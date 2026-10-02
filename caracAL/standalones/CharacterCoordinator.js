const child_process = require("node:child_process");
const account_info = require("../account_info");
const game_files = require("../game_files");
const bwi = require("bot-web-interface");
const monitoring_util = require("../monitoring_util");
const express = require("express");
const fs_regular = require("node:fs");
const {
  LOCALSTORAGE_PATH,
  LOCALSTORAGE_ROTA_PATH,
  STAT_BEAT_INTERVAL,
} = require("../src/CONSTANTS");
const { log, console, ctype_to_clid } = require("../src/LogUtils");

const FileStoredKeyValues = require("../src/FileStoredKeyValues");
const {
  CONTROL_ACTIONS,
  DESIRED_RUNTIME_STATES,
} = require("../src/CharacterControl");
const { DiagnosticEventStore } = require("../src/DiagnosticStore");
const { attachHeadlessDashboard } = require("../src/HeadlessDashboard");
const { updateCharacterLiveState } = require("../src/LiveState");
const {
  LIFECYCLE_STATES,
  computeRestartDelay,
  countActiveCharacters,
  getInitialStartupCharacters,
  isHeartbeatStale,
  readLifecyclePolicy,
} = require("../src/CharacterLifecyclePolicy");

//TODO check for invalid session
//TODO improve termination
//MAYBE improve linux service
//MAYBE exclude used versions

function partition(a, fun) {
  const ret = [[], []];
  for (let i = 0; i < a.length; i++)
    if (fun(a[i])) ret[0].push(a[i]);
    else ret[1].push(a[i]);
  return ret;
}

//note to self: how to promisify event emitter(once)
//const someAsyncFunction = util.promisify(myEmitter.once).bind(myEmitter);

function migrate_old_storage(path, localStorage) {
  let file_contents;
  try {
    file_contents = fs_regular.readFileSync(path, "utf8");
  } catch (err) {
    log.info(
      { type: "ls_migration_none", path },
      "localStorage migration unnecessary",
    );
    return;
  }
  if (file_contents.length > 0) {
    const json_object = JSON.parse(file_contents);
    for (let [key, value] of Object.entries(json_object)) {
      localStorage.set(key, value);
    }
    log.info(
      { type: "ls_migration", path, value: Object.keys(json_object).length },
      "localStorage migrated",
    );
  }
  fs_regular.unlinkSync(path);
  log.info({ type: "ls_migration_done", path }, "old localStorage deleted");
  return;
}

(async () => {
  const localStorage = new FileStoredKeyValues(
    LOCALSTORAGE_PATH,
    LOCALSTORAGE_ROTA_PATH,
  );

  //migrate from old library which stored everything in single file
  migrate_old_storage("./localStorage/storage.json", localStorage);

  const sessionStorage = new Map();
  localStorage.set("caracAL", "Yeah");
  sessionStorage.set("caracAL", "Yup");

  const version = await game_files.ensure_latest();

  const cfg = require("../config");
  const lifecycle_policy = readLifecyclePolicy(cfg);
  let coordinator_shutting_down = false;
  if (cfg.cull_versions) {
    await game_files.cull_versions([version]);
  }
  const sess = process.env.AL_SESSION || cfg.session;
  const my_acc = await account_info(sess);
  const default_realm = my_acc.response.servers[0];

  const character_manage = cfg.characters;
  const diagnostic_store = new DiagnosticEventStore({ maxEvents: 20000 });

  //TODO right now this server wont terminate.
  //this is fine atm because caracAL does not terminate when all chars stop.
  //when I change this in the future this might change as well.
  let bwi_instance = {};
  let dashboard = null;
  let owned_web_server = null;
  try {
    const web_port = (cfg.web_app && cfg.web_app.port) || 924;
    const dashboard_enabled =
      !cfg.web_app || cfg.web_app.enable_headless_dashboard !== false;

    if (cfg.web_app && (cfg.web_app.enable_bwi || cfg.web_app.enable_minimap)) {
      bwi_instance = new bwi({
        port: web_port,
        password: null,
        updateRate: STAT_BEAT_INTERVAL,
      });
    }

    let express_inst = bwi_instance.router;
    const ensure_express = () => {
      if (!express_inst) {
        express_inst = express();
        owned_web_server = express_inst.listen(web_port, "127.0.0.1");
      }
      return express_inst;
    };

    if (dashboard_enabled) {
      dashboard = attachHeadlessDashboard({
        router: ensure_express(),
        express,
        characterManage: character_manage,
        lifecyclePolicy: lifecycle_policy,
        controlCharacter: control_character,
        diagnosticStore: diagnostic_store,
      });
      log.info(
        {
          type: "headless_dashboard_started",
          port: web_port,
          path: "/headless",
        },
        `Headless dashboard available on http://localhost:${web_port}/headless`,
      );
    }

    if (cfg.web_app && cfg.web_app.expose_CODE) {
      ensure_express();
      log.info(
        { type: "CODE_exposed", src_path: __dirname + "/../CODE" },
        "Serving CODE statically",
      );
      express_inst.use("/CODE", express.static(__dirname + "/../CODE"));
    }
    if (cfg.web_app && cfg.web_app.expose_TYPECODE && cfg.enable_TYPECODE) {
      ensure_express();
      log.info(
        { type: "TYPECODE_exposed", src_path: __dirname + "/../TYPECODE.out" },
        "Serving TYPECODE statically",
      );
      express_inst.use(
        "/TYPECODE",
        express.static(__dirname + "/../TYPECODE.out"),
      );
    }
  } catch (e) {
    console.error(`failed to start web services.`, e);
    console.error(`no web services will be available`);
  }

  function safe_send(target, data) {
    if (target) {
      target.send(data, undefined, undefined, (e) => {
        //This can occur due to node closing ipc
        //before firing its close handlers
        if (e) {
          //console.error(`failed to send ipc`);
          //console.error(`target: `,target);
        }
      });
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function capture_character_stream(stream, char_name, stream_name) {
    if (!stream) return;

    let buffer = "";
    const flush_line = (line) => {
      const message = line.trimEnd();
      if (!message) return;
      diagnostic_store.append({
        type: "character_log",
        event:
          stream_name === "stderr" ? "CHARACTER_STDERR" : "CHARACTER_STDOUT",
        character: char_name,
        stream: stream_name,
        message,
      });
    };

    stream.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline_index = buffer.indexOf("\n");

      while (newline_index >= 0) {
        flush_line(buffer.slice(0, newline_index));
        buffer = buffer.slice(newline_index + 1);
        newline_index = buffer.indexOf("\n");
      }
    });

    stream.on("end", () => {
      if (buffer) flush_line(buffer);
      buffer = "";
    });
  }

  function emit_supervisor_event(event, char_name, details = {}) {
    const payload = {
      type: "supervisor_event",
      event,
      character: char_name || null,
      timestamp: Date.now(),
      ...details,
    };
    const sanitized_payload = diagnostic_store.append(payload);
    log.info(
      sanitized_payload,
      char_name ? `supervisor ${event}: ${char_name}` : `supervisor ${event}`,
    );
    dashboard?.publish(sanitized_payload);
  }

  function set_lifecycle_state(char_name, state, reason) {
    const char_block = character_manage[char_name];
    if (!char_block) return;
    if (char_block.lifecycle_state === state && !reason) return;
    const previous = char_block.lifecycle_state || LIFECYCLE_STATES.STOPPED;
    char_block.lifecycle_state = state;
    log.info(
      {
        type: "character_lifecycle",
        character: char_name,
        previous,
        state,
        reason: reason || null,
      },
      `${char_name} lifecycle ${previous} -> ${state}`,
    );
    emit_supervisor_event("CHARACTER_LIFECYCLE", char_name, {
      previous,
      state,
      reason: reason || null,
    });
  }

  function clear_restart_timer(char_block) {
    if (char_block && char_block.restart_timer) {
      clearTimeout(char_block.restart_timer);
      char_block.restart_timer = null;
    }
  }

  function clear_stable_timer(char_block) {
    if (char_block && char_block.stable_timer) {
      clearTimeout(char_block.stable_timer);
      char_block.stable_timer = null;
    }
  }

  function initialize_char_block(char_name, char_block) {
    char_block.name = char_name;
    char_block.connected = false;
    char_block.lifecycle_state =
      char_block.lifecycle_state || LIFECYCLE_STATES.STOPPED;
    char_block.restart_attempts = char_block.restart_attempts || 0;
    char_block.restart_timer = char_block.restart_timer || null;
    char_block.stable_timer = char_block.stable_timer || null;
    char_block.controlled_restart = false;
    char_block.last_heartbeat_at = char_block.last_heartbeat_at || 0;
    char_block.last_heartbeat_pid = char_block.last_heartbeat_pid || null;
    char_block.watchdog_recovery_in_progress = false;
    char_block.live_state = char_block.live_state || null;
    char_block.movement_trail = Array.isArray(char_block.movement_trail)
      ? char_block.movement_trail
      : [];
    char_block.desired_runtime_state =
      char_block.desired_runtime_state ||
      (char_block.enabled
        ? DESIRED_RUNTIME_STATES.RUNNING
        : DESIRED_RUNTIME_STATES.STOPPED);
    return char_block;
  }

  function schedule_restart(char_name, reason) {
    const char_block = character_manage[char_name];
    if (
      !char_block ||
      !char_block.enabled ||
      coordinator_shutting_down ||
      char_block.restart_timer
    ) {
      return;
    }

    char_block.restart_attempts += 1;
    const delay = computeRestartDelay(
      char_block.restart_attempts,
      lifecycle_policy,
    );
    set_lifecycle_state(char_name, LIFECYCLE_STATES.BACKOFF, reason);
    log.warn(
      {
        type: "character_restart_scheduled",
        character: char_name,
        attempt: char_block.restart_attempts,
        delay_ms: delay,
        reason,
      },
      `restart for ${char_name} scheduled in ${delay}ms`,
    );

    char_block.restart_timer = setTimeout(() => {
      char_block.restart_timer = null;
      if (!char_block.enabled || coordinator_shutting_down) return;
      const started = start_char(char_name);
      if (!started && char_block.enabled && !coordinator_shutting_down) {
        schedule_restart(char_name, "slot_unavailable");
      }
    }, delay);
  }
  //attempts to softkill child processes
  //by sending an ipc if the client is connected and giving some timeout
  //why not actual SIGTERM? cause windows cant even
  async function softkill_block(char_block) {
    const proc = char_block.instance;
    if (proc) {
      set_lifecycle_state(
        char_block.name,
        LIFECYCLE_STATES.STOPPING,
        "shutdown_requested",
      );
      if (char_block.connected) {
        console.log("telling client to self-terminate");
        safe_send(proc, {
          type: "closing_client",
        });
        const ended_graceful = await Promise.race([
          sleep(500),
          new Promise((resolve) => {
            proc.on("exit", function () {
              console.log("Client terminated gracefully");
              resolve(true);
            });
          }),
        ]);
        if (ended_graceful) {
          return;
        }
      }
      console.log("Hard-terminating client");
      proc.kill("SIGKILL");
    }
  }

  function update_siblings_and_acc(info) {
    const sib_names = Object.keys(character_manage)
      .filter((x) => character_manage[x].connected)
      .sort();

    sib_names.forEach((char) => {
      safe_send(character_manage[char].instance, {
        type: "siblings_and_acc",
        account: info,
        siblings: sib_names,
      });
    });
  }

  function make_control_error(code, message, statusCode) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
  }

  async function control_character(char_name, action) {
    const char_block = character_manage[char_name];
    if (!char_block) {
      throw make_control_error(
        "CHARACTER_NOT_FOUND",
        `Unknown character: ${char_name}`,
        404,
      );
    }

    switch (action) {
      case CONTROL_ACTIONS.START: {
        if (
          !char_block.instance &&
          countActiveCharacters(character_manage) >=
            lifecycle_policy.maxOnlineCharacters
        ) {
          throw make_control_error(
            "CHARACTER_SLOT_LIMIT",
            "Maximum online character count reached",
            409,
          );
        }

        char_block.enabled = true;
        char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;
        clear_restart_timer(char_block);

        emit_supervisor_event("CHARACTER_CONTROL_REQUESTED", char_name, {
          action,
          desired_runtime_state: char_block.desired_runtime_state,
        });

        if (char_block.instance) {
          safe_send(char_block.instance, {
            type: "runtime_control",
            state: DESIRED_RUNTIME_STATES.RUNNING,
          });
        } else {
          start_char(char_name);
        }
        break;
      }

      case CONTROL_ACTIONS.PAUSE:
        if (!char_block.instance) {
          throw make_control_error(
            "CHARACTER_NOT_ONLINE",
            "A stopped character cannot be paused",
            409,
          );
        }

        char_block.enabled = true;
        char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.PAUSED;
        emit_supervisor_event("CHARACTER_CONTROL_REQUESTED", char_name, {
          action,
          desired_runtime_state: char_block.desired_runtime_state,
        });
        safe_send(char_block.instance, {
          type: "runtime_control",
          state: DESIRED_RUNTIME_STATES.PAUSED,
        });
        break;

      case CONTROL_ACTIONS.STOP:
        char_block.enabled = false;
        char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.STOPPED;
        clear_restart_timer(char_block);
        clear_stable_timer(char_block);
        emit_supervisor_event("CHARACTER_CONTROL_REQUESTED", char_name, {
          action,
          desired_runtime_state: char_block.desired_runtime_state,
        });

        if (char_block.instance) {
          await softkill_block(char_block);
        } else {
          set_lifecycle_state(
            char_name,
            LIFECYCLE_STATES.STOPPED,
            "manual_stop",
          );
        }
        break;

      default:
        throw make_control_error(
          "INVALID_CONTROL_ACTION",
          `Unsupported control action: ${action}`,
          400,
        );
    }

    return {
      character: char_name,
      action,
      desired_runtime_state: char_block.desired_runtime_state,
      lifecycle_state: char_block.lifecycle_state,
    };
  }

  function start_char(char_name) {
    const char_block = character_manage[char_name];
    if (!char_block || !char_block.enabled || coordinator_shutting_down) {
      return null;
    }
    if (char_block.instance) {
      return char_block.instance;
    }
    if (
      countActiveCharacters(character_manage) >=
      lifecycle_policy.maxOnlineCharacters
    ) {
      set_lifecycle_state(
        char_name,
        LIFECYCLE_STATES.BACKOFF,
        "max_online_characters",
      );
      log.warn(
        {
          type: "character_start_blocked",
          character: char_name,
          max_online_characters: lifecycle_policy.maxOnlineCharacters,
        },
        `not starting ${char_name}: online character limit reached`,
      );
      return null;
    }

    clear_restart_timer(char_block);
    set_lifecycle_state(
      char_name,
      LIFECYCLE_STATES.STARTING,
      "start_requested",
    );

    let realm = my_acc.resolve_realm(char_block.realm);
    if (!realm) {
      console.warn(
        `could not find realm ${char_block.realm},`,
        `falling back to realm ${default_realm.key}`,
      );
      char_block.realm = default_realm.key;
      realm = default_realm;
    }
    const char = my_acc.resolve_char(char_name);
    //class is char.type
    if (!char) {
      console.error(
        `could not resolve character ${char_name}`,
        `this character will not be started`,
      );
      console.error(
        "are you sure you own this character and have not deleted it?",
      );
      char_block.enabled = false;
      set_lifecycle_state(
        char_name,
        LIFECYCLE_STATES.ERROR,
        "character_not_owned",
      );
      return null;
    }
    const g_version = char_block.version || version;
    console.log(
      `starting ${char_name} running version ${g_version} in ${char_block.realm}`,
    );
    const args = {
      version: g_version,
      realm_addr: realm.addr,
      realm_port: realm.port,
      sess: sess,
      cid: char.id,
      script_file: char_block.script,
      enable_map: !!(cfg.web_app && cfg.web_app.enable_minimap),
      cname: char_name,
      clid: ctype_to_clid[char.type] || -1,
      heartbeat_interval_ms: lifecycle_policy.heartbeatIntervalMs,
      runtime_state: char_block.desired_runtime_state,
    };
    if (cfg.enable_TYPECODE) {
      args.typescript_file = char_block.typescript;
    }

    const result = child_process.fork("./src/CharacterThread.js", [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    capture_character_stream(result.stdout, char_name, "stdout");
    capture_character_stream(result.stderr, char_name, "stderr");
    result.stdout.pipe(process.stdout);
    result.stderr.pipe(process.stderr);
    char_block.instance = result;
    char_block.last_heartbeat_at = Date.now();
    char_block.last_heartbeat_pid = result.pid || null;
    char_block.watchdog_recovery_in_progress = false;
    emit_supervisor_event("CHARACTER_PROCESS_STARTED", char_name, {
      pid: result.pid || null,
    });

    result.on("exit", (code, signal) => {
      if (char_block.monitor) {
        //close monitor
        char_block.monitor.destroy();
        char_block.monitor = null;
      }
      clear_stable_timer(char_block);
      char_block.connected = false;
      char_block.watchdog_recovery_in_progress = false;
      emit_supervisor_event("CHARACTER_PROCESS_EXITED", char_name, {
        code,
        signal,
        pid: result.pid || null,
      });
      if (char_block.instance === result) {
        char_block.instance = null;
      }

      const controlled_restart = char_block.controlled_restart;
      char_block.controlled_restart = false;

      if (
        controlled_restart &&
        char_block.enabled &&
        !coordinator_shutting_down
      ) {
        char_block.restart_attempts = 0;
        set_lifecycle_state(
          char_name,
          LIFECYCLE_STATES.STOPPED,
          "controlled_restart",
        );
        setTimeout(
          () => start_char(char_name),
          lifecycle_policy.startupStaggerMs,
        );
        return;
      }

      if (char_block.enabled && !coordinator_shutting_down) {
        schedule_restart(
          char_name,
          `unexpected_exit(code=${code},signal=${signal})`,
        );
      } else {
        set_lifecycle_state(
          char_name,
          LIFECYCLE_STATES.STOPPED,
          coordinator_shutting_down ? "coordinator_shutdown" : "disabled",
        );
      }
    });
    result.on("message", (m) => {
      switch (m.type) {
        case "process_ready":
          set_lifecycle_state(
            char_name,
            LIFECYCLE_STATES.CONNECTING,
            "process_ready",
          );
          safe_send(result, {
            type: "process_args",
            arguments: args,
          });
          break;
        case "initialized":
          emit_supervisor_event("CHARACTER_INITIALIZED", char_name, {
            pid: result.pid || null,
          });
          break;
        case "runtime_state_applied":
          if (m.state === DESIRED_RUNTIME_STATES.PAUSED) {
            set_lifecycle_state(
              char_name,
              LIFECYCLE_STATES.PAUSED,
              "runtime_control_applied",
            );
          } else if (
            m.state === DESIRED_RUNTIME_STATES.RUNNING &&
            char_block.connected
          ) {
            set_lifecycle_state(
              char_name,
              LIFECYCLE_STATES.ONLINE,
              "runtime_control_applied",
            );
          }
          emit_supervisor_event("CHARACTER_CONTROL_APPLIED", char_name, {
            state: m.state,
          });
          break;
        case "heartbeat":
          char_block.last_heartbeat_at =
            Number.isFinite(m.timestamp) && m.timestamp > 0
              ? m.timestamp
              : Date.now();
          char_block.last_heartbeat_pid = m.pid || result.pid || null;
          break;
        case "stat_beat":
          updateCharacterLiveState(char_block, m);
          dashboard?.publishSnapshot();
          break;

        case "connected":
          char_block.connected = true;
          char_block.last_heartbeat_at = Date.now();
          char_block.watchdog_recovery_in_progress = false;
          set_lifecycle_state(char_name, LIFECYCLE_STATES.ONLINE, "connected");
          safe_send(result, {
            type: "runtime_control",
            state: char_block.desired_runtime_state,
          });
          emit_supervisor_event("CHARACTER_CONNECTED", char_name, {
            pid: result.pid || null,
          });
          clear_stable_timer(char_block);
          char_block.stable_timer = setTimeout(() => {
            char_block.restart_attempts = 0;
            char_block.stable_timer = null;
            log.info(
              {
                type: "character_restart_backoff_reset",
                character: char_name,
              },
              `restart backoff reset for ${char_name}`,
            );
          }, lifecycle_policy.restartResetMs);
          update_siblings_and_acc(my_acc.response);
          break;
        case "deploy":
          //check for existing charblock, adjust parameters and kill it
          //or not find any, make a new one and start it
          const new_char_name = m.character || char_name;
          const candidate = initialize_char_block(
            new_char_name,
            character_manage[new_char_name] || {},
          );
          character_manage[new_char_name] = candidate;
          candidate.enabled = true;
          candidate.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;
          candidate.realm = m.realm || char_block.realm;
          if (char_block.typescript && char_block.typescript.length > 0) {
            candidate.typescript = m.script || char_block.typescript;
          } else {
            candidate.script = m.script || char_block.script;
            candidate.typescript = null;
          }
          candidate.script = m.script || char_block.script;
          candidate.version = m.version || char_block.version;
          if (candidate.instance) {
            candidate.controlled_restart = true;
            softkill_block(candidate);
          } else {
            candidate.connected = false;
            start_char(new_char_name);
          }
          break;
        case "shutdown":
          if (m.character) {
            const candidate = character_manage[m.character] || {};

            console.log(
              `shutdown requested for ${m.character} from ${char_name}`,
            );
            candidate.enabled = false;
            candidate.desired_runtime_state = DESIRED_RUNTIME_STATES.STOPPED;
            softkill_block(candidate);
          } else {
            console.log("shutdown requested from " + char_name);
            char_block.enabled = false;
            char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.STOPPED;
            softkill_block(char_block);
          }
          break;
        case "cm":
          let recipients = m.to;
          if (!Array.isArray(recipients)) {
            recipients = [recipients];
          }
          const [locs, globs] = partition(
            recipients,
            (x) => character_manage[x] && character_manage[x].connected,
          );
          if (globs.length > 0) {
            safe_send(char_block.instance, {
              type: "send_cm",
              to: globs,
              data: m.data,
            });
          }
          locs.forEach((blk) => {
            safe_send(character_manage[blk].instance, {
              type: "receive_cm",
              name: char_name,
              data: m.data,
            });
          });
          break;
        //localStorage and sessionStorage related
        case "stor":
          const trg_store = m.ident == "ls" ? localStorage : sessionStorage;
          switch (m.op) {
            case "set":
              for (let key in m.data) {
                trg_store.set(key, m.data[key]);
              }
              break;
            case "del":
              for (let key of m.data) {
                trg_store.delete(key);
              }
              break;
            case "clear":
              for (let [key, value] of trg_store.entries()) {
                trg_store.delete(key);
              }
              break;
            case "init":
              const catchup_data = {};
              for (let [key, value] of trg_store.entries()) {
                catchup_data[key] = value;
              }
              safe_send(char_block.instance, {
                type: "stor",
                op: "set",
                ident: m.ident,
                data: catchup_data,
              });
              break;
            default:
              break;
          }
          if (m.op != "init") {
            //forward to other running processes
            Object.values(character_manage)
              .filter((x) => x.instance)
              .forEach((block) => {
                safe_send(block.instance, m);
              });
          }
          break;
        default:
          break;
      }
    });
    if (bwi_instance.publisher) {
      char_block.monitor = monitoring_util.create_monitor_ui(
        bwi_instance,
        char_name,
        char_block,
        cfg.web_app.enable_minimap,
      );
    }

    return result;
  }
  //TODO beta new logic for #5
  //i need to implement decent lifecycle-handling
  let last_watchdog_tick_at = Date.now();
  const watchdog_task = setInterval(() => {
    if (coordinator_shutting_down) return;
    const now = Date.now();
    const watchdog_gap_ms = now - last_watchdog_tick_at;
    last_watchdog_tick_at = now;

    if (watchdog_gap_ms > lifecycle_policy.heartbeatTimeoutMs) {
      Object.values(character_manage).forEach((char_block) => {
        if (char_block.instance) {
          char_block.last_heartbeat_at = now;
        }
      });
      emit_supervisor_event("WATCHDOG_CLOCK_GAP", null, {
        gap_ms: watchdog_gap_ms,
        heartbeat_timeout_ms: lifecycle_policy.heartbeatTimeoutMs,
      });
      return;
    }

    Object.entries(character_manage).forEach(([char_name, char_block]) => {
      if (
        !char_block.instance ||
        char_block.watchdog_recovery_in_progress ||
        !isHeartbeatStale(
          char_block.last_heartbeat_at,
          now,
          lifecycle_policy.heartbeatTimeoutMs,
        )
      ) {
        return;
      }

      char_block.watchdog_recovery_in_progress = true;
      const age_ms = now - char_block.last_heartbeat_at;
      set_lifecycle_state(
        char_name,
        LIFECYCLE_STATES.ERROR,
        "heartbeat_timeout",
      );
      emit_supervisor_event("CHARACTER_HEARTBEAT_TIMEOUT", char_name, {
        age_ms,
        timeout_ms: lifecycle_policy.heartbeatTimeoutMs,
        pid: char_block.last_heartbeat_pid,
      });
      softkill_block(char_block);
    });
  }, lifecycle_policy.watchdogIntervalMs);
  watchdog_task.unref();

  ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) =>
    process.on(signal, async () => {
      if (coordinator_shutting_down) return;
      coordinator_shutting_down = true;
      clearInterval(watchdog_task);
      emit_supervisor_event("COORDINATOR_SHUTDOWN", null, { signal });
      dashboard?.close();
      if (owned_web_server) {
        owned_web_server.close();
      }
      console.log(`Received ${signal} on master. Rounding up clients`);
      //softkill all chars, giving them chance to shutdown
      await Promise.all(
        Object.values(character_manage).map((char_block) => {
          char_block.enabled = false;
          char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.STOPPED;
          clear_restart_timer(char_block);
          clear_stable_timer(char_block);
          return softkill_block(char_block);
        }),
      );
      console.log("now truly exiting");
      process.exit();
    }),
  );

  Object.entries(character_manage).forEach(([char_name, char_block]) => {
    initialize_char_block(char_name, char_block);
  });

  const requested_startup = Object.values(character_manage).filter(
    (char_block) => char_block.enabled,
  ).length;
  const startup_chars = getInitialStartupCharacters(
    character_manage,
    lifecycle_policy.maxOnlineCharacters,
  );
  if (requested_startup > startup_chars.length) {
    log.warn(
      {
        type: "character_startup_limit",
        requested: requested_startup,
        scheduled: startup_chars.length,
        max_online_characters: lifecycle_policy.maxOnlineCharacters,
      },
      "configured characters exceed the online character limit",
    );
  }

  emit_supervisor_event("COORDINATOR_READY", null, {
    max_online_characters: lifecycle_policy.maxOnlineCharacters,
    heartbeat_interval_ms: lifecycle_policy.heartbeatIntervalMs,
    heartbeat_timeout_ms: lifecycle_policy.heartbeatTimeoutMs,
    watchdog_interval_ms: lifecycle_policy.watchdogIntervalMs,
    scheduled_characters: startup_chars,
  });

  startup_chars.forEach((char_name, index) => {
    const delay = index * lifecycle_policy.startupStaggerMs;
    setTimeout(() => start_char(char_name), delay);
  });

  my_acc.add_listener(update_siblings_and_acc);
})().catch((e) => {
  console.error("failed to start caracAL", e);
});

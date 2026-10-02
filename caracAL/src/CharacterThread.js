const vm = require("vm");
const io = require("socket.io-client");
const fs = require("fs").promises;
const node_query = require("jquery");
const game_files = require("../game_files");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const monitoring_util = require("../monitoring_util");
const ipc_storage = require("../ipcStorage");
const { DESIRED_RUNTIME_STATES } = require("./CharacterControl");
const { normalizeRuntimeEvent } = require("./RuntimeEventBridge");
const { normalizeIpcMessage, sendIpcMessage } = require("./IpcProtocol");
const { prepareConfigPush } = require("./CharacterConfigService");
const { createIsolatedBrowserContext } = require("./BrowserVmContext");
const {
  installCrossRealmClone,
  setAdventureLandAuthCookie,
} = require("./AdventureLandVmCompat");

const LogUtils = require("./LogUtils");
const { console } = LogUtils;

function acceptedIpcMessage(rawMessage) {
  const normalized = normalizeIpcMessage(rawMessage);
  return normalized.ok ? normalized.message : null;
}

process.on("unhandledRejection", function (exception) {
  console.warn("promise rejected: \n", exception);
});

const html_spoof = `<!DOCTYPE html>
<html>
<head>
<title>Adventure Land</title>
</head>
<body>
</body>
</html>`;

function make_context(upper = null) {
  const browser = createIsolatedBrowserContext(html_spoof);
  const result = browser.context;
  result.globalThis = result;
  result.fetch = fetch;
  result.$ = result.jQuery = node_query(browser.window);
  result.require = require;
  result.console = console;
  Object.defineProperty(result, "__caracalDom", {
    value: browser.dom,
    enumerable: false,
  });
  if (upper) {
    Object.defineProperty(result, "parent", { value: upper });
    result._localStorage = upper._localStorage;
    result._sessionStorage = upper._sessionStorage;
  } else {
    result._localStorage = ipc_storage.make_IPC_storage("ls");
    result._sessionStorage = ipc_storage.make_IPC_storage("ss");
  }

  result.eval = function (arg) {
    return vm.runInContext(arg, result);
  };

  return result;
}

async function ev_files(locations, context) {
  for (let location of locations) {
    let text = await fs.readFile(location, "utf8");
    vm.runInContext(text + "\n//# sourceURL=file://" + location, context);
    if (
      location.endsWith("/old_common_functions.js") ||
      location.endsWith("\\old_common_functions.js")
    ) {
      installCrossRealmClone(context);
    }
  }
}

async function make_runner(upper, CODE_file, version, is_typescript) {
  const runner_sources = game_files
    .get_runner_files()
    .map((f) => game_files.locate_game_file(f, version));
  console.log("constructing runner instance");
  console.debug("source files:\n%s", runner_sources);
  const runner_context = make_context(upper);
  //contents of adventure.land/runner
  //its an html file but not labeled as such
  //TODO in the future i should consider parsing the relevant parts out of the html files directly
  //for the runners as well as the instances
  vm.runInContext(
    "var active=false,catch_errors=true,Place='code',is_code=1,is_server=0,is_game=0,is_bot=parent.is_bot,is_cli=parent.is_cli,is_sdk=parent.is_sdk,Dev=parent.Dev,Staging=parent.Staging,Prod=parent.Prod,Local=parent.Local;",
    runner_context,
  );
  await ev_files(runner_sources, runner_context);
  runner_context.send_cm = function (to, data) {
    sendIpcMessage(process, {
      type: "cm",
      to,
      data,
    });
  };
  //we need to do this here because of scoping
  upper.caracAL.load_scripts = async function (locations) {
    if (!is_typescript) {
      return await ev_files(
        locations.map((x) => "./CODE/" + x),
        runner_context,
      );
    } else {
      throw new Exception(
        "Runtime Loading Code is not supported in Typescript Mode.\nUse an import instead",
      );
    }
  };
  vm.runInContext(
    "active = true;parent.code_active = true;set_message('Code Active');if (character.rip) character.trigger('death', {past: true});",
    runner_context,
  );

  process.on("message", (rawMessage) => {
    const m = acceptedIpcMessage(rawMessage);
    if (!m) return;
    switch (m.type) {
      case "closing_client":
        console.log("terminating self");
        vm.runInContext("on_destroy()", runner_context);
        process.exit();
        //vscode says this is unreachable.
        //with how whack node is better be safe
        break;
      case "inventory_live_test": {
        const requestId =
          typeof m.request_id === "string" && m.request_id
            ? m.request_id
            : "inventory-live-" + Date.now();
        const runtime = runner_context.__caracalBotRuntime;
        if (!runtime?.runInventoryIntelligenceLiveTest) {
          sendIpcMessage(process, {
            type: "inventory_live_test_result",
            request_id: requestId,
            error: "INVENTORY_LIVE_TEST_RUNTIME_NOT_READY",
          });
          break;
        }

        try {
          const result = runtime.runInventoryIntelligenceLiveTest({
            requestId,
          });
          sendIpcMessage(process, {
            type: "inventory_live_test_result",
            request_id: requestId,
            result,
          });
        } catch (error) {
          sendIpcMessage(process, {
            type: "inventory_live_test_result",
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "farm_live_test": {
        const requestId =
          typeof m.request_id === "string" && m.request_id
            ? m.request_id
            : "farm-live-" + Date.now();
        const runtime = runner_context.__caracalBotRuntime;
        if (!runtime?.runFarmIntelligenceLiveTest) {
          sendIpcMessage(process, {
            type: "farm_live_test_result",
            request_id: requestId,
            error: "FARM_LIVE_TEST_RUNTIME_NOT_READY",
          });
          break;
        }

        void runtime
          .runFarmIntelligenceLiveTest({
            requestId,
            sampleMs: Number.isFinite(Number(m.sample_ms))
              ? Number(m.sample_ms)
              : undefined,
          })
          .then((result) => {
            sendIpcMessage(process, {
              type: "farm_live_test_result",
              request_id: requestId,
              result,
            });
          })
          .catch((error) => {
            sendIpcMessage(process, {
              type: "farm_live_test_result",
              request_id: requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        break;
      }
      case "group_live_test": {
        const requestId =
          typeof m.request_id === "string" && m.request_id
            ? m.request_id
            : "group-live-" + Date.now();
        const runtime = runner_context.__caracalBotRuntime;
        if (!runtime?.runGroupLiveTest) {
          sendIpcMessage(process, {
            type: "group_live_test_result",
            request_id: requestId,
            error: "GROUP_LIVE_TEST_RUNTIME_NOT_READY",
          });
          break;
        }

        void runtime
          .runGroupLiveTest({
            requestId,
            role: m.role,
            leader: m.leader,
            peer: m.peer,
            baselinePairFormed:
              typeof m.baselinePairFormed === "boolean"
                ? m.baselinePairFormed
                : undefined,
            coordinatedPair: m.coordinatedPair === true,
          })
          .then((result) => {
            sendIpcMessage(process, {
              type: "group_live_test_result",
              request_id: requestId,
              result,
            });
          })
          .catch((error) => {
            sendIpcMessage(process, {
              type: "group_live_test_result",
              request_id: requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        break;
      }
      case "class_skill_live_test": {
        const requestId =
          typeof m.request_id === "string" && m.request_id
            ? m.request_id
            : `class-skill-live-${Date.now()}`;
        const runtime = runner_context.__caracalBotRuntime;
        if (!runtime?.runClassSkillLiveTest) {
          sendIpcMessage(process, {
            type: "class_skill_live_test_result",
            request_id: requestId,
            error: "CLASS_SKILL_LIVE_TEST_RUNTIME_NOT_READY",
          });
          break;
        }

        void runtime
          .runClassSkillLiveTest({ requestId })
          .then((result) => {
            sendIpcMessage(process, {
              type: "class_skill_live_test_result",
              request_id: requestId,
              result,
            });
          })
          .catch((error) => {
            sendIpcMessage(process, {
              type: "class_skill_live_test_result",
              request_id: requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        break;
      }
      case "combat_live_test": {
        const requestId =
          typeof m.request_id === "string" && m.request_id
            ? m.request_id
            : `combat-live-${Date.now()}`;
        const runtime = runner_context.__caracalBotRuntime;
        if (!runtime?.runCombatLiveTest) {
          sendIpcMessage(process, {
            type: "combat_live_test_result",
            request_id: requestId,
            error: "COMBAT_LIVE_TEST_RUNTIME_NOT_READY",
          });
          break;
        }

        void runtime
          .runCombatLiveTest({ requestId })
          .then((result) => {
            sendIpcMessage(process, {
              type: "combat_live_test_result",
              request_id: requestId,
              result,
            });
          })
          .catch((error) => {
            sendIpcMessage(process, {
              type: "combat_live_test_result",
              request_id: requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        break;
      }
      case "movement_live_test": {
        const requestId =
          typeof m.request_id === "string" && m.request_id
            ? m.request_id
            : `movement-live-${Date.now()}`;
        const runtime = runner_context.__caracalBotRuntime;
        if (!runtime?.runMovementLiveTest) {
          sendIpcMessage(process, {
            type: "movement_live_test_result",
            request_id: requestId,
            error: "MOVEMENT_LIVE_TEST_RUNTIME_NOT_READY",
          });
          break;
        }

        void runtime
          .runMovementLiveTest({ requestId })
          .then((result) => {
            sendIpcMessage(process, {
              type: "movement_live_test_result",
              request_id: requestId,
              result,
            });
          })
          .catch((error) => {
            sendIpcMessage(process, {
              type: "movement_live_test_result",
              request_id: requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        break;
      }
    }
  });

  //so.
  //these should send a shutdown to parent
  //parent deletes instance and marks them inactive
  //if its duplicate then no instance and no double shutdown
  ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) =>
    process.on(signal, async () => {
      console.log(`Received ${signal} on client. Requesting termination`);
      sendIpcMessage(process, {
        type: "shutdown",
      });
    }),
  );

  //awaits the arrival of a message from parent process
  //indicating the servers_and_characters proxy that we use
  const connected_signoff = new Promise((resolve) => {
    process.on("message", (rawMessage) => {
      const m = acceptedIpcMessage(rawMessage);
      if (!m) return;
      switch (m.type) {
        case "siblings_and_acc":
          resolve();
          break;
      }
    });
  });

  sendIpcMessage(process, { type: "connected" });

  console.log("runner instance constructed");
  monitoring_util.register_stat_beat(upper);
  //Fix a bug where parent.X is initially empty
  await connected_signoff;
  await ev_files([CODE_file], runner_context);
  //TODO put a process end handler here

  return runner_context;
}

async function make_game(proc_args) {
  const game_sources_before_html_vars = game_files
    .get_game_files_before_html_vars()
    .map((f) => game_files.locate_game_file(f, proc_args.version));
  const game_sources_after_html_vars = game_files
    .get_game_files_after_html_vars()
    .map((f) => game_files.locate_game_file(f, proc_args.version));
  const game_sources = game_sources_before_html_vars
    .concat(["./html_vars.js"])
    .concat(game_sources_after_html_vars);
  console.log("constructing game instance");
  console.debug("source files:\n%s", game_sources);
  const game_context = make_context();
  game_context.Place = "game";
  setAdventureLandAuthCookie(game_context, proc_args.sess);
  const serverAddress = proc_args.realm_address || proc_args.realm_addr;
  const serverPath = proc_args.realm_path || "/socket.io";
  game_context.io = io;
  game_context.bowser = {};
  game_context.server_address = serverAddress;
  game_context.server_path = serverPath;
  await ev_files(game_sources_before_html_vars, game_context);
  await ev_files(["./html_vars.js"], game_context);
  await ev_files(game_sources_after_html_vars, game_context);
  game_context.VERSION = "" + game_context.G.version;
  game_context.server_address = serverAddress;
  game_context.server_path = serverPath;
  game_context.server_addr = proc_args.realm_addr || serverAddress;
  game_context.server_port = proc_args.realm_port;
  game_context.user_id = proc_args.sess.split("-")[0];
  game_context.user_auth = proc_args.sess.split("-")[1];
  game_context.character_to_load = proc_args.cid;

  //expose the block under parent.caracAL
  const extensions = {};

  extensions.log = LogUtils.log;
  extensions.runtime_state =
    proc_args.runtime_state || DESIRED_RUNTIME_STATES.RUNNING;
  extensions.code_revision = proc_args.code_revision || null;
  extensions.config_revision = proc_args.config_revision || null;
  extensions.source_revision = proc_args.source_revision || null;
  const initialConfig = prepareConfigPush(
    0,
    proc_args.character_config_revision || 0,
    proc_args.character_config || {},
  );
  extensions.config = initialConfig.config;
  extensions.runtime_config_revision = initialConfig.revision;
  extensions.emergency_stop = !!proc_args.emergency_stop?.active;
  extensions.emergency_stop_state = proc_args.emergency_stop || {
    active: false,
    reason: null,
    activated_at: null,
    cleared_at: null,
    revision: 0,
  };

  extensions.deploy = function (char_name, realm, script_file, game_version) {
    sendIpcMessage(process, {
      type: "deploy",
      ...(char_name && { character: char_name }),
      ...(realm && { realm }),
      ...(script_file && { script: script_file }),
      ...(game_version && { version: game_version }),
    });
  };
  extensions.shutdown = function (char_name) {
    sendIpcMessage(process, {
      type: "shutdown",
      character: char_name,
    });
  };
  extensions.map_enabled = function () {
    return proc_args.enable_map;
  };
  extensions.emit_event = function (event) {
    const normalized = normalizeRuntimeEvent(event);
    if (!normalized || !process.connected) return false;

    sendIpcMessage(process, {
      type: "runtime_event",
      event: normalized,
    });
    return true;
  };

  game_context.caracAL = extensions;

  const old_ng_logic = game_context.new_game_logic;
  game_context.new_game_logic = function () {
    old_ng_logic();
    clearTimeout(reload_task);
    //people reported bad performance when switching maps
    //and this allegedly fixes it.
    vm.runInContext("pause()", game_context);

    const is_typescript =
      proc_args.typescript_file && proc_args.typescript_file.length > 0;
    const target_script = is_typescript
      ? "./TYPECODE.out/" + proc_args.typescript_file
      : "./CODE/" + proc_args.script_file;
    (async function () {
      const runner_context = await make_runner(
        game_context,
        target_script,
        proc_args.version,
        is_typescript,
      );
      extensions.runner = runner_context;
    })();
  };
  const old_dc = game_context.disconnect;
  game_context.disconnect = function () {
    old_dc();
    extensions.deploy();
  };
  const old_api = game_context.api_call;
  game_context.api_call = function (method, args, r_args) {
    //servers and characters are handled centrally
    if (method != "servers_and_characters") {
      return old_api(method, args, r_args);
    } else {
      console.debug("filtered s&c call");
    }
  };
  game_context.get_code_function = function (f_name) {
    return (extensions.runner && extensions.runner[f_name]) || function () {};
  };
  //call_code_function("trigger_character_event","cm",{name:data.name,message:JSON.parse(data.message)});

  vm.runInContext(
    `
  (function() {
    const old_add_log = add_log; 
    add_log = function(msg, col) {
      old_add_log(msg,col);
      for(let [msg, col] of game_logs) {
        caracAL.log.info({col:col, type:"game_logs"}, msg);
      }
      game_logs = [];
    }
  })();
  `,
    game_context,
  );
  //show_json causes a popup so it must be important
  //therefore we use warn level here
  vm.runInContext(
    'show_json = function(json) {caracAL.log.warn({data:json, type:"AL", func:"show_json"});}',
    game_context,
  );
  sendIpcMessage(process, { type: "initialized" });
  sendIpcMessage(process, {
    type: "config_applied",
    revision: extensions.runtime_config_revision,
    changed: true,
    source: "process_args",
  });
  process.on("message", (rawMessage) => {
    const m = acceptedIpcMessage(rawMessage);
    if (!m) return;
    switch (m.type) {
      case "siblings_and_acc":
        extensions.siblings = m.siblings;
        game_context.handle_information([m.account]);
        break;
      case "receive_cm":
        game_context.call_code_function("trigger_character_event", "cm", {
          name: m.name,
          message: m.data,
          caracAL: true,
        });
        break;
      case "send_cm":
        game_context.send_code_message(m.to, m.data);
        break;
      case "runtime_control":
        if (Object.values(DESIRED_RUNTIME_STATES).includes(m.state)) {
          extensions.runtime_state = m.state;
          sendIpcMessage(process, {
            type: "runtime_state_applied",
            state: extensions.runtime_state,
          });
        }
        break;
      case "config_push":
        try {
          const nextConfig = prepareConfigPush(
            extensions.runtime_config_revision,
            m.revision,
            m.config,
          );
          if (nextConfig.changed) {
            extensions.config = nextConfig.config;
            extensions.runtime_config_revision = nextConfig.revision;
          }
          sendIpcMessage(process, {
            type: "config_applied",
            revision: nextConfig.revision,
            changed: nextConfig.changed,
            source: "config_push",
          });
        } catch (error) {
          sendIpcMessage(process, {
            type: "config_rejected",
            revision: Number.isInteger(Number(m.revision))
              ? Number(m.revision)
              : null,
            reason: error.code || "CHARACTER_CONFIG_REJECTED",
            message: error.message,
          });
        }
        break;
      case "emergency_stop":
        extensions.emergency_stop = !!m.state?.active;
        extensions.emergency_stop_state = m.state || {
          active: false,
          reason: null,
          activated_at: null,
          cleared_at: null,
          revision: 0,
        };
        sendIpcMessage(process, {
          type: "emergency_stop_applied",
          state: extensions.emergency_stop_state,
        });
        break;
    }
  });
  vm.runInContext("the_game()", game_context);
  const reload_timeout = 14;
  const reload_task = setTimeout(
    function () {
      console.warn(
        `game not loaded after ${reload_timeout} seconds, reloading`,
      );
      extensions.deploy();
    },
    reload_timeout * 1000 + 100,
  );
  console.log("game instance constructed");
  return game_context;
}
let heartbeat_task = null;

function start_heartbeat(interval_ms) {
  if (heartbeat_task) {
    clearInterval(heartbeat_task);
  }
  const normalized_interval = Math.max(1000, Number(interval_ms) || 5000);
  heartbeat_task = setInterval(() => {
    if (!process.connected) return;
    sendIpcMessage(process, {
      type: "heartbeat",
      timestamp: Date.now(),
      pid: process.pid,
    });
  }, normalized_interval);
  heartbeat_task.unref();
}

//have to use on, localstorage may send messages
process.on("message", async (rawMessage) => {
  const msg = acceptedIpcMessage(rawMessage);
  if (!msg) return;
  if (msg.type == "process_args") {
    const { cname, clid } = msg.arguments;
    start_heartbeat(msg.arguments.heartbeat_interval_ms);
    console.debug("starting character thread", {
      cname,
      clid,
      version: msg.arguments.version,
      realm_address: msg.arguments.realm_address,
      realm_path: msg.arguments.realm_path,
      realm_addr: msg.arguments.realm_addr,
      realm_port: msg.arguments.realm_port,
      script_file: msg.arguments.script_file,
      typescript_file: msg.arguments.typescript_file,
      runtime_state: msg.arguments.runtime_state,
    });
    const new_log = LogUtils.log.child({ cname, clid });
    LogUtils.log = new_log;
    await make_game(msg.arguments);
  }
});

sendIpcMessage(process, {
  type: "process_ready",
});

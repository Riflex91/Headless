const child_process = require("node:child_process");
const account_info = require("../account_info");
const game_files = require("../game_files");
const bwi = require("bot-web-interface");
const monitoring_util = require("../monitoring_util");
const express = require("express");
const fs_regular = require("node:fs");
const path = require("node:path");
const {
  LOCALSTORAGE_PATH,
  LOCALSTORAGE_ROTA_PATH,
  STAT_BEAT_INTERVAL,
} = require("../src/CONSTANTS");
const { log, console, ctype_to_clid } = require("../src/LogUtils");
const {
  IPC_PROTOCOL_VERSION,
  normalizeIpcMessage,
  sendIpcMessage,
} = require("../src/IpcProtocol");

const FileStoredKeyValues = require("../src/FileStoredKeyValues");
const {
  CONTROL_ACTIONS,
  DESIRED_RUNTIME_STATES,
  canRestartCharacter,
} = require("../src/CharacterControl");
const { AdventureLandAssetCache } = require("../src/AdventureLandAssetCache");
const { normalizeRealmConnection } = require("../src/AdventureLandRealm");
const {
  MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
  resolveCharacterExecutionSource,
} = require("../src/CharacterExecutionSource");
const {
  registerAccountCharacters,
} = require("../src/AccountCharacterRegistry");
const { DiagnosticEventStore } = require("../src/DiagnosticStore");
const { EmergencyStopState } = require("../src/EmergencyStopState");
const { attachHeadlessDashboard } = require("../src/HeadlessDashboard");
const { IncidentRecorder } = require("../src/IncidentRecorder");
const { createRotationPlan } = require("../src/CharacterRotation");
const { StructuredLogger } = require("../src/StructuredLogger");
const {
  updateCharacterLiveState,
  updateCharacterMovementRuntime,
} = require("../src/LiveState");
const { normalizeRuntimeEvent } = require("../src/RuntimeEventBridge");
const {
  combineMovementLiveTestResult,
  movementLiveTestDiagnostics,
  movementLiveTestEvidence,
} = require("../src/MovementLiveTest");
const {
  combatLiveTestDiagnostics,
  combatLiveTestEvidence,
  combineCombatLiveTestResult,
} = require("../src/CombatLiveTest");
const {
  classSkillLiveTestDiagnostics,
  classSkillLiveTestEvidence,
  combineClassSkillLiveTestResult,
} = require("../src/ClassSkillLiveTest");
const {
  combineGroupLiveTestResult,
  groupLiveTestDiagnostics,
  groupLiveTestEvidence,
} = require("../src/GroupLiveTest");
const {
  combineFarmLiveTestResult,
  farmLiveTestDiagnostics,
  farmLiveTestEvidence,
} = require("../src/FarmLiveTest");
const { PersistenceService } = require("../src/PersistenceService");
const { CharacterConfigService } = require("../src/CharacterConfigService");
const {
  beginSnapshotPersist,
  buildCharacterProfile,
  completeSnapshotPersist,
  failSnapshotPersist,
  restoreDesiredRuntimeState,
  shouldPersistSnapshot,
  snapshotSignature,
} = require("../src/SupervisorPersistencePolicy");
const {
  FileRevisionCache,
  createConfigRevision,
  readGitRevision,
  resolveCharacterScriptPath,
  revisionStatus,
} = require("../src/RuntimeRevision");
const {
  LIFECYCLE_STATES,
  computeRestartDelay,
  countActiveCharacters,
  getInitialStartupCharacters,
  isHeartbeatStale,
  readLifecyclePolicy,
} = require("../src/CharacterLifecyclePolicy");

const CONFIG_PUSH_TIMEOUT_MS = 30000;
const MOVEMENT_LIVE_TEST_RUNTIME_TIMEOUT_MS = 45000;
const MOVEMENT_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const COMBAT_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const CLASS_SKILL_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const GROUP_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const FARM_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;

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
  const account_characters = Array.isArray(my_acc.response.characters)
    ? my_acc.response.characters
    : [];

  const character_manage = registerAccountCharacters(
    cfg.characters,
    account_characters,
    {
      defaultRealm: default_realm.key,
      enableTypecode: !!cfg.enable_TYPECODE,
    },
  );
  const revision_cache = new FileRevisionCache();
  const source_revision = readGitRevision(process.cwd());
  const installed_config_revision = createConfigRevision(cfg);
  const persistence = await PersistenceService.open({
    databasePath: path.join(
      process.cwd(),
      "data",
      "database",
      "caracal-bot.db",
    ),
  });
  await persistence.setMeta("supervisor", {
    source_revision,
    installed_config_revision,
    game_version: version,
  });
  const character_config_service = new CharacterConfigService({ persistence });
  const diagnostic_store = new DiagnosticEventStore({ maxEvents: 20000 });
  const emergency_stop = new EmergencyStopState();
  const structured_logger = new StructuredLogger({
    rootDir: path.join(process.cwd(), "logs"),
  });
  const asset_cache = new AdventureLandAssetCache({
    cacheDir: path.join(process.cwd(), "data", "assets", "adventure-land"),
  });

  //TODO right now this server wont terminate.
  //this is fine atm because caracAL does not terminate when all chars stop.
  //when I change this in the future this might change as well.
  let bwi_instance = {};
  let dashboard = null;
  let owned_web_server = null;
  const dashboard_map_scenes = new Map();
  const movement_live_test_requests = new Map();
  let movement_live_test_sequence = 0;
  const combat_live_test_requests = new Map();
  let combat_live_test_sequence = 0;
  const class_skill_live_test_requests = new Map();
  let class_skill_live_test_sequence = 0;
  const group_live_test_requests = new Map();
  let group_live_test_sequence = 0;
  const farm_live_test_requests = new Map();
  let farm_live_test_sequence = 0;
  const incident_recorder = new IncidentRecorder({
    rootDir: path.join(process.cwd(), "logs", "incidents"),
    diagnosticStore: diagnostic_store,
    getSnapshot: () => dashboard?.getSnapshot?.() || null,
  });
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
        updateCharacterConfig: control_character_config,
        controlRotation: control_rotation,
        runMovementLiveTest: run_movement_live_test,
        runCombatLiveTest: run_combat_live_test,
        runClassSkillLiveTest: run_class_skill_live_test,
        runGroupLiveTest: run_group_live_test,
        runFarmLiveTest: run_farm_live_test,
        controlEmergencyStop: control_emergency_stop,
        getEmergencyStopState: () => emergency_stop.snapshot(),
        getRevisionSummary: revision_summary,
        getPersistenceHealth: () => persistence.health(),
        getMapScene: (mapName) => dashboard_map_scenes.get(mapName) || null,
        diagnosticStore: diagnostic_store,
        incidentRecorder: incident_recorder,
        assetCache: asset_cache,
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
    return sendIpcMessage(target, data, (e) => {
      //This can occur due to node closing ipc
      //before firing its close handlers
      if (e) {
        //console.error(`failed to send ipc`);
        //console.error(`target: `,target);
      }
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function report_persistence_error(operation, char_name, error) {
    const payload = diagnostic_store.append({
      type: "persistence_error",
      event: "PERSISTENCE_WRITE_FAILED",
      character: char_name || null,
      timestamp: Date.now(),
      operation,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack || null : null,
    });
    structured_logger.write(payload);
    incident_recorder.maybeCapture(payload);
    dashboard?.publish(payload);
    log.error(payload, `persistence operation failed: ${operation}`);
  }

  function observe_persistence(promise, operation, char_name = null) {
    return promise.catch((error) => {
      report_persistence_error(operation, char_name, error);
      return null;
    });
  }

  function persist_character_runtime_state(char_name, reason) {
    const char_block = character_manage[char_name];
    if (!char_block) return;

    void observe_persistence(
      persistence.saveCharacterRuntimeState(char_name, {
        desiredState:
          char_block.desired_runtime_state || DESIRED_RUNTIME_STATES.STOPPED,
        actualState: char_block.lifecycle_state || LIFECYCLE_STATES.STOPPED,
        codeRevision: char_block.running_code_revision || null,
        configRevision: char_block.running_config_revision || null,
      }),
      `runtime_state:${reason || "update"}`,
      char_name,
    );
  }

  function maybe_persist_character_snapshot(char_name, char_block, stat_beat) {
    const signature = snapshotSignature(stat_beat);
    const now = Date.now();

    if (!shouldPersistSnapshot(char_block, signature, now)) return;

    beginSnapshotPersist(char_block, now);
    const operation = persistence
      .saveCharacterSnapshot(char_name, {
        capturedAt: now,
        inventory: stat_beat.items || [],
        equipment: stat_beat.slots || {},
      })
      .then(() => {
        completeSnapshotPersist(char_block, signature, now);
      })
      .catch((error) => {
        failSnapshotPersist(char_block);
        throw error;
      });

    void observe_persistence(operation, "character_snapshot", char_name);
  }

  function record_observation(payload, { publish = true } = {}) {
    const sanitized_payload = diagnostic_store.append(payload);
    structured_logger.write(sanitized_payload);
    const incident = incident_recorder.maybeCapture(sanitized_payload);
    if (incident) {
      void observe_persistence(
        persistence.indexIncident(
          incident,
          path.join("logs", "incidents", incident.incident_id),
        ),
        "incident_index",
        incident.character || null,
      );
    }

    if (publish) {
      dashboard?.publish(sanitized_payload);
    }

    return sanitized_payload;
  }

  function capture_character_stream(stream, char_name, stream_name) {
    if (!stream) return;

    let buffer = "";
    const flush_line = (line) => {
      const message = line.trimEnd();
      if (!message) return;
      record_observation(
        {
          type: "character_log",
          event:
            stream_name === "stderr" ? "CHARACTER_STDERR" : "CHARACTER_STDOUT",
          character: char_name,
          stream: stream_name,
          message,
        },
        { publish: false },
      );
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
    const sanitized_payload = record_observation(payload);
    log.info(
      sanitized_payload,
      char_name ? `supervisor ${event}: ${char_name}` : `supervisor ${event}`,
    );
  }

  function emit_runtime_event(char_name, event) {
    const normalized = normalizeRuntimeEvent(event);
    if (!normalized) {
      emit_supervisor_event("RUNTIME_EVENT_REJECTED", char_name, {
        reason: "INVALID_RUNTIME_EVENT",
      });
      return;
    }

    const char_block = character_manage[char_name];
    if (
      char_block &&
      normalized.module === "RuntimeKernel" &&
      normalized.type === "RUNTIME_STARTED"
    ) {
      char_block.bot_runtime_started_at = normalized.timestamp;
    } else if (
      char_block &&
      normalized.module === "RuntimeKernel" &&
      normalized.type === "RUNTIME_STOPPED"
    ) {
      char_block.bot_runtime_started_at = null;
    }

    if (
      char_block &&
      normalized.data?.combat &&
      typeof normalized.data.combat === "object"
    ) {
      char_block.combat_runtime = normalized.data.combat;
    }

    if (
      char_block &&
      normalized.data?.classSkills &&
      typeof normalized.data.classSkills === "object"
    ) {
      char_block.class_skill_runtime = normalized.data.classSkills;
    }

    if (
      char_block &&
      normalized.data?.groupCombat &&
      typeof normalized.data.groupCombat === "object"
    ) {
      char_block.group_combat_runtime = normalized.data.groupCombat;
    }

    if (
      char_block &&
      normalized.data?.farmIntelligence &&
      typeof normalized.data.farmIntelligence === "object"
    ) {
      char_block.farm_intelligence_runtime = normalized.data.farmIntelligence;
    }

    if (
      normalized.module === "FarmIntelligenceController" &&
      normalized.type === "FARM_INTELLIGENCE_SAMPLE" &&
      normalized.data?.sample &&
      typeof normalized.data.sample === "object"
    ) {
      const sample = normalized.data.sample;
      const farm_key =
        typeof sample.farmKey === "string" ? sample.farmKey.trim() : "";
      if (farm_key) {
        void observe_persistence(
          persistence.appendFarmStatistic(char_name, farm_key, {
            startedAt: Number(sample.startedAt) || normalized.timestamp,
            endedAt: Number(sample.endedAt) || normalized.timestamp,
            stats:
              sample.stats && typeof sample.stats === "object"
                ? sample.stats
                : {},
          }),
          "farm_intelligence_sample",
          char_name,
        );
      }
    }

    if (char_block && normalized.data?.movement) {
      updateCharacterMovementRuntime(char_block, normalized.data.movement, {
        timestamp: normalized.timestamp,
        eventType: normalized.type,
        eventReason: normalized.why || null,
      });
    }

    const payload = {
      ...normalized,
      character: char_name,
      source: "bot_runtime",
    };
    const sanitized_payload = record_observation(payload);
    log.info(
      sanitized_payload,
      `${char_name} runtime ${normalized.module}:${normalized.type}`,
    );

    if (
      char_block &&
      (normalized.data?.movement ||
        normalized.data?.combat ||
        normalized.data?.classSkills ||
        normalized.data?.groupCombat ||
        normalized.data?.farmIntelligence)
    ) {
      dashboard?.publishSnapshot();
    }
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
    persist_character_runtime_state(char_name, reason || "lifecycle");
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

  function clear_config_push_timer(char_block) {
    if (char_block && char_block.config_push_timer) {
      clearTimeout(char_block.config_push_timer);
      char_block.config_push_timer = null;
    }
  }

  function arm_config_push_timeout(char_name, revision) {
    const char_block = character_manage[char_name];
    if (!char_block) return;

    clear_config_push_timer(char_block);
    char_block.config_push_timer = setTimeout(() => {
      char_block.config_push_timer = null;
      if (
        char_block.runtime_config_revision !== revision ||
        char_block.config_push_status !== "PENDING"
      ) {
        return;
      }

      char_block.config_push_status = "TIMEOUT";
      char_block.config_push_error = "CONFIG_APPLY_ACK_TIMEOUT";
      emit_supervisor_event("CHARACTER_CONFIG_PUSH_TIMEOUT", char_name, {
        why: "CONFIG_APPLY_ACK_TIMEOUT",
        revision,
        timeout_ms: CONFIG_PUSH_TIMEOUT_MS,
      });
      dashboard?.publishSnapshot();
    }, CONFIG_PUSH_TIMEOUT_MS);
    char_block.config_push_timer.unref?.();
  }

  function refresh_character_revision(char_block) {
    const revision_block = char_block.movement_live_test_typescript_override
      ? {
          ...char_block,
          typescript: char_block.movement_live_test_typescript_override,
        }
      : char_block;
    const script_path = resolveCharacterScriptPath(
      process.cwd(),
      revision_block,
      !!(
        cfg.enable_TYPECODE || char_block.movement_live_test_typescript_override
      ),
    );
    char_block.script_path = script_path;
    char_block.installed_code_revision = revision_cache.revision(script_path);
    char_block.installed_config_revision = installed_config_revision;
    char_block.revision_status = revisionStatus({
      runningCodeRevision: char_block.running_code_revision,
      installedCodeRevision: char_block.installed_code_revision,
      runningConfigRevision: char_block.running_config_revision,
      installedConfigRevision: char_block.installed_config_revision,
    });
    return char_block.revision_status;
  }

  function revision_summary() {
    Object.values(character_manage).forEach(refresh_character_revision);
    const active = Object.values(character_manage).filter(
      (char_block) => char_block.instance,
    );
    const statuses = active.map((char_block) => char_block.revision_status);
    const status =
      statuses.length === 0
        ? "UNKNOWN"
        : statuses.includes("STALE")
        ? "STALE"
        : statuses.every((value) => value === "HEALTHY")
        ? "HEALTHY"
        : "UNKNOWN";

    return {
      source_revision,
      installed_config_revision,
      status,
    };
  }

  function initialize_char_block(char_name, char_block) {
    const persisted_lifecycle = persistence.getLifecycleState(char_name);
    const runtime_config = character_config_service.load(
      char_name,
      char_block.runtime_config || {},
    );

    char_block.name = char_name;
    char_block.connected = false;
    char_block.restart_attempts = char_block.restart_attempts || 0;
    char_block.restart_timer = char_block.restart_timer || null;
    char_block.stable_timer = char_block.stable_timer || null;
    char_block.controlled_restart = false;
    char_block.rotation_replacement = null;
    char_block.rotation_source = null;
    char_block.runtime_config = runtime_config.config;
    char_block.runtime_config_revision = runtime_config.revision;
    char_block.runtime_config_source = runtime_config.source;
    char_block.applied_runtime_config_revision = null;
    char_block.config_push_status =
      runtime_config.source === "PERSISTED" ? "STORED" : "READY";
    char_block.config_push_error = null;
    char_block.config_push_timer = null;
    char_block.last_heartbeat_at = char_block.last_heartbeat_at || 0;
    char_block.last_heartbeat_pid = char_block.last_heartbeat_pid || null;
    char_block.watchdog_recovery_in_progress = false;
    char_block.live_state = char_block.live_state || null;
    char_block.bot_runtime_started_at = null;
    char_block.movement_live_test = char_block.movement_live_test || null;
    char_block.combat_live_test = char_block.combat_live_test || null;
    char_block.class_skill_live_test = char_block.class_skill_live_test || null;
    char_block.group_live_test = char_block.group_live_test || null;
    char_block.farm_live_test = char_block.farm_live_test || null;
    char_block.combat_runtime = char_block.combat_runtime || null;
    char_block.class_skill_runtime = char_block.class_skill_runtime || null;
    char_block.group_combat_runtime = char_block.group_combat_runtime || null;
    char_block.farm_intelligence_runtime =
      char_block.farm_intelligence_runtime || null;
    char_block.movement_live_test_typescript_override = null;
    char_block.running_code_revision = char_block.running_code_revision || null;
    char_block.running_config_revision =
      char_block.running_config_revision || null;
    char_block.snapshot_persist_inflight = false;
    char_block.last_snapshot_persist_attempt_at = 0;
    char_block.last_persisted_snapshot_at = 0;
    char_block.last_persisted_snapshot_signature = null;
    restoreDesiredRuntimeState(char_block, persisted_lifecycle);
    refresh_character_revision(char_block);
    char_block.movement_trail = Array.isArray(char_block.movement_trail)
      ? char_block.movement_trail
      : [];

    if (persisted_lifecycle) {
      emit_supervisor_event("PERSISTED_DESIRED_STATE_RESTORED", char_name, {
        desired_runtime_state: char_block.desired_runtime_state,
        persisted_actual_state: persisted_lifecycle.actual_state,
      });
    }

    void observe_persistence(
      persistence.saveCharacterProfile(
        char_name,
        buildCharacterProfile(
          char_name,
          char_block,
          my_acc.resolve_char(char_name),
        ),
      ),
      "character_profile",
      char_name,
    );
    persist_character_runtime_state(char_name, "initialize");
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

  async function control_emergency_stop(action, reason) {
    let state;

    if (action === "activate") {
      state = emergency_stop.activate(reason);
    } else if (action === "clear") {
      state = emergency_stop.clear(reason);
    } else {
      throw make_control_error(
        "INVALID_EMERGENCY_STOP_ACTION",
        `Unsupported emergency stop action: ${action}`,
        400,
      );
    }

    Object.values(character_manage).forEach((char_block) => {
      if (!char_block.instance) return;
      safe_send(char_block.instance, {
        type: "emergency_stop",
        state,
      });
    });

    emit_supervisor_event(
      state.active ? "EMERGENCY_STOP_ACTIVATED" : "EMERGENCY_STOP_CLEARED",
      null,
      {
        reason: state.reason,
        revision: state.revision,
      },
    );
    dashboard?.publishSnapshot();
    return state;
  }

  async function control_character_config(char_name, config) {
    const char_block = character_manage[char_name];
    if (!char_block) {
      throw make_control_error(
        "CHARACTER_NOT_FOUND",
        `Unknown character: ${char_name}`,
        404,
      );
    }

    let stored;
    try {
      stored = await character_config_service.store(
        char_name,
        char_block.runtime_config_revision,
        config,
      );
    } catch (error) {
      if (!String(error.code || "").startsWith("CHARACTER_CONFIG_")) {
        report_persistence_error("character_config", char_name, error);
      }
      throw error;
    }

    clear_config_push_timer(char_block);
    char_block.runtime_config = stored.config;
    char_block.runtime_config_revision = stored.revision;
    char_block.runtime_config_source = "PERSISTED";
    char_block.config_push_error = null;

    if (char_block.instance && char_block.connected) {
      char_block.config_push_status = "PENDING";
      safe_send(char_block.instance, {
        type: "config_push",
        revision: stored.revision,
        config: stored.config,
      });
      arm_config_push_timeout(char_name, stored.revision);
      emit_supervisor_event("CHARACTER_CONFIG_PUSH_REQUESTED", char_name, {
        why: "LIVE_CONFIG_UPDATE",
        revision: stored.revision,
      });
    } else {
      char_block.config_push_status = "STORED";
      emit_supervisor_event("CHARACTER_CONFIG_STORED", char_name, {
        why: "APPLY_ON_NEXT_CHARACTER_START",
        revision: stored.revision,
      });
    }

    dashboard?.publishSnapshot();
    return {
      character: char_name,
      revision: stored.revision,
      status: char_block.config_push_status,
    };
  }

  async function control_rotation({ startCharacter, stopCharacter } = {}) {
    const plan = createRotationPlan(character_manage, {
      startCharacter,
      stopCharacter,
    });
    const source = character_manage[plan.stop_character];
    const target = character_manage[plan.start_character];

    clear_restart_timer(source);
    clear_stable_timer(source);
    clear_restart_timer(target);
    clear_stable_timer(target);

    source.enabled = false;
    source.desired_runtime_state = DESIRED_RUNTIME_STATES.STOPPED;
    source.rotation_replacement = plan.start_character;

    target.enabled = true;
    target.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;
    target.rotation_source = plan.stop_character;

    persist_character_runtime_state(plan.stop_character, "rotation_source");
    persist_character_runtime_state(plan.start_character, "rotation_target");

    emit_supervisor_event("CHARACTER_ROTATION_REQUESTED", null, {
      why: "EXPLICIT_SLOT_ROTATION",
      stop_character: plan.stop_character,
      start_character: plan.start_character,
      source_desired_state: plan.source_desired_state,
      target_desired_state: plan.target_desired_state,
    });
    dashboard?.publishSnapshot();

    await softkill_block(source);

    return {
      ...plan,
      status: "REQUESTED",
    };
  }

  function reject_movement_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of movement_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      movement_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  function reject_combat_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of combat_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      combat_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }
  function reject_class_skill_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of class_skill_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      class_skill_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }
  function reject_group_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of group_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      group_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  function reject_farm_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of farm_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      farm_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  async function wait_for_farm_live_test_runtime(
    char_name,
    timeout_ms = MOVEMENT_LIVE_TEST_RUNTIME_TIMEOUT_MS,
  ) {
    const started_at = Date.now();
    while (Date.now() - started_at < timeout_ms) {
      const char_block = character_manage[char_name];
      if (
        char_block?.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at)
      ) {
        return char_block;
      }
      await sleep(100);
    }

    throw make_control_error(
      "FARM_LIVE_TEST_RUNTIME_TIMEOUT",
      `Farm runtime did not become ready for ${char_name}`,
      504,
    );
  }

  async function wait_for_movement_live_test_runtime(
    char_name,
    timeout_ms = MOVEMENT_LIVE_TEST_RUNTIME_TIMEOUT_MS,
  ) {
    const started_at = Date.now();
    while (Date.now() - started_at < timeout_ms) {
      const char_block = character_manage[char_name];
      if (
        char_block?.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at)
      ) {
        return char_block;
      }
      await sleep(100);
    }

    throw make_control_error(
      "MOVEMENT_LIVE_TEST_RUNTIME_TIMEOUT",
      `Movement runtime did not become ready for ${char_name}`,
      504,
    );
  }

  async function wait_for_group_live_test_runtime(
    char_name,
    timeout_ms = MOVEMENT_LIVE_TEST_RUNTIME_TIMEOUT_MS,
  ) {
    const started_at = Date.now();
    while (Date.now() - started_at < timeout_ms) {
      const char_block = character_manage[char_name];
      if (
        char_block?.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at)
      ) {
        return char_block;
      }
      await sleep(100);
    }

    throw make_control_error(
      "GROUP_LIVE_TEST_RUNTIME_TIMEOUT",
      `Group runtime did not become ready for ${char_name}`,
      504,
    );
  }

  async function wait_for_character_connected(
    char_name,
    timeout_ms = MOVEMENT_LIVE_TEST_RUNTIME_TIMEOUT_MS,
  ) {
    const started_at = Date.now();
    while (Date.now() - started_at < timeout_ms) {
      const char_block = character_manage[char_name];
      if (char_block?.instance && char_block.connected) {
        return char_block;
      }
      await sleep(100);
    }

    throw make_control_error(
      "CHARACTER_RESTORE_TIMEOUT",
      `Character did not reconnect while restoring ${char_name}`,
      504,
    );
  }

  async function restart_character_for_movement_runtime(char_name, char_block) {
    if (!char_block.instance) {
      const started = start_char(char_name);
      if (!started) {
        throw make_control_error(
          "MOVEMENT_LIVE_TEST_RUNTIME_START_FAILED",
          `Could not start movement runtime for ${char_name}`,
          503,
        );
      }
      return;
    }

    clear_restart_timer(char_block);
    clear_stable_timer(char_block);
    char_block.controlled_restart = true;
    await softkill_block(char_block);
  }

  async function restore_movement_live_test_execution_source(
    char_name,
    original_desired_state,
  ) {
    const char_block = character_manage[char_name];
    if (!char_block) return;

    char_block.movement_live_test_typescript_override = null;
    emit_supervisor_event(
      "MOVEMENT_LIVE_TEST_RUNTIME_OVERRIDE_CLEARED",
      char_name,
      {
        desired_runtime_state: original_desired_state,
      },
    );

    if (original_desired_state === DESIRED_RUNTIME_STATES.STOPPED) {
      await control_character(char_name, CONTROL_ACTIONS.STOP);
      return;
    }

    char_block.enabled = true;
    char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;

    if (char_block.instance) {
      clear_restart_timer(char_block);
      clear_stable_timer(char_block);
      char_block.controlled_restart = true;
      await softkill_block(char_block);
    } else {
      const started = start_char(char_name);
      if (!started) {
        throw make_control_error(
          "CHARACTER_RESTORE_START_FAILED",
          `Could not restart original runtime for ${char_name}`,
          503,
        );
      }
    }

    await wait_for_character_connected(char_name);

    if (original_desired_state === DESIRED_RUNTIME_STATES.PAUSED) {
      await control_character(char_name, CONTROL_ACTIONS.PAUSE);
    }
  }

  function wait_for_movement_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        movement_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "MOVEMENT_LIVE_TEST_TIMEOUT",
            `Movement live test timed out for ${char_name}`,
            504,
          ),
        );
      }, MOVEMENT_LIVE_TEST_RESULT_TIMEOUT_MS);

      movement_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }

  function wait_for_combat_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        combat_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "COMBAT_LIVE_TEST_TIMEOUT",
            `Combat live test timed out for ${char_name}`,
            504,
          ),
        );
      }, COMBAT_LIVE_TEST_RESULT_TIMEOUT_MS);

      combat_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }
  function wait_for_class_skill_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        class_skill_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "CLASS_SKILL_LIVE_TEST_TIMEOUT",
            `Class skill live test timed out for ${char_name}`,
            504,
          ),
        );
      }, CLASS_SKILL_LIVE_TEST_RESULT_TIMEOUT_MS);

      class_skill_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }
  function wait_for_group_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        group_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "GROUP_LIVE_TEST_TIMEOUT",
            `Group live test timed out for ${char_name}`,
            504,
          ),
        );
      }, GROUP_LIVE_TEST_RESULT_TIMEOUT_MS);

      group_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }

  function wait_for_farm_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        farm_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "FARM_LIVE_TEST_TIMEOUT",
            `Farm live test timed out for ${char_name}`,
            504,
          ),
        );
      }, FARM_LIVE_TEST_RESULT_TIMEOUT_MS);

      farm_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }

  async function restore_movement_live_test_state(
    char_name,
    desired_runtime_state,
  ) {
    const char_block = character_manage[char_name];
    if (!char_block) return;

    if (desired_runtime_state === DESIRED_RUNTIME_STATES.STOPPED) {
      await control_character(char_name, CONTROL_ACTIONS.STOP);
    } else if (desired_runtime_state === DESIRED_RUNTIME_STATES.PAUSED) {
      if (char_block.instance) {
        await control_character(char_name, CONTROL_ACTIONS.PAUSE);
      }
    } else if (
      desired_runtime_state === DESIRED_RUNTIME_STATES.RUNNING &&
      char_block.desired_runtime_state !== DESIRED_RUNTIME_STATES.RUNNING
    ) {
      await control_character(char_name, CONTROL_ACTIONS.START);
    }
  }

  async function restore_combat_live_test_execution_source(
    char_name,
    original_desired_state,
  ) {
    const char_block = character_manage[char_name];
    if (!char_block) return;

    char_block.movement_live_test_typescript_override = null;
    emit_supervisor_event(
      "COMBAT_LIVE_TEST_RUNTIME_OVERRIDE_CLEARED",
      char_name,
      {
        desired_runtime_state: original_desired_state,
      },
    );

    if (original_desired_state === DESIRED_RUNTIME_STATES.STOPPED) {
      await control_character(char_name, CONTROL_ACTIONS.STOP);
      return;
    }

    char_block.enabled = true;
    char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;

    if (char_block.instance) {
      clear_restart_timer(char_block);
      clear_stable_timer(char_block);
      char_block.controlled_restart = true;
      await softkill_block(char_block);
    } else {
      const started = start_char(char_name);
      if (!started) {
        throw make_control_error(
          "CHARACTER_RESTORE_START_FAILED",
          `Could not restart original runtime for ${char_name}`,
          503,
        );
      }
    }

    await wait_for_character_connected(char_name);

    if (original_desired_state === DESIRED_RUNTIME_STATES.PAUSED) {
      await control_character(char_name, CONTROL_ACTIONS.PAUSE);
    }
  }
  async function restore_class_skill_live_test_execution_source(
    char_name,
    original_desired_state,
  ) {
    const char_block = character_manage[char_name];
    if (!char_block) return;

    char_block.movement_live_test_typescript_override = null;
    emit_supervisor_event(
      "CLASS_SKILL_LIVE_TEST_RUNTIME_OVERRIDE_CLEARED",
      char_name,
      {
        desired_runtime_state: original_desired_state,
      },
    );

    if (original_desired_state === DESIRED_RUNTIME_STATES.STOPPED) {
      await control_character(char_name, CONTROL_ACTIONS.STOP);
      return;
    }

    char_block.enabled = true;
    char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;

    if (char_block.instance) {
      clear_restart_timer(char_block);
      clear_stable_timer(char_block);
      char_block.controlled_restart = true;
      await softkill_block(char_block);
    } else {
      const started = start_char(char_name);
      if (!started) {
        throw make_control_error(
          "CHARACTER_RESTORE_START_FAILED",
          `Could not restart original runtime for ${char_name}`,
          503,
        );
      }
    }

    await wait_for_character_connected(char_name);

    if (original_desired_state === DESIRED_RUNTIME_STATES.PAUSED) {
      await control_character(char_name, CONTROL_ACTIONS.PAUSE);
    }
  }
  async function restore_group_live_test_execution_source(
    char_name,
    original_desired_state,
  ) {
    const char_block = character_manage[char_name];
    if (!char_block) return;

    char_block.movement_live_test_typescript_override = null;
    emit_supervisor_event(
      "GROUP_LIVE_TEST_RUNTIME_OVERRIDE_CLEARED",
      char_name,
      {
        desired_runtime_state: original_desired_state,
      },
    );

    if (original_desired_state === DESIRED_RUNTIME_STATES.STOPPED) {
      await control_character(char_name, CONTROL_ACTIONS.STOP);
      return;
    }

    char_block.enabled = true;
    char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;

    if (char_block.instance) {
      clear_restart_timer(char_block);
      clear_stable_timer(char_block);
      char_block.controlled_restart = true;
      await softkill_block(char_block);
    } else {
      const started = start_char(char_name);
      if (!started) {
        throw make_control_error(
          "CHARACTER_RESTORE_START_FAILED",
          `Could not restart original runtime for ${char_name}`,
          503,
        );
      }
    }

    await wait_for_character_connected(char_name);

    if (original_desired_state === DESIRED_RUNTIME_STATES.PAUSED) {
      await control_character(char_name, CONTROL_ACTIONS.PAUSE);
    }
  }

  function capture_movement_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "MOVEMENT_LIVE_TEST_FAILED",
      severity:
        test_result.outcome === "UNKNOWN" || test_result.outcome === "TIMEOUT"
          ? "HIGH"
          : "ERROR",
      character: char_name,
      event: {
        type: "movement_live_test",
        event: "MOVEMENT_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "MOVEMENT_LIVE_TEST_FAILED",
      },
      extra: {
        test: test_result,
      },
    });

    void observe_persistence(
      persistence.indexIncident(
        incident,
        path.join("logs", "incidents", incident.incident_id),
      ),
      "movement_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }

  function capture_combat_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "COMBAT_LIVE_TEST_FAILED",
      severity:
        test_result.outcome === "UNKNOWN" || test_result.outcome === "TIMEOUT"
          ? "HIGH"
          : "ERROR",
      character: char_name,
      event: {
        type: "combat_live_test",
        event: "COMBAT_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "COMBAT_LIVE_TEST_FAILED",
      },
      extra: {
        test: test_result,
      },
    });

    void observe_persistence(
      persistence.indexIncident(
        incident,
        path.join("logs", "incidents", incident.incident_id),
      ),
      "combat_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }
  function capture_class_skill_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "CLASS_SKILL_LIVE_TEST_FAILED",
      severity:
        test_result.outcome === "UNKNOWN" || test_result.outcome === "TIMEOUT"
          ? "HIGH"
          : "ERROR",
      character: char_name,
      event: {
        type: "class_skill_live_test",
        event: "CLASS_SKILL_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "CLASS_SKILL_LIVE_TEST_FAILED",
      },
      extra: {
        test: test_result,
      },
    });

    void observe_persistence(
      persistence.indexIncident(
        incident,
        path.join("logs", "incidents", incident.incident_id),
      ),
      "class_skill_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }
  function capture_group_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "GROUP_LIVE_TEST_FAILED",
      severity:
        test_result.outcome === "UNKNOWN" || test_result.outcome === "TIMEOUT"
          ? "HIGH"
          : "ERROR",
      character: char_name,
      event: {
        type: "group_live_test",
        event: "GROUP_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.reque
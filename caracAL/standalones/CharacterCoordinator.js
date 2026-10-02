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
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "GROUP_LIVE_TEST_FAILED",
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
      "group_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }

  function capture_farm_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "FARM_LIVE_TEST_FAILED",
      severity: test_result.outcome === "TIMEOUT" ? "HIGH" : "ERROR",
      character: char_name,
      event: {
        type: "farm_live_test",
        event: "FARM_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "FARM_LIVE_TEST_FAILED",
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
      "farm_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }

  async function run_movement_live_test(char_name) {
    const char_block = character_manage[char_name];
    if (!char_block) {
      throw make_control_error(
        "CHARACTER_NOT_FOUND",
        `Unknown character: ${char_name}`,
        404,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.movement_live_test?.status)
    ) {
      throw make_control_error(
        "MOVEMENT_LIVE_TEST_ALREADY_RUNNING",
        `Movement live test already running for ${char_name}`,
        409,
      );
    }
    if (["STARTING", "RUNNING"].includes(char_block.combat_live_test?.status)) {
      throw make_control_error(
        "COMBAT_LIVE_TEST_ALREADY_RUNNING",
        `Combat live test already running for ${char_name}`,
        409,
      );
    }

    if (
      ["STARTING", "RUNNING"].includes(char_block.class_skill_live_test?.status)
    ) {
      throw make_control_error(
        "CLASS_SKILL_LIVE_TEST_ALREADY_RUNNING",
        `Class skill live test already running for ${char_name}`,
        409,
      );
    }

    if (["STARTING", "RUNNING"].includes(char_block.group_live_test?.status)) {
      throw make_control_error(
        "GROUP_LIVE_TEST_ALREADY_RUNNING",
        "Group live test already running for " + char_name,
        409,
      );
    }

    const original_desired_state =
      char_block.desired_runtime_state ||
      (char_block.enabled
        ? DESIRED_RUNTIME_STATES.RUNNING
        : DESIRED_RUNTIME_STATES.STOPPED);
    const start_state = {
      lifecycle_state: char_block.lifecycle_state || null,
      desired_runtime_state: original_desired_state,
      enabled: !!char_block.enabled,
      connected: !!char_block.connected,
      map: char_block.live_state?.map || null,
      x: Number.isFinite(char_block.live_state?.x)
        ? char_block.live_state.x
        : null,
      y: Number.isFinite(char_block.live_state?.y)
        ? char_block.live_state.y
        : null,
    };
    const started_at = Date.now();
    movement_live_test_sequence += 1;
    const request_id = `movement-live-${started_at}-${movement_live_test_sequence}`;

    char_block.movement_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("MOVEMENT_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;

    try {
      const runtime_ready =
        !!char_block.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at);

      if (!runtime_ready) {
        const bundle_path = path.join(
          process.cwd(),
          "TYPECODE.out",
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
        );
        if (!fs_regular.existsSync(bundle_path)) {
          throw make_control_error(
            "MOVEMENT_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Movement runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "MOVEMENT_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
          char_name,
          {
            typescript_file: MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
          },
        );
      }

      if (original_desired_state !== DESIRED_RUNTIME_STATES.RUNNING) {
        char_block.enabled = true;
        char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;
      }

      if (runtime_override_applied) {
        await restart_character_for_movement_runtime(char_name, char_block);
      } else if (!char_block.instance) {
        await control_character(char_name, CONTROL_ACTIONS.START);
      }

      await wait_for_movement_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_movement_live_test_result(
        char_name,
        request_id,
      );

      ready_block.movement_live_test = {
        ...ready_block.movement_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "movement_live_test",
        request_id,
      });
      if (!sent) {
        const pending = movement_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          movement_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "MOVEMENT_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch movement live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "MOVEMENT_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Movement live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = movementLiveTestEvidence(events, ready_block, {
        startedAt: started_at,
      });
      const combined = combineMovementLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_movement_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = movementLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.movement_live_test = {
        ...combined,
        request_id,
        status: "COMPLETED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
      };
      emit_supervisor_event("MOVEMENT_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
      dashboard?.publishSnapshot();
      return ready_block.movement_live_test;
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "MOVEMENT_LIVE_TEST_TIMEOUT" ||
          error.code === "MOVEMENT_LIVE_TEST_RUNTIME_TIMEOUT"
            ? "TIMEOUT"
            : "FAIL",
        reason: error.code || error.message || "MOVEMENT_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = movementLiveTestEvidence(
        failure_events,
        char_block,
        { startedAt: started_at },
      );
      const incident_id = capture_movement_live_test_incident(
        char_name,
        failed_result,
      );
      const failed = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: movementLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
      };
      char_block.movement_live_test = failed;
      emit_supervisor_event("MOVEMENT_LIVE_TEST_FAILED", char_name, failed);
      dashboard?.publishSnapshot();
      return failed;
    } finally {
      const pending = movement_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        movement_live_test_requests.delete(request_id);
      }

      try {
        if (runtime_override_applied) {
          await restore_movement_live_test_execution_source(
            char_name,
            original_desired_state,
          );
        } else {
          await restore_movement_live_test_state(
            char_name,
            original_desired_state,
          );
        }
      } catch (restore_error) {
        emit_supervisor_event(
          "MOVEMENT_LIVE_TEST_STATE_RESTORE_FAILED",
          char_name,
          {
            request_id,
            desired_runtime_state: original_desired_state,
            error:
              restore_error instanceof Error
                ? restore_error.message
                : String(restore_error),
          },
        );
      }
      dashboard?.publishSnapshot();
    }
  }

  async function run_combat_live_test(char_name) {
    const char_block = character_manage[char_name];
    if (!char_block) {
      throw make_control_error(
        "CHARACTER_NOT_FOUND",
        `Unknown character: ${char_name}`,
        404,
      );
    }
    if (char_block.account_character_type === "merchant") {
      throw make_control_error(
        "COMBAT_CHARACTER_REQUIRED",
        `Combat live test requires a non-merchant character: ${char_name}`,
        400,
      );
    }
    if (["STARTING", "RUNNING"].includes(char_block.combat_live_test?.status)) {
      throw make_control_error(
        "COMBAT_LIVE_TEST_ALREADY_RUNNING",
        `Combat live test already running for ${char_name}`,
        409,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.movement_live_test?.status)
    ) {
      throw make_control_error(
        "MOVEMENT_LIVE_TEST_ALREADY_RUNNING",
        `Movement live test already running for ${char_name}`,
        409,
      );
    }

    if (
      ["STARTING", "RUNNING"].includes(char_block.class_skill_live_test?.status)
    ) {
      throw make_control_error(
        "CLASS_SKILL_LIVE_TEST_ALREADY_RUNNING",
        `Class skill live test already running for ${char_name}`,
        409,
      );
    }

    if (["STARTING", "RUNNING"].includes(char_block.group_live_test?.status)) {
      throw make_control_error(
        "GROUP_LIVE_TEST_ALREADY_RUNNING",
        "Group live test already running for " + char_name,
        409,
      );
    }

    const original_desired_state =
      char_block.desired_runtime_state ||
      (char_block.enabled
        ? DESIRED_RUNTIME_STATES.RUNNING
        : DESIRED_RUNTIME_STATES.STOPPED);
    const start_state = {
      lifecycle_state: char_block.lifecycle_state || null,
      desired_runtime_state: original_desired_state,
      enabled: !!char_block.enabled,
      connected: !!char_block.connected,
      map: char_block.live_state?.map || null,
      x: Number.isFinite(char_block.live_state?.x)
        ? char_block.live_state.x
        : null,
      y: Number.isFinite(char_block.live_state?.y)
        ? char_block.live_state.y
        : null,
      hp: Number.isFinite(char_block.live_state?.hp)
        ? char_block.live_state.hp
        : null,
      mp: Number.isFinite(char_block.live_state?.mp)
        ? char_block.live_state.mp
        : null,
    };
    const started_at = Date.now();
    combat_live_test_sequence += 1;
    const request_id = `combat-live-${started_at}-${combat_live_test_sequence}`;

    char_block.combat_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("COMBAT_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;

    try {
      const runtime_ready =
        !!char_block.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at);

      if (!runtime_ready) {
        const bundle_path = path.join(
          process.cwd(),
          "TYPECODE.out",
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
        );
        if (!fs_regular.existsSync(bundle_path)) {
          throw make_control_error(
            "COMBAT_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Combat runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "COMBAT_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
          char_name,
          {
            typescript_file: MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
          },
        );
      }

      if (original_desired_state !== DESIRED_RUNTIME_STATES.RUNNING) {
        char_block.enabled = true;
        char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;
      }

      if (runtime_override_applied) {
        await restart_character_for_movement_runtime(char_name, char_block);
      } else if (!char_block.instance) {
        await control_character(char_name, CONTROL_ACTIONS.START);
      }

      await wait_for_movement_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_combat_live_test_result(
        char_name,
        request_id,
      );

      ready_block.combat_live_test = {
        ...ready_block.combat_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "combat_live_test",
        request_id,
      });
      if (!sent) {
        const pending = combat_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          combat_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "COMBAT_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch combat live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "COMBAT_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Combat live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = combatLiveTestEvidence(events, ready_block);
      const combined = combineCombatLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_combat_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = combatLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.combat_live_test = {
        ...combined,
        request_id,
        status: "COMPLETED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
      };
      emit_supervisor_event("COMBAT_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
      dashboard?.publishSnapshot();
      return ready_block.combat_live_test;
    } catch (error) {
      const failed_result = {
        request_id,
        outcome: error.code === "COMBAT_LIVE_TEST_TIMEOUT" ? "TIMEOUT" : "FAIL",
        reason: error.code || error.message || "COMBAT_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = combatLiveTestEvidence(
        failure_events,
        char_block,
      );
      const incident_id = capture_combat_live_test_incident(
        char_name,
        failed_result,
      );
      const failed = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: combatLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
      };
      char_block.combat_live_test = failed;
      emit_supervisor_event("COMBAT_LIVE_TEST_FAILED", char_name, failed);
      dashboard?.publishSnapshot();
      return failed;
    } finally {
      const pending = combat_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        combat_live_test_requests.delete(request_id);
      }

      try {
        if (runtime_override_applied) {
          await restore_combat_live_test_execution_source(
            char_name,
            original_desired_state,
          );
        } else {
          await restore_movement_live_test_state(
            char_name,
            original_desired_state,
          );
        }
      } catch (restore_error) {
        emit_supervisor_event(
          "COMBAT_LIVE_TEST_STATE_RESTORE_FAILED",
          char_name,
          {
            request_id,
            desired_runtime_state: original_desired_state,
            error:
              restore_error instanceof Error
                ? restore_error.message
                : String(restore_error),
          },
        );
      }
      dashboard?.publishSnapshot();
    }
  }
  async function run_class_skill_live_test(char_name) {
    const char_block = character_manage[char_name];
    if (!char_block) {
      throw make_control_error(
        "CHARACTER_NOT_FOUND",
        `Unknown character: ${char_name}`,
        404,
      );
    }
    if (
      (char_block.account_character_type || char_block.live_state?.ctype) !==
      "ranger"
    ) {
      throw make_control_error(
        "CLASS_SKILL_RANGER_REQUIRED",
        `Class skill live test requires a Ranger: ${char_name}`,
        400,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.class_skill_live_test?.status)
    ) {
      throw make_control_error(
        "CLASS_SKILL_LIVE_TEST_ALREADY_RUNNING",
        `Class skill live test already running for ${char_name}`,
        409,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.movement_live_test?.status)
    ) {
      throw make_control_error(
        "MOVEMENT_LIVE_TEST_ALREADY_RUNNING",
        `Movement live test already running for ${char_name}`,
        409,
      );
    }
    if (["STARTING", "RUNNING"].includes(char_block.combat_live_test?.status)) {
      throw make_control_error(
        "COMBAT_LIVE_TEST_ALREADY_RUNNING",
        `Combat live test already running for ${char_name}`,
        409,
      );
    }

    if (["STARTING", "RUNNING"].includes(char_block.group_live_test?.status)) {
      throw make_control_error(
        "GROUP_LIVE_TEST_ALREADY_RUNNING",
        "Group live test already running for " + char_name,
        409,
      );
    }

    const original_desired_state =
      char_block.desired_runtime_state ||
      (char_block.enabled
        ? DESIRED_RUNTIME_STATES.RUNNING
        : DESIRED_RUNTIME_STATES.STOPPED);
    const start_state = {
      lifecycle_state: char_block.lifecycle_state || null,
      desired_runtime_state: original_desired_state,
      enabled: !!char_block.enabled,
      connected: !!char_block.connected,
      map: char_block.live_state?.map || null,
      x: Number.isFinite(char_block.live_state?.x)
        ? char_block.live_state.x
        : null,
      y: Number.isFinite(char_block.live_state?.y)
        ? char_block.live_state.y
        : null,
      hp: Number.isFinite(char_block.live_state?.hp)
        ? char_block.live_state.hp
        : null,
      mp: Number.isFinite(char_block.live_state?.mp)
        ? char_block.live_state.mp
        : null,
    };
    const started_at = Date.now();
    class_skill_live_test_sequence += 1;
    const request_id = `class-skill-live-${started_at}-${class_skill_live_test_sequence}`;

    char_block.class_skill_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("CLASS_SKILL_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;

    try {
      const runtime_ready =
        !!char_block.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at);

      if (!runtime_ready) {
        const bundle_path = path.join(
          process.cwd(),
          "TYPECODE.out",
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
        );
        if (!fs_regular.existsSync(bundle_path)) {
          throw make_control_error(
            "CLASS_SKILL_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Class skill runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "CLASS_SKILL_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
          char_name,
          {
            typescript_file: MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
          },
        );
      }

      if (original_desired_state !== DESIRED_RUNTIME_STATES.RUNNING) {
        char_block.enabled = true;
        char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;
      }

      if (runtime_override_applied) {
        await restart_character_for_movement_runtime(char_name, char_block);
      } else if (!char_block.instance) {
        await control_character(char_name, CONTROL_ACTIONS.START);
      }

      await wait_for_movement_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_class_skill_live_test_result(
        char_name,
        request_id,
      );

      ready_block.class_skill_live_test = {
        ...ready_block.class_skill_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "class_skill_live_test",
        request_id,
      });
      if (!sent) {
        const pending = class_skill_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          class_skill_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "CLASS_SKILL_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch combat live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "CLASS_SKILL_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Class skill live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = classSkillLiveTestEvidence(events, ready_block);
      const combined = combineClassSkillLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_class_skill_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = classSkillLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.class_skill_live_test = {
        ...combined,
        request_id,
        status: "COMPLETED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
      };
      emit_supervisor_event("CLASS_SKILL_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
      dashboard?.publishSnapshot();
      return ready_block.class_skill_live_test;
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "CLASS_SKILL_LIVE_TEST_TIMEOUT" ? "TIMEOUT" : "FAIL",
        reason: error.code || error.message || "CLASS_SKILL_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = classSkillLiveTestEvidence(
        failure_events,
        char_block,
      );
      const incident_id = capture_class_skill_live_test_incident(
        char_name,
        failed_result,
      );
      const failed = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: classSkillLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
      };
      char_block.class_skill_live_test = failed;
      emit_supervisor_event("CLASS_SKILL_LIVE_TEST_FAILED", char_name, failed);
      dashboard?.publishSnapshot();
      return failed;
    } finally {
      const pending = class_skill_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        class_skill_live_test_requests.delete(request_id);
      }

      try {
        if (runtime_override_applied) {
          await restore_class_skill_live_test_execution_source(
            char_name,
            original_desired_state,
          );
        } else {
          await restore_movement_live_test_state(
            char_name,
            original_desired_state,
          );
        }
      } catch (restore_error) {
        emit_supervisor_event(
          "CLASS_SKILL_LIVE_TEST_STATE_RESTORE_FAILED",
          char_name,
          {
            request_id,
            desired_runtime_state: original_desired_state,
            error:
              restore_error instanceof Error
                ? restore_error.message
                : String(restore_error),
          },
        );
      }
      dashboard?.publishSnapshot();
    }
  }
  async function run_group_live_test(char_name, options = {}) {
    const char_block = character_manage[char_name];
    if (!char_block) {
      throw make_control_error(
        "CHARACTER_NOT_FOUND",
        `Unknown character: ${char_name}`,
        404,
      );
    }
    if (
      (char_block.account_character_type || char_block.live_state?.ctype) ===
      "merchant"
    ) {
      throw make_control_error(
        "GROUP_COMBAT_CHARACTER_REQUIRED",
        "Group live test requires a non-merchant character: " + char_name,
        400,
      );
    }
    if (
      !["leader", "follower"].includes(options.role) ||
      typeof options.leader !== "string" ||
      typeof options.peer !== "string" ||
      options.leader === options.peer ||
      ![options.leader, options.peer].includes(char_name)
    ) {
      throw make_control_error(
        "GROUP_LIVE_TEST_PAIR_INVALID",
        "Invalid group live test pair for " + char_name,
        400,
      );
    }

    if (["STARTING", "RUNNING"].includes(char_block.group_live_test?.status)) {
      throw make_control_error(
        "GROUP_LIVE_TEST_ALREADY_RUNNING",
        `Group live test already running for ${char_name}`,
        409,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.movement_live_test?.status)
    ) {
      throw make_control_error(
        "MOVEMENT_LIVE_TEST_ALREADY_RUNNING",
        `Movement live test already running for ${char_name}`,
        409,
      );
    }
    if (["STARTING", "RUNNING"].includes(char_block.combat_live_test?.status)) {
      throw make_control_error(
        "COMBAT_LIVE_TEST_ALREADY_RUNNING",
        `Combat live test already running for ${char_name}`,
        409,
      );
    }

    if (["STARTING", "RUNNING"].includes(char_block.group_live_test?.status)) {
      throw make_control_error(
        "GROUP_LIVE_TEST_ALREADY_RUNNING",
        "Group live test already running for " + char_name,
        409,
      );
    }

    const original_desired_state =
      char_block.desired_runtime_state ||
      (char_block.enabled
        ? DESIRED_RUNTIME_STATES.RUNNING
        : DESIRED_RUNTIME_STATES.STOPPED);
    const start_state = {
      lifecycle_state: char_block.lifecycle_state || null,
      desired_runtime_state: original_desired_state,
      enabled: !!char_block.enabled,
      connected: !!char_block.connected,
      map: char_block.live_state?.map || null,
      x: Number.isFinite(char_block.live_state?.x)
        ? char_block.live_state.x
        : null,
      y: Number.isFinite(char_block.live_state?.y)
        ? char_block.live_state.y
        : null,
      hp: Number.isFinite(char_block.live_state?.hp)
        ? char_block.live_state.hp
        : null,
      mp: Number.isFinite(char_block.live_state?.mp)
        ? char_block.live_state.mp
        : null,
    };
    const started_at = Date.now();
    group_live_test_sequence += 1;
    const request_id = `group-live-${started_at}-${group_live_test_sequence}`;

    char_block.group_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("GROUP_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
      role: options.role,
      leader: options.leader,
      peer: options.peer,
      baseline_pair_formed:
        typeof options.baselinePairFormed === "boolean"
          ? options.baselinePairFormed
          : null,
      coordinated_pair: options.coordinatedPair === true,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;

    try {
      const runtime_ready =
        !!char_block.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at);

      if (!runtime_ready) {
        const bundle_path = path.join(
          process.cwd(),
          "TYPECODE.out",
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
        );
        if (!fs_regular.existsSync(bundle_path)) {
          throw make_control_error(
            "GROUP_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Group runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "GROUP_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
          char_name,
          {
            typescript_file: MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
          },
        );
      }

      if (original_desired_state !== DESIRED_RUNTIME_STATES.RUNNING) {
        char_block.enabled = true;
        char_block.desired_runtime_state = DESIRED_RUNTIME_STATES.RUNNING;
      }

      if (runtime_override_applied) {
        await restart_character_for_movement_runtime(char_name, char_block);
      } else if (!char_block.instance) {
        await control_character(char_name, CONTROL_ACTIONS.START);
      }

      await wait_for_group_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_group_live_test_result(
        char_name,
        request_id,
      );

      ready_block.group_live_test = {
        ...ready_block.group_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "group_live_test",
        request_id,
        role: options.role,
        leader: options.leader,
        peer: options.peer,
        baselinePairFormed:
          typeof options.baselinePairFormed === "boolean"
            ? options.baselinePairFormed
            : undefined,
        coordinatedPair: options.coordinatedPair === true,
      });
      if (!sent) {
        const pending = group_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          group_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "GROUP_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch group live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "GROUP_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Group live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = groupLiveTestEvidence(events, ready_block);
      const combined = combineGroupLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_group_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = groupLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
    !}QMQ}%1ˆ°(€€€€€€€•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”ñğMÑÉ¥¹œ¡•ÉÉ½È¤°(€€€€€€€ÍÑ…ÉÑ•‘}…Ğ°(€€€€€€€½µÁ±•Ñ•‘}…Ğè…Ñ”¹¹½Ü ¤°(€€€€€€€‘ÕÉ…Ñ¥½¹5Ìè…Ñ”¹¹½Ü ¤€´ÍÑ…ÉÑ•‘}…Ğ°(€€€€€ôì(€€€€€½¹ÍĞ™…¥±ÕÉ•}•Ù•¹ÑÌ€ô‘¥…¹½ÍÑ¥}ÍÑ½É”¹•ÑÙ•¹ÑÌ¡ì(€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€Í¥¹”èÍÑ…ÉÑ•‘}…Ğ°(€€€€€ô¤ì(€€€€€½¹ÍĞ™…¥±ÕÉ•}•Ù¥‘•¹”€ôÉ½ÕÁ1¥Ù•Q•ÍÑÙ¥‘•¹” (€€€€€€€™…¥±ÕÉ•}•Ù•¹ÑÌ°(€€€€€€€¡…É}‰±½¬°(€€€€€€¤ì(€€€€€½¹ÍĞ¥¹¥‘•¹Ñ}¥€ô…ÁÑÕÉ•}É½ÕÁ}±¥Ù•}Ñ•ÍÑ}¥¹¥‘•¹Ğ (€€€€€€€¡…É}¹…µ”°(€€€€€€€™…¥±•‘}É•ÍÕ±Ğ°(€€€€€€¤ì(€€€€€½¹ÍĞ™…¥±•€ôì(€€€€€€€€¸¸¹™…¥±•‘}É•ÍÕ±Ğ°(€€€€€€€ÍÑ…ÑÕÌè€‰%1ˆ°(€€€€€€€¥¹¥‘•¹Ñ}¥°(€€€€€€€‘¥…¹½ÍÑ¥ÌèÉ½ÕÁ1¥Ù•Q•ÍÑ¥…¹½ÍÑ¥Ì¡™…¥±•‘}É•ÍÕ±Ğ°ì(€€€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€€€½É¥¥¹…±•Í¥É•‘MÑ…Ñ”è½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€ÍÑ…ÉÑMÑ…Ñ”èÍÑ…ÉÑ}ÍÑ…Ñ”°(€€€€€€€€€•Ù¥‘•¹”è™…¥±ÕÉ•}•Ù¥‘•¹”°(€€€€€€€€€¥¹¥‘•¹Ñ%è¥¹¥‘•¹Ñ}¥°(€€€€€€€ô¤°(€€€€€ôì(€€€€€¡…É}‰±½¬¹É½ÕÁ}±¥Ù•}Ñ•ÍĞ€ô™…¥±•ì(€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I=UA}1%Y}QMQ}%1ˆ°¡…É}¹…µ”°™…¥±•¤ì(€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€€€É•ÑÕÉ¸™…¥±•ì(€€€ô™¥¹…±±äì(€€€€€½¹ÍĞÁ•¹‘¥¹œ€ôÉ½ÕÁ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡É•ÅÕ•ÍÑ}¥¤ì(€€€€€¥˜€¡Á•¹‘¥¹œ¤ì(€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€É½ÕÁ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡É•ÅÕ•ÍÑ}¥¤ì(€€€€€ô((€€€€€ÑÉäì(€€€€€€€¥˜€¡ÉÕ¹Ñ¥µ•}½Ù•ÉÉ¥‘•}…ÁÁ±¥•¤ì(€€€€€€€€€…İ…¥ĞÉ•ÍÑ½É•}É½ÕÁ}±¥Ù•}Ñ•ÍÑ}•á•ÕÑ¥½¹}Í½ÕÉ” (€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€€¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€…İ…¥ĞÉ•ÍÑ½É•}µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑ}ÍÑ…Ñ” (€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€€¤ì(€€€€€€€ô(€€€€€ô…Ñ €¡É•ÍÑ½É•}•ÉÉ½È¤ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€‰I=UA}1%Y}QMQ}MQQ}IMQ=I}%1ˆ°(€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€ì(€€€€€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€€€•ÉÉ½Èè(€€€€€€€€€€€€€É•ÍÑ½É•}•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È(€€€€€€€€€€€€€€€€üÉ•ÍÑ½É•}•ÉÉ½È¹µ•ÍÍ…”(€€€€€€€€€€€€€€€€èMÑÉ¥¹œ¡É•ÍÑ½É•}•ÉÉ½È¤°(€€€€€€€€€ô°(€€€€€€€€¤ì(€€€€€ô(€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€ô(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸ÉÕ¹}™…Éµ}±¥Ù•}Ñ•ÍĞ¡¡…É}¹…µ”°½ÁÑ¥½¹Ì€ôíô¤ì(€€€½¹ÍĞ¡…É}‰±½¬€ô¡…É…Ñ•É}µ…¹…•m¡…É}¹…µ•tì(€€€¥˜€ …¡…É}‰±½¬¤ì(€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€‰!IQI}9=Q}=U9ˆ°(€€€€€€€U¹­¹½İ¸¡…É…Ñ•Èè€‘í¡…É}¹…µ•õ€°(€€€€€€€€ĞÀĞ°(€€€€€€¤ì(€€€ô(€€€¥˜€ (€€€€€€¡¡…É}‰±½¬¹…½Õ¹Ñ}¡…É…Ñ•É}ÑåÁ”ñğ¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”ü¹ÑåÁ”¤€ôôô(€€€€€€‰µ•É¡…¹Ğˆ(€€€€¤ì(€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€‰I5}!IQI}IEU%Iˆ°(€€€€€€€€‰…É´±¥Ù”Ñ•ÍĞÉ•ÅÕ¥É•Ì„¹½¸µµ•É¡…¹Ğ¡…É…Ñ•Èè€ˆ€¬¡…É}¹…µ”°(€€€€€€€€ĞÀÀ°(€€€€€€¤ì(€€€ô(€€€¥˜€¡l‰MQIQ%9ˆ°€‰IU99%9‰t¹¥¹±Õ‘•Ì¡¡…É}‰±½¬¹™…Éµ}±¥Ù•}Ñ•ÍĞü¹ÍÑ…ÑÕÌ¤¤ì(€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€‰I5}1%Y}QMQ}1Ie}IU99%9ˆ°(€€€€€€€…É´±¥Ù”Ñ•ÍĞ…±É•…‘äÉÕ¹¹¥¹œ™½È€‘í¡…É}¹…µ•õ€°(€€€€€€€€ĞÀä°(€€€€€€¤ì(€€€ô(€€€™½È€¡½¹ÍĞ…Ñ¥Ù”½˜l(€€€€€l‰5=Y59Pˆ°¡…É}‰±½¬¹µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑt°(€€€€€l‰=5	Pˆ°¡…É}‰±½¬¹½µ‰…Ñ}±¥Ù•}Ñ•ÍÑt°(€€€€€l‰1MM}M-%10ˆ°¡…É}‰±½¬¹±…ÍÍ}Í­¥±±}±¥Ù•}Ñ•ÍÑt°(€€€€€l‰I=U@ˆ°¡…É}‰±½¬¹É½ÕÁ}±¥Ù•}Ñ•ÍÑt°(€€€t¤ì(€€€€€¥˜€¡l‰MQIQ%9ˆ°€‰IU99%9‰t¹¥¹±Õ‘•Ì¡…Ñ¥Ù•lÅtü¹ÍÑ…ÑÕÌ¤¤ì(€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€…Ñ¥Ù•lÁt€¬€‰}1%Y}QMQ}1Ie}IU99%9ˆ°(€€€€€€€€€…Ñ¥Ù•lÁt€¬€ˆ±¥Ù”Ñ•ÍĞ…±É•…‘äÉÕ¹¹¥¹œ™½È€ˆ€¬¡…É}¹…µ”°(€€€€€€€€€€ĞÀä°(€€€€€€€€¤ì(€€€€€ô(€€€ô((€€€½¹ÍĞ½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”€ô(€€€€€¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”ñğ(€€€€€€¡¡…É}‰±½¬¹•¹…‰±•(€€€€€€€€üM%I}IU9Q%5}MQQL¹IU99%9(€€€€€€€€èM%I}IU9Q%5}MQQL¹MQ=AA¤ì(€€€½¹ÍĞÍÑ…ÉÑ}ÍÑ…Ñ”€ôì(€€€€€±¥™•å±•}ÍÑ…Ñ”è¡…É}‰±½¬¹±¥™•å±•}ÍÑ…Ñ”ñğ¹Õ±°°(€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€•¹…‰±•è€„…¡…É}‰±½¬¹•¹…‰±•°(€€€€€½¹¹•Ñ•è€„…¡…É}‰±½¬¹½¹¹•Ñ•°(€€€€€µ…Àè¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”ü¹µ…Àñğ¹Õ±°°(€€€€€àè9Õµ‰•È¹¥Í¥¹¥Ñ”¡¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”ü¹à¤(€€€€€€€€ü¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”¹à(€€€€€€€€è¹Õ±°°(€€€€€äè9Õµ‰•È¹¥Í¥¹¥Ñ”¡¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”ü¹ä¤(€€€€€€€€ü¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”¹ä(€€€€€€€€è¹Õ±°°(€€€€€áÀè9Õµ‰•È¹¥Í¥¹¥Ñ”¡¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”ü¹áÀ¤(€€€€€€€€ü¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”¹áÀ(€€€€€€€€è¹Õ±°°(€€€€€½±è9Õµ‰•È¹¥Í¥¹¥Ñ”¡¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”ü¹½±¤(€€€€€€€€ü¡…É}‰±½¬¹±¥Ù•}ÍÑ…Ñ”¹½±(€€€€€€€€è¹Õ±°°(€€€ôì(€€€½¹ÍĞÍÑ…ÉÑ•‘}…Ğ€ô…Ñ”¹¹½Ü ¤ì(€€€™…Éµ}±¥Ù•}Ñ•ÍÑ}Í•ÅÕ•¹”€¬ô€Äì(€€€½¹ÍĞÉ•ÅÕ•ÍÑ}¥€ô™…É´µ±¥Ù”´‘íÍÑ…ÉÑ•‘}…Ñô´‘í™…Éµ}±¥Ù•}Ñ•ÍÑ}Í•ÅÕ•¹•õ€ì((€€€¡…É}‰±½¬¹™…Éµ}±¥Ù•}Ñ•ÍĞ€ôì(€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€ÍÑ…ÑÕÌè€‰MQIQ%9ˆ°(€€€€€½ÕÑ½µ”è¹Õ±°°(€€€€€É•…Í½¸è¹Õ±°°(€€€€€ÍÑ…ÉÑ•‘}…Ğ°(€€€€€½µÁ±•Ñ•‘}…Ğè¹Õ±°°(€€€ôì(€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I5}1%Y}QMQ}IEUMQˆ°¡…É}¹…µ”°ì(€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€ô¤ì(€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì((€€€±•ĞÉÕ¹Ñ¥µ•}½Ù•ÉÉ¥‘•}…ÁÁ±¥•€ô™…±Í”ì((€€€ÑÉäì(€€€€€½¹ÍĞÉÕ¹Ñ¥µ•}É•…‘ä€ô(€€€€€€€€„…¡…É}‰±½¬¹¥¹ÍÑ…¹”€˜˜(€€€€€€€¡…É}‰±½¬¹½¹¹•Ñ•€˜˜(€€€€€€€9Õµ‰•È¹¥Í¥¹¥Ñ”¡¡…É}‰±½¬¹‰½Ñ}ÉÕ¹Ñ¥µ•}ÍÑ…ÉÑ•‘}…Ğ¤ì((€€€€€¥˜€ …ÉÕ¹Ñ¥µ•}É•…‘ä¤ì(€€€€€€€½¹ÍĞ‰Õ¹‘±•}Á…Ñ €ôÁ…Ñ ¹©½¥¸ (€€€€€€€€€ÁÉ½•ÍÌ¹İ ¤°(€€€€€€€€€€‰QeA=¹½ÕĞˆ°(€€€€€€€€€5=Y59Q}1%Y}QMQ}QeAMI%AQ}%1°(€€€€€€€€¤ì(€€€€€€€¥˜€ …™Í}É•Õ±…È¹•á¥ÍÑÍMå¹Œ¡‰Õ¹‘±•}Á…Ñ ¤¤ì(€€€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€€€€‰I5}1%Y}QMQ}IU9Q%5}	U91}5%MM%9ˆ°(€€€€€€€€€€€…É´ÉÕ¹Ñ¥µ”‰Õ¹‘±”¥Ìµ¥ÍÍ¥¹œè€‘í‰Õ¹‘±•}Á…Ñ¡õ€°(€€€€€€€€€€€€ÔÀÌ°(€€€€€€€€€€¤ì(€€€€€€€ô((€€€€€€€¡…É}‰±½¬¹µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑ}ÑåÁ•ÍÉ¥ÁÑ}½Ù•ÉÉ¥‘”€ô(€€€€€€€€€5=Y59Q}1%Y}QMQ}QeAMI%AQ}%1ì(€€€€€€€ÉÕ¹Ñ¥µ•}½Ù•ÉÉ¥‘•}…ÁÁ±¥•€ôÑÉÕ”ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€‰I5}1%Y}QMQ}IU9Q%5}=YII%}AA1%ˆ°(€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€ì(€€€€€€€€€€€ÑåÁ•ÍÉ¥ÁÑ}™¥±”è5=Y59Q}1%Y}QMQ}QeAMI%AQ}%1°(€€€€€€€€€ô°(€€€€€€€€¤ì(€€€€€ô((€€€€€¥˜€¡½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”€„ôôM%I}IU9Q%5}MQQL¹IU99%9¤ì(€€€€€€€¡…É}‰±½¬¹•¹…‰±•€ôÑÉÕ”ì(€€€€€€€¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€ôM%I}IU9Q%5}MQQL¹IU99%9ì(€€€€€ô((€€€€€¥˜€¡ÉÕ¹Ñ¥µ•}½Ù•ÉÉ¥‘•}…ÁÁ±¥•¤ì(€€€€€€€…İ…¥ĞÉ•ÍÑ…ÉÑ}¡…É…Ñ•É}™½É}µ½Ù•µ•¹Ñ}ÉÕ¹Ñ¥µ”¡¡…É}¹…µ”°¡…É}‰±½¬¤ì(€€€€€ô•±Í”¥˜€ …¡…É}‰±½¬¹¥¹ÍÑ…¹”¤ì(€€€€€€€…İ…¥Ğ½¹ÑÉ½±}¡…É…Ñ•È¡¡…É}¹…µ”°=9QI=1}Q%=9L¹MQIP¤ì(€€€€€ô((€€€€€…İ…¥Ğİ…¥Ñ}™½É}™…Éµ}±¥Ù•}Ñ•ÍÑ}ÉÕ¹Ñ¥µ”¡¡…É}¹…µ”¤ì(€€€€€½¹ÍĞÉ•…‘å}‰±½¬€ô¡…É…Ñ•É}µ…¹…•m¡…É}¹…µ•tì(€€€€€½¹ÍĞÉ•ÍÕ±Ñ}ÁÉ½µ¥Í”€ôİ…¥Ñ}™½É}™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÍÕ±Ğ (€€€€€€€¡…É}¹…µ”°(€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€¤ì((€€€€€É•…‘å}‰±½¬¹™…Éµ}±¥Ù•}Ñ•ÍĞ€ôì(€€€€€€€€¸¸¹É•…‘å}‰±½¬¹™…Éµ}±¥Ù•}Ñ•ÍĞ°(€€€€€€€ÍÑ…ÑÕÌè€‰IU99%9ˆ°(€€€€€ôì(€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì((€€€€€½¹ÍĞÍ•¹Ğ€ôÍ…™•}Í•¹¡É•…‘å}‰±½¬¹¥¹ÍÑ…¹”°ì(€€€€€€€ÑåÁ”è€‰™…Éµ}±¥Ù•}Ñ•ÍĞˆ°(€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€€Í…µÁ±•}µÌè9Õµ‰•È¹¥Í¥¹¥Ñ”¡9Õµ‰•È¡½ÁÑ¥½¹Ì¹Í…µÁ±•5Ì¤¤(€€€€€€€€€€ü9Õµ‰•È¡½ÁÑ¥½¹Ì¹Í…µÁ±•5Ì¤(€€€€€€€€€€èÕ¹‘•™¥¹•°(€€€€€ô¤ì(€€€€€¥˜€ …Í•¹Ğ¤ì(€€€€€€€½¹ÍĞÁ•¹‘¥¹œ€ô™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€¥˜€¡Á•¹‘¥¹œ¤ì(€€€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€€€™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€ô(€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€€‰I5}1%Y}QMQ}%MAQ!}%1ˆ°(€€€€€€€€€½Õ±¹½Ğ‘¥ÍÁ…Ñ ™…É´±¥Ù”Ñ•ÍĞÑ¼€‘í¡…É}¹…µ•õ€°(€€€€€€€€€€ÔÀÌ°(€€€€€€€€¤ì(€€€€€ô((€€€€€½¹ÍĞ¡¥±‘}É•ÍÁ½¹Í”€ô…İ…¥ĞÉ•ÍÕ±Ñ}ÁÉ½µ¥Í”ì(€€€€€¥˜€¡¡¥±‘}É•ÍÁ½¹Í”¹•ÉÉ½Èñğ€…¡¥±‘}É•ÍÁ½¹Í”¹É•ÍÕ±Ğ¤ì(€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€€‰I5}1%Y}QMQ}IU9Q%5}%1ˆ°(€€€€€€€€€¡¥±‘}É•ÍÁ½¹Í”¹•ÉÉ½Èñğ€‰…É´±¥Ù”Ñ•ÍĞÉ•ÑÕÉ¹•¹¼É•ÍÕ±Ğˆ°(€€€€€€€€€€ÔÀÀ°(€€€€€€€€¤ì(€€€€€ô((€€€€€½¹ÍĞ•Ù•¹ÑÌ€ô‘¥…¹½ÍÑ¥}ÍÑ½É”¹•ÑÙ•¹ÑÌ¡ì(€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€Í¥¹”èÍÑ…ÉÑ•‘}…Ğ°(€€€€€ô¤ì(€€€€€½¹ÍĞ•Ù¥‘•¹”€ô™…Éµ1¥Ù•Q•ÍÑÙ¥‘•¹”¡•Ù•¹ÑÌ°É•…‘å}‰±½¬¤ì(€€€€€½¹ÍĞ½µ‰¥¹•€ô½µ‰¥¹•…Éµ1¥Ù•Q•ÍÑI•ÍÕ±Ğ (€€€€€€€¡¥±‘}É•ÍÁ½¹Í”¹É•ÍÕ±Ğ°(€€€€€€€•Ù¥‘•¹”°(€€€€€€¤ì(€€€€€½¹ÍĞ¥¹¥‘•¹Ñ}¥€ô(€€€€€€€½µ‰¥¹•¹½ÕÑ½µ”€ôôô€‰AMLˆ(€€€€€€€€€€ü¹Õ±°(€€€€€€€€€€è…ÁÑÕÉ•}™…Éµ}±¥Ù•}Ñ•ÍÑ}¥¹¥‘•¹Ğ¡¡…É}¹…µ”°ì(€€€€€€€€€€€€€€¸¸¹½µ‰¥¹•°(€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€ô¤ì(€€€€€½¹ÍĞ‘¥…¹½ÍÑ¥Ì€ô™…Éµ1¥Ù•Q•ÍÑ¥…¹½ÍÑ¥Ì¡½µ‰¥¹•°ì(€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€½É¥¥¹…±•Í¥É•‘MÑ…Ñ”è½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€ÍÑ…ÉÑMÑ…Ñ”èÍÑ…ÉÑ}ÍÑ…Ñ”°(€€€€€€€•Ù¥‘•¹”°(€€€€€€€¥¹¥‘•¹Ñ%è¥¹¥‘•¹Ñ}¥°(€€€€€ô¤ì((€€€€€É•…‘å}‰±½¬¹™…Éµ}±¥Ù•}Ñ•ÍĞ€ôì(€€€€€€€€¸¸¹½µ‰¥¹•°(€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€€ÍÑ…ÑÕÌè€‰=5A1Qˆ°(€€€€€€€ÍÑ…ÉÑ•‘}…Ğ°(€€€€€€€½µÁ±•Ñ•‘}…Ğè…Ñ”¹¹½Ü ¤°(€€€€€€€¥¹¥‘•¹Ñ}¥°(€€€€€€€‘¥…¹½ÍÑ¥Ì°(€€€€€ôì(€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I5}1%Y}QMQ}=5A1Qˆ°¡…É}¹…µ”°ì(€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€€½ÕÑ½µ”è½µ‰¥¹•¹½ÕÑ½µ”°(€€€€€€€É•…Í½¸è½µ‰¥¹•¹É•…Í½¸°(€€€€€€€¥¹¥‘•¹Ñ}¥°(€€€€€€€ÍÕÁ•ÉÙ¥Í½Èè•Ù¥‘•¹”°(€€€€€ô¤ì(€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€€€É•ÑÕÉ¸É•…‘å}‰±½¬¹™…Éµ}±¥Ù•}Ñ•ÍĞì(€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€½¹ÍĞ™…¥±•‘}É•ÍÕ±Ğ€ôì(€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€€½ÕÑ½µ”è(€€€€€€€€€•ÉÉ½È¹½‘”€ôôô€‰I5}1%Y}QMQ}Q%5=UPˆñğ(€€€€€€€€€•ÉÉ½È¹½‘”€ôôô€‰I5}1%Y}QMQ}IU9Q%5}Q%5=UPˆ(€€€€€€€€€€€€ü€‰Q%5=UPˆ(€€€€€€€€€€€€è€‰%0ˆ°(€€€€€€€É•…Í½¸è•ÉÉ½È¹½‘”ñğ•ÉÉ½È¹µ•ÍÍ…”ñğ€‰I5}1%Y}QMQ}%1ˆ°(€€€€€€€•ÉÉ½Èè•ÉÉ½È¹µ•ÍÍ…”ñğMÑÉ¥¹œ¡•ÉÉ½È¤°(€€€€€€€ÍÑ…ÉÑ•‘}…Ğ°(€€€€€€€½µÁ±•Ñ•‘}…Ğè…Ñ”¹¹½Ü ¤°(€€€€€€€‘ÕÉ…Ñ¥½¹5Ìè…Ñ”¹¹½Ü ¤€´ÍÑ…ÉÑ•‘}…Ğ°(€€€€€ôì(€€€€€½¹ÍĞ™…¥±ÕÉ•}•Ù•¹ÑÌ€ô‘¥…¹½ÍÑ¥}ÍÑ½É”¹•ÑÙ•¹ÑÌ¡ì(€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€Í¥¹”èÍÑ…ÉÑ•‘}…Ğ°(€€€€€ô¤ì(€€€€€½¹ÍĞ™…¥±ÕÉ•}•Ù¥‘•¹”€ô™…Éµ1¥Ù•Q•ÍÑÙ¥‘•¹”¡™…¥±ÕÉ•}•Ù•¹ÑÌ°¡…É}‰±½¬¤ì(€€€€€½¹ÍĞ¥¹¥‘•¹Ñ}¥€ô…ÁÑÕÉ•}™…Éµ}±¥Ù•}Ñ•ÍÑ}¥¹¥‘•¹Ğ (€€€€€€€¡…É}¹…µ”°(€€€€€€€™…¥±•‘}É•ÍÕ±Ğ°(€€€€€€¤ì(€€€€€½¹ÍĞ™…¥±•€ôì(€€€€€€€€¸¸¹™…¥±•‘}É•ÍÕ±Ğ°(€€€€€€€ÍÑ…ÑÕÌè€‰%1ˆ°(€€€€€€€¥¹¥‘•¹Ñ}¥°(€€€€€€€‘¥…¹½ÍÑ¥Ìè™…Éµ1¥Ù•Q•ÍÑ¥…¹½ÍÑ¥Ì¡™…¥±•‘}É•ÍÕ±Ğ°ì(€€€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€€€½É¥¥¹…±•Í¥É•‘MÑ…Ñ”è½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€ÍÑ…ÉÑMÑ…Ñ”èÍÑ…ÉÑ}ÍÑ…Ñ”°(€€€€€€€€€•Ù¥‘•¹”è™…¥±ÕÉ•}•Ù¥‘•¹”°(€€€€€€€€€¥¹¥‘•¹Ñ%è¥¹¥‘•¹Ñ}¥°(€€€€€€€ô¤°(€€€€€ôì(€€€€€¡…É}‰±½¬¹™…Éµ}±¥Ù•}Ñ•ÍĞ€ô™…¥±•ì(€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I5}1%Y}QMQ}%1ˆ°¡…É}¹…µ”°™…¥±•¤ì(€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€€€É•ÑÕÉ¸™…¥±•ì(€€€ô™¥¹…±±äì(€€€€€½¹ÍĞÁ•¹‘¥¹œ€ô™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡É•ÅÕ•ÍÑ}¥¤ì(€€€€€¥˜€¡Á•¹‘¥¹œ¤ì(€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡É•ÅÕ•ÍÑ}¥¤ì(€€€€€ô((€€€€€ÑÉäì(€€€€€€€¥˜€¡ÉÕ¹Ñ¥µ•}½Ù•ÉÉ¥‘•}…ÁÁ±¥•¤ì(€€€€€€€€€…İ…¥ĞÉ•ÍÑ½É•}µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑ}•á•ÕÑ¥½¹}Í½ÕÉ” (€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€€¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€…İ…¥ĞÉ•ÍÑ½É•}µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑ}ÍÑ…Ñ” (€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€€¤ì(€€€€€€€ô(€€€€€ô…Ñ €¡É•ÍÑ½É•}•ÉÉ½È¤ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€‰I5}1%Y}QMQ}MQQ}IMQ=I}%1ˆ°(€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€ì(€€€€€€€€€€€É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è½É¥¥¹…±}‘•Í¥É•‘}ÍÑ…Ñ”°(€€€€€€€€€€€•ÉÉ½Èè(€€€€€€€€€€€€€É•ÍÑ½É•}•ÉÉ½È¥¹ÍÑ…¹•½˜ÉÉ½È(€€€€€€€€€€€€€€€€üÉ•ÍÑ½É•}•ÉÉ½È¹µ•ÍÍ…”(€€€€€€€€€€€€€€€€èMÑÉ¥¹œ¡É•ÍÑ½É•}•ÉÉ½È¤°(€€€€€€€€€ô°(€€€€€€€€¤ì(€€€€€ô(€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€ô(€ô((€…Íå¹Œ™Õ¹Ñ¥½¸½¹ÑÉ½±}¡…É…Ñ•È¡¡…É}¹…µ”°…Ñ¥½¸¤ì(€€€½¹ÍĞ¡…É}‰±½¬€ô¡…É…Ñ•É}µ…¹…•m¡…É}¹…µ•tì(€€€¥˜€ …¡…É}‰±½¬¤ì(€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€‰!IQI}9=Q}=U9ˆ°(€€€€€€€U¹­¹½İ¸¡…É…Ñ•Èè€‘í¡…É}¹…µ•õ€°(€€€€€€€€ĞÀĞ°(€€€€€€¤ì(€€€ô((€€€Íİ¥Ñ €¡…Ñ¥½¸¤ì(€€€€€…Í”=9QI=1}Q%=9L¹MQIPèì(€€€€€€€¥˜€ (€€€€€€€€€€…¡…É}‰±½¬¹¥¹ÍÑ…¹”€˜˜(€€€€€€€€€½Õ¹ÑÑ¥Ù•¡…É…Ñ•ÉÌ¡¡…É…Ñ•É}µ…¹…”¤€øô(€€€€€€€€€€€±¥™•å±•}Á½±¥ä¹µ…á=¹±¥¹•¡…É…Ñ•ÉÌ(€€€€€€€€¤ì(€€€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€€€€‰!IQI}M1=Q}1%5%Pˆ°(€€€€€€€€€€€€‰5…á¥µÕ´½¹±¥¹”¡…É…Ñ•È½Õ¹ĞÉ•…¡•ˆ°(€€€€€€€€€€€€ĞÀä°(€€€€€€€€€€¤ì(€€€€€€€ô((€€€€€€€¡…É}‰±½¬¹•¹…‰±•€ôÑÉÕ”ì(€€€€€€€¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€ôM%I}IU9Q%5}MQQL¹IU99%9ì(€€€€€€€±•…É}É•ÍÑ…ÉÑ}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€Á•ÉÍ¥ÍÑ}¡…É…Ñ•É}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”¡¡…É}¹…µ”°€‰µ…¹Õ…±}ÍÑ…ÉĞˆ¤ì((€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9QI=1}IEUMQˆ°¡…É}¹…µ”°ì(€€€€€€€€€…Ñ¥½¸°(€€€€€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”°(€€€€€€€ô¤ì((€€€€€€€¥˜€¡¡…É}‰±½¬¹¥¹ÍÑ…¹”¤ì(€€€€€€€€€Í…™•}Í•¹¡¡…É}‰±½¬¹¥¹ÍÑ…¹”°ì(€€€€€€€€€€€ÑåÁ”è€‰ÉÕ¹Ñ¥µ•}½¹ÑÉ½°ˆ°(€€€€€€€€€€€ÍÑ…Ñ”èM%I}IU9Q%5}MQQL¹IU99%9°(€€€€€€€€€ô¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€ÍÑ…ÉÑ}¡…È¡¡…É}¹…µ”¤ì(€€€€€€€ô(€€€€€€€‰É•…¬ì(€€€€€ô((€€€€€…Í”=9QI=1}Q%=9L¹AUMè(€€€€€€€¥˜€ …¡…É}‰±½¬¹¥¹ÍÑ…¹”¤ì(€€€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€€€€‰!IQI}9=Q}=91%9ˆ°(€€€€€€€€€€€€‰ÍÑ½ÁÁ•¡…É…Ñ•È…¹¹½Ğ‰”Á…ÕÍ•ˆ°(€€€€€€€€€€€€ĞÀä°(€€€€€€€€€€¤ì(€€€€€€€ô((€€€€€€€¡…É}‰±½¬¹•¹…‰±•€ôÑÉÕ”ì(€€€€€€€¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€ôM%I}IU9Q%5}MQQL¹AUMì(€€€€€€€Á•ÉÍ¥ÍÑ}¡…É…Ñ•É}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”¡¡…É}¹…µ”°€‰µ…¹Õ…±}Á…ÕÍ”ˆ¤ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9QI=1}IEUMQˆ°¡…É}¹…µ”°ì(€€€€€€€€€…Ñ¥½¸°(€€€€€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”°(€€€€€€€ô¤ì(€€€€€€€Í…™•}Í•¹¡¡…É}‰±½¬¹¥¹ÍÑ…¹”°ì(€€€€€€€€€ÑåÁ”è€‰ÉÕ¹Ñ¥µ•}½¹ÑÉ½°ˆ°(€€€€€€€€€ÍÑ…Ñ”èM%I}IU9Q%5}MQQL¹AUM°(€€€€€€€ô¤ì(€€€€€€€‰É•…¬ì((€€€€€…Í”=9QI=1}Q%=9L¹MQ=@è(€€€€€€€¡…É}‰±½¬¹•¹…‰±•€ô™…±Í”ì(€€€€€€€¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€ôM%I}IU9Q%5}MQQL¹MQ=AAì(€€€€€€€¥˜€¡¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}Í½ÕÉ”¤ì(€€€€€€€€€½¹ÍĞÉ½Ñ…Ñ¥½¹}Í½ÕÉ”€ô¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}Í½ÕÉ”ì(€€€€€€€€€½¹ÍĞÍ½ÕÉ”€ô¡…É…Ñ•É}µ…¹…•mÉ½Ñ…Ñ¥½¹}Í½ÕÉ•tì(€€€€€€€€€¥˜€¡Í½ÕÉ”ü¹É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ€ôôô¡…É}¹…µ”¤ì(€€€€€€€€€€€Í½ÕÉ”¹É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ€ô¹Õ±°ì(€€€€€€€€€ô(€€€€€€€€€¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}Í½ÕÉ”€ô¹Õ±°ì(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}I=QQ%=9}911ˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€İ¡äè€‰I=QQ%=9}QIQ}MQ=AAˆ°(€€€€€€€€€€€ÍÑ½Á}¡…É…Ñ•ÈèÉ½Ñ…Ñ¥½¹}Í½ÕÉ”°(€€€€€€€€€€€ÍÑ…ÉÑ}¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€€€€€É•…Í½¸è€‰QIQ}MQ=AAˆ°(€€€€€€€€€ô¤ì(€€€€€€€ô(€€€€€€€±•…É}É•ÍÑ…ÉÑ}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€±•…É}ÍÑ…‰±•}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€Á•ÉÍ¥ÍÑ}¡…É…Ñ•É}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”¡¡…É}¹…µ”°€‰µ…¹Õ…±}ÍÑ½Àˆ¤ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9QI=1}IEUMQˆ°¡…É}¹…µ”°ì(€€€€€€€€€…Ñ¥½¸°(€€€€€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”°(€€€€€€€ô¤ì((€€€€€€€¥˜€¡¡…É}‰±½¬¹¥¹ÍÑ…¹”¤ì(€€€€€€€€€…İ…¥ĞÍ½™Ñ­¥±±}‰±½¬¡¡…É}‰±½¬¤ì(€€€€€€€ô•±Í”ì(€€€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€1%e1}MQQL¹MQ=AA°(€€€€€€€€€€€€‰µ…¹Õ…±}ÍÑ½Àˆ°(€€€€€€€€€€¤ì(€€€€€€€ô(€€€€€€€‰É•…¬ì((€€€€€…Í”=9QI=1}Q%=9L¹IMQIPè(€€€€€€€¥˜€ ……¹I•ÍÑ…ÉÑ¡…É…Ñ•È¡¡…É}‰±½¬¤¤ì(€€€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€€€€‰!IQI}9=Q}IMQIQ	1ˆ°(€€€€€€€€€€€€‰=¹±ä…¸…Ñ¥Ù”IU99%9½ÈAUM¡…É…Ñ•È…¸‰”É•ÍÑ…ÉÑ•ˆ°(€€€€€€€€€€€€ĞÀä°(€€€€€€€€€€¤ì(€€€€€€€ô((€€€€€€€±•…É}É•ÍÑ…ÉÑ}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€±•…É}ÍÑ…‰±•}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€¡…É}‰±½¬¹É•ÍÑ…ÉÑ}…ÑÑ•µÁÑÌ€ô€Àì(€€€€€€€¡…É}‰±½¬¹½¹ÑÉ½±±•‘}É•ÍÑ…ÉĞ€ôÑÉÕ”ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9QI=1}IEUMQˆ°¡…É}¹…µ”°ì(€€€€€€€€€…Ñ¥½¸°(€€€€€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”°(€€€€€€€ô¤ì(€€€€€€€Á•ÉÍ¥ÍÑ}¡…É…Ñ•É}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”¡¡…É}¹…µ”°€‰µ…¹Õ…±}É•ÍÑ…ÉĞˆ¤ì(€€€€€€€…İ…¥ĞÍ½™Ñ­¥±±}‰±½¬¡¡…É}‰±½¬¤ì(€€€€€€€‰É•…¬ì((€€€€€‘•™…Õ±Ğè(€€€€€€€Ñ¡É½Üµ…­•}½¹ÑÉ½±}•ÉÉ½È (€€€€€€€€€€‰%9Y1%}=9QI=1}Q%=8ˆ°(€€€€€€€€€U¹ÍÕÁÁ½ÉÑ•½¹ÑÉ½°…Ñ¥½¸è€‘í…Ñ¥½¹õ€°(€€€€€€€€€€ĞÀÀ°(€€€€€€€€¤ì(€€€ô((€€€É•ÑÕÉ¸ì(€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€…Ñ¥½¸°(€€€€€‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”°(€€€€€±¥™•å±•}ÍÑ…Ñ”è¡…É}‰±½¬¹±¥™•å±•}ÍÑ…Ñ”°(€€€ôì(€ô((€™Õ¹Ñ¥½¸ÍÑ…ÉÑ}¡…È¡¡…É}¹…µ”¤ì(€€€½¹ÍĞ¡…É}‰±½¬€ô¡…É…Ñ•É}µ…¹…•m¡…É}¹…µ•tì(€€€¥˜€ …¡…É}‰±½¬ñğ€…¡…É}‰±½¬¹•¹…‰±•ñğ½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€¥˜€¡¡…É}‰±½¬¹¥¹ÍÑ…¹”¤ì(€€€€€É•ÑÕÉ¸¡…É}‰±½¬¹¥¹ÍÑ…¹”ì(€€€ô(€€€¥˜€ (€€€€€½Õ¹ÑÑ¥Ù•¡…É…Ñ•ÉÌ¡¡…É…Ñ•É}µ…¹…”¤€øô(€€€€€±¥™•å±•}Á½±¥ä¹µ…á=¹±¥¹•¡…É…Ñ•ÉÌ(€€€€¤ì(€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€¡…É}¹…µ”°(€€€€€€€1%e1}MQQL¹	-=°(€€€€€€€€‰µ…á}½¹±¥¹•}¡…É…Ñ•ÉÌˆ°(€€€€€€¤ì(€€€€€±½œ¹İ…É¸ (€€€€€€€ì(€€€€€€€€€ÑåÁ”è€‰¡…É…Ñ•É}ÍÑ…ÉÑ}‰±½­•ˆ°(€€€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€€€µ…á}½¹±¥¹•}¡…É…Ñ•ÉÌè±¥™•å±•}Á½±¥ä¹µ…á=¹±¥¹•¡…É…Ñ•ÉÌ°(€€€€€€€ô°(€€€€€€€¹½ĞÍÑ…ÉÑ¥¹œ€‘í¡…É}¹…µ•ôè½¹±¥¹”¡…É…Ñ•È±¥µ¥ĞÉ•…¡•‘€°(€€€€€€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô((€€€±•…É}É•ÍÑ…ÉÑ}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€¡…É}¹…µ”°(€€€€€1%e1}MQQL¹MQIQ%9°(€€€€€€‰ÍÑ…ÉÑ}É•ÅÕ•ÍÑ•ˆ°(€€€€¤ì((€€€±•ĞÉ•…±´€ôµå}…Œ¹É•Í½±Ù•}É•…±´¡¡…É}‰±½¬¹É•…±´¤ì(€€€¥˜€ …É•…±´¤ì(€€€€€½¹Í½±”¹İ…É¸ (€€€€€€€½Õ±¹½Ğ™¥¹É•…±´€‘í¡…É}‰±½¬¹É•…±µô±€°(€€€€€€€™…±±¥¹œ‰…¬Ñ¼É•…±´€‘í‘•™…Õ±Ñ}É•…±´¹­•åõ€°(€€€€€€¤ì(€€€€€¡…É}‰±½¬¹É•…±´€ô‘•™…Õ±Ñ}É•…±´¹­•äì(€€€€€É•…±´€ô‘•™…Õ±Ñ}É•…±´ì(€€€ô(€€€½¹ÍĞ¡…È€ôµå}…Œ¹É•Í½±Ù•}¡…È¡¡…É}¹…µ”¤ì(€€€€¼½±…ÍÌ¥Ì¡…È¹ÑåÁ”(€€€¥˜€ …¡…È¤ì(€€€€€½¹Í½±”¹•ÉÉ½È (€€€€€€€½Õ±¹½ĞÉ•Í½±Ù”¡…É…Ñ•È€‘í¡…É}¹…µ•õ€°(€€€€€€€Ñ¡¥Ì¡…É…Ñ•Èİ¥±°¹½Ğ‰”ÍÑ…ÉÑ•‘€°(€€€€€€¤ì(€€€€€½¹Í½±”¹•ÉÉ½È (€€€€€€€€‰…É”å½ÔÍÕÉ”å½Ô½İ¸Ñ¡¥Ì¡…É…Ñ•È…¹¡…Ù”¹½Ğ‘•±•Ñ•¥Ğüˆ°(€€€€€€¤ì(€€€€€¡…É}‰±½¬¹•¹…‰±•€ô™…±Í”ì(€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€¡…É}¹…µ”°(€€€€€€€1%e1}MQQL¹II=H°(€€€€€€€€‰¡…É…Ñ•É}¹½Ñ}½İ¹•ˆ°(€€€€€€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€Ù½¥½‰Í•ÉÙ•}Á•ÉÍ¥ÍÑ•¹” (€€€€€Á•ÉÍ¥ÍÑ•¹”¹Í…Ù•¡…É…Ñ•ÉAÉ½™¥±” (€€€€€€€¡…É}¹…µ”°(€€€€€€€‰Õ¥±‘¡…É…Ñ•ÉAÉ½™¥±”¡¡…É}¹…µ”°¡…É}‰±½¬°¡…È¤°(€€€€€€¤°(€€€€€€‰¡…É…Ñ•É}ÁÉ½™¥±•}É•Í½±Ù•ˆ°(€€€€€¡…É}¹…µ”°(€€€€¤ì(€€€½¹ÍĞ}Ù•ÉÍ¥½¸€ô¡…É}‰±½¬¹Ù•ÉÍ¥½¸ñğÙ•ÉÍ¥½¸ì(€€€½¹Í½±”¹±½œ (€€€€€ÍÑ…ÉÑ¥¹œ€‘í¡…É}¹…µ•ôÉÕ¹¹¥¹œÙ•ÉÍ¥½¸€‘í}Ù•ÉÍ¥½¹ô¥¸€‘í¡…É}‰±½¬¹É•…±µõ€°(€€€€¤ì(€€€½¹ÍĞÉ•…±µ}½¹¹•Ñ¥½¸€ô¹½Éµ…±¥é•I•…±µ½¹¹•Ñ¥½¸¡É•…±´¤ì(€€€¥˜€ …É•…±µ}½¹¹•Ñ¥½¸¹…‘‘É•ÍÌ¤ì(€€€€€½¹Í½±”¹•ÉÉ½È (€€€€€€€½Õ±¹½ĞÉ•Í½±Ù”½¹¹•Ñ¥½¸…‘‘É•ÍÌ™½ÈÉ•…±´€‘í¡…É}‰±½¬¹É•…±µõ€°(€€€€€€¤ì(€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€¡…É}¹…µ”°(€€€€€€€1%e1}MQQL¹II=H°(€€€€€€€€‰É•…±µ}½¹¹•Ñ¥½¹}µ¥ÍÍ¥¹œˆ°(€€€€€€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô((€€€½¹ÍĞ•á•ÕÑ¥½¹}Í½ÕÉ”€ôÉ•Í½±Ù•¡…É…Ñ•Éá•ÕÑ¥½¹M½ÕÉ” (€€€€€¡…É}‰±½¬°(€€€€€€„…™œ¹•¹…‰±•}QeA=°(€€€€¤ì(€€€½¹ÍĞ…ÉÌ€ôì(€€€€€Ù•ÉÍ¥½¸è}Ù•ÉÍ¥½¸°(€€€€€É•…±µ}…‘‘É•ÍÌèÉ•…±µ}½¹¹•Ñ¥½¸¹…‘‘É•ÍÌ°(€€€€€É•…±µ}Á…Ñ èÉ•…±µ}½¹¹•Ñ¥½¸¹Á…Ñ °(€€€€€É•…±µ}…‘‘ÈèÉ•…±µ}½¹¹•Ñ¥½¸¹±•…å‘‘È°(€€€€€É•…±µ}Á½ÉĞèÉ•…±µ}½¹¹•Ñ¥½¸¹±•…åA½ÉĞ°(€€€€€Í•ÍÌèÍ•ÍÌ°(€€€€€¥è¡…È¹¥°(€€€€€ÍÉ¥ÁÑ}™¥±”è•á•ÕÑ¥½¹}Í½ÕÉ”¹ÍÉ¥ÁÑ¥±”°(€€€€€•¹…‰±•}µ…Àè€„„¡™œ¹İ•‰}…ÁÀ€˜˜™œ¹İ•‰}…ÁÀ¹•¹…‰±•}µ¥¹¥µ…À¤°(€€€€€¹…µ”è¡…É}¹…µ”°(€€€€€±¥èÑåÁ•}Ñ½}±¥‘m¡…È¹ÑåÁ•tñğ€´Ä°(€€€€€¡•…ÉÑ‰•…Ñ}¥¹Ñ•ÉÙ…±}µÌè±¥™•å±•}Á½±¥ä¹¡•…ÉÑ‰•…Ñ%¹Ñ•ÉÙ…±5Ì°(€€€€€ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”è¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”°(€€€€€•µ•É•¹å}ÍÑ½Àè•µ•É•¹å}ÍÑ½À¹Í¹…ÁÍ¡½Ğ ¤°(€€€ôì(€€€¥˜€¡•á•ÕÑ¥½¹}Í½ÕÉ”¹ÑåÁ•ÍÉ¥ÁÑ¥±”¤ì(€€€€€…ÉÌ¹ÑåÁ•ÍÉ¥ÁÑ}™¥±”€ô•á•ÕÑ¥½¹}Í½ÕÉ”¹ÑåÁ•ÍÉ¥ÁÑ¥±”ì(€€€ô((€€€½¹ÍĞÉ•ÍÕ±Ğ€ô¡¥±‘}ÁÉ½•ÍÌ¹™½É¬ ˆ¸½ÍÉŒ½¡…É…Ñ•ÉQ¡É•…¹©Ìˆ°mt°ì(€€€€€ÍÑ‘¥¼èl‰¥¹½É”ˆ°€‰Á¥Á”ˆ°€‰Á¥Á”ˆ°€‰¥ÁŒ‰t°(€€€ô¤ì((€€€…ÁÑÕÉ•}¡…É…Ñ•É}ÍÑÉ•…´¡É•ÍÕ±Ğ¹ÍÑ‘½ÕĞ°¡…É}¹…µ”°€‰ÍÑ‘½ÕĞˆ¤ì(€€€…ÁÑÕÉ•}¡…É…Ñ•É}ÍÑÉ•…´¡É•ÍÕ±Ğ¹ÍÑ‘•ÉÈ°¡…É}¹…µ”°€‰ÍÑ‘•ÉÈˆ¤ì(€€€É•ÍÕ±Ğ¹ÍÑ‘½ÕĞ¹Á¥Á”¡ÁÉ½•ÍÌ¹ÍÑ‘½ÕĞ¤ì(€€€É•ÍÕ±Ğ¹ÍÑ‘•ÉÈ¹Á¥Á”¡ÁÉ½•ÍÌ¹ÍÑ‘•ÉÈ¤ì(€€€¡…É}‰±½¬¹¥¹ÍÑ…¹”€ôÉ•ÍÕ±Ğì(€€€¡…É}‰±½¬¹‰½Ñ}ÉÕ¹Ñ¥µ•}ÍÑ…ÉÑ•‘}…Ğ€ô¹Õ±°ì(€€€¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}…Ğ€ô…Ñ”¹¹½Ü ¤ì(€€€¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}Á¥€ôÉ•ÍÕ±Ğ¹Á¥ñğ¹Õ±°ì(€€€¡…É}‰±½¬¹İ…Ñ¡‘½}É•½Ù•Éå}¥¹}ÁÉ½É•ÍÌ€ô™…±Í”ì(€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}AI=MM}MQIQˆ°¡…É}¹…µ”°ì(€€€€€Á¥èÉ•ÍÕ±Ğ¹Á¥ñğ¹Õ±°°(€€€ô¤ì((€€€É•ÍÕ±Ğ¹½¸ ‰•á¥Ğˆ°€¡½‘”°Í¥¹…°¤€ôøì(€€€€€¥˜€¡¡…É}‰±½¬¹µ½¹¥Ñ½È¤ì(€€€€€€€€¼½±½Í”µ½¹¥Ñ½È(€€€€€€€¡…É}‰±½¬¹µ½¹¥Ñ½È¹‘•ÍÑÉ½ä ¤ì(€€€€€€€¡…É}‰±½¬¹µ½¹¥Ñ½È€ô¹Õ±°ì(€€€€€ô(€€€€€±•…É}ÍÑ…‰±•}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€±•…É}½¹™¥}ÁÕÍ¡}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}ÍÑ…ÑÕÌ€ô€‰MQ=Iˆì(€€€€€¡…É}‰±½¬¹…ÁÁ±¥•‘}ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸€ô¹Õ±°ì(€€€€€¡…É}‰±½¬¹½¹¹•Ñ•€ô™…±Í”ì(€€€€€¡…É}‰±½¬¹‰½Ñ}ÉÕ¹Ñ¥µ•}ÍÑ…ÉÑ•‘}…Ğ€ô¹Õ±°ì(€€€€€¡…É}‰±½¬¹İ…Ñ¡‘½}É•½Ù•Éå}¥¹}ÁÉ½É•ÍÌ€ô™…±Í”ì(€€€€€É•©•Ñ}µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑÍ}™½É}¡…É…Ñ•È (€€€€€€€¡…É}¹…µ”°(€€€€€€€€‰!IQI}AI=MM}a%Q}UI%9}5=Y59Q}1%Y}QMPˆ°(€€€€€€¤ì(€€€€€É•©•Ñ}½µ‰…Ñ}±¥Ù•}Ñ•ÍÑÍ}™½É}¡…É…Ñ•È (€€€€€€€¡…É}¹…µ”°(€€€€€€€€‰!IQI}AI=MM}a%Q}UI%9}=5	Q}1%Y}QMPˆ°(€€€€€€¤ì(€€€€€É•©•Ñ}±…ÍÍ}Í­¥±±}±¥Ù•}Ñ•ÍÑÍ}™½É}¡…É…Ñ•È (€€€€€€€¡…É}¹…µ”°(€€€€€€€€‰!IQI}AI=MM}a%Q}UI%9}1MM}M-%11}1%Y}QMPˆ°(€€€€€€¤ì(€€€€€É•©•Ñ}É½ÕÁ}±¥Ù•}Ñ•ÍÑÍ}™½É}¡…É…Ñ•È (€€€€€€€¡…É}¹…µ”°(€€€€€€€€‰!IQI}AI=MM}a%Q}UI%9}I=UA}1%Y}QMPˆ°(€€€€€€¤ì(€€€€€É•©•Ñ}™…Éµ}±¥Ù•}Ñ•ÍÑÍ}™½É}¡…É…Ñ•È (€€€€€€€¡…É}¹…µ”°(€€€€€€€€‰!IQI}AI=MM}a%Q}UI%9}I5}1%Y}QMPˆ°(€€€€€€¤ì(€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}AI=MM}a%Qˆ°¡…É}¹…µ”°ì(€€€€€€€½‘”°(€€€€€€€Í¥¹…°°(€€€€€€€Á¥èÉ•ÍÕ±Ğ¹Á¥ñğ¹Õ±°°(€€€€€ô¤ì(€€€€€¥˜€¡¡…É}‰±½¬¹¥¹ÍÑ…¹”€ôôôÉ•ÍÕ±Ğ¤ì(€€€€€€€¡…É}‰±½¬¹¥¹ÍÑ…¹”€ô¹Õ±°ì(€€€€€ô((€€€€€½¹ÍĞÉ½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ€ô¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğì(€€€€€¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ€ô¹Õ±°ì(€€€€€½¹ÍĞ½¹ÑÉ½±±•‘}É•ÍÑ…ÉĞ€ô¡…É}‰±½¬¹½¹ÑÉ½±±•‘}É•ÍÑ…ÉĞì(€€€€€¡…É}‰±½¬¹½¹ÑÉ½±±•‘}É•ÍÑ…ÉĞ€ô™…±Í”ì((€€€€€¥˜€¡É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ€˜˜€…½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸¤ì(€€€€€€€¡…É}‰±½¬¹É•ÍÑ…ÉÑ}…ÑÑ•µÁÑÌ€ô€Àì(€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€1%e1}MQQL¹MQ=AA°(€€€€€€€€€€‰É½Ñ…Ñ¥½¹}Í±½Ñ}É•±•…Í•ˆ°(€€€€€€€€¤ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}I=QQ%=9}M1=Q}I1Mˆ°¡…É}¹…µ”°ì(€€€€€€€€€İ¡äè€‰I=QQ%=9}M=UI}a%Qˆ°(€€€€€€€€€ÍÑ…ÉÑ}¡…É…Ñ•ÈèÉ½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ°(€€€€€€€ô¤ì(€€€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì((€€€€€€€Í•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€€€€€€€½¹ÍĞÑ…É•Ğ€ô¡…É…Ñ•É}µ…¹…•mÉ½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ñtì(€€€€€€€€€¥˜€ (€€€€€€€€€€€€…Ñ…É•Ğñğ(€€€€€€€€€€€€…Ñ…É•Ğ¹•¹…‰±•ñğ(€€€€€€€€€€€Ñ…É•Ğ¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€„ôôM%I}IU9Q%5}MQQL¹IU99%9(€€€€€€€€€€¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô((€€€€€€€€€½¹ÍĞÍÑ…ÉÑ•€ôÍÑ…ÉÑ}¡…È¡É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ¤ì(€€€€€€€€€¥˜€¡ÍÑ…ÉÑ•¤ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€€€€€‰!IQI}I=QQ%=9}QIQ}MQIQ%9ˆ°(€€€€€€€€€€€€€É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ°(€€€€€€€€€€€€€ì(€€€€€€€€€€€€€€€İ¡äè€‰I=QQ%=9}M1=Q}Y%1	1ˆ°(€€€€€€€€€€€€€€€ÍÑ½Á}¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€€€€€€€ô°(€€€€€€€€€€€€¤ì(€€€€€€€€€ô•±Í”¥˜€¡Ñ…É•Ğ¹•¹…‰±•¤ì(€€€€€€€€€€€Í¡•‘Õ±•}É•ÍÑ…ÉĞ¡É½Ñ…Ñ¥½¹}É•Á±…•µ•¹Ğ°€‰É½Ñ…Ñ¥½¹}Í±½Ñ}Õ¹…Ù…¥±…‰±”ˆ¤ì(€€€€€€€€€ô(€€€€€€€ô°±¥™•å±•}Á½±¥ä¹ÍÑ…ÉÑÕÁMÑ…•É5Ì¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€¥˜€ (€€€€€€€½¹ÑÉ½±±•‘}É•ÍÑ…ÉĞ€˜˜(€€€€€€€¡…É}‰±½¬¹•¹…‰±•€˜˜(€€€€€€€€…½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸(€€€€€€¤ì(€€€€€€€¡…É}‰±½¬¹É•ÍÑ…ÉÑ}…ÑÑ•µÁÑÌ€ô€Àì(€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€1%e1}MQQL¹MQ=AA°(€€€€€€€€€€‰½¹ÑÉ½±±•‘}É•ÍÑ…ÉĞˆ°(€€€€€€€€¤ì(€€€€€€€Í•ÑQ¥µ•½ÕĞ (€€€€€€€€€€ ¤€ôøÍÑ…ÉÑ}¡…È¡¡…É}¹…µ”¤°(€€€€€€€€€±¥™•å±•}Á½±¥ä¹ÍÑ…ÉÑÕÁMÑ…•É5Ì°(€€€€€€€€¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€¥˜€¡¡…É}‰±½¬¹•¹…‰±•€˜˜€…½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸¤ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰U9aAQ}!IQI}a%Pˆ°¡…É}¹…µ”°ì(€€€€€€€€€½‘”°(€€€€€€€€€Í¥¹…°°(€€€€€€€€€Á¥èÉ•ÍÕ±Ğ¹Á¥ñğ¹Õ±°°(€€€€€€€ô¤ì(€€€€€€€Í¡•‘Õ±•}É•ÍÑ…ÉĞ (€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€Õ¹•áÁ•Ñ•‘}•á¥Ğ¡½‘”ô‘í½‘•ô±Í¥¹…°ô‘íÍ¥¹…±ô¥€°(€€€€€€€€¤ì(€€€€€ô•±Í”ì(€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€1%e1}MQQL¹MQ=AA°(€€€€€€€€€½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸€ü€‰½½É‘¥¹…Ñ½É}Í¡ÕÑ‘½İ¸ˆ€è€‰‘¥Í…‰±•ˆ°(€€€€€€€€¤ì(€€€€€ô(€€€ô¤ì(€€€É•ÍÕ±Ğ¹½¸ ‰µ•ÍÍ…”ˆ°€¡É…İ}µ•ÍÍ…”¤€ôøì(€€€€€½¹ÍĞ¥ÁŒ€ô¹½Éµ…±¥é•%Á5•ÍÍ…”¡É…İ}µ•ÍÍ…”¤ì(€€€€€¥˜€ …¥ÁŒ¹½¬¤ì(€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰%A}5MM}I)Qˆ°¡…É}¹…µ”°ì(€€€€€€€€€É•…Í½¸è¥ÁŒ¹½‘”°(€€€€€€€€€ÁÉ½Ñ½½±}Ù•ÉÍ¥½¸è¥ÁŒ¹ÁÉ½Ñ½½±}Ù•ÉÍ¥½¸°(€€€€€€€€€µ•ÍÍ…•}ÑåÁ”èÉ…İ}µ•ÍÍ…”ü¹ÑåÁ”ñğ¹Õ±°°(€€€€€€€€€ÍÕÁÁ½ÉÑ•‘}ÁÉ½Ñ½½±}Ù•ÉÍ¥½¸è%A}AI=Q==1}YIM%=8°(€€€€€€€ô¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€½¹ÍĞ´€ô¥ÁŒ¹µ•ÍÍ…”ì(€€€€€Íİ¥Ñ €¡´¹ÑåÁ”¤ì(€€€€€€€…Í”€‰ÁÉ½•ÍÍ}É•…‘äˆè(€€€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€1%e1}MQQL¹=99Q%9°(€€€€€€€€€€€€‰ÁÉ½•ÍÍ}É•…‘äˆ°(€€€€€€€€€€¤ì(€€€€€€€€€É•™É•Í¡}¡…É…Ñ•É}É•Ù¥Í¥½¸¡¡…É}‰±½¬¤ì(€€€€€€€€€¡…É}‰±½¬¹ÉÕ¹¹¥¹}½‘•}É•Ù¥Í¥½¸€ô¡…É}‰±½¬¹¥¹ÍÑ…±±•‘}½‘•}É•Ù¥Í¥½¸ì(€€€€€€€€€¡…É}‰±½¬¹ÉÕ¹¹¥¹}½¹™¥}É•Ù¥Í¥½¸€ô(€€€€€€€€€€€¡…É}‰±½¬¹¥¹ÍÑ…±±•‘}½¹™¥}É•Ù¥Í¥½¸ì(€€€€€€€€€¡…É}‰±½¬¹É•Ù¥Í¥½¹}ÍÑ…ÑÕÌ€ôÉ•Ù¥Í¥½¹MÑ…ÑÕÌ¡ì(€€€€€€€€€€€ÉÕ¹¹¥¹½‘•I•Ù¥Í¥½¸è¡…É}‰±½¬¹ÉÕ¹¹¥¹}½‘•}É•Ù¥Í¥½¸°(€€€€€€€€€€€¥¹ÍÑ…±±•‘½‘•I•Ù¥Í¥½¸è¡…É}‰±½¬¹¥¹ÍÑ…±±•‘}½‘•}É•Ù¥Í¥½¸°(€€€€€€€€€€€ÉÕ¹¹¥¹½¹™¥I•Ù¥Í¥½¸è¡…É}‰±½¬¹ÉÕ¹¹¥¹}½¹™¥}É•Ù¥Í¥½¸°(€€€€€€€€€€€¥¹ÍÑ…±±•‘½¹™¥I•Ù¥Í¥½¸è¡…É}‰±½¬¹¥¹ÍÑ…±±•‘}½¹™¥}É•Ù¥Í¥½¸°(€€€€€€€€€ô¤ì(€€€€€€€€€…ÉÌ¹½‘•}É•Ù¥Í¥½¸€ô¡…É}‰±½¬¹ÉÕ¹¹¥¹}½‘•}É•Ù¥Í¥½¸ì(€€€€€€€€€…ÉÌ¹½¹™¥}É•Ù¥Í¥½¸€ô¡…É}‰±½¬¹ÉÕ¹¹¥¹}½¹™¥}É•Ù¥Í¥½¸ì(€€€€€€€€€…ÉÌ¹Í½ÕÉ•}É•Ù¥Í¥½¸€ôÍ½ÕÉ•}É•Ù¥Í¥½¸ì(€€€€€€€€€…ÉÌ¹¡…É…Ñ•É}½¹™¥œ€ô¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥œì(€€€€€€€€€…ÉÌ¹¡…É…Ñ•É}½¹™¥}É•Ù¥Í¥½¸€ô¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸ì(€€€€€€€€€¡…É}‰±½¬¹…ÁÁ±¥•‘}ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸€ô¹Õ±°ì(€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}ÍÑ…ÑÕÌ€ô€‰A9%9ˆì(€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}•ÉÉ½È€ô¹Õ±°ì(€€€€€€€€€…Éµ}½¹™¥}ÁÕÍ¡}Ñ¥µ•½ÕĞ (€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸°(€€€€€€€€€€¤ì(€€€€€€€€€Á•ÉÍ¥ÍÑ}¡…É…Ñ•É}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”¡¡…É}¹…µ”°€‰ÁÉ½•ÍÍ}É•…‘äˆ¤ì(€€€€€€€€€Í…™•}Í•¹¡É•ÍÕ±Ğ°ì(€€€€€€€€€€€ÑåÁ”è€‰ÁÉ½•ÍÍ}…ÉÌˆ°(€€€€€€€€€€€…ÉÕµ•¹ÑÌè…ÉÌ°(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰¥¹¥Ñ¥…±¥é•ˆè(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}%9%Q%1%iˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€Á¥èÉ•ÍÕ±Ğ¹Á¥ñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰ÉÕ¹Ñ¥µ•}•Ù•¹Ğˆè(€€€€€€€€€•µ¥Ñ}ÉÕ¹Ñ¥µ•}•Ù•¹Ğ¡¡…É}¹…µ”°´¹•Ù•¹Ğ¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑ}É•ÍÕ±Ğˆèì(€€€€€€€€€½¹ÍĞÁ•¹‘¥¹œ€ôµ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€¥˜€ …Á•¹‘¥¹œñğÁ•¹‘¥¹œ¹¡…É…Ñ•È€„ôô¡…É}¹…µ”¤ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€€€€€‰5=Y59Q}1%Y}QMQ}IMU1Q}%9=Iˆ°(€€€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€€€ì(€€€€€€€€€€€€€€€İ¡äè€‰U9-9=]9}=I}MQ1}IEUMPˆ°(€€€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥ñğ¹Õ±°°(€€€€€€€€€€€€€ô°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€ô((€€€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€€€µ½Ù•µ•¹Ñ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€Á•¹‘¥¹œ¹É•Í½±Ù”¡ì(€€€€€€€€€€€É•ÍÕ±Ğè´¹É•ÍÕ±Ğñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€€€‰5=Y59Q}1%Y}QMQ}IMU1Q}I%Yˆ°(€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€ì(€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€€€½ÕÑ½µ”è´¹É•ÍÕ±Ğü¹½ÕÑ½µ”ñğ¹Õ±°°(€€€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€€€ô°(€€€€€€€€€€¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€…Í”€‰½µ‰…Ñ}±¥Ù•}Ñ•ÍÑ}É•ÍÕ±Ğˆèì(€€€€€€€€€½¹ÍĞÁ•¹‘¥¹œ€ô½µ‰…Ñ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€¥˜€ …Á•¹‘¥¹œñğÁ•¹‘¥¹œ¹¡…É…Ñ•È€„ôô¡…É}¹…µ”¤ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€€€€€‰=5	Q}1%Y}QMQ}IMU1Q}%9=Iˆ°(€€€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€€€ì(€€€€€€€€€€€€€€€İ¡äè€‰U9-9=]9}=I}MQ1}IEUMPˆ°(€€€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥ñğ¹Õ±°°(€€€€€€€€€€€€€ô°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€ô((€€€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€€€½µ‰…Ñ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€Á•¹‘¥¹œ¹É•Í½±Ù”¡ì(€€€€€€€€€€€É•ÍÕ±Ğè´¹É•ÍÕ±Ğñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰=5	Q}1%Y}QMQ}IMU1Q}I%Yˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€½ÕÑ½µ”è´¹É•ÍÕ±Ğü¹½ÕÑ½µ”ñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€…Í”€‰±…ÍÍ}Í­¥±±}±¥Ù•}Ñ•ÍÑ}É•ÍÕ±Ğˆèì(€€€€€€€€€½¹ÍĞÁ•¹‘¥¹œ€ô±…ÍÍ}Í­¥±±}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€¥˜€ …Á•¹‘¥¹œñğÁ•¹‘¥¹œ¹¡…É…Ñ•È€„ôô¡…É}¹…µ”¤ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€€€€€‰1MM}M-%11}1%Y}QMQ}IMU1Q}%9=Iˆ°(€€€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€€€ì(€€€€€€€€€€€€€€€İ¡äè€‰U9-9=]9}=I}MQ1}IEUMPˆ°(€€€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥ñğ¹Õ±°°(€€€€€€€€€€€€€ô°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€ô((€€€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€€€±…ÍÍ}Í­¥±±}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€Á•¹‘¥¹œ¹É•Í½±Ù”¡ì(€€€€€€€€€€€É•ÍÕ±Ğè´¹É•ÍÕ±Ğñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€€€‰1MM}M-%11}1%Y}QMQ}IMU1Q}I%Yˆ°(€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€ì(€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€€€½ÕÑ½µ”è´¹É•ÍÕ±Ğü¹½ÕÑ½µ”ñğ¹Õ±°°(€€€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€€€ô°(€€€€€€€€€€¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€…Í”€‰™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÍÕ±Ğˆèì(€€€€€€€€€½¹ÍĞÁ•¹‘¥¹œ€ô™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€¥˜€ …Á•¹‘¥¹œñğÁ•¹‘¥¹œ¹¡…É…Ñ•È€„ôô¡…É}¹…µ”¤ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I5}1%Y}QMQ}IMU1Q}%9=Iˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€€€İ¡äè€‰U9-9=]9}=I}MQ1}IEUMPˆ°(€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥ñğ¹Õ±°°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€ô((€€€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€€€™…Éµ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€Á•¹‘¥¹œ¹É•Í½±Ù”¡ì(€€€€€€€€€€€É•ÍÕ±Ğè´¹É•ÍÕ±Ğñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I5}1%Y}QMQ}IMU1Q}I%Yˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€½ÕÑ½µ”è´¹É•ÍÕ±Ğü¹½ÕÑ½µ”ñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€…Í”€‰É½ÕÁ}±¥Ù•}Ñ•ÍÑ}É•ÍÕ±Ğˆèì(€€€€€€€€€½¹ÍĞÁ•¹‘¥¹œ€ôÉ½ÕÁ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹•Ğ¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€¥˜€ …Á•¹‘¥¹œñğÁ•¹‘¥¹œ¹¡…É…Ñ•È€„ôô¡…É}¹…µ”¤ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I=UA}1%Y}QMQ}IMU1Q}%9=Iˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€€€İ¡äè€‰U9-9=]9}=I}MQ1}IEUMPˆ°(€€€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥ñğ¹Õ±°°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€ô((€€€€€€€€€±•…ÉQ¥µ•½ÕĞ¡Á•¹‘¥¹œ¹Ñ¥µ•È¤ì(€€€€€€€€€É½ÕÁ}±¥Ù•}Ñ•ÍÑ}É•ÅÕ•ÍÑÌ¹‘•±•Ñ”¡´¹É•ÅÕ•ÍÑ}¥¤ì(€€€€€€€€€Á•¹‘¥¹œ¹É•Í½±Ù”¡ì(€€€€€€€€€€€É•ÍÕ±Ğè´¹É•ÍÕ±Ğñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰I=UA}1%Y}QMQ}IMU1Q}I%Yˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€É•ÅÕ•ÍÑ}¥è´¹É•ÅÕ•ÍÑ}¥°(€€€€€€€€€€€½ÕÑ½µ”è´¹É•ÍÕ±Ğü¹½ÕÑ½µ”ñğ¹Õ±°°(€€€€€€€€€€€•ÉÉ½Èè´¹•ÉÉ½Èñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€…Í”€‰½¹™¥}…ÁÁ±¥•ˆèì(€€€€€€€€€½¹ÍĞ…ÁÁ±¥•‘}É•Ù¥Í¥½¸€ô9Õµ‰•È¡´¹É•Ù¥Í¥½¸¤ì(€€€€€€€€€¥˜€ (€€€€€€€€€€€9Õµ‰•È¹¥Í%¹Ñ••È¡…ÁÁ±¥•‘}É•Ù¥Í¥½¸¤€˜˜(€€€€€€€€€€€…ÁÁ±¥•‘}É•Ù¥Í¥½¸€ôôô¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸(€€€€€€€€€€¤ì(€€€€€€€€€€€±•…É}½¹™¥}ÁÕÍ¡}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€€€€€¡…É}‰±½¬¹…ÁÁ±¥•‘}ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸€ô…ÁÁ±¥•‘}É•Ù¥Í¥½¸ì(€€€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}ÍÑ…ÑÕÌ€ô€‰AA1%ˆì(€€€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}•ÉÉ½È€ô¹Õ±°ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9%}AA1%ˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€€€İ¡äè(€€€€€€€€€€€€€€€´¹Í½ÕÉ”€ôôô€‰ÁÉ½•ÍÍ}…ÉÌˆ(€€€€€€€€€€€€€€€€€€ü€‰AI=MM}MQIQ}=9%ˆ(€€€€€€€€€€€€€€€€€€è€‰1%Y}=9%}AUM ˆ°(€€€€€€€€€€€€€É•Ù¥Í¥½¸è…ÁÁ±¥•‘}É•Ù¥Í¥½¸°(€€€€€€€€€€€€€¡…¹•è´¹¡…¹•€„ôô™…±Í”°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9%}-}%9=Iˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€€€İ¡äè€‰MQ1}=I}%9Y1%}=9%},ˆ°(€€€€€€€€€€€€€É•Ù¥Í¥½¸è9Õµ‰•È¹¥Í¥¹¥Ñ”¡…ÁÁ±¥•‘}É•Ù¥Í¥½¸¤(€€€€€€€€€€€€€€€€ü…ÁÁ±¥•‘}É•Ù¥Í¥½¸(€€€€€€€€€€€€€€€€è¹Õ±°°(€€€€€€€€€€€€€•áÁ•Ñ•‘}É•Ù¥Í¥½¸è¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸°(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô(€€€€€€€€€‰É•…¬ì(€€€€€€€ô(€€€€€€€…Í”€‰½¹™¥}É•©•Ñ•ˆè(€€€€€€€€€¥˜€¡9Õµ‰•È¡´¹É•Ù¥Í¥½¸¤€ôôô¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸¤ì(€€€€€€€€€€€±•…É}½¹™¥}ÁÕÍ¡}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}ÍÑ…ÑÕÌ€ô€‰I)Qˆì(€€€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}•ÉÉ½È€ô´¹É•…Í½¸ñğ€‰=9%}I)Qˆì(€€€€€€€€€ô(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9%}I)Qˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€İ¡äè´¹É•…Í½¸ñğ€‰=9%}I)Qˆ°(€€€€€€€€€€€É•Ù¥Í¥½¸è9Õµ‰•È¹¥Í¥¹¥Ñ”¡9Õµ‰•È¡´¹É•Ù¥Í¥½¸¤¤(€€€€€€€€€€€€€€ü9Õµ‰•È¡´¹É•Ù¥Í¥½¸¤(€€€€€€€€€€€€€€è¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰•µ•É•¹å}ÍÑ½Á}…ÁÁ±¥•ˆè(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰5I9e}MQ=A}AA1%ˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€…Ñ¥Ù”è€„…´¹ÍÑ…Ñ”ü¹…Ñ¥Ù”°(€€€€€€€€€€€É•…Í½¸è´¹ÍÑ…Ñ”ü¹É•…Í½¸ñğ¹Õ±°°(€€€€€€€€€€€É•Ù¥Í¥½¸è´¹ÍÑ…Ñ”ü¹É•Ù¥Í¥½¸ñğ€À°(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰ÉÕ¹Ñ¥µ•}ÍÑ…Ñ•}…ÁÁ±¥•ˆè(€€€€€€€€€¥˜€¡´¹ÍÑ…Ñ”€ôôôM%I}IU9Q%5}MQQL¹AUM¤ì(€€€€€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€€€1%e1}MQQL¹AUM°(€€€€€€€€€€€€€€‰ÉÕ¹Ñ¥µ•}½¹ÑÉ½±}…ÁÁ±¥•ˆ°(€€€€€€€€€€€€¤ì(€€€€€€€€€ô•±Í”¥˜€ (€€€€€€€€€€€´¹ÍÑ…Ñ”€ôôôM%I}IU9Q%5}MQQL¹IU99%9€˜˜(€€€€€€€€€€€¡…É}‰±½¬¹½¹¹•Ñ•(€€€€€€€€€€¤ì(€€€€€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€€€1%e1}MQQL¹=91%9°(€€€€€€€€€€€€€€‰ÉÕ¹Ñ¥µ•}½¹ÑÉ½±}…ÁÁ±¥•ˆ°(€€€€€€€€€€€€¤ì(€€€€€€€€€ô(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=9QI=1}AA1%ˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€ÍÑ…Ñ”è´¹ÍÑ…Ñ”°(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰¡•…ÉÑ‰•…Ğˆè(€€€€€€€€€¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}…Ğ€ô(€€€€€€€€€€€9Õµ‰•È¹¥Í¥¹¥Ñ”¡´¹Ñ¥µ•ÍÑ…µÀ¤€˜˜´¹Ñ¥µ•ÍÑ…µÀ€ø€À(€€€€€€€€€€€€€€ü´¹Ñ¥µ•ÍÑ…µÀ(€€€€€€€€€€€€€€è…Ñ”¹¹½Ü ¤ì(€€€€€€€€€¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}Á¥€ô´¹Á¥ñğÉ•ÍÕ±Ğ¹Á¥ñğ¹Õ±°ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰ÍÑ…Ñ}‰•…Ğˆè(€€€€€€€€€¥˜€¡´¹µ…Á}Í•¹”ü¹µ…À¤ì(€€€€€€€€€€€‘…Í¡‰½…É‘}µ…Á}Í•¹•Ì¹Í•Ğ¡´¹µ…Á}Í•¹”¹µ…À°´¹µ…Á}Í•¹”¤ì(€€€€€€€€€€€‘•±•Ñ”´¹µ…Á}Í•¹”ì(€€€€€€€€€ô(€€€€€€€€€ÕÁ‘…Ñ•¡…É…Ñ•É1¥Ù•MÑ…Ñ”¡¡…É}‰±½¬°´¤ì(€€€€€€€€€µ…å‰•}Á•ÉÍ¥ÍÑ}¡…É…Ñ•É}Í¹…ÁÍ¡½Ğ¡¡…É}¹…µ”°¡…É}‰±½¬°´¤ì(€€€€€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€€€€€€€‰É•…¬ì((€€€€€€€…Í”€‰½¹¹•Ñ•ˆè(€€€€€€€€€¡…É}‰±½¬¹½¹¹•Ñ•€ôÑÉÕ”ì(€€€€€€€€€¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}…Ğ€ô…Ñ”¹¹½Ü ¤ì(€€€€€€€€€¡…É}‰±½¬¹İ…Ñ¡‘½}É•½Ù•Éå}¥¹}ÁÉ½É•ÍÌ€ô™…±Í”ì(€€€€€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ”¡¡…É}¹…µ”°1%e1}MQQL¹=91%9°€‰½¹¹•Ñ•ˆ¤ì(€€€€€€€€€¥˜€ (€€€€€€€€€€€¡…É}‰±½¬¹…ÁÁ±¥•‘}ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸€„ôô(€€€€€€€€€€€¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸(€€€€€€€€€€¤ì(€€€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}ÍÑ…ÑÕÌ€ô€‰A9%9ˆì(€€€€€€€€€€€¡…É}‰±½¬¹½¹™¥}ÁÕÍ¡}•ÉÉ½È€ô¹Õ±°ì(€€€€€€€€€€€Í…™•}Í•¹¡É•ÍÕ±Ğ°ì(€€€€€€€€€€€€€ÑåÁ”è€‰½¹™¥}ÁÕÍ ˆ°(€€€€€€€€€€€€€É•Ù¥Í¥½¸è¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸°(€€€€€€€€€€€€€½¹™¥œè¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥œ°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€…Éµ}½¹™¥}ÁÕÍ¡}Ñ¥µ•½ÕĞ (€€€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€€€¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ (€€€€€€€€€€€€€€‰!IQI}=9%}AUM!}IEUMQˆ°(€€€€€€€€€€€€€¡…É}¹…µ”°(€€€€€€€€€€€€€ì(€€€€€€€€€€€€€€€İ¡äè€‰Me9}=9%}QI}=99Pˆ°(€€€€€€€€€€€€€€€É•Ù¥Í¥½¸è¡…É}‰±½¬¹ÉÕ¹Ñ¥µ•}½¹™¥}É•Ù¥Í¥½¸°(€€€€€€€€€€€€€ô°(€€€€€€€€€€€€¤ì(€€€€€€€€€ô(€€€€€€€€€Í…™•}Í•¹¡É•ÍÕ±Ğ°ì(€€€€€€€€€€€ÑåÁ”è€‰ÉÕ¹Ñ¥µ•}½¹ÑÉ½°ˆ°(€€€€€€€€€€€ÍÑ…Ñ”è¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”°(€€€€€€€€€ô¤ì(€€€€€€€€€Í…™•}Í•¹¡É•ÍÕ±Ğ°ì(€€€€€€€€€€€ÑåÁ”è€‰•µ•É•¹å}ÍÑ½Àˆ°(€€€€€€€€€€€ÍÑ…Ñ”è•µ•É•¹å}ÍÑ½À¹Í¹…ÁÍ¡½Ğ ¤°(€€€€€€€€€ô¤ì(€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}=99Qˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€Á¥èÉ•ÍÕ±Ğ¹Á¥ñğ¹Õ±°°(€€€€€€€€€ô¤ì(€€€€€€€€€¥˜€¡¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}Í½ÕÉ”¤ì(€€€€€€€€€€€½¹ÍĞÉ½Ñ…Ñ¥½¹}Í½ÕÉ”€ô¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}Í½ÕÉ”ì(€€€€€€€€€€€¡…É}‰±½¬¹É½Ñ…Ñ¥½¹}Í½ÕÉ”€ô¹Õ±°ì(€€€€€€€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}I=QQ%=9}=5A1Qˆ°¡…É}¹…µ”°ì(€€€€€€€€€€€€€İ¡äè€‰I=QQ%=9}QIQ}=99Qˆ°(€€€€€€€€€€€€€ÍÑ½Á}¡…É…Ñ•ÈèÉ½Ñ…Ñ¥½¹}Í½ÕÉ”°(€€€€€€€€€€€€€ÍÑ…ÉÑ}¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì(€€€€€€€€€ô(€€€€€€€€€±•…É}ÍÑ…‰±•}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€€€¡…É}‰±½¬¹ÍÑ…‰±•}Ñ¥µ•È€ôÍ•ÑQ¥µ•½ÕĞ  ¤€ôøì(€€€€€€€€€€€¡…É}‰±½¬¹É•ÍÑ…ÉÑ}…ÑÑ•µÁÑÌ€ô€Àì(€€€€€€€€€€€¡…É}‰±½¬¹ÍÑ…‰±•}Ñ¥µ•È€ô¹Õ±°ì(€€€€€€€€€€€±½œ¹¥¹™¼ (€€€€€€€€€€€€€ì(€€€€€€€€€€€€€€€ÑåÁ”è€‰¡…É…Ñ•É}É•ÍÑ…ÉÑ}‰…­½™™}É•Í•Ğˆ°(€€€€€€€€€€€€€€€¡…É…Ñ•Èè¡…É}¹…µ”°(€€€€€€€€€€€€€ô°(€€€€€€€€€€€€€É•ÍÑ…ÉĞ‰…­½™˜É•Í•Ğ™½È€‘í¡…É}¹…µ•õ€°(€€€€€€€€€€€€¤ì(€€€€€€€€€ô°±¥™•å±•}Á½±¥ä¹É•ÍÑ…ÉÑI•Í•Ñ5Ì¤ì(€€€€€€€€€ÕÁ‘…Ñ•}Í¥‰±¥¹Í}…¹‘}…Œ¡µå}…Œ¹É•ÍÁ½¹Í”¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰‘•Á±½äˆè(€€€€€€€€€€¼½¡•¬™½È•á¥ÍÑ¥¹œ¡…É‰±½¬°…‘©ÕÍĞÁ…É…µ•Ñ•ÉÌ…¹­¥±°¥Ğ(€€€€€€€€€€¼½½È¹½Ğ™¥¹…¹ä°µ…­”„¹•Ü½¹”…¹ÍÑ…ÉĞ¥Ğ(€€€€€€€€€½¹ÍĞ¹•İ}¡…É}¹…µ”€ô´¹¡…É…Ñ•Èñğ¡…É}¹…µ”ì(€€€€€€€€€½¹ÍĞ…¹‘¥‘…Ñ”€ô¥¹¥Ñ¥…±¥é•}¡…É}‰±½¬ (€€€€€€€€€€€¹•İ}¡…É}¹…µ”°(€€€€€€€€€€€¡…É…Ñ•É}µ…¹…•m¹•İ}¡…É}¹…µ•tñğíô°(€€€€€€€€€€¤ì(€€€€€€€€€¡…É…Ñ•É}µ…¹…•m¹•İ}¡…É}¹…µ•t€ô…¹‘¥‘…Ñ”ì(€€€€€€€€€…¹‘¥‘…Ñ”¹•¹…‰±•€ôÑÉÕ”ì(€€€€€€€€€…¹‘¥‘…Ñ”¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€ôM%I}IU9Q%5}MQQL¹IU99%9ì(€€€€€€€€€…¹‘¥‘…Ñ”¹É•…±´€ô´¹É•…±´ñğ¡…É}‰±½¬¹É•…±´ì(€€€€€€€€€¥˜€¡¡…É}‰±½¬¹ÑåÁ•ÍÉ¥ÁĞ€˜˜¡…É}‰±½¬¹ÑåÁ•ÍÉ¥ÁĞ¹±•¹Ñ €ø€À¤ì(€€€€€€€€€€€…¹‘¥‘…Ñ”¹ÑåÁ•ÍÉ¥ÁĞ€ô´¹ÍÉ¥ÁĞñğ¡…É}‰±½¬¹ÑåÁ•ÍÉ¥ÁĞì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€…¹‘¥‘…Ñ”¹ÍÉ¥ÁĞ€ô´¹ÍÉ¥ÁĞñğ¡…É}‰±½¬¹ÍÉ¥ÁĞì(€€€€€€€€€€€…¹‘¥‘…Ñ”¹ÑåÁ•ÍÉ¥ÁĞ€ô¹Õ±°ì(€€€€€€€€€ô(€€€€€€€€€…¹‘¥‘…Ñ”¹ÍÉ¥ÁĞ€ô´¹ÍÉ¥ÁĞñğ¡…É}‰±½¬¹ÍÉ¥ÁĞì(€€€€€€€€€…¹‘¥‘…Ñ”¹Ù•ÉÍ¥½¸€ô´¹Ù•ÉÍ¥½¸ñğ¡…É}‰±½¬¹Ù•ÉÍ¥½¸ì(€€€€€€€€€¥˜€¡…¹‘¥‘…Ñ”¹¥¹ÍÑ…¹”¤ì(€€€€€€€€€€€…¹‘¥‘…Ñ”¹½¹ÑÉ½±±•‘}É•ÍÑ…ÉĞ€ôÑÉÕ”ì(€€€€€€€€€€€Í½™Ñ­¥±±}‰±½¬¡…¹‘¥‘…Ñ”¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€…¹‘¥‘…Ñ”¹½¹¹•Ñ•€ô™…±Í”ì(€€€€€€€€€€€ÍÑ…ÉÑ}¡…È¡¹•İ}¡…É}¹…µ”¤ì(€€€€€€€€€ô(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰Í¡ÕÑ‘½İ¸ˆè(€€€€€€€€€¥˜€¡´¹¡…É…Ñ•È¤ì(€€€€€€€€€€€½¹ÍĞ…¹‘¥‘…Ñ”€ô¡…É…Ñ•É}µ…¹…•m´¹¡…É…Ñ•Étñğíôì((€€€€€€€€€€€½¹Í½±”¹±½œ (€€€€€€€€€€€€€Í¡ÕÑ‘½İ¸É•ÅÕ•ÍÑ•™½È€‘í´¹¡…É…Ñ•Éô™É½´€‘í¡…É}¹…µ•õ€°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€…¹‘¥‘…Ñ”¹•¹…‰±•€ô™…±Í”ì(€€€€€€€€€€€…¹‘¥‘…Ñ”¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€ôM%I}IU9Q%5}MQQL¹MQ=AAì(€€€€€€€€€€€Í½™Ñ­¥±±}‰±½¬¡…¹‘¥‘…Ñ”¤ì(€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€½¹Í½±”¹±½œ ‰Í¡ÕÑ‘½İ¸É•ÅÕ•ÍÑ•™É½´€ˆ€¬¡…É}¹…µ”¤ì(€€€€€€€€€€€¡…É}‰±½¬¹•¹…‰±•€ô™…±Í”ì(€€€€€€€€€€€¡…É}‰±½¬¹‘•Í¥É•‘}ÉÕ¹Ñ¥µ•}ÍÑ…Ñ”€ôM%I}IU9Q%5}MQQL¹MQ=AAì(€€€€€€€€€€€Í½™Ñ­¥±±}‰±½¬¡¡…É}‰±½¬¤ì(€€€€€€€€€ô(€€€€€€€€€‰É•…¬ì(€€€€€€€…Í”€‰´ˆè(€€€€€€€€€±•ĞÉ•¥Á¥•¹ÑÌ€ô´¹Ñ¼ì(€€€€€€€€€¥˜€ …ÉÉ…ä¹¥ÍÉÉ…ä¡É•¥Á¥•¹ÑÌ¤¤ì(€€€€€€€€€€€É•¥Á¥•¹ÑÌ€ômÉ•¥Á¥•¹ÑÍtì(€€€€€€€€€ô(€€€€€€€€€½¹ÍĞm±½Ì°±½‰Ít€ôÁ…ÉÑ¥Ñ¥½¸ (€€€€€€€€€€€É•¥Á¥•¹ÑÌ°(€€€€€€€€€€€€¡à¤€ôø¡…É…Ñ•É}µ…¹…•mát€˜˜¡…É…Ñ•É}µ…¹…•mát¹½¹¹•Ñ•°(€€€€€€€€€€¤ì(€€€€€€€€€¥˜€¡±½‰Ì¹±•¹Ñ €ø€À¤ì(€€€€€€€€€€€Í…™•}Í•¹¡¡…É}‰±½¬¹¥¹ÍÑ…¹”°ì(€€€€€€€€€€€€€ÑåÁ”è€‰Í•¹‘}´ˆ°(€€€€€€€€€€€€€Ñ¼è±½‰Ì°(€€€€€€€€€€€€€‘…Ñ„è´¹‘…Ñ„°(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô(€€€€€€€€€±½Ì¹™½É…  ¡‰±¬¤€ôøì(€€€€€€€€€€€Í…™•}Í•¹¡¡…É…Ñ•É}µ…¹…•m‰±­t¹¥¹ÍÑ…¹”°ì(€€€€€€€€€€€€€ÑåÁ”è€‰É••¥Ù•}´ˆ°(€€€€€€€€€€€€€¹…µ”è¡…É}¹…µ”°(€€€€€€€€€€€€€‘…Ñ„è´¹‘…Ñ„°(€€€€€€€€€€€ô¤ì(€€€€€€€€€ô¤ì(€€€€€€€€€‰É•…¬ì(€€€€€€€€¼½±½…±MÑ½É…”…¹Í•ÍÍ¥½¹MÑ½É…”É•±…Ñ•(€€€€€€€…Í”€‰ÍÑ½Èˆè(€€€€€€€€€½¹ÍĞÑÉ}ÍÑ½É”€ô´¹¥‘•¹Ğ€ôô€‰±Ìˆ€ü±½…±MÑ½É…”€èÍ•ÍÍ¥½¹MÑ½É…”ì(€€€€€€€€€Íİ¥Ñ €¡´¹½À¤ì(€€€€€€€€€€€…Í”€‰Í•Ğˆè(€€€€€€€€€€€€€™½È€¡±•Ğ­•ä¥¸´¹‘…Ñ„¤ì(€€€€€€€€€€€€€€€ÑÉ}ÍÑ½É”¹Í•Ğ¡­•ä°´¹‘…Ñ…m­•åt¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€€€…Í”€‰‘•°ˆè(€€€€€€€€€€€€€™½È€¡±•Ğ­•ä½˜´¹‘…Ñ„¤ì(€€€€€€€€€€€€€€€ÑÉ}ÍÑ½É”¹‘•±•Ñ”¡­•ä¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€€€…Í”€‰±•…Èˆè(€€€€€€€€€€€€€™½È€¡±•Ğm­•ä°Ù…±Õ•t½˜ÑÉ}ÍÑ½É”¹•¹ÑÉ¥•Ì ¤¤ì(€€€€€€€€€€€€€€€ÑÉ}ÍÑ½É”¹‘•±•Ñ”¡­•ä¤ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€€€…Í”€‰¥¹¥Ğˆè(€€€€€€€€€€€€€½¹ÍĞ…Ñ¡ÕÁ}‘…Ñ„€ôíôì(€€€€€€€€€€€€€™½È€¡±•Ğm­•ä°Ù…±Õ•t½˜ÑÉ}ÍÑ½É”¹•¹ÑÉ¥•Ì ¤¤ì(€€€€€€€€€€€€€€€…Ñ¡ÕÁ}‘…Ñ…m­•åt€ôÙ…±Õ”ì(€€€€€€€€€€€€€ô(€€€€€€€€€€€€€Í…™•}Í•¹¡¡…É}‰±½¬¹¥¹ÍÑ…¹”°ì(€€€€€€€€€€€€€€€ÑåÁ”è€‰ÍÑ½Èˆ°(€€€€€€€€€€€€€€€½Àè€‰Í•Ğˆ°(€€€€€€€€€€€€€€€¥‘•¹Ğè´¹¥‘•¹Ğ°(€€€€€€€€€€€€€€€‘…Ñ„è…Ñ¡ÕÁ}‘…Ñ„°(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€€€‘•™…Õ±Ğè(€€€€€€€€€€€€€‰É•…¬ì(€€€€€€€€€ô(€€€€€€€€€¥˜€¡´¹½À€„ô€‰¥¹¥Ğˆ¤ì(€€€€€€€€€€€€¼½™½Éİ…ÉÑ¼½Ñ¡•ÈÉÕ¹¹¥¹œÁÉ½•ÍÍ•Ì(€€€€€€€€€€€=‰©•Ğ¹Ù…±Õ•Ì¡¡…É…Ñ•É}µ…¹…”¤(€€€€€€€€€€€€€€¹™¥±Ñ•È ¡à¤€ôøà¹¥¹ÍÑ…¹”¤(€€€€€€€€€€€€€€¹™½É…  ¡‰±½¬¤€ôøì(€€€€€€€€€€€€€€€Í…™•}Í•¹¡‰±½¬¹¥¹ÍÑ…¹”°´¤ì(€€€€€€€€€€€€€ô¤ì(€€€€€€€€€ô(€€€€€€€€€‰É•…¬ì(€€€€€€€‘•™…Õ±Ğè(€€€€€€€€€‰É•…¬ì(€€€€€ô(€€€ô¤ì(€€€¥˜€¡‰İ¥}¥¹ÍÑ…¹”¹ÁÕ‰±¥Í¡•È¤ì(€€€€€¡…É}‰±½¬¹µ½¹¥Ñ½È€ôµ½¹¥Ñ½É¥¹}ÕÑ¥°¹É•…Ñ•}µ½¹¥Ñ½É}Õ¤ (€€€€€€€‰İ¥}¥¹ÍÑ…¹”°(€€€€€€€¡…É}¹…µ”°(€€€€€€€¡…É}‰±½¬°(€€€€€€€™œ¹İ•‰}…ÁÀ¹•¹…‰±•}µ¥¹¥µ…À°(€€€€€€¤ì(€€€ô((€€€É•ÑÕÉ¸É•ÍÕ±Ğì(€ô(€€¼½Q=<‰•Ñ„¹•Ü±½¥Œ™½È€ŒÔ(€€¼½¤¹••Ñ¼¥µÁ±•µ•¹Ğ‘••¹Ğ±¥™•å±”µ¡…¹‘±¥¹œ(€±•Ğ±…ÍÑ}İ…Ñ¡‘½}Ñ¥­}…Ğ€ô…Ñ”¹¹½Ü ¤ì(€½¹ÍĞİ…Ñ¡‘½}Ñ…Í¬€ôÍ•Ñ%¹Ñ•ÉÙ…°  ¤€ôøì(€€€¥˜€¡½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸¤É•ÑÕÉ¸ì(€€€½¹ÍĞ¹½Ü€ô…Ñ”¹¹½Ü ¤ì(€€€½¹ÍĞİ…Ñ¡‘½}…Á}µÌ€ô¹½Ü€´±…ÍÑ}İ…Ñ¡‘½}Ñ¥­}…Ğì(€€€±…ÍÑ}İ…Ñ¡‘½}Ñ¥­}…Ğ€ô¹½Üì(€€€=‰©•Ğ¹Ù…±Õ•Ì¡¡…É…Ñ•É}µ…¹…”¤¹™½É… ¡É•™É•Í¡}¡…É…Ñ•É}É•Ù¥Í¥½¸¤ì(€€€‘…Í¡‰½…Éü¹ÁÕ‰±¥Í¡M¹…ÁÍ¡½Ğ ¤ì((€€€¥˜€¡İ…Ñ¡‘½}…Á}µÌ€ø±¥™•å±•}Á½±¥ä¹¡•…ÉÑ‰•…ÑQ¥µ•½ÕÑ5Ì¤ì(€€€€€=‰©•Ğ¹Ù…±Õ•Ì¡¡…É…Ñ•É}µ…¹…”¤¹™½É…  ¡¡…É}‰±½¬¤€ôøì(€€€€€€€¥˜€¡¡…É}‰±½¬¹¥¹ÍÑ…¹”¤ì(€€€€€€€€€¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}…Ğ€ô¹½Üì(€€€€€€€ô(€€€€€ô¤ì(€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰]Q!=}1=-}@ˆ°¹Õ±°°ì(€€€€€€€…Á}µÌèİ…Ñ¡‘½}…Á}µÌ°(€€€€€€€¡•…ÉÑ‰•…Ñ}Ñ¥µ•½ÕÑ}µÌè±¥™•å±•}Á½±¥ä¹¡•…ÉÑ‰•…ÑQ¥µ•½ÕÑ5Ì°(€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€=‰©•Ğ¹•¹ÑÉ¥•Ì¡¡…É…Ñ•É}µ…¹…”¤¹™½É…  ¡m¡…É}¹…µ”°¡…É}‰±½­t¤€ôøì(€€€€€¥˜€ (€€€€€€€€…¡…É}‰±½¬¹¥¹ÍÑ…¹”ñğ(€€€€€€€¡…É}‰±½¬¹İ…Ñ¡‘½}É•½Ù•Éå}¥¹}ÁÉ½É•ÍÌñğ(€€€€€€€€…¥Í!•…ÉÑ‰•…ÑMÑ…±” (€€€€€€€€€¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}…Ğ°(€€€€€€€€€¹½Ü°(€€€€€€€€€±¥™•å±•}Á½±¥ä¹¡•…ÉÑ‰•…ÑQ¥µ•½ÕÑ5Ì°(€€€€€€€€¤(€€€€€€¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€¡…É}‰±½¬¹İ…Ñ¡‘½}É•½Ù•Éå}¥¹}ÁÉ½É•ÍÌ€ôÑÉÕ”ì(€€€€€½¹ÍĞ…•}µÌ€ô¹½Ü€´¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}…Ğì(€€€€€Í•Ñ}±¥™•å±•}ÍÑ…Ñ” (€€€€€€€¡…É}¹…µ”°(€€€€€€€1%e1}MQQL¹II=H°(€€€€€€€€‰¡•…ÉÑ‰•…Ñ}Ñ¥µ•½ÕĞˆ°(€€€€€€¤ì(€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰!IQI}!IQ	Q}Q%5=UPˆ°¡…É}¹…µ”°ì(€€€€€€€…•}µÌ°(€€€€€€€Ñ¥µ•½ÕÑ}µÌè±¥™•å±•}Á½±¥ä¹¡•…ÉÑ‰•…ÑQ¥µ•½ÕÑ5Ì°(€€€€€€€Á¥è¡…É}‰±½¬¹±…ÍÑ}¡•…ÉÑ‰•…Ñ}Á¥°(€€€€€ô¤ì(€€€€€Í½™Ñ­¥±±}‰±½¬¡¡…É}‰±½¬¤ì(€€€ô¤ì(€ô°±¥™•å±•}Á½±¥ä¹İ…Ñ¡‘½%¹Ñ•ÉÙ…±5Ì¤ì(€İ…Ñ¡‘½}Ñ…Í¬¹Õ¹É•˜ ¤ì((€l‰M%%9Pˆ°€‰M%QI4ˆ°€‰M%EU%P‰t¹™½É…  ¡Í¥¹…°¤€ôø(€€€ÁÉ½•ÍÌ¹½¸¡Í¥¹…°°…Íå¹Œ€ ¤€ôøì(€€€€€¥˜€¡½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸¤É•ÑÕÉ¸ì(€€€€€½½É‘¥¹…Ñ½É}Í¡ÕÑÑ¥¹}‘½İ¸€ôÑÉÕ”ì(€€€€€±•…É%¹Ñ•ÉÙ…°¡İ…Ñ¡‘½}Ñ…Í¬¤ì(€€€€€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰==I%9Q=I}M!UQ=]8ˆ°¹Õ±°°ìÍ¥¹…°ô¤ì(€€€€€‘…Í¡‰½…Éü¹±½Í” ¤ì(€€€€€¥˜€¡½İ¹•‘}İ•‰}Í•ÉÙ•È¤ì(€€€€€€€½İ¹•‘}İ•‰}Í•ÉÙ•È¹±½Í” ¤ì(€€€€€ô(€€€€€½¹Í½±”¹±½œ¡I••¥Ù•€‘íÍ¥¹…±ô½¸µ…ÍÑ•È¸I½Õ¹‘¥¹œÕÀ±¥•¹ÑÍ€¤ì(€€€€€€¼½Í½™Ñ­¥±°…±°¡…ÉÌ°¥Ù¥¹œÑ¡•´¡…¹”Ñ¼Í¡ÕÑ‘½İ¸(€€€€€…İ…¥ĞAÉ½µ¥Í”¹…±° (€€€€€€€=‰©•Ğ¹Ù…±Õ•Ì¡¡…É…Ñ•É}µ…¹…”¤¹µ…À ¡¡…É}‰±½¬¤€ôøì(€€€€€€€€€±•…É}É•ÍÑ…ÉÑ}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€€€±•…É}ÍÑ…‰±•}Ñ¥µ•È¡¡…É}‰±½¬¤ì(€€€€€€€€€É•ÑÕÉ¸Í½™Ñ­¥±±}‰±½¬¡¡…É}‰±½¬¤ì(€€€€€€€ô¤°(€€€€€€¤ì(€€€€€…İ…¥ĞAÉ½µ¥Í”¹…±±M•ÑÑ±•¡l(€€€€€€€ÍÑÉÕÑÕÉ•‘}±½•È¹™±ÕÍ  ¤°(€€€€€€€¥¹¥‘•¹Ñ}É•½É‘•È¹™±ÕÍ  ¤°(€€€€€t¤ì(€€€€€…İ…¥ĞÁ•ÉÍ¥ÍÑ•¹”¹±½Í” ¤ì(€€€€€½¹Í½±”¹±½œ ‰¹½ÜÑÉÕ±ä•á¥Ñ¥¹œˆ¤ì(€€€€€ÁÉ½•ÍÌ¹•á¥Ğ ¤ì(€€€ô¤°(€€¤ì((€=‰©•Ğ¹•¹ÑÉ¥•Ì¡¡…É…Ñ•É}µ…¹…”¤¹™½É…  ¡m¡…É}¹…µ”°¡…É}‰±½­t¤€ôøì(€€€¥¹¥Ñ¥…±¥é•}¡…É}‰±½¬¡¡…É}¹…µ”°¡…É}‰±½¬¤ì(€ô¤ì((€½¹ÍĞÉ•ÅÕ•ÍÑ•‘}ÍÑ…ÉÑÕÀ€ô=‰©•Ğ¹Ù…±Õ•Ì¡¡…É…Ñ•É}µ…¹…”¤¹™¥±Ñ•È (€€€€¡¡…É}‰±½¬¤€ôø¡…É}‰±½¬¹•¹…‰±•°(€€¤¹±•¹Ñ ì(€½¹ÍĞÍÑ…ÉÑÕÁ}¡…ÉÌ€ô•Ñ%¹¥Ñ¥…±MÑ…ÉÑÕÁ¡…É…Ñ•ÉÌ (€€€¡…É…Ñ•É}µ…¹…”°(€€€±¥™•å±•}Á½±¥ä¹µ…á=¹±¥¹•¡…É…Ñ•ÉÌ°(€€¤ì(€¥˜€¡É•ÅÕ•ÍÑ•‘}ÍÑ…ÉÑÕÀ€øÍÑ…ÉÑÕÁ}¡…ÉÌ¹±•¹Ñ ¤ì(€€€±½œ¹İ…É¸ (€€€€€ì(€€€€€€€ÑåÁ”è€‰¡…É…Ñ•É}ÍÑ…ÉÑÕÁ}±¥µ¥Ğˆ°(€€€€€€€É•ÅÕ•ÍÑ•èÉ•ÅÕ•ÍÑ•‘}ÍÑ…ÉÑÕÀ°(€€€€€€€Í¡•‘Õ±•èÍÑ…ÉÑÕÁ}¡…ÉÌ¹±•¹Ñ °(€€€€€€€µ…á}½¹±¥¹•}¡…É…Ñ•ÉÌè±¥™•å±•}Á½±¥ä¹µ…á=¹±¥¹•¡…É…Ñ•ÉÌ°(€€€€€ô°(€€€€€€‰½¹™¥ÕÉ•¡…É…Ñ•ÉÌ•á••Ñ¡”½¹±¥¹”¡…É…Ñ•È±¥µ¥Ğˆ°(€€€€¤ì(€ô((€•µ¥Ñ}ÍÕÁ•ÉÙ¥Í½É}•Ù•¹Ğ ‰==I%9Q=I}Idˆ°¹Õ±°°ì(€€€É•¥ÍÑ•É•‘}¡…É…Ñ•É}½Õ¹Ğè=‰©•Ğ¹­•åÌ¡¡…É…Ñ•É}µ…¹…”¤¹±•¹Ñ °(€€€…½Õ¹Ñ}¡…É…Ñ•É}½Õ¹Ğè…½Õ¹Ñ}¡…É…Ñ•ÉÌ¹±•¹Ñ °(€€€É•¥ÍÑ•É•‘}¡…É…Ñ•ÉÌè=‰©•Ğ¹­•åÌ¡¡…É…Ñ•É}µ…¹…”¤¹Í½ÉĞ ¤°(€€€µ…á}½¹±¥¹•}¡…É…Ñ•ÉÌè±¥™•å±•}Á½±¥ä¹µ…á=¹±¥¹•¡…É…Ñ•ÉÌ°(€€€¡•…ÉÑ‰•…Ñ}¥¹Ñ•ÉÙ…±}µÌè±¥™•å±•}Á½±¥ä¹¡•…ÉÑ‰•…Ñ%¹Ñ•ÉÙ…±5Ì°(€€€¡•…ÉÑ‰•…Ñ}Ñ¥µ•½ÕÑ}µÌè±¥™•å±•}Á½±¥ä¹¡•…ÉÑ‰•…ÑQ¥µ•½ÕÑ5Ì°(€€€İ…Ñ¡‘½}¥¹Ñ•ÉÙ…±}µÌè±¥™•å±•}Á½±¥ä¹İ…Ñ¡‘½%¹Ñ•ÉÙ…±5Ì°(€€€Í¡•‘Õ±•‘}¡…É…Ñ•ÉÌèÍÑ…ÉÑÕÁ}¡…ÉÌ°(€ô¤ì((€ÍÑ…ÉÑÕÁ}¡…ÉÌ¹™½É…  ¡¡…É}¹…µ”°¥¹‘•à¤€ôøì(€€€½¹ÍĞ‘•±…ä€ô¥¹‘•à€¨±¥™•å±•}Á½±¥ä¹ÍÑ…ÉÑÕÁMÑ…•É5Ìì(€€€Í•ÑQ¥µ•½ÕĞ  ¤€ôøÍÑ…ÉÑ}¡…È¡¡…É}¹…µ”¤°‘•±…ä¤ì(€ô¤ì((€µå}…Œ¹…‘‘}±¥ÍÑ•¹•È¡ÕÁ‘…Ñ•}Í¥‰±¥¹Í}…¹‘}…Œ¤ì)ô¤ ¤¹…Ñ  ¡”¤€ôøì(€½¹Í½±”¹•ÉÉ½È ‰™…¥±•Ñ¼ÍÑ…ÉĞ…É…0ˆ°”¤ì)ô¤ì(
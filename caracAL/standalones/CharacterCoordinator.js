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
const {
  combineInventoryLiveTestResult,
  inventoryLiveTestDiagnostics,
  inventoryLiveTestEvidence,
} = require("../src/InventoryLiveTest");
const {
  combineLogisticsLiveTestResult,
  logisticsLiveTestDiagnostics,
  logisticsLiveTestEvidence,
} = require("../src/LogisticsLiveTest");
const {
  combineMerchantLiveTestResult,
  merchantLiveTestDiagnostics,
  merchantLiveTestEvidence,
} = require("../src/MerchantLiveTest");
const {
  combineMerritLiveTestResult,
  merritLiveTestDiagnostics,
  merritLiveTestEvidence,
} = require("../src/MerritLiveTest");
const {
  combineFishingLiveTestResult,
  fishingLiveTestDiagnostics,
  fishingLiveTestEvidence,
} = require("../src/FishingLiveTest");
const { PersistenceService } = require("../src/PersistenceService");
const { CharacterConfigService } = require("../src/CharacterConfigService");
const { MerchantLogisticsPlanner } = require("../src/MerchantLogisticsPlanner");
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
const INVENTORY_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const LOGISTICS_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const MERCHANT_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const MERRIT_LIVE_TEST_RESULT_TIMEOUT_MS = 420000;
const FISHING_LIVE_TEST_RESULT_TIMEOUT_MS = 20 * 60 * 1000;
const MATERIAL_GATHER_TASK_RESULT_TIMEOUT_MS = 6 * 60 * 1000;
const DEFAULT_FISHING_MATERIAL_WORKERS = Object.freeze([
  "My_Ranger1",
  "My_Ranger2",
  "My_Ranger3",
]);
const LOGISTICS_CLAIM_RESULT_TIMEOUT_MS = 30000;

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
  const merchant_logistics_planner = new MerchantLogisticsPlanner();
  let merchant_logistics_board =
    merchant_logistics_planner.plan(character_manage);
  let merchant_logistics_signature = null;
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
  const inventory_live_test_requests = new Map();
  let inventory_live_test_sequence = 0;
  const logistics_live_test_requests = new Map();
  let logistics_live_test_sequence = 0;
  let logistics_live_test_active = false;
  const merchant_live_test_requests = new Map();
  let merchant_live_test_sequence = 0;
  const merrit_live_test_requests = new Map();
  let merrit_live_test_sequence = 0;
  const fishing_live_test_requests = new Map();
  let fishing_live_test_sequence = 0;
  let fishing_live_test_active = false;
  const material_gather_task_requests = new Map();
  let material_gather_task_sequence = 0;
  const fishing_material_requests = new Map();
  let material_worker_active_count = 0;
  const logistics_claim_requests = new Map();
  let logistics_claim_sequence = 0;
  let logistics_dispatch_scheduled = false;
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
        runInventoryLiveTest: run_inventory_live_test,
        runLogisticsLiveTest: run_logistics_live_test,
        runMerchantLiveTest: run_merchant_live_test,
        runMerritLiveTest: run_merrit_live_test,
        runFishingLiveTest: run_fishing_live_test,
        controlEmergencyStop: control_emergency_stop,
        getEmergencyStopState: () => emergency_stop.snapshot(),
        getRevisionSummary: revision_summary,
        getPersistenceHealth: () => persistence.health(),
        getMerchantLogisticsState: () => merchant_logistics_board,
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

  function logistics_record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function logistics_claim_route(claim) {
    const merchant = claim?.merchant?.name || null;
    const farmer = claim?.farmer || null;
    if (
      ["MLUCK", "POTION_DELIVERY", "ITEM_DELIVERY", "GEAR_DELIVERY"].includes(
        claim?.type,
      )
    ) {
      return { source: merchant, target: farmer };
    }
    if (
      ["GOLD_PICKUP", "INVENTORY_PRESSURE", "MATERIAL_DELIVERY"].includes(
        claim?.type,
      )
    ) {
      return { source: farmer, target: merchant };
    }
    return { source: null, target: null };
  }

  function logistics_execution_enabled(claim) {
    const farmer_block = character_manage[claim?.farmer];
    const merchant_block = character_manage[claim?.merchant?.name];
    if (!farmer_block || !merchant_block) return false;

    const farmer_config = logistics_record(farmer_block.runtime_config);
    const farmer_logistics = logistics_record(farmer_config.logistics);
    const merchant_config = logistics_record(merchant_block.runtime_config);
    const merchant_settings = logistics_record(merchant_config.merchant);
    const merchant_logistics = logistics_record(merchant_settings.logistics);

    const farmer_enabled =
      farmer_logistics.executionEnabled === true ||
      farmer_logistics.execute === true;
    const merchant_enabled =
      merchant_logistics.executionEnabled === true ||
      merchant_logistics.execute === true;
    return farmer_enabled && merchant_enabled;
  }

  function logistics_live_execution_summary(board = merchant_logistics_board) {
    const claims = Array.isArray(board?.claims) ? board.claims : [];
    const ready = claims.filter((claim) => claim?.status === "READY");
    const eligible = ready.filter((claim) =>
      logistics_execution_enabled(claim),
    );
    const dispatchable = eligible.filter((claim) => {
      const route = logistics_claim_route(claim);
      const source_block = character_manage[route.source];
      return (
        !!route.source &&
        !!route.target &&
        !!source_block?.instance &&
        source_block.connected &&
        Number.isFinite(source_block.bot_runtime_started_at)
      );
    });
    const emergency_stop_active = emergency_stop.snapshot().active;

    return {
      readyClaims: ready.length,
      configEligibleClaims: eligible.length,
      dispatchableClaims: emergency_stop_active ? 0 : dispatchable.length,
      emergencyStopActive: emergency_stop_active,
      activeRequestCount: logistics_claim_requests.size,
    };
  }

  function schedule_merchant_logistics_dispatch() {
    if (logistics_dispatch_scheduled || coordinator_shutting_down) return;
    logistics_dispatch_scheduled = true;
    setImmediate(() => {
      logistics_dispatch_scheduled = false;
      dispatch_merchant_logistics_claim();
    });
  }

  function dispatch_merchant_logistics_claim() {
    if (coordinator_shutting_down) return false;
    if (
      logistics_live_test_active ||
      fishing_live_test_active ||
      material_worker_active_count > 0
    )
      return false;
    if (emergency_stop.snapshot().active) return false;
    if (logistics_claim_requests.size > 0) return false;

    const claim = merchant_logistics_board.claims.find(
      (candidate) =>
        candidate.status === "READY" && logistics_execution_enabled(candidate),
    );
    if (!claim) return false;

    const route = logistics_claim_route(claim);
    const source_block = character_manage[route.source];
    if (
      !route.source ||
      !route.target ||
      !source_block?.instance ||
      !source_block.connected ||
      !Number.isFinite(source_block.bot_runtime_started_at)
    ) {
      return false;
    }

    logistics_claim_sequence += 1;
    const request_id =
      "logistics-claim-" + Date.now() + "-" + logistics_claim_sequence;
    const pending = {
      request_id,
      claim,
      source: route.source,
      target: route.target,
      timer: null,
    };

    pending.timer = setTimeout(() => {
      const current = logistics_claim_requests.get(request_id);
      if (!current) return;
      logistics_claim_requests.delete(request_id);
      merchant_logistics_planner.recordClaimOutcome(claim, {
        outcome: "UNKNOWN",
        reason: "LOGISTICS_CLAIM_RESULT_TIMEOUT",
        source: route.source,
        target: route.target,
        itemName: claim.itemName || null,
        fulfilled: false,
      });
      emit_supervisor_event("LOGISTICS_CLAIM_TIMEOUT", route.source, {
        request_id,
        claim_id: claim.id,
        why: "OUTCOME_UNCERTAIN_NO_BLIND_RETRY",
      });
      refresh_merchant_logistics("LOGISTICS_CLAIM_TIMEOUT");
    }, LOGISTICS_CLAIM_RESULT_TIMEOUT_MS);
    pending.timer.unref?.();
    logistics_claim_requests.set(request_id, pending);

    const sent = safe_send(source_block.instance, {
      type: "logistics_claim",
      request_id,
      claim,
    });
    if (!sent) {
      clearTimeout(pending.timer);
      logistics_claim_requests.delete(request_id);
      merchant_logistics_planner.recordClaimOutcome(claim, {
        outcome: "BLOCKED",
        reason: "LOGISTICS_CLAIM_IPC_UNAVAILABLE",
        source: route.source,
        target: route.target,
        itemName: claim.itemName || null,
        fulfilled: false,
      });
      refresh_merchant_logistics("LOGISTICS_CLAIM_IPC_UNAVAILABLE");
      return false;
    }

    emit_supervisor_event("LOGISTICS_CLAIM_DISPATCHED", route.source, {
      request_id,
      claim_id: claim.id,
      claim_type: claim.type,
      target: route.target,
    });
    return true;
  }

  function refresh_merchant_logistics(reason = "STATE_CHANGED") {
    const board = merchant_logistics_planner.plan(character_manage);
    const comparable = {
      merchantIndependent: board.merchantIndependent,
      merchants: board.merchants,
      claims: board.claims,
      suppressed: board.suppressed,
      summary: board.summary,
    };
    const signature = JSON.stringify(comparable);
    const changed = signature !== merchant_logistics_signature;
    merchant_logistics_signature = signature;
    merchant_logistics_board = board;

    if (changed) {
      emit_supervisor_event("MERCHANT_LOGISTICS_BOARD_UPDATED", null, {
        why: reason,
        summary: board.summary,
        merchant_independent: board.merchantIndependent,
      });
      dashboard?.publishSnapshot();
    }
    schedule_merchant_logistics_dispatch();
    return board;
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
      char_block &&
      normalized.data?.inventoryIntelligence &&
      typeof normalized.data.inventoryIntelligence === "object"
    ) {
      char_block.inventory_intelligence_runtime =
        normalized.data.inventoryIntelligence;
      refresh_merchant_logistics("INVENTORY_INTELLIGENCE_UPDATED");
    }

    if (
      char_block &&
      normalized.data?.merchantMerrit &&
      typeof normalized.data.merchantMerrit === "object"
    ) {
      char_block.merrit_runtime = normalized.data.merchantMerrit;
    }

    if (
      char_block &&
      normalized.data?.merchantFishing &&
      typeof normalized.data.merchantFishing === "object"
    ) {
      char_block.fishing_runtime = normalized.data.merchantFishing;
    }

    if (
      normalized.module === "MerchantMerritController" &&
      normalized.type === "MERRIT_PARCEL_CONFIRMED" &&
      Number.isFinite(Number(normalized.data?.readyAt))
    ) {
      const readyAt = Number(normalized.data.readyAt);
      void observe_persistence(
        persistence.saveCooldown("account", "merrit", {
          readyAt,
          state: {
            character: char_name,
            receiptAt: Number(normalized.data?.receiptAt) || null,
            shells: Number(normalized.data?.shells) || 0,
          },
        }),
        "merrit_cooldown",
        char_name,
      );
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
        normalized.data?.farmIntelligence ||
        normalized.data?.inventoryIntelligence ||
        normalized.data?.merchantMerrit ||
        normalized.data?.merchantFishing)
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
    char_block.inventory_live_test = char_block.inventory_live_test || null;
    char_block.combat_runtime = char_block.combat_runtime || null;
    char_block.class_skill_runtime = char_block.class_skill_runtime || null;
    char_block.group_combat_runtime = char_block.group_combat_runtime || null;
    char_block.farm_intelligence_runtime =
      char_block.farm_intelligence_runtime || null;
    char_block.inventory_intelligence_runtime =
      char_block.inventory_intelligence_runtime || null;
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
    refresh_merchant_logistics("CHARACTER_INITIALIZED");
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

    refresh_merchant_logistics("CONFIG_UPDATED");
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

  function reject_inventory_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of inventory_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      inventory_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  function reject_logistics_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of logistics_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      logistics_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  function reject_merchant_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of merchant_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      merchant_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  function reject_merrit_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of merrit_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      merrit_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  function reject_fishing_live_tests_for_character(char_name, reason) {
    for (const [request_id, pending] of fishing_live_test_requests) {
      if (pending.character !== char_name) continue;
      clearTimeout(pending.timer);
      fishing_live_test_requests.delete(request_id);
      pending.reject(new Error(reason));
    }
  }

  async function wait_for_logistics_claim_idle(
    timeout_ms = LOGISTICS_CLAIM_RESULT_TIMEOUT_MS + 5000,
  ) {
    const started_at = Date.now();
    while (Date.now() - started_at < timeout_ms) {
      if (logistics_claim_requests.size === 0) return true;
      await sleep(100);
    }

    throw make_control_error(
      "LOGISTICS_LIVE_TEST_EXECUTION_BUSY",
      "Existing logistics execution did not settle before the live test",
      504,
    );
  }

  async function wait_for_inventory_live_test_runtime(
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
      "INVENTORY_LIVE_TEST_RUNTIME_TIMEOUT",
      `Inventory runtime did not become ready for ${char_name}`,
      504,
    );
  }

  async function wait_for_logistics_live_test_runtime(
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
      "LOGISTICS_LIVE_TEST_RUNTIME_TIMEOUT",
      `Logistics runtime did not become ready for ${char_name}`,
      504,
    );
  }

  async function wait_for_merchant_live_test_runtime(
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
      "MERCHANT_LIVE_TEST_RUNTIME_TIMEOUT",
      `Merchant runtime did not become ready for ${char_name}`,
      504,
    );
  }

  async function wait_for_fishing_live_test_runtime(
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
      "FISHING_LIVE_TEST_RUNTIME_TIMEOUT",
      `Fishing runtime did not become ready for ${char_name}`,
      504,
    );
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

  function wait_for_inventory_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        inventory_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "INVENTORY_LIVE_TEST_TIMEOUT",
            `Inventory live test timed out for ${char_name}`,
            504,
          ),
        );
      }, INVENTORY_LIVE_TEST_RESULT_TIMEOUT_MS);

      inventory_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }

  function wait_for_logistics_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        logistics_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "LOGISTICS_LIVE_TEST_TIMEOUT",
            `Logistics live test timed out for ${char_name}`,
            504,
          ),
        );
      }, LOGISTICS_LIVE_TEST_RESULT_TIMEOUT_MS);

      logistics_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }

  function wait_for_merchant_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        merchant_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "MERCHANT_LIVE_TEST_TIMEOUT",
            `Merchant live test timed out for ${char_name}`,
            504,
          ),
        );
      }, MERCHANT_LIVE_TEST_RESULT_TIMEOUT_MS);

      merchant_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }

  function wait_for_merrit_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        merrit_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "MERRIT_LIVE_TEST_TIMEOUT",
            `Merrit live test timed out for ${char_name}`,
            504,
          ),
        );
      }, MERRIT_LIVE_TEST_RESULT_TIMEOUT_MS);

      merrit_live_test_requests.set(request_id, {
        character: char_name,
        resolve,
        reject,
        timer,
      });
    });
  }

  function wait_for_fishing_live_test_result(char_name, request_id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fishing_live_test_requests.delete(request_id);
        reject(
          make_control_error(
            "FISHING_LIVE_TEST_TIMEOUT",
            `Fishing live test timed out for ${char_name}`,
            504,
          ),
        );
      }, FISHING_LIVE_TEST_RESULT_TIMEOUT_MS);

      fishing_live_test_requests.set(request_id, {
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

  function capture_inventory_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "INVENTORY_LIVE_TEST_FAILED",
      severity: test_result.outcome === "TIMEOUT" ? "HIGH" : "ERROR",
      character: char_name,
      event: {
        type: "inventory_live_test",
        event: "INVENTORY_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "INVENTORY_LIVE_TEST_FAILED",
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
      "inventory_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }

  function capture_logistics_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "LOGISTICS_LIVE_TEST_FAILED",
      severity: test_result.outcome === "TIMEOUT" ? "HIGH" : "ERROR",
      character: char_name,
      event: {
        type: "logistics_live_test",
        event: "LOGISTICS_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "LOGISTICS_LIVE_TEST_FAILED",
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
      "logistics_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }

  function capture_merchant_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "MERCHANT_LIVE_TEST_FAILED",
      severity: test_result.outcome === "TIMEOUT" ? "HIGH" : "ERROR",
      character: char_name,
      event: {
        type: "merchant_live_test",
        event: "MERCHANT_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "MERCHANT_LIVE_TEST_FAILED",
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
      "merchant_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }

  function capture_merrit_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "MERRIT_LIVE_TEST_FAILED",
      severity: test_result.outcome === "TIMEOUT" ? "HIGH" : "ERROR",
      character: char_name,
      event: {
        type: "merrit_live_test",
        event: "MERRIT_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "MERRIT_LIVE_TEST_FAILED",
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
      "merrit_live_test_incident",
      char_name,
    );
    return incident.incident_id;
  }

  function capture_fishing_live_test_incident(char_name, test_result) {
    const incident = incident_recorder.capture({
      reason: test_result.reason || "FISHING_LIVE_TEST_FAILED",
      severity: test_result.outcome === "TIMEOUT" ? "HIGH" : "ERROR",
      character: char_name,
      event: {
        type: "fishing_live_test",
        event: "FISHING_LIVE_TEST_FAILED",
        character: char_name,
        timestamp: Date.now(),
        request_id: test_result.request_id || test_result.requestId || null,
        outcome: test_result.outcome || "FAIL",
        reason: test_result.reason || "FISHING_LIVE_TEST_FAILED",
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
      "fishing_live_test_incident",
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
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.group_live_test = {
        ...combined,
        request_id,
        status: "COMPLETED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
      };
      emit_supervisor_event("GROUP_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
      dashboard?.publishSnapshot();
      return ready_block.group_live_test;
    } catch (error) {
      const failed_result = {
        request_id,
        outcome: error.code === "GROUP_LIVE_TEST_TIMEOUT" ? "TIMEOUT" : "FAIL",
        reason: error.code || error.message || "GROUP_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = groupLiveTestEvidence(
        failure_events,
        char_block,
      );
      const incident_id = capture_group_live_test_incident(
        char_name,
        failed_result,
      );
      const failed = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: groupLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
      };
      char_block.group_live_test = failed;
      emit_supervisor_event("GROUP_LIVE_TEST_FAILED", char_name, failed);
      dashboard?.publishSnapshot();
      return failed;
    } finally {
      const pending = group_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        group_live_test_requests.delete(request_id);
      }

      try {
        if (runtime_override_applied) {
          await restore_group_live_test_execution_source(
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
          "GROUP_LIVE_TEST_STATE_RESTORE_FAILED",
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

  async function run_farm_live_test(char_name, options = {}) {
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
        "FARM_CHARACTER_REQUIRED",
        "Farm live test requires a non-merchant character: " + char_name,
        400,
      );
    }
    if (["STARTING", "RUNNING"].includes(char_block.farm_live_test?.status)) {
      throw make_control_error(
        "FARM_LIVE_TEST_ALREADY_RUNNING",
        `Farm live test already running for ${char_name}`,
        409,
      );
    }
    for (const active of [
      ["MOVEMENT", char_block.movement_live_test],
      ["COMBAT", char_block.combat_live_test],
      ["CLASS_SKILL", char_block.class_skill_live_test],
      ["GROUP", char_block.group_live_test],
    ]) {
      if (["STARTING", "RUNNING"].includes(active[1]?.status)) {
        throw make_control_error(
          active[0] + "_LIVE_TEST_ALREADY_RUNNING",
          active[0] + " live test already running for " + char_name,
          409,
        );
      }
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
      xp: Number.isFinite(char_block.live_state?.xp)
        ? char_block.live_state.xp
        : null,
      gold: Number.isFinite(char_block.live_state?.gold)
        ? char_block.live_state.gold
        : null,
    };
    const started_at = Date.now();
    farm_live_test_sequence += 1;
    const request_id = `farm-live-${started_at}-${farm_live_test_sequence}`;

    char_block.farm_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("FARM_LIVE_TEST_REQUESTED", char_name, {
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
            "FARM_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Farm runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "FARM_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
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

      await wait_for_farm_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_farm_live_test_result(
        char_name,
        request_id,
      );

      ready_block.farm_live_test = {
        ...ready_block.farm_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "farm_live_test",
        request_id,
        sample_ms: Number.isFinite(Number(options.sampleMs))
          ? Number(options.sampleMs)
          : undefined,
      });
      if (!sent) {
        const pending = farm_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          farm_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "FARM_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch farm live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "FARM_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Farm live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = farmLiveTestEvidence(events, ready_block);
      const combined = combineFarmLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_farm_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = farmLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.farm_live_test = {
        ...combined,
        request_id,
        status: "COMPLETED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
      };
      emit_supervisor_event("FARM_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
      dashboard?.publishSnapshot();
      return ready_block.farm_live_test;
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "FARM_LIVE_TEST_TIMEOUT" ||
          error.code === "FARM_LIVE_TEST_RUNTIME_TIMEOUT"
            ? "TIMEOUT"
            : "FAIL",
        reason: error.code || error.message || "FARM_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = farmLiveTestEvidence(failure_events, char_block);
      const incident_id = capture_farm_live_test_incident(
        char_name,
        failed_result,
      );
      const failed = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: farmLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
      };
      char_block.farm_live_test = failed;
      emit_supervisor_event("FARM_LIVE_TEST_FAILED", char_name, failed);
      dashboard?.publishSnapshot();
      return failed;
    } finally {
      const pending = farm_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        farm_live_test_requests.delete(request_id);
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
          "FARM_LIVE_TEST_STATE_RESTORE_FAILED",
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

  async function run_inventory_live_test(char_name) {
    const char_block = character_manage[char_name];
    if (!char_block) {
      throw make_control_error(
        "CHARACTER_NOT_FOUND",
        `Unknown character: ${char_name}`,
        404,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.inventory_live_test?.status)
    ) {
      throw make_control_error(
        "INVENTORY_LIVE_TEST_ALREADY_RUNNING",
        `Inventory live test already running for ${char_name}`,
        409,
      );
    }
    for (const active of [
      ["MOVEMENT", char_block.movement_live_test],
      ["COMBAT", char_block.combat_live_test],
      ["CLASS_SKILL", char_block.class_skill_live_test],
      ["GROUP", char_block.group_live_test],
      ["FARM", char_block.farm_live_test],
    ]) {
      if (["STARTING", "RUNNING"].includes(active[1]?.status)) {
        throw make_control_error(
          active[0] + "_LIVE_TEST_ALREADY_RUNNING",
          active[0] + " live test already running for " + char_name,
          409,
        );
      }
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
      inventory_slots: Array.isArray(char_block.live_state?.items)
        ? char_block.live_state.items.filter(Boolean).length
        : null,
    };
    const started_at = Date.now();
    inventory_live_test_sequence += 1;
    const request_id = `inventory-live-${started_at}-${inventory_live_test_sequence}`;

    char_block.inventory_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("INVENTORY_LIVE_TEST_REQUESTED", char_name, {
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
            "INVENTORY_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Inventory runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "INVENTORY_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
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

      await wait_for_inventory_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_inventory_live_test_result(
        char_name,
        request_id,
      );

      ready_block.inventory_live_test = {
        ...ready_block.inventory_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "inventory_live_test",
        request_id,
      });
      if (!sent) {
        const pending = inventory_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          inventory_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "INVENTORY_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch inventory live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "INVENTORY_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Inventory live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = inventoryLiveTestEvidence(events, ready_block);
      const combined = combineInventoryLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_inventory_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = inventoryLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.inventory_live_test = {
        ...combined,
        request_id,
        status: "COMPLETED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
      };
      emit_supervisor_event("INVENTORY_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
      dashboard?.publishSnapshot();
      return ready_block.inventory_live_test;
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "INVENTORY_LIVE_TEST_TIMEOUT" ||
          error.code === "INVENTORY_LIVE_TEST_RUNTIME_TIMEOUT"
            ? "TIMEOUT"
            : "FAIL",
        reason: error.code || error.message || "INVENTORY_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = inventoryLiveTestEvidence(
        failure_events,
        char_block,
      );
      const incident_id = capture_inventory_live_test_incident(
        char_name,
        failed_result,
      );
      const failed = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: inventoryLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
      };
      char_block.inventory_live_test = failed;
      emit_supervisor_event("INVENTORY_LIVE_TEST_FAILED", char_name, failed);
      dashboard?.publishSnapshot();
      return failed;
    } finally {
      const pending = inventory_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        inventory_live_test_requests.delete(request_id);
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
          "INVENTORY_LIVE_TEST_STATE_RESTORE_FAILED",
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

  async function run_logistics_live_test(char_name) {
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
      "merchant"
    ) {
      throw make_control_error(
        "LOGISTICS_MERCHANT_REQUIRED",
        "Logistics live test requires an account-owned merchant: " + char_name,
        400,
      );
    }
    if (char_block.account_owned !== true) {
      throw make_control_error(
        "LOGISTICS_ACCOUNT_MERCHANT_REQUIRED",
        "Logistics live test requires an account-owned merchant: " + char_name,
        400,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(
        char_block.logistics_live_test?.status,
      ) ||
      logistics_live_test_active
    ) {
      throw make_control_error(
        "LOGISTICS_LIVE_TEST_ALREADY_RUNNING",
        "A logistics live test is already running",
        409,
      );
    }
    for (const active of [
      ["MOVEMENT", char_block.movement_live_test],
      ["COMBAT", char_block.combat_live_test],
      ["CLASS_SKILL", char_block.class_skill_live_test],
      ["GROUP", char_block.group_live_test],
      ["FARM", char_block.farm_live_test],
      ["INVENTORY", char_block.inventory_live_test],
    ]) {
      if (["STARTING", "RUNNING"].includes(active[1]?.status)) {
        throw make_control_error(
          active[0] + "_LIVE_TEST_ALREADY_RUNNING",
          active[0] + " live test already running for " + char_name,
          409,
        );
      }
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
      gold: Number.isFinite(char_block.live_state?.gold)
        ? char_block.live_state.gold
        : null,
      inventory_slots: Array.isArray(char_block.live_state?.items)
        ? char_block.live_state.items.filter(Boolean).length
        : null,
    };
    const started_at = Date.now();
    logistics_live_test_sequence += 1;
    const request_id = `logistics-live-${started_at}-${logistics_live_test_sequence}`;

    char_block.logistics_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("LOGISTICS_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;
    let runtime_state_restored = false;
    logistics_live_test_active = true;

    try {
      await wait_for_logistics_claim_idle();

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
            "LOGISTICS_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Logistics runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "LOGISTICS_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
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

      await wait_for_logistics_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_logistics_live_test_result(
        char_name,
        request_id,
      );

      ready_block.logistics_live_test = {
        ...ready_block.logistics_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "logistics_live_test",
        request_id,
      });
      if (!sent) {
        const pending = logistics_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          logistics_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "LOGISTICS_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch logistics live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "LOGISTICS_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Logistics live test returned no result",
          500,
        );
      }

      const board = refresh_merchant_logistics("LOGISTICS_LIVE_TEST_EVIDENCE");
      const planner = merchant_logistics_planner.diagnostics();
      const account_blocks = Object.values(character_manage).filter(
        (block) => block?.account_owned === true,
      );
      const merchant_count = account_blocks.filter(
        (block) =>
          (block.account_character_type || block.live_state?.ctype) ===
          "merchant",
      ).length;
      const farmer_count = account_blocks.filter(
        (block) =>
          (block.account_character_type || block.live_state?.ctype) !==
          "merchant",
      ).length;
      const execution = logistics_live_execution_summary(board);
      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = logisticsLiveTestEvidence(events, {
        board,
        planner,
        account: {
          merchantCount: merchant_count,
          farmerCount: farmer_count,
        },
        execution,
        dispatcherSuppressedDuringTest: logistics_live_test_active,
      });
      const combined = combineLogisticsLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_logistics_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = logisticsLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        board,
        planner,
        incidentId: incident_id,
      });

      ready_block.logistics_live_test = {
        ...combined,
        request_id,
        status: "COMPLETED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
        board_summary: board.summary,
        execution,
        cleanup: {
          ...(combined.cleanup || {}),
          runtimeStateRestored: false,
          dispatcherRestored: false,
        },
      };
      emit_supervisor_event("LOGISTICS_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "LOGISTICS_LIVE_TEST_TIMEOUT" ||
          error.code === "LOGISTICS_LIVE_TEST_RUNTIME_TIMEOUT" ||
          error.code === "LOGISTICS_LIVE_TEST_EXECUTION_BUSY"
            ? "TIMEOUT"
            : "FAIL",
        reason: error.code || error.message || "LOGISTICS_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
        scope: {
          readOnly: true,
          valueMutationForced: false,
          sendItemForced: false,
          sendGoldForced: false,
          mluckForced: false,
          mutationScope: "not forced",
        },
      };
      const board = refresh_merchant_logistics(
        "LOGISTICS_LIVE_TEST_FAILURE_EVIDENCE",
      );
      const planner = merchant_logistics_planner.diagnostics();
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = logisticsLiveTestEvidence(failure_events, {
        board,
        planner,
        account: {
          merchantCount: Object.values(character_manage).filter(
            (block) =>
              block?.account_owned === true &&
              (block.account_character_type || block.live_state?.ctype) ===
                "merchant",
          ).length,
          farmerCount: Object.values(character_manage).filter(
            (block) =>
              block?.account_owned === true &&
              (block.account_character_type || block.live_state?.ctype) !==
                "merchant",
          ).length,
        },
        execution: logistics_live_execution_summary(board),
        dispatcherSuppressedDuringTest: logistics_live_test_active,
      });
      const incident_id = capture_logistics_live_test_incident(
        char_name,
        failed_result,
      );
      char_block.logistics_live_test = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: logisticsLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          board,
          planner,
          incidentId: incident_id,
        }),
        cleanup: {
          runtimeStateRestored: false,
          dispatcherRestored: false,
        },
      };
      emit_supervisor_event(
        "LOGISTICS_LIVE_TEST_FAILED",
        char_name,
        char_block.logistics_live_test,
      );
    } finally {
      const pending = logistics_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        logistics_live_test_requests.delete(request_id);
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
        runtime_state_restored = true;
      } catch (restore_error) {
        emit_supervisor_event(
          "LOGISTICS_LIVE_TEST_STATE_RESTORE_FAILED",
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

      logistics_live_test_active = false;
      schedule_merchant_logistics_dispatch();

      const final_block = character_manage[char_name];
      if (final_block?.logistics_live_test) {
        final_block.logistics_live_test.cleanup = {
          ...(final_block.logistics_live_test.cleanup || {}),
          runtimeStateRestored: runtime_state_restored,
          dispatcherRestored: true,
        };
        if (
          !runtime_state_restored &&
          final_block.logistics_live_test.outcome === "PASS"
        ) {
          final_block.logistics_live_test.outcome = "FAIL";
          final_block.logistics_live_test.reason =
            "LOGISTICS_LIVE_E2E_STATE_RESTORE_FAILED";
          final_block.logistics_live_test.status = "FAILED";
          const incident_id = capture_logistics_live_test_incident(
            char_name,
            final_block.logistics_live_test,
          );
          final_block.logistics_live_test.incident_id = incident_id;
          if (final_block.logistics_live_test.diagnostics) {
            final_block.logistics_live_test.diagnostics.incident_id =
              incident_id;
            final_block.logistics_live_test.diagnostics.result = {
              outcome: "FAIL",
              reason: "LOGISTICS_LIVE_E2E_STATE_RESTORE_FAILED",
            };
            final_block.logistics_live_test.diagnostics.cleanup =
              final_block.logistics_live_test.cleanup;
          }
        } else if (final_block.logistics_live_test.diagnostics) {
          final_block.logistics_live_test.diagnostics.cleanup =
            final_block.logistics_live_test.cleanup;
        }
      }
      dashboard?.publishSnapshot();
    }

    return character_manage[char_name]?.logistics_live_test;
  }

  async function run_fishing_live_test(char_name) {
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
      "merchant"
    ) {
      throw make_control_error(
        "FISHING_LIVE_TEST_MERCHANT_REQUIRED",
        "Fishing live test requires a merchant: " + char_name,
        400,
      );
    }
    if (char_block.account_owned !== true) {
      throw make_control_error(
        "FISHING_LIVE_TEST_ACCOUNT_MERCHANT_REQUIRED",
        "Fishing live test requires an account-owned merchant: " + char_name,
        400,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.fishing_live_test?.status) ||
      fishing_live_test_active
    ) {
      throw make_control_error(
        "FISHING_LIVE_TEST_ALREADY_RUNNING",
        "A Fishing live test is already running",
        409,
      );
    }

    for (const active of [
      ["MOVEMENT", char_block.movement_live_test],
      ["COMBAT", char_block.combat_live_test],
      ["CLASS_SKILL", char_block.class_skill_live_test],
      ["GROUP", char_block.group_live_test],
      ["FARM", char_block.farm_live_test],
      ["INVENTORY", char_block.inventory_live_test],
      ["LOGISTICS", char_block.logistics_live_test],
      ["MERCHANT", char_block.merchant_live_test],
      ["MERRIT", char_block.merrit_live_test],
    ]) {
      if (["STARTING", "RUNNING"].includes(active[1]?.status)) {
        throw make_control_error(
          active[0] + "_LIVE_TEST_ALREADY_RUNNING",
          active[0] + " live test already running for " + char_name,
          409,
        );
      }
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
      gold: Number.isFinite(char_block.live_state?.gold)
        ? char_block.live_state.gold
        : null,
      inventory_slots: Array.isArray(char_block.live_state?.items)
        ? char_block.live_state.items.filter(Boolean).length
        : null,
      mainhand: char_block.live_state?.slots?.mainhand || null,
    };
    const started_at = Date.now();
    fishing_live_test_sequence += 1;
    const request_id = `fishing-live-${started_at}-${fishing_live_test_sequence}`;

    char_block.fishing_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("FISHING_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;
    let runtime_state_restored = false;
    fishing_live_test_active = true;

    try {
      await wait_for_logistics_claim_idle();

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
            "FISHING_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Fishing runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "FISHING_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
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

      await wait_for_fishing_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_fishing_live_test_result(
        char_name,
        request_id,
      );

      ready_block.fishing_live_test = {
        ...ready_block.fishing_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "fishing_live_test",
        request_id,
      });
      if (!sent) {
        const pending = fishing_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          fishing_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "FISHING_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch Fishing live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "FISHING_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Fishing live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = fishingLiveTestEvidence(events, ready_block, {
        dispatcherSuppressedDuringTest: fishing_live_test_active,
      });
      const combined = combineFishingLiveTestResult(
        child_response.result,
        evidence,
      );
      const cooldown_blocked =
        combined.reason === "FISHING_LIVE_COOLDOWN_ACTIVE";
      const incident_id =
        combined.outcome === "PASS" || cooldown_blocked
          ? null
          : capture_fishing_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = fishingLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.fishing_live_test = {
        ...combined,
        request_id,
        status: combined.outcome === "PASS" ? "COMPLETED" : "FAILED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
        cleanup: {
          ...(combined.cleanup || {}),
          runtimeStateRestored: false,
          dispatcherRestored: false,
        },
      };
      emit_supervisor_event("FISHING_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "FISHING_LIVE_TEST_TIMEOUT" ||
          error.code === "FISHING_LIVE_TEST_RUNTIME_TIMEOUT"
            ? "TIMEOUT"
            : "FAIL",
        reason: error.code || error.message || "FISHING_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
        scope: {
          movementMutationAllowed: true,
          combatMutationAllowed: true,
          lootMutationAllowed: true,
          prerequisitePurchaseAllowed: true,
          craftMutationAllowed: true,
          equipmentMutationAllowed: true,
          fishingSkillMutationAllowed: true,
          blindRetryAllowed: false,
          standMutationAllowed: false,
          wishlistMutationAllowed: false,
          pontyPurchaseAllowed: false,
          giveawayMutationAllowed: false,
          miningMutationAllowed: false,
          mutationScope: "fishing-only",
        },
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = fishingLiveTestEvidence(
        failure_events,
        char_block,
        {
          dispatcherSuppressedDuringTest: fishing_live_test_active,
        },
      );
      const incident_id = capture_fishing_live_test_incident(
        char_name,
        failed_result,
      );
      char_block.fishing_live_test = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: fishingLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
        cleanup: {
          runtimeStateRestored: false,
          dispatcherRestored: false,
        },
      };
      emit_supervisor_event(
        "FISHING_LIVE_TEST_FAILED",
        char_name,
        char_block.fishing_live_test,
      );
    } finally {
      const pending = fishing_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        fishing_live_test_requests.delete(request_id);
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
        runtime_state_restored = true;
      } catch (restore_error) {
        emit_supervisor_event(
          "FISHING_LIVE_TEST_STATE_RESTORE_FAILED",
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

      fishing_live_test_active = false;
      schedule_merchant_logistics_dispatch();

      const final_block = character_manage[char_name];
      if (final_block?.fishing_live_test) {
        final_block.fishing_live_test.cleanup = {
          ...(final_block.fishing_live_test.cleanup || {}),
          runtimeStateRestored: runtime_state_restored,
          dispatcherRestored: true,
        };
        if (
          !runtime_state_restored &&
          final_block.fishing_live_test.outcome === "PASS"
        ) {
          final_block.fishing_live_test.outcome = "FAIL";
          final_block.fishing_live_test.reason =
            "FISHING_LIVE_E2E_STATE_RESTORE_FAILED";
          final_block.fishing_live_test.status = "FAILED";
          const incident_id = capture_fishing_live_test_incident(
            char_name,
            final_block.fishing_live_test,
          );
          final_block.fishing_live_test.incident_id = incident_id;
          if (final_block.fishing_live_test.diagnostics) {
            final_block.fishing_live_test.diagnostics.incident_id = incident_id;
            final_block.fishing_live_test.diagnostics.result = {
              outcome: "FAIL",
              reason: "FISHING_LIVE_E2E_STATE_RESTORE_FAILED",
            };
            final_block.fishing_live_test.diagnostics.cleanup =
              final_block.fishing_live_test.cleanup;
          }
        } else if (final_block.fishing_live_test.diagnostics) {
          final_block.fishing_live_test.diagnostics.cleanup =
            final_block.fishing_live_test.cleanup;
        }
      }
      dashboard?.publishSnapshot();
    }

    return character_manage[char_name]?.fishing_live_test;
  }

  async function run_merrit_live_test(char_name) {
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
      "merchant"
    ) {
      throw make_control_error(
        "MERRIT_LIVE_TEST_MERCHANT_REQUIRED",
        "Merrit live test requires a merchant: " + char_name,
        400,
      );
    }
    if (char_block.account_owned !== true) {
      throw make_control_error(
        "MERRIT_LIVE_TEST_ACCOUNT_MERCHANT_REQUIRED",
        "Merrit live test requires an account-owned merchant: " + char_name,
        400,
      );
    }
    if (["STARTING", "RUNNING"].includes(char_block.merrit_live_test?.status)) {
      throw make_control_error(
        "MERRIT_LIVE_TEST_ALREADY_RUNNING",
        "Merrit live test already running for " + char_name,
        409,
      );
    }

    for (const active of [
      ["MOVEMENT", char_block.movement_live_test],
      ["COMBAT", char_block.combat_live_test],
      ["CLASS_SKILL", char_block.class_skill_live_test],
      ["GROUP", char_block.group_live_test],
      ["FARM", char_block.farm_live_test],
      ["INVENTORY", char_block.inventory_live_test],
      ["LOGISTICS", char_block.logistics_live_test],
      ["MERCHANT", char_block.merchant_live_test],
    ]) {
      if (["STARTING", "RUNNING"].includes(active[1]?.status)) {
        throw make_control_error(
          active[0] + "_LIVE_TEST_ALREADY_RUNNING",
          active[0] + " live test already running for " + char_name,
          409,
        );
      }
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
      gold: Number.isFinite(char_block.live_state?.gold)
        ? char_block.live_state.gold
        : null,
      inventory_slots: Array.isArray(char_block.live_state?.items)
        ? char_block.live_state.items.filter(Boolean).length
        : null,
      persisted_cooldown: persistence.getCooldown("account", "merrit"),
    };
    const started_at = Date.now();
    merrit_live_test_sequence += 1;
    const request_id = `merrit-live-${started_at}-${merrit_live_test_sequence}`;

    char_block.merrit_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("MERRIT_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;
    let runtime_state_restored = false;

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
            "MERRIT_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Merrit runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "MERRIT_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
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

      await wait_for_merchant_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_merrit_live_test_result(
        char_name,
        request_id,
      );

      ready_block.merrit_live_test = {
        ...ready_block.merrit_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "merrit_live_test",
        request_id,
      });
      if (!sent) {
        const pending = merrit_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          merrit_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "MERRIT_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch Merrit live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "MERRIT_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Merrit live test returned no result",
          500,
        );
      }

      const runtime_result = child_response.result;
      const parcel_ready_at = Number(
        runtime_result.finalStatus?.parcel?.readyAt,
      );
      if (
        runtime_result.outcome === "PASS" &&
        Number.isFinite(parcel_ready_at) &&
        parcel_ready_at > 0
      ) {
        await persistence.saveCooldown("account", "merrit", {
          readyAt: parcel_ready_at,
          state: {
            character: char_name,
            receiptAt:
              Number(runtime_result.finalStatus?.parcel?.confirmedAt) || null,
            source: "merrit_live_test",
          },
        });
      }
      const persisted_cooldown = persistence.getCooldown("account", "merrit");

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = merritLiveTestEvidence(
        events,
        ready_block,
        persisted_cooldown,
      );
      const combined = combineMerritLiveTestResult(runtime_result, evidence);
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_merrit_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = merritLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        persistedCooldown: persisted_cooldown,
        incidentId: incident_id,
      });

      ready_block.merrit_live_test = {
        ...combined,
        request_id,
        status: combined.outcome === "PASS" ? "COMPLETED" : "FAILED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        persisted_cooldown,
        diagnostics,
        cleanup: {
          ...(combined.cleanup || {}),
          runtimeStateRestored: false,
        },
      };
      emit_supervisor_event("MERRIT_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
        persisted_cooldown,
      });
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "MERRIT_LIVE_TEST_TIMEOUT" ||
          error.code === "MERCHANT_LIVE_TEST_RUNTIME_TIMEOUT"
            ? "TIMEOUT"
            : "FAIL",
        reason: error.code || error.message || "MERRIT_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
        scope: {
          movementMutationAllowed: true,
          standMutationAllowed: true,
          listingMutationAllowed: true,
          prerequisitePurchaseAllowed: true,
          blindRetryAllowed: false,
          wishlistMutationAllowed: false,
          pontyPurchaseAllowed: false,
          giveawayMutationAllowed: false,
          gatheringMutationAllowed: false,
          equipmentMutationAllowed: false,
          mutationScope: "merrit-only",
        },
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const persisted_cooldown = persistence.getCooldown("account", "merrit");
      const failure_evidence = merritLiveTestEvidence(
        failure_events,
        char_block,
        persisted_cooldown,
      );
      const incident_id = capture_merrit_live_test_incident(
        char_name,
        failed_result,
      );
      char_block.merrit_live_test = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        persisted_cooldown,
        diagnostics: merritLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          persistedCooldown: persisted_cooldown,
          incidentId: incident_id,
        }),
        cleanup: {
          runtimeStateRestored: false,
        },
      };
      emit_supervisor_event(
        "MERRIT_LIVE_TEST_FAILED",
        char_name,
        char_block.merrit_live_test,
      );
    } finally {
      const pending = merrit_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        merrit_live_test_requests.delete(request_id);
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
        runtime_state_restored = true;
      } catch (restore_error) {
        emit_supervisor_event(
          "MERRIT_LIVE_TEST_STATE_RESTORE_FAILED",
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

      const final_block = character_manage[char_name];
      if (final_block?.merrit_live_test) {
        final_block.merrit_live_test.cleanup = {
          ...(final_block.merrit_live_test.cleanup || {}),
          runtimeStateRestored: runtime_state_restored,
        };
        if (
          !runtime_state_restored &&
          final_block.merrit_live_test.outcome === "PASS"
        ) {
          final_block.merrit_live_test.outcome = "FAIL";
          final_block.merrit_live_test.reason =
            "MERRIT_LIVE_E2E_STATE_RESTORE_FAILED";
          final_block.merrit_live_test.status = "FAILED";
          const incident_id = capture_merrit_live_test_incident(
            char_name,
            final_block.merrit_live_test,
          );
          final_block.merrit_live_test.incident_id = incident_id;
          if (final_block.merrit_live_test.diagnostics) {
            final_block.merrit_live_test.diagnostics.incident_id = incident_id;
            final_block.merrit_live_test.diagnostics.result = {
              outcome: "FAIL",
              reason: "MERRIT_LIVE_E2E_STATE_RESTORE_FAILED",
            };
            final_block.merrit_live_test.diagnostics.cleanup =
              final_block.merrit_live_test.cleanup;
          }
        } else if (final_block.merrit_live_test.diagnostics) {
          final_block.merrit_live_test.diagnostics.cleanup =
            final_block.merrit_live_test.cleanup;
        }
      }
      dashboard?.publishSnapshot();
    }

    return character_manage[char_name]?.merrit_live_test;
  }

  async function run_merchant_live_test(char_name) {
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
      "merchant"
    ) {
      throw make_control_error(
        "MERCHANT_LIVE_TEST_MERCHANT_REQUIRED",
        "Merchant Autonomy live test requires a merchant: " + char_name,
        400,
      );
    }
    if (char_block.account_owned !== true) {
      throw make_control_error(
        "MERCHANT_LIVE_TEST_ACCOUNT_MERCHANT_REQUIRED",
        "Merchant Autonomy live test requires an account-owned merchant: " +
          char_name,
        400,
      );
    }
    if (
      ["STARTING", "RUNNING"].includes(char_block.merchant_live_test?.status)
    ) {
      throw make_control_error(
        "MERCHANT_LIVE_TEST_ALREADY_RUNNING",
        "Merchant Autonomy live test already running for " + char_name,
        409,
      );
    }
    if (["STARTING", "RUNNING"].includes(char_block.merrit_live_test?.status)) {
      throw make_control_error(
        "MERRIT_LIVE_TEST_ALREADY_RUNNING",
        "Merrit live test already running for " + char_name,
        409,
      );
    }
    for (const active of [
      ["MOVEMENT", char_block.movement_live_test],
      ["COMBAT", char_block.combat_live_test],
      ["CLASS_SKILL", char_block.class_skill_live_test],
      ["GROUP", char_block.group_live_test],
      ["FARM", char_block.farm_live_test],
      ["INVENTORY", char_block.inventory_live_test],
      ["LOGISTICS", char_block.logistics_live_test],
    ]) {
      if (["STARTING", "RUNNING"].includes(active[1]?.status)) {
        throw make_control_error(
          active[0] + "_LIVE_TEST_ALREADY_RUNNING",
          active[0] + " live test already running for " + char_name,
          409,
        );
      }
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
      gold: Number.isFinite(char_block.live_state?.gold)
        ? char_block.live_state.gold
        : null,
      inventory_slots: Array.isArray(char_block.live_state?.items)
        ? char_block.live_state.items.filter(Boolean).length
        : null,
    };
    const started_at = Date.now();
    merchant_live_test_sequence += 1;
    const request_id = `merchant-live-${started_at}-${merchant_live_test_sequence}`;

    char_block.merchant_live_test = {
      request_id,
      status: "STARTING",
      outcome: null,
      reason: null,
      started_at,
      completed_at: null,
    };
    emit_supervisor_event("MERCHANT_LIVE_TEST_REQUESTED", char_name, {
      request_id,
      original_desired_state,
    });
    dashboard?.publishSnapshot();

    let runtime_override_applied = false;
    let runtime_state_restored = false;

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
            "MERCHANT_LIVE_TEST_RUNTIME_BUNDLE_MISSING",
            `Merchant runtime bundle is missing: ${bundle_path}`,
            503,
          );
        }

        char_block.movement_live_test_typescript_override =
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE;
        runtime_override_applied = true;
        emit_supervisor_event(
          "MERCHANT_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED",
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

      await wait_for_merchant_live_test_runtime(char_name);
      const ready_block = character_manage[char_name];
      const result_promise = wait_for_merchant_live_test_result(
        char_name,
        request_id,
      );

      ready_block.merchant_live_test = {
        ...ready_block.merchant_live_test,
        status: "RUNNING",
      };
      dashboard?.publishSnapshot();

      const sent = safe_send(ready_block.instance, {
        type: "merchant_live_test",
        request_id,
      });
      if (!sent) {
        const pending = merchant_live_test_requests.get(request_id);
        if (pending) {
          clearTimeout(pending.timer);
          merchant_live_test_requests.delete(request_id);
        }
        throw make_control_error(
          "MERCHANT_LIVE_TEST_DISPATCH_FAILED",
          `Could not dispatch Merchant Autonomy live test to ${char_name}`,
          503,
        );
      }

      const child_response = await result_promise;
      if (child_response.error || !child_response.result) {
        throw make_control_error(
          "MERCHANT_LIVE_TEST_RUNTIME_FAILED",
          child_response.error || "Merchant live test returned no result",
          500,
        );
      }

      const events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const evidence = merchantLiveTestEvidence(events, ready_block);
      const combined = combineMerchantLiveTestResult(
        child_response.result,
        evidence,
      );
      const incident_id =
        combined.outcome === "PASS"
          ? null
          : capture_merchant_live_test_incident(char_name, {
              ...combined,
              request_id,
            });
      const diagnostics = merchantLiveTestDiagnostics(combined, {
        character: char_name,
        originalDesiredState: original_desired_state,
        startState: start_state,
        evidence,
        incidentId: incident_id,
      });

      ready_block.merchant_live_test = {
        ...combined,
        request_id,
        status: combined.outcome === "PASS" ? "COMPLETED" : "FAILED",
        started_at,
        completed_at: Date.now(),
        incident_id,
        diagnostics,
        cleanup: {
          ...(combined.cleanup || {}),
          runtimeStateRestored: false,
        },
      };
      emit_supervisor_event("MERCHANT_LIVE_TEST_COMPLETED", char_name, {
        request_id,
        outcome: combined.outcome,
        reason: combined.reason,
        incident_id,
        supervisor: evidence,
      });
    } catch (error) {
      const failed_result = {
        request_id,
        outcome:
          error.code === "MERCHANT_LIVE_TEST_TIMEOUT" ||
          error.code === "MERCHANT_LIVE_TEST_RUNTIME_TIMEOUT"
            ? "TIMEOUT"
            : "FAIL",
        reason: error.code || error.message || "MERCHANT_LIVE_TEST_FAILED",
        error: error.message || String(error),
        started_at,
        completed_at: Date.now(),
        durationMs: Date.now() - started_at,
        scope: {
          readOnly: true,
          movementMutationForced: false,
          valueMutationForced: false,
          standMutationForced: false,
          wishlistMutationForced: false,
          pontyPurchaseForced: false,
          giveawayJoinForced: false,
          gatheringSkillForced: false,
          equipmentMutationForced: false,
          mutationScope: "not forced",
        },
      };
      const failure_events = diagnostic_store.getEvents({
        character: char_name,
        since: started_at,
      });
      const failure_evidence = merchantLiveTestEvidence(
        failure_events,
        char_block,
      );
      const incident_id = capture_merchant_live_test_incident(
        char_name,
        failed_result,
      );
      char_block.merchant_live_test = {
        ...failed_result,
        status: "FAILED",
        incident_id,
        diagnostics: merchantLiveTestDiagnostics(failed_result, {
          character: char_name,
          originalDesiredState: original_desired_state,
          startState: start_state,
          evidence: failure_evidence,
          incidentId: incident_id,
        }),
        cleanup: {
          runtimeStateRestored: false,
        },
      };
      emit_supervisor_event(
        "MERCHANT_LIVE_TEST_FAILED",
        char_name,
        char_block.merchant_live_test,
      );
    } finally {
      const pending = merchant_live_test_requests.get(request_id);
      if (pending) {
        clearTimeout(pending.timer);
        merchant_live_test_requests.delete(request_id);
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
        runtime_state_restored = true;
      } catch (restore_error) {
        emit_supervisor_event(
          "MERCHANT_LIVE_TEST_STATE_RESTORE_FAILED",
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

      const final_block = character_manage[char_name];
      if (final_block?.merchant_live_test) {
        final_block.merchant_live_test.cleanup = {
          ...(final_block.merchant_live_test.cleanup || {}),
          runtimeStateRestored: runtime_state_restored,
        };
        if (
          !runtime_state_restored &&
          final_block.merchant_live_test.outcome === "PASS"
        ) {
          final_block.merchant_live_test.outcome = "FAIL";
          final_block.merchant_live_test.reason =
            "MERCHANT_LIVE_E2E_STATE_RESTORE_FAILED";
          final_block.merchant_live_test.status = "FAILED";
          const incident_id = capture_merchant_live_test_incident(
            char_name,
            final_block.merchant_live_test,
          );
          final_block.merchant_live_test.incident_id = incident_id;
          if (final_block.merchant_live_test.diagnostics) {
            final_block.merchant_live_test.diagnostics.incident_id =
              incident_id;
            final_block.merchant_live_test.diagnostics.result = {
              outcome: "FAIL",
              reason: "MERCHANT_LIVE_E2E_STATE_RESTORE_FAILED",
            };
            final_block.merchant_live_test.diagnostics.cleanup =
              final_block.merchant_live_test.cleanup;
          }
        } else if (final_block.merchant_live_test.diagnostics) {
          final_block.merchant_live_test.diagnostics.cleanup =
            final_block.merchant_live_test.cleanup;
        }
      }
      dashboard?.publishSnapshot();
    }

    return character_manage[char_name]?.merchant_live_test;
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
        persist_character_runtime_state(char_name, "manual_start");

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
        persist_character_runtime_state(char_name, "manual_pause");
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
        if (char_block.rotation_source) {
          const rotation_source = char_block.rotation_source;
          const source = character_manage[rotation_source];
          if (source?.rotation_replacement === char_name) {
            source.rotation_replacement = null;
          }
          char_block.rotation_source = null;
          emit_supervisor_event("CHARACTER_ROTATION_CANCELLED", char_name, {
            why: "ROTATION_TARGET_STOPPED",
            stop_character: rotation_source,
            start_character: char_name,
            reason: "TARGET_STOPPED",
          });
        }
        clear_restart_timer(char_block);
        clear_stable_timer(char_block);
        persist_character_runtime_state(char_name, "manual_stop");
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

      case CONTROL_ACTIONS.RESTART:
        if (!canRestartCharacter(char_block)) {
          throw make_control_error(
            "CHARACTER_NOT_RESTARTABLE",
            "Only an active RUNNING or PAUSED character can be restarted",
            409,
          );
        }

        clear_restart_timer(char_block);
        clear_stable_timer(char_block);
        char_block.restart_attempts = 0;
        char_block.controlled_restart = true;
        emit_supervisor_event("CHARACTER_CONTROL_REQUESTED", char_name, {
          action,
          desired_runtime_state: char_block.desired_runtime_state,
        });
        persist_character_runtime_state(char_name, "manual_restart");
        await softkill_block(char_block);
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
    void observe_persistence(
      persistence.saveCharacterProfile(
        char_name,
        buildCharacterProfile(char_name, char_block, char),
      ),
      "character_profile_resolved",
      char_name,
    );
    const g_version = char_block.version || version;
    console.log(
      `starting ${char_name} running version ${g_version} in ${char_block.realm}`,
    );
    const realm_connection = normalizeRealmConnection(realm);
    if (!realm_connection.address) {
      console.error(
        `could not resolve connection address for realm ${char_block.realm}`,
      );
      set_lifecycle_state(
        char_name,
        LIFECYCLE_STATES.ERROR,
        "realm_connection_missing",
      );
      return null;
    }

    const execution_source = resolveCharacterExecutionSource(
      char_block,
      !!cfg.enable_TYPECODE,
    );
    const args = {
      version: g_version,
      realm_address: realm_connection.address,
      realm_path: realm_connection.path,
      realm_addr: realm_connection.legacyAddr,
      realm_port: realm_connection.legacyPort,
      sess: sess,
      cid: char.id,
      script_file: execution_source.scriptFile,
      enable_map: !!(cfg.web_app && cfg.web_app.enable_minimap),
      cname: char_name,
      clid: ctype_to_clid[char.type] || -1,
      heartbeat_interval_ms: lifecycle_policy.heartbeatIntervalMs,
      runtime_state: char_block.desired_runtime_state,
      emergency_stop: emergency_stop.snapshot(),
    };
    if (execution_source.typescriptFile) {
      args.typescript_file = execution_source.typescriptFile;
    }

    const result = child_process.fork("./src/CharacterThread.js", [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    capture_character_stream(result.stdout, char_name, "stdout");
    capture_character_stream(result.stderr, char_name, "stderr");
    result.stdout.pipe(process.stdout);
    result.stderr.pipe(process.stderr);
    char_block.instance = result;
    char_block.bot_runtime_started_at = null;
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
      clear_config_push_timer(char_block);
      char_block.config_push_status = "STORED";
      char_block.applied_runtime_config_revision = null;
      char_block.connected = false;
      char_block.bot_runtime_started_at = null;
      char_block.watchdog_recovery_in_progress = false;
      reject_movement_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_MOVEMENT_LIVE_TEST",
      );
      reject_combat_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_COMBAT_LIVE_TEST",
      );
      reject_class_skill_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_CLASS_SKILL_LIVE_TEST",
      );
      reject_group_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_GROUP_LIVE_TEST",
      );
      reject_farm_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_FARM_LIVE_TEST",
      );
      reject_inventory_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_INVENTORY_LIVE_TEST",
      );
      reject_logistics_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_LOGISTICS_LIVE_TEST",
      );
      reject_merchant_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_MERCHANT_LIVE_TEST",
      );
      reject_merrit_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_MERRIT_LIVE_TEST",
      );
      reject_fishing_live_tests_for_character(
        char_name,
        "CHARACTER_PROCESS_EXITED_DURING_FISHING_LIVE_TEST",
      );
      emit_supervisor_event("CHARACTER_PROCESS_EXITED", char_name, {
        code,
        signal,
        pid: result.pid || null,
      });
      if (char_block.instance === result) {
        char_block.instance = null;
      }

      const rotation_replacement = char_block.rotation_replacement;
      char_block.rotation_replacement = null;
      const controlled_restart = char_block.controlled_restart;
      char_block.controlled_restart = false;

      if (rotation_replacement && !coordinator_shutting_down) {
        char_block.restart_attempts = 0;
        set_lifecycle_state(
          char_name,
          LIFECYCLE_STATES.STOPPED,
          "rotation_slot_released",
        );
        emit_supervisor_event("CHARACTER_ROTATION_SLOT_RELEASED", char_name, {
          why: "ROTATION_SOURCE_EXITED",
          start_character: rotation_replacement,
        });
        dashboard?.publishSnapshot();

        setTimeout(() => {
          const target = character_manage[rotation_replacement];
          if (
            !target ||
            !target.enabled ||
            target.desired_runtime_state !== DESIRED_RUNTIME_STATES.RUNNING
          ) {
            return;
          }

          const started = start_char(rotation_replacement);
          if (started) {
            emit_supervisor_event(
              "CHARACTER_ROTATION_TARGET_STARTING",
              rotation_replacement,
              {
                why: "ROTATION_SLOT_AVAILABLE",
                stop_character: char_name,
              },
            );
          } else if (target.enabled) {
            schedule_restart(rotation_replacement, "rotation_slot_unavailable");
          }
        }, lifecycle_policy.startupStaggerMs);
        return;
      }

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
        emit_supervisor_event("UNEXPECTED_CHARACTER_EXIT", char_name, {
          code,
          signal,
          pid: result.pid || null,
        });
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
    result.on("message", (raw_message) => {
      const ipc = normalizeIpcMessage(raw_message);
      if (!ipc.ok) {
        emit_supervisor_event("IPC_MESSAGE_REJECTED", char_name, {
          reason: ipc.code,
          protocol_version: ipc.protocol_version,
          message_type: raw_message?.type || null,
          supported_protocol_version: IPC_PROTOCOL_VERSION,
        });
        return;
      }

      const m = ipc.message;
      switch (m.type) {
        case "process_ready":
          set_lifecycle_state(
            char_name,
            LIFECYCLE_STATES.CONNECTING,
            "process_ready",
          );
          refresh_character_revision(char_block);
          char_block.running_code_revision = char_block.installed_code_revision;
          char_block.running_config_revision =
            char_block.installed_config_revision;
          char_block.revision_status = revisionStatus({
            runningCodeRevision: char_block.running_code_revision,
            installedCodeRevision: char_block.installed_code_revision,
            runningConfigRevision: char_block.running_config_revision,
            installedConfigRevision: char_block.installed_config_revision,
          });
          args.code_revision = char_block.running_code_revision;
          args.config_revision = char_block.running_config_revision;
          args.source_revision = source_revision;
          args.character_config = char_block.runtime_config;
          args.character_config_revision = char_block.runtime_config_revision;
          char_block.applied_runtime_config_revision = null;
          char_block.config_push_status = "PENDING";
          char_block.config_push_error = null;
          arm_config_push_timeout(
            char_name,
            char_block.runtime_config_revision,
          );
          persist_character_runtime_state(char_name, "process_ready");
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
        case "runtime_event":
          emit_runtime_event(char_name, m.event);
          break;
        case "logistics_claim_result": {
          const pending = logistics_claim_requests.get(m.request_id);
          if (
            !pending ||
            pending.source !== char_name ||
            pending.claim?.id !== m.claim_id
          ) {
            emit_supervisor_event("LOGISTICS_CLAIM_RESULT_IGNORED", char_name, {
              why: "UNKNOWN_OR_STALE_REQUEST",
              request_id: m.request_id || null,
              claim_id: m.claim_id || null,
            });
            break;
          }

          clearTimeout(pending.timer);
          logistics_claim_requests.delete(m.request_id);
          const fallback_result = {
            claimId: pending.claim.id,
            type: pending.claim.type,
            source: pending.source,
            target: pending.target,
            outcome: "UNKNOWN",
            reason: m.error || "LOGISTICS_CLAIM_RUNTIME_ERROR",
            actionId: null,
            itemName: pending.claim.itemName || null,
            requestedQuantity: pending.claim.quantity || null,
            executedQuantity: null,
            amount: pending.claim.amount || null,
            fulfilled: false,
          };
          const execution_result =
            m.result && typeof m.result === "object"
              ? m.result
              : fallback_result;

          merchant_logistics_planner.recordClaimOutcome(
            pending.claim,
            execution_result,
          );
          emit_supervisor_event("LOGISTICS_CLAIM_RESULT_RECEIVED", char_name, {
            request_id: m.request_id,
            claim_id: pending.claim.id,
            claim_type: pending.claim.type,
            outcome: execution_result.outcome || "UNKNOWN",
            reason: execution_result.reason || null,
            fulfilled: execution_result.fulfilled === true,
            error: m.error || null,
          });
          refresh_merchant_logistics("LOGISTICS_CLAIM_RESULT");
          break;
        }
        case "movement_live_test_result": {
          const pending = movement_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "MOVEMENT_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          movement_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event(
            "MOVEMENT_LIVE_TEST_RESULT_RECEIVED",
            char_name,
            {
              request_id: m.request_id,
              outcome: m.result?.outcome || null,
              error: m.error || null,
            },
          );
          break;
        }
        case "combat_live_test_result": {
          const pending = combat_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "COMBAT_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          combat_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event("COMBAT_LIVE_TEST_RESULT_RECEIVED", char_name, {
            request_id: m.request_id,
            outcome: m.result?.outcome || null,
            error: m.error || null,
          });
          break;
        }
        case "class_skill_live_test_result": {
          const pending = class_skill_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "CLASS_SKILL_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          class_skill_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event(
            "CLASS_SKILL_LIVE_TEST_RESULT_RECEIVED",
            char_name,
            {
              request_id: m.request_id,
              outcome: m.result?.outcome || null,
              error: m.error || null,
            },
          );
          break;
        }
        case "logistics_live_test_result": {
          const pending = logistics_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "LOGISTICS_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          logistics_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event(
            "LOGISTICS_LIVE_TEST_RESULT_RECEIVED",
            char_name,
            {
              request_id: m.request_id,
              outcome: m.result?.outcome || null,
              error: m.error || null,
            },
          );
          break;
        }
        case "fishing_live_test_result": {
          const pending = fishing_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "FISHING_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          fishing_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event(
            "FISHING_LIVE_TEST_RESULT_RECEIVED",
            char_name,
            {
              request_id: m.request_id,
              outcome: m.result?.outcome || null,
              error: m.error || null,
            },
          );
          break;
        }
        case "merrit_live_test_result": {
          const pending = merrit_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "MERRIT_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          merrit_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event("MERRIT_LIVE_TEST_RESULT_RECEIVED", char_name, {
            request_id: m.request_id,
            outcome: m.result?.outcome || null,
            error: m.error || null,
          });
          break;
        }
        case "merchant_live_test_result": {
          const pending = merchant_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "MERCHANT_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          merchant_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event(
            "MERCHANT_LIVE_TEST_RESULT_RECEIVED",
            char_name,
            {
              request_id: m.request_id,
              outcome: m.result?.outcome || null,
              error: m.error || null,
            },
          );
          break;
        }
        case "inventory_live_test_result": {
          const pending = inventory_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event(
              "INVENTORY_LIVE_TEST_RESULT_IGNORED",
              char_name,
              {
                why: "UNKNOWN_OR_STALE_REQUEST",
                request_id: m.request_id || null,
              },
            );
            break;
          }

          clearTimeout(pending.timer);
          inventory_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event(
            "INVENTORY_LIVE_TEST_RESULT_RECEIVED",
            char_name,
            {
              request_id: m.request_id,
              outcome: m.result?.outcome || null,
              error: m.error || null,
            },
          );
          break;
        }
        case "farm_live_test_result": {
          const pending = farm_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event("FARM_LIVE_TEST_RESULT_IGNORED", char_name, {
              why: "UNKNOWN_OR_STALE_REQUEST",
              request_id: m.request_id || null,
            });
            break;
          }

          clearTimeout(pending.timer);
          farm_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event("FARM_LIVE_TEST_RESULT_RECEIVED", char_name, {
            request_id: m.request_id,
            outcome: m.result?.outcome || null,
            error: m.error || null,
          });
          break;
        }
        case "group_live_test_result": {
          const pending = group_live_test_requests.get(m.request_id);
          if (!pending || pending.character !== char_name) {
            emit_supervisor_event("GROUP_LIVE_TEST_RESULT_IGNORED", char_name, {
              why: "UNKNOWN_OR_STALE_REQUEST",
              request_id: m.request_id || null,
            });
            break;
          }

          clearTimeout(pending.timer);
          group_live_test_requests.delete(m.request_id);
          pending.resolve({
            result: m.result || null,
            error: m.error || null,
          });
          emit_supervisor_event("GROUP_LIVE_TEST_RESULT_RECEIVED", char_name, {
            request_id: m.request_id,
            outcome: m.result?.outcome || null,
            error: m.error || null,
          });
          break;
        }
        case "config_applied": {
          const applied_revision = Number(m.revision);
          if (
            Number.isInteger(applied_revision) &&
            applied_revision === char_block.runtime_config_revision
          ) {
            clear_config_push_timer(char_block);
            char_block.applied_runtime_config_revision = applied_revision;
            char_block.config_push_status = "APPLIED";
            char_block.config_push_error = null;
            emit_supervisor_event("CHARACTER_CONFIG_APPLIED", char_name, {
              why:
                m.source === "process_args"
                  ? "PROCESS_START_CONFIG"
                  : "LIVE_CONFIG_PUSH",
              revision: applied_revision,
              changed: m.changed !== false,
            });
            dashboard?.publishSnapshot();
          } else {
            emit_supervisor_event("CHARACTER_CONFIG_ACK_IGNORED", char_name, {
              why: "STALE_OR_INVALID_CONFIG_ACK",
              revision: Number.isFinite(applied_revision)
                ? applied_revision
                : null,
              expected_revision: char_block.runtime_config_revision,
            });
          }
          break;
        }
        case "config_rejected":
          if (Number(m.revision) === char_block.runtime_config_revision) {
            clear_config_push_timer(char_block);
            char_block.config_push_status = "REJECTED";
            char_block.config_push_error = m.reason || "CONFIG_REJECTED";
          }
          emit_supervisor_event("CHARACTER_CONFIG_REJECTED", char_name, {
            why: m.reason || "CONFIG_REJECTED",
            revision: Number.isFinite(Number(m.revision))
              ? Number(m.revision)
              : null,
          });
          dashboard?.publishSnapshot();
          break;
        case "emergency_stop_applied":
          emit_supervisor_event("EMERGENCY_STOP_APPLIED", char_name, {
            active: !!m.state?.active,
            reason: m.state?.reason || null,
            revision: m.state?.revision || 0,
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
          if (m.map_scene?.map) {
            dashboard_map_scenes.set(m.map_scene.map, m.map_scene);
            delete m.map_scene;
          }
          updateCharacterLiveState(char_block, m);
          maybe_persist_character_snapshot(char_name, char_block, m);
          refresh_merchant_logistics("STAT_BEAT");
          dashboard?.publishSnapshot();
          break;

        case "connected":
          char_block.connected = true;
          char_block.last_heartbeat_at = Date.now();
          char_block.watchdog_recovery_in_progress = false;
          set_lifecycle_state(char_name, LIFECYCLE_STATES.ONLINE, "connected");
          if (
            char_block.applied_runtime_config_revision !==
            char_block.runtime_config_revision
          ) {
            char_block.config_push_status = "PENDING";
            char_block.config_push_error = null;
            safe_send(result, {
              type: "config_push",
              revision: char_block.runtime_config_revision,
              config: char_block.runtime_config,
            });
            arm_config_push_timeout(
              char_name,
              char_block.runtime_config_revision,
            );
            emit_supervisor_event(
              "CHARACTER_CONFIG_PUSH_REQUESTED",
              char_name,
              {
                why: "SYNC_CONFIG_AFTER_CONNECT",
                revision: char_block.runtime_config_revision,
              },
            );
          }
          safe_send(result, {
            type: "runtime_control",
            state: char_block.desired_runtime_state,
          });
          safe_send(result, {
            type: "emergency_stop",
            state: emergency_stop.snapshot(),
          });
          emit_supervisor_event("CHARACTER_CONNECTED", char_name, {
            pid: result.pid || null,
          });
          if (char_block.rotation_source) {
            const rotation_source = char_block.rotation_source;
            char_block.rotation_source = null;
            emit_supervisor_event("CHARACTER_ROTATION_COMPLETED", char_name, {
              why: "ROTATION_TARGET_CONNECTED",
              stop_character: rotation_source,
              start_character: char_name,
            });
            dashboard?.publishSnapshot();
          }
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
    Object.values(character_manage).forEach(refresh_character_revision);
    dashboard?.publishSnapshot();

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
          clear_restart_timer(char_block);
          clear_stable_timer(char_block);
          return softkill_block(char_block);
        }),
      );
      await Promise.allSettled([
        structured_logger.flush(),
        incident_recorder.flush(),
      ]);
      await persistence.close();
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
    registered_character_count: Object.keys(character_manage).length,
    account_character_count: account_characters.length,
    registered_characters: Object.keys(character_manage).sort(),
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

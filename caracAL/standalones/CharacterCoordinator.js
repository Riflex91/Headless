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
  buildAccountGearReservationPlan,
  reservationProjectionForCharacter,
  reservedSlotsForCharacter,
} = require("../src/AccountGearReservation");
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
const BANK_TRAVEL_LIVE_TEST_RESULT_TIMEOUT_MS = 240000;
const BANK_GOLD_LIVE_TEST_RESULT_TIMEOUT_MS = 240000;
const UPGRADE_LIVE_TEST_RESULT_TIMEOUT_MS = 120000;
const NPC_TRADING_LIVE_TEST_RESULT_TIMEOUT_MS = 240000;
const MARKET_TRADING_LIVE_TEST_RESULT_TIMEOUT_MS = 240000;
const FISHING_LIVE_TEST_RESULT_TIMEOUT_MS = 20 * 60 * 1000;
const MATERIAL_GATHER_TASK_RESULT_TIMEOUT_MS = 6 * 60 * 1000;
const COMPOUND_GATHER_PLAN_TIMEOUT_MS = 30000;
const DEFAULT_FISHING_MATERIAL_WORKERS = Object.freeze([
  "My_Ranger1",
  "My_Ranger2",
  "My_Ranger3",
]);
const DEFAULT_COMPOUND_MATERIAL_WORKERS = Object.freeze([
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
  let account_gear_reservation_plan =
    buildAccountGearReservationPlan(character_manage);
  let account_gear_reservation_signature = null;
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
  let gear_scoring_live_test_sequence = 0;
  let account_gear_reservation_live_test_sequence = 0;
  let account_gear_reservation_live_test_active = false;
  const logistics_live_test_requests = new Map();
  let logistics_live_test_sequence = 0;
  let logistics_live_test_active = false;
  const merchant_live_test_requests = new Map();
  let merchant_live_test_sequence = 0;
  const bank_travel_live_test_requests = new Map();
  let bank_travel_live_test_sequence = 0;
  let bank_travel_live_test_active = false;
  const bank_gold_live_test_requests = new Map();
  let bank_gold_live_test_sequence = 0;
  let bank_gold_live_test_active = false;
  const upgrade_live_test_requests = new Map();
  let upgrade_live_test_sequence = 0;
  let upgrade_live_test_active = false;
  const upgrade_live_preflight_requests = new Map();
  let upgrade_live_preflight_sequence = 0;
  let upgrade_live_preflight_active = false;
  const npc_trading_live_test_requests = new Map();
  let npc_trading_live_test_sequence = 0;
  let npc_trading_live_test_active = false;
  const market_trading_live_test_requests = new Map();
  let market_trading_live_test_sequence = 0;
  let market_trading_live_test_active = false;
  const merrit_live_test_requests = new Map();
  let merrit_live_test_sequence = 0;
  const fishing_live_test_requests = new Map();
  let fishing_live_test_sequence = 0;
  let fishing_live_test_active = false;
  const material_gather_task_requests = new Map();
  let material_gather_task_sequence = 0;
  const compound_gather_plan_requests = new Map();
  let compound_material_preparation_active = false;
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
        runGearScoringLiveTest: run_gear_scoring_live_test,
        runAccountGearReservationLiveTest:
          run_account_gear_reservation_live_test,
        runLogisticsLiveTest: run_logistics_live_test,
        runMerchantLiveTest: run_merchant_live_test,
        runBankTravelLiveTest: run_bank_travel_live_test,
        runBankGoldLiveTest: run_bank_gold_live_test,
        runUpgradeLiveTest: run_upgrade_live_test,
        runUpgradeLivePreflight: run_upgrade_live_preflight,
        runCompoundMaterialPreparation: run_compound_material_preparation,
        runNpcTradingLiveTest: run_npc_trading_live_test,
        runMarketTradingLiveTest: run_market_trading_live_test,
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
      bank_travel_live_test_active ||
      bank_gold_live_test_active ||
      upgrade_live_test_active ||
      upgrade_live_preflight_active ||
      compound_material_preparation_active ||
      npc_trading_live_test_active ||
      market_trading_live_test_active ||
      account_gear_reservation_live_test_active ||
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

  function refresh_account_gear_reservations(reason = "STATE_CHANGED") {
    const plan = buildAccountGearReservationPlan(character_manage);
    const comparable = {
      sameClassOnly: plan.sameClassOnly,
      reservations: plan.reservations,
      summary: plan.summary,
    };
    const signature = JSON.stringify(comparable);
    const changed = signature !== account_gear_reservation_signature;
    account_gear_reservation_signature = signature;
    account_gear_reservation_plan = plan;

    for (const [char_name, char_block] of Object.entries(character_manage)) {
      if (char_block?.account_owned !== true) continue;

      char_block.account_gear_reservation_runtime =
        reservationProjectionForCharacter(plan, char_name);

      if (
        char_block.instance &&
        char_block.connected &&
        Number.isFinite(char_block.bot_runtime_started_at)
      ) {
        safe_send(char_block.instance, {
          type: "account_gear_reservations",
          slots: reservedSlotsForCharacter(plan, char_name),
        });
      }
    }

    if (changed) {
      emit_supervisor_event("ACCOUNT_GEAR_RESERVATION_UPDATED", null, {
        why: reason,
        summary: plan.summary,
      });
      dashboard?.publishSnapshot();
    }

    return plan;
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
      normalized.data?.gearScoring &&
      typeof normalized.data.gearScoring === "object"
    ) {
      char_block.gear_scoring_runtime = normalized.data.gearScoring;
      refresh_account_gear_reservations("GEAR_SCORING_UPDATED");
    }

    if (
      char_block &&
      normalized.data?.futureGear &&
      typeof normalized.data.futureGear === "object"
    ) {
      char_block.future_gear_runtime = normalized.data.futureGear;
      refresh_account_gear_reservations("FUTURE_GEAR_UPDATED");
    }

    if (
      char_block &&
      normalized.data?.upgrade &&
      typeof normalized.data.upgrade === "object"
    ) {
      char_block.upgrade_runtime = normalized.data.upgrade;
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
      char_block &&
      normalized.module === "MerchantFishingController" &&
      normalized.type === "FISHING_MATERIAL_REQUESTED"
    ) {
      void coordinate_fishing_material_request(char_name, {
        itemName: normalized.data?.itemName,
        quantity: normalized.data?.quantity,
        recipient: normalized.data?.recipient,
        purpose: normalized.data?.purpose,
        recipientPosition: normalized.data?.merchantFishing?.character,
      });
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
    char_block.fishing_material_request =
      char_block.fishing_material_request || null;
    char_block.inventory_intelligence_runtime =
      char_block.inventory_intelligence_runtime || null;
    char_block.gear_scoring_runtime = char_block.gear_scoring_runtime || null;
    char_block.future_gear_runtime = char_block.future_gear_runtime || null;
    char_block.upgrade_runtime = char_block.upgrade_runtime || null;
    char_block.account_gear_reservation_runtime =
      char_block.account_gear_reservation_runtime || null;
    char_block.gear_scoring_live_test =
      char_block.gear_scoring_live_test || null;
    char_block.account_gear_reservation_live_test =
      char_block.account_gear_reservation_live_test || null;
    char_block.upgrade_live_test = char_block.upgrade_live_test || null;
    char_block.upgrade_live_preflight =
      char_block.upgrade_live_preflight || null;
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
    refresh_account_gear_reservations("CHARACTER_INITIALIZED");
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
      pending.reject(new Error(
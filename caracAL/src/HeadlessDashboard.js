"use strict";

const path = require("node:path");
const { normalizeControlAction } = require("./CharacterControl");
const { IPC_PROTOCOL_VERSION } = require("./IpcProtocol");
const {
  formatAccountDiagnostic,
  formatCharacterDiagnostic,
} = require("./DiagnosticStore");

function publicLiveState(liveState) {
  if (!liveState) return null;

  const result = {};
  [
    "timestamp",
    "name",
    "ctype",
    "map",
    "x",
    "y",
    "heading",
    "direction",
    "moving",
    "going_x",
    "going_y",
    "movement_destination",
    "movement_state",
    "movement_mode",
    "movement_owner",
    "movement_reason",
    "movement_command",
    "movement_stuck",
    "runtime_planned_path",
    "runtime_planned_destination",
    "safe_point",
    "planned_path",
    "planned_destination",
    "rip",
    "hp",
    "max_hp",
    "mp",
    "max_mp",
    "level",
    "xp",
    "max_xp",
    "gold",
    "party",
    "isize",
    "esize",
    "t_mtype",
    "t_name",
    "target",
    "nearby_entities",
    "current_status",
    "items",
    "slots",
  ].forEach((key) => {
    if (liveState[key] !== undefined) {
      result[key] = liveState[key];
    }
  });
  return result;
}

function publicCharacterState(name, charBlock = {}) {
  return {
    name,
    enabled: !!charBlock.enabled,
    connected: !!charBlock.connected,
    lifecycle_state: charBlock.lifecycle_state || "STOPPED",
    desired_runtime_state:
      charBlock.desired_runtime_state ||
      (charBlock.enabled ? "RUNNING" : "STOPPED"),
    rotation_source: charBlock.rotation_source || null,
    rotation_replacement: charBlock.rotation_replacement || null,
    account_owned: charBlock.account_owned === true,
    registration_source: charBlock.registration_source || "CONFIG",
    ctype:
      charBlock.account_character_type || charBlock.live_state?.ctype || null,
    realm: charBlock.realm || null,
    pid: charBlock.instance?.pid || null,
    last_heartbeat_at: charBlock.last_heartbeat_at || null,
    restart_attempts: charBlock.restart_attempts || 0,
    script: charBlock.typescript || charBlock.script || null,
    code_revision: charBlock.running_code_revision || null,
    installed_code_revision: charBlock.installed_code_revision || null,
    config_revision: charBlock.running_config_revision || null,
    installed_config_revision: charBlock.installed_config_revision || null,
    runtime_config_revision: Number.isInteger(charBlock.runtime_config_revision)
      ? charBlock.runtime_config_revision
      : 0,
    applied_runtime_config_revision: Number.isInteger(
      charBlock.applied_runtime_config_revision,
    )
      ? charBlock.applied_runtime_config_revision
      : null,
    runtime_config_source: charBlock.runtime_config_source || "CONFIG",
    config_push_status: charBlock.config_push_status || "UNKNOWN",
    config_push_error: charBlock.config_push_error || null,
    revision_status: charBlock.revision_status || "UNKNOWN",
    movement_live_test: charBlock.movement_live_test || null,
    combat_live_test: charBlock.combat_live_test || null,
    class_skill_live_test: charBlock.class_skill_live_test || null,
    group_live_test: charBlock.group_live_test || null,
    farm_live_test: charBlock.farm_live_test || null,
    inventory_live_test: charBlock.inventory_live_test || null,
    gear_scoring_live_test: charBlock.gear_scoring_live_test || null,
    account_gear_reservation_live_test:
      charBlock.account_gear_reservation_live_test || null,
    upgrade_live_test: charBlock.upgrade_live_test || null,
    upgrade_live_preflight: charBlock.upgrade_live_preflight || null,
    exchange_preflight: charBlock.exchange_preflight || null,
    craft_preflight: charBlock.craft_preflight || null,
    exchange_live_test: charBlock.exchange_live_test || null,
    compound_live_test: charBlock.compound_live_test || null,
    logistics_live_test: charBlock.logistics_live_test || null,
    merchant_live_test: charBlock.merchant_live_test || null,
    bank_travel_live_test: charBlock.bank_travel_live_test || null,
    bank_gold_live_test: charBlock.bank_gold_live_test || null,
    npc_trading_live_test: charBlock.npc_trading_live_test || null,
    market_trading_live_test: charBlock.market_trading_live_test || null,
    merrit_live_test: charBlock.merrit_live_test || null,
    fishing_live_test: charBlock.fishing_live_test || null,
    fishing_material_request: charBlock.fishing_material_request || null,
    combat_runtime: charBlock.combat_runtime || null,
    class_skill_runtime: charBlock.class_skill_runtime || null,
    group_combat_runtime: charBlock.group_combat_runtime || null,
    farm_intelligence_runtime: charBlock.farm_intelligence_runtime || null,
    inventory_intelligence_runtime:
      charBlock.inventory_intelligence_runtime || null,
    gear_scoring_runtime: charBlock.gear_scoring_runtime || null,
    future_gear_runtime: charBlock.future_gear_runtime || null,
    upgrade_runtime: charBlock.upgrade_runtime || null,
    account_gear_reservation_runtime:
      charBlock.account_gear_reservation_runtime || null,
    merrit_runtime: charBlock.merrit_runtime || null,
    fishing_runtime: charBlock.fishing_runtime || null,
    game: publicLiveState(charBlock.live_state),
    movement_trail: Array.isArray(charBlock.movement_trail)
      ? charBlock.movement_trail
      : [],
  };
}

const SENSITIVE_CONFIG_KEY =
  /^(?:session|auth|user_auth|password|token|secret|api[_-]?key)$/i;

function sanitizeDashboardConfig(value, path = [], redactedPaths = []) {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeDashboardConfig(entry, [...path, String(index)], redactedPaths),
    );
  }
  if (!value || typeof value !== "object") return value;

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_CONFIG_KEY.test(key)) {
      redactedPaths.push([...path, key].join("."));
      continue;
    }
    result[key] = sanitizeDashboardConfig(entry, [...path, key], redactedPaths);
  }
  return result;
}

function hasSensitiveConfigKey(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveConfigKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      SENSITIVE_CONFIG_KEY.test(key) || hasSensitiveConfigKey(entry),
  );
}

function mergePreservedSensitiveConfig(existing, incoming) {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return incoming;
  }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return incoming;
  }

  const result = JSON.parse(JSON.stringify(incoming));
  for (const [key, value] of Object.entries(existing)) {
    if (SENSITIVE_CONFIG_KEY.test(key)) {
      result[key] = value;
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergePreservedSensitiveConfig(value, result[key]);
    }
  }
  return result;
}

function publicCharacterConfig(name, charBlock = {}) {
  const redactedPaths = [];
  const config = sanitizeDashboardConfig(
    charBlock.runtime_config || {},
    [],
    redactedPaths,
  );
  return {
    character: name,
    revision: Number.isInteger(charBlock.runtime_config_revision)
      ? charBlock.runtime_config_revision
      : 0,
    applied_revision: Number.isInteger(
      charBlock.applied_runtime_config_revision,
    )
      ? charBlock.applied_runtime_config_revision
      : null,
    source: charBlock.runtime_config_source || "CONFIG",
    status: charBlock.config_push_status || "UNKNOWN",
    error: charBlock.config_push_error || null,
    redacted_paths: redactedPaths,
    config,
  };
}

function buildSupervisorSnapshot(
  characterManage = {},
  lifecyclePolicy = {},
  emergencyStopState = null,
  revisionSummary = null,
  persistenceHealth = null,
  merchantLogisticsState = null,
) {
  const characters = Object.entries(characterManage)
    .map(([name, charBlock]) => publicCharacterState(name, charBlock))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    generated_at: Date.now(),
    ipc_protocol_version: IPC_PROTOCOL_VERSION,
    max_online_characters: lifecyclePolicy.maxOnlineCharacters || 4,
    active_characters: characters.filter((character) =>
      ["STARTING", "CONNECTING", "ONLINE", "PAUSED", "STOPPING"].includes(
        character.lifecycle_state,
      ),
    ).length,
    emergency_stop: emergencyStopState || {
      active: false,
      reason: null,
      activated_at: null,
      cleared_at: null,
      revision: 0,
    },
    revision_summary: revisionSummary || {
      source_revision: null,
      installed_config_revision: null,
      status: "UNKNOWN",
    },
    persistence: persistenceHealth || {
      status: "UNKNOWN",
      database_path: null,
      schema_version: null,
      current_schema_version: null,
      flush_count: 0,
      closed: true,
      last_error: null,
    },
    merchant_logistics: merchantLogisticsState || {
      generatedAt: null,
      merchantIndependent: true,
      merchants: [],
      claims: [],
      suppressed: [],
      summary: {
        total: 0,
        ready: 0,
        waitingMerchant: 0,
        suppressed: 0,
        byType: {},
      },
    },
    characters,
  };
}

function encodeSseEvent(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function isLoopbackAddress(address) {
  const normalized = String(address || "").toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function diagnosticSinceFromQuery(query = {}) {
  const minutes = Number(query.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  return Date.now() - Math.min(minutes, 24 * 60) * 60 * 1000;
}

function attachHeadlessDashboard({
  router,
  express,
  characterManage,
  lifecyclePolicy,
  publicDir,
  controlCharacter,
  updateCharacterConfig,
  controlRotation,
  runMovementLiveTest,
  runCombatLiveTest,
  runClassSkillLiveTest,
  runGroupLiveTest,
  runFarmLiveTest,
  runInventoryLiveTest,
  runGearScoringLiveTest,
  runAccountGearReservationLiveTest,
  runUpgradeLiveTest,
  runUpgradeLivePreflight,
  runExchangePreflight,
  runCraftPreflight,
  runCraftMaterialPreparation,
  runExchangeLiveTest,
  runCompoundMaterialPreparation,
  runCompoundLiveTest,
  runLogisticsLiveTest,
  runMerchantLiveTest,
  runBankTravelLiveTest,
  runBankGoldLiveTest,
  runNpcTradingLiveTest,
  runMarketTradingLiveTest,
  runMerritLiveTest,
  runFishingLiveTest,
  controlEmergencyStop,
  getEmergencyStopState,
  getRevisionSummary,
  getPersistenceHealth,
  getMerchantLogisticsState,
  getMapScene,
  diagnosticStore,
  incidentRecorder,
  assetCache,
}) {
  if (!router) {
    throw new Error("headless dashboard requires an Express router");
  }

  const clients = new Set();
  let snapshotPublishTimer = null;
  const getSnapshot = () =>
    buildSupervisorSnapshot(
      characterManage,
      lifecyclePolicy,
      getEmergencyStopState?.(),
      getRevisionSummary?.(),
      getPersistenceHealth?.(),
      getMerchantLogisticsState?.(),
    );

  router.use("/headless", (req, res, next) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(403).json({ error: "LOCAL_ACCESS_ONLY" });
      return;
    }
    next();
  });

  router.get("/headless/api/state", (_req, res) => {
    res.json(getSnapshot());
  });

  router.get("/headless/api/characters/:name/config", (req, res) => {
    const charBlock = characterManage?.[req.params.name];
    if (!charBlock) {
      res.status(404).json({ error: "CHARACTER_NOT_FOUND" });
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      ...publicCharacterConfig(req.params.name, charBlock),
    });
  });

  router.put(
    "/headless/api/characters/:name/config",
    express.json({ limit: "96kb" }),
    async (req, res) => {
      if (!updateCharacterConfig) {
        res.status(503).json({ error: "CONFIG_PUSH_UNAVAILABLE" });
        return;
      }

      try {
        const charBlock = characterManage?.[req.params.name];
        if (!charBlock) {
          res.status(404).json({ error: "CHARACTER_NOT_FOUND" });
          return;
        }
        const incomingConfig = req.body?.config;
        if (hasSensitiveConfigKey(incomingConfig)) {
          res.status(400).json({
            error: "SENSITIVE_CONFIG_KEY_NOT_ALLOWED",
            message:
              "Sensitive auth/session fields cannot be edited in the dashboard",
          });
          return;
        }
        const mergedConfig = mergePreservedSensitiveConfig(
          charBlock.runtime_config || {},
          incomingConfig,
        );
        const result = await updateCharacterConfig(
          req.params.name,
          mergedConfig,
        );
        res.json({
          ok: true,
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CONFIG_PUSH_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/rotation",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!controlRotation) {
        res.status(503).json({ error: "ROTATION_UNAVAILABLE" });
        return;
      }

      try {
        const result = await controlRotation({
          startCharacter: req.body?.start_character,
          stopCharacter: req.body?.stop_character,
        });
        res.json({
          ok: true,
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "ROTATION_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/movement",
    async (req, res) => {
      if (!runMovementLiveTest) {
        res.status(503).json({ error: "MOVEMENT_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runMovementLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "MOVEMENT_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/combat",
    async (req, res) => {
      if (!runCombatLiveTest) {
        res.status(503).json({ error: "COMBAT_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runCombatLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "COMBAT_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );
  router.post(
    "/headless/api/characters/:name/tests/class-skill",
    async (req, res) => {
      if (!runClassSkillLiveTest) {
        res.status(503).json({ error: "CLASS_SKILL_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runClassSkillLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CLASS_SKILL_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/inventory",
    async (req, res) => {
      if (!runInventoryLiveTest) {
        res.status(503).json({ error: "INVENTORY_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runInventoryLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "INVENTORY_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/gear-scoring",
    async (req, res) => {
      if (!runGearScoringLiveTest) {
        res.status(503).json({ error: "GEAR_SCORING_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runGearScoringLiveTest(
          req.params.name,
          Number(req.body?.sampleMs) || 1200,
        );
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "GEAR_SCORING_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/account-gear-reservation",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runAccountGearReservationLiveTest) {
        res
          .status(503)
          .json({ error: "ACCOUNT_GEAR_RESERVATION_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runAccountGearReservationLiveTest(
          req.params.name,
          req.body?.targetCharacter,
          Number(req.body?.sampleMs) || 1200,
        );
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "ACCOUNT_GEAR_RESERVATION_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/upgrade-preflight",
    async (req, res) => {
      if (!runUpgradeLivePreflight) {
        res.status(503).json({ error: "UPGRADE_PREFLIGHT_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runUpgradeLivePreflight(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "UPGRADE_PREFLIGHT_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/craft-preflight",
    async (req, res) => {
      if (!runCraftPreflight) {
        res.status(503).json({ error: "CRAFT_PREFLIGHT_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runCraftPreflight(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CRAFT_PREFLIGHT_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/craft-prepare",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runCraftMaterialPreparation) {
        res
          .status(503)
          .json({ error: "CRAFT_MATERIAL_PREPARATION_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runCraftMaterialPreparation(req.params.name, {
          recipe: req.body?.recipe,
          workers: req.body?.workers,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CRAFT_MATERIAL_PREPARATION_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/exchange-preflight",
    async (req, res) => {
      if (!runExchangePreflight) {
        res.status(503).json({ error: "EXCHANGE_PREFLIGHT_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runExchangePreflight(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "EXCHANGE_PREFLIGHT_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/exchange",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runExchangeLiveTest) {
        res.status(503).json({ error: "EXCHANGE_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runExchangeLiveTest(req.params.name, {
          itemName: req.body?.itemName,
          itemSlot: req.body?.itemSlot,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "EXCHANGE_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/compound-prepare",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runCompoundMaterialPreparation) {
        res.status(503).json({
          error: "COMPOUND_MATERIAL_PREPARATION_UNAVAILABLE",
        });
        return;
      }

      try {
        const result = await runCompoundMaterialPreparation(req.params.name, {
          workers: req.body?.workers,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "COMPOUND_MATERIAL_PREPARATION_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/compound",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runCompoundLiveTest) {
        res.status(503).json({ error: "COMPOUND_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runCompoundLiveTest(req.params.name, {
          itemName: req.body?.itemName,
          itemSlots: req.body?.itemSlots,
          scrollName: req.body?.scrollName,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "COMPOUND_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/upgrade",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runUpgradeLiveTest) {
        res.status(503).json({ error: "UPGRADE_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runUpgradeLiveTest(req.params.name, {
          itemName: req.body?.itemName,
          scrollName: req.body?.scrollName,
          itemSlot: req.body?.itemSlot,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "UPGRADE_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/logistics",
    async (req, res) => {
      if (!runLogisticsLiveTest) {
        res.status(503).json({ error: "LOGISTICS_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runLogisticsLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "LOGISTICS_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/fishing",
    async (req, res) => {
      if (!runFishingLiveTest) {
        res.status(503).json({ error: "FISHING_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runFishingLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "FISHING_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/market-trading",
    async (req, res) => {
      if (!runMarketTradingLiveTest) {
        res.status(503).json({ error: "MARKET_TRADING_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runMarketTradingLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "MARKET_TRADING_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/npc-trading",
    async (req, res) => {
      if (!runNpcTradingLiveTest) {
        res.status(503).json({ error: "NPC_TRADING_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runNpcTradingLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "NPC_TRADING_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/bank-gold",
    async (req, res) => {
      if (!runBankGoldLiveTest) {
        res.status(503).json({ error: "BANK_GOLD_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runBankGoldLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "BANK_GOLD_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/bank-travel",
    async (req, res) => {
      if (!runBankTravelLiveTest) {
        res.status(503).json({ error: "BANK_TRAVEL_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runBankTravelLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "BANK_TRAVEL_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/merrit",
    async (req, res) => {
      if (!runMerritLiveTest) {
        res.status(503).json({ error: "MERRIT_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runMerritLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "MERRIT_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/merchant",
    async (req, res) => {
      if (!runMerchantLiveTest) {
        res.status(503).json({ error: "MERCHANT_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runMerchantLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "MERCHANT_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/farm",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runFarmLiveTest) {
        res.status(503).json({ error: "FARM_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runFarmLiveTest(req.params.name, {
          sampleMs: Number.isFinite(Number(req.body?.sampleMs))
            ? Number(req.body.sampleMs)
            : undefined,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "FARM_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/group",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runGroupLiveTest) {
        res.status(503).json({ error: "GROUP_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runGroupLiveTest(req.params.name, {
          role: req.body?.role,
          leader: req.body?.leader,
          peer: req.body?.peer,
          baselinePairFormed:
            typeof req.body?.baselinePairFormed === "boolean"
              ? req.body.baselinePairFormed
              : undefined,
          coordinatedPair: req.body?.coordinatedPair === true,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "GROUP_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/emergency-stop",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      const action = String(req.body?.action || "").toLowerCase();
      if (!["activate", "clear"].includes(action)) {
        res.status(400).json({ error: "INVALID_EMERGENCY_STOP_ACTION" });
        return;
      }
      if (!controlEmergencyStop) {
        res.status(503).json({ error: "EMERGENCY_STOP_UNAVAILABLE" });
        return;
      }

      try {
        const state = await controlEmergencyStop(
          action,
          req.body?.reason || undefined,
        );
        res.json({
          ok: true,
          emergency_stop: state,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "EMERGENCY_STOP_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.get("/headless/api/maps/:name/scene", (req, res) => {
    if (!getMapScene) {
      res.status(503).json({ error: "MAP_SCENE_UNAVAILABLE" });
      return;
    }

    const scene = getMapScene(req.params.name);
    if (!scene) {
      res.status(404).json({ error: "MAP_SCENE_NOT_FOUND" });
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json(scene);
  });

  router.get("/headless/api/assets/adventure-land", async (req, res) => {
    if (!assetCache) {
      res.status(503).json({ error: "ASSET_CACHE_UNAVAILABLE" });
      return;
    }

    try {
      const asset = await assetCache.ensure(req.query.path);
      res.set({
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": asset.contentType,
      });
      res.sendFile(asset.path);
    } catch (error) {
      res.status(Number(error.statusCode) || 502).json({
        error: error.code || "ASSET_FETCH_FAILED",
        message: error.message,
      });
    }
  });

  router.get("/headless/api/diagnostic", (req, res) => {
    if (!diagnosticStore) {
      res.status(503).json({ error: "DIAGNOSTICS_UNAVAILABLE" });
      return;
    }

    const since = diagnosticSinceFromQuery(req.query);
    const events = diagnosticStore.getEvents({ since });
    res.type("text/plain").send(formatAccountDiagnostic(getSnapshot(), events));
  });

  router.get("/headless/api/incidents", async (req, res) => {
    if (!incidentRecorder) {
      res.status(503).json({ error: "INCIDENTS_UNAVAILABLE" });
      return;
    }

    try {
      const incidents = await incidentRecorder.list({
        limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
        character: req.query.character || undefined,
      });
      res.json({ incidents });
    } catch (error) {
      res.status(500).json({
        error: "INCIDENT_LIST_FAILED",
        message: error.message,
      });
    }
  });

  router.get("/headless/api/incidents/latest", async (req, res) => {
    if (!incidentRecorder) {
      res.status(503).json({ error: "INCIDENTS_UNAVAILABLE" });
      return;
    }

    try {
      const incident = await incidentRecorder.latest({
        character: req.query.character || undefined,
      });
      if (!incident) {
        res.status(404).json({ error: "INCIDENT_NOT_FOUND" });
        return;
      }

      res
        .type("text/plain")
        .send(await incidentRecorder.readText(incident.incident_id));
    } catch (error) {
      res.status(Number(error.statusCode) || 500).json({
        error: error.code || "INCIDENT_READ_FAILED",
        message: error.message,
      });
    }
  });

  router.get("/headless/api/incidents/:id", async (req, res) => {
    if (!incidentRecorder) {
      res.status(503).json({ error: "INCIDENTS_UNAVAILABLE" });
      return;
    }

    try {
      res
        .type("text/plain")
        .send(await incidentRecorder.readText(req.params.id));
    } catch (error) {
      res.status(Number(error.statusCode) || 404).json({
        error: error.code || "INCIDENT_NOT_FOUND",
        message: error.message,
      });
    }
  });

  router.get("/headless/api/characters/:name/diagnostic", (req, res) => {
    if (!diagnosticStore) {
      res.status(503).json({ error: "DIAGNOSTICS_UNAVAILABLE" });
      return;
    }

    try {
      const since = diagnosticSinceFromQuery(req.query);
      const events = diagnosticStore.getEvents({
        character: req.params.name,
        since,
      });
      res
        .type("text/plain")
        .send(
          formatCharacterDiagnostic(req.params.name, getSnapshot(), events),
        );
    } catch (error) {
      res.status(Number(error.statusCode) || 500).json({
        error: error.code || "DIAGNOSTIC_FAILED",
        message: error.message,
      });
    }
  });

  router.post(
    "/headless/api/characters/:name/control",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      const action = normalizeControlAction(req.body?.action);
      if (!action) {
        res.status(400).json({ error: "INVALID_CONTROL_ACTION" });
        return;
      }
      if (!controlCharacter) {
        res.status(503).json({ error: "CONTROL_UNAVAILABLE" });
        return;
      }

      try {
        const result = await controlCharacter(req.params.name, action);
        res.json({
          ok: true,
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CONTROL_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.get("/headless/api/events", (req, res) => {
    res.status(200);
    res.set({
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    res.flushHeaders?.();

    clients.add(res);
    res.write(encodeSseEvent("snapshot", getSnapshot()));

    req.on("close", () => {
      clients.delete(res);
    });
  });

  const staticDir = publicDir || path.join(__dirname, "..", "dashboard");
  router.use("/headless", express.static(staticDir));

  function publishSnapshot() {
    if (snapshotPublishTimer) return;

    snapshotPublishTimer = setTimeout(() => {
      snapshotPublishTimer = null;
      const snapshot = getSnapshot();
      for (const client of clients) {
        client.write(encodeSseEvent("snapshot", snapshot));
      }
    }, 500);
    snapshotPublishTimer.unref?.();
  }

  function publish(event) {
    const payload = {
      ...event,
      timestamp: event.timestamp || Date.now(),
    };
    for (const client of clients) {
      client.write(encodeSseEvent("supervisor", payload));
    }
  }

  function close() {
    if (snapshotPublishTimer) {
      clearTimeout(snapshotPublishTimer);
      snapshotPublishTimer = null;
    }
    for (const client of clients) {
      client.end();
    }
    clients.clear();
  }

  return {
    close,
    getSnapshot,
    publish,
    publishSnapshot,
  };
}

module.exports = {
  attachHeadlessDashboard,
  buildSupervisorSnapshot,
  diagnosticSinceFromQuery,
  encodeSseEvent,
  hasSensitiveConfigKey,
  isLoopbackAddress,
  mergePreservedSensitiveConfig,
  publicCharacterConfig,
  publicCharacterState,
  publicLiveState,
  sanitizeDashboardConfig,
};

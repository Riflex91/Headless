"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildSupervisorSnapshot,
  diagnosticSinceFromQuery,
  encodeSseEvent,
  isLoopbackAddress,
  publicCharacterConfig,
  publicCharacterState,
} = require("../src/HeadlessDashboard");
const { make_cfg_string } = require("../src/ConfigUtil");
const { IPC_PROTOCOL_VERSION } = require("../src/IpcProtocol");

test("public character state exposes only dashboard-safe fields", () => {
  const character = publicCharacterState("My_Ranger1", {
    enabled: true,
    connected: true,
    lifecycle_state: "ONLINE",
    desired_runtime_state: "PAUSED",
    rotation_source: "My_Warrior",
    rotation_replacement: null,
    account_owned: true,
    registration_source: "CONFIG",
    account_character_type: "ranger",
    realm: "EUII",
    instance: { pid: 12345, secret: "do-not-export" },
    last_heartbeat_at: 123456,
    restart_attempts: 2,
    typescript: "bot/main.js",
    running_code_revision: "sha256-running",
    installed_code_revision: "sha256-installed",
    running_config_revision: "cfg-running",
    installed_config_revision: "cfg-installed",
    runtime_config_revision: 7,
    applied_runtime_config_revision: 6,
    runtime_config_source: "PERSISTED",
    config_push_status: "PENDING",
    config_push_error: null,
    runtime_config: { secret_value: "DO_NOT_EXPORT_CONFIG" },
    revision_status: "STALE",
    session: "SECRET_SESSION",
    auth: "SECRET_AUTH",
  });

  assert.deepEqual(character, {
    name: "My_Ranger1",
    enabled: true,
    connected: true,
    lifecycle_state: "ONLINE",
    desired_runtime_state: "PAUSED",
    rotation_source: "My_Warrior",
    rotation_replacement: null,
    account_owned: true,
    registration_source: "CONFIG",
    ctype: "ranger",
    realm: "EUII",
    pid: 12345,
    last_heartbeat_at: 123456,
    restart_attempts: 2,
    script: "bot/main.js",
    code_revision: "sha256-running",
    installed_code_revision: "sha256-installed",
    config_revision: "cfg-running",
    installed_config_revision: "cfg-installed",
    runtime_config_revision: 7,
    applied_runtime_config_revision: 6,
    runtime_config_source: "PERSISTED",
    config_push_status: "PENDING",
    config_push_error: null,
    revision_status: "STALE",
    movement_live_test: null,
    combat_live_test: null,
    class_skill_live_test: null,
    group_live_test: null,
    farm_live_test: null,
    inventory_live_test: null,
    logistics_live_test: null,
    merchant_live_test: null,
    merrit_live_test: null,
    fishing_live_test: null,
    fishing_material_request: null,
    combat_runtime: null,
    class_skill_runtime: null,
    group_combat_runtime: null,
    farm_intelligence_runtime: null,
    inventory_intelligence_runtime: null,
    merrit_runtime: null,
    fishing_runtime: null,
    game: null,
    movement_trail: [],
  });

  const serialized = JSON.stringify(character);
  assert.equal(serialized.includes("SECRET_SESSION"), false);
  assert.equal(serialized.includes("SECRET_AUTH"), false);
  assert.equal(serialized.includes("do-not-export"), false);
  assert.equal(serialized.includes("DO_NOT_EXPORT_CONFIG"), false);
});

test("character config payload redacts auth-shaped keys", () => {
  const payload = publicCharacterConfig("My_Ranger1", {
    runtime_config_revision: 7,
    applied_runtime_config_revision: 6,
    runtime_config_source: "PERSISTED",
    config_push_status: "APPLIED",
    runtime_config: {
      combat: { enabled: true },
      session: "DO_NOT_EXPORT",
      nested: { auth: "DO_NOT_EXPORT_EITHER", keep: 42 },
    },
    session: "ACCOUNT_SECRET",
  });

  assert.equal(payload.revision, 7);
  assert.equal(payload.applied_revision, 6);
  assert.deepEqual(payload.config, {
    combat: { enabled: true },
    nested: { keep: 42 },
  });
  assert.deepEqual(payload.redacted_paths.sort(), ["nested.auth", "session"]);
  assert.equal(JSON.stringify(payload).includes("DO_NOT_EXPORT"), false);
  assert.equal(JSON.stringify(payload).includes("ACCOUNT_SECRET"), false);
});

test("dashboard access accepts loopback addresses only", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.12"), false);
  assert.equal(isLoopbackAddress("10.0.0.2"), false);
});

test("supervisor snapshot counts active lifecycle states", () => {
  const snapshot = buildSupervisorSnapshot(
    {
      My_Ranger1: { lifecycle_state: "ONLINE" },
      My_Ranger2: { lifecycle_state: "CONNECTING" },
      My_Ranger3: { lifecycle_state: "STOPPED" },
      My_Merchant: { lifecycle_state: "PAUSED" },
    },
    { maxOnlineCharacters: 4 },
    {
      active: true,
      reason: "TEST_STOP",
      activated_at: 1234,
      cleared_at: null,
      revision: 7,
    },
    {
      source_revision: "abc123",
      installed_config_revision: "cfg-account",
      status: "STALE",
    },
    {
      status: "HEALTHY",
      database_path: "data/database/caracal-bot.db",
      schema_version: 2,
      current_schema_version: 2,
      flush_count: 7,
      closed: false,
      last_error: null,
    },
  );

  assert.equal(snapshot.ipc_protocol_version, IPC_PROTOCOL_VERSION);
  assert.equal(snapshot.max_online_characters, 4);
  assert.equal(snapshot.active_characters, 3);
  assert.deepEqual(snapshot.emergency_stop, {
    active: true,
    reason: "TEST_STOP",
    activated_at: 1234,
    cleared_at: null,
    revision: 7,
  });
  assert.deepEqual(snapshot.revision_summary, {
    source_revision: "abc123",
    installed_config_revision: "cfg-account",
    status: "STALE",
  });
  assert.deepEqual(snapshot.persistence, {
    status: "HEALTHY",
    database_path: "data/database/caracal-bot.db",
    schema_version: 2,
    current_schema_version: 2,
    flush_count: 7,
    closed: false,
    last_error: null,
  });
  assert.deepEqual(
    snapshot.characters.map((character) => character.name),
    ["My_Merchant", "My_Ranger1", "My_Ranger2", "My_Ranger3"],
  );
});

test("diagnostic time range query is bounded", () => {
  const before = Date.now();
  const since = diagnosticSinceFromQuery({ minutes: "5" });
  const after = Date.now();

  assert.equal(since <= after - 5 * 60 * 1000, true);
  assert.equal(since >= before - 5 * 60 * 1000, true);
  assert.equal(diagnosticSinceFromQuery({ minutes: "" }), undefined);

  const bounded = diagnosticSinceFromQuery({ minutes: "99999" });
  assert.equal(bounded >= before - 24 * 60 * 60 * 1000, true);
});

test("SSE event encoding is valid and compact", () => {
  const encoded = encodeSseEvent("supervisor", {
    event: "CHARACTER_CONNECTED",
    character: "My_Ranger1",
  });

  assert.equal(encoded.startsWith("event: supervisor\n"), true);
  assert.equal(encoded.endsWith("\n\n"), true);
  assert.match(encoded, /"CHARACTER_CONNECTED"/);
});

test("generated config enables the local dashboard by default", () => {
  const generated = make_cfg_string({});
  assert.match(generated, /enable_headless_dashboard:\s+true/);
});

test("dashboard static assets are present", () => {
  const dashboardDir = path.join(__dirname, "..", "dashboard");

  for (const file of [
    "index.html",
    "app.js",
    "config-form.js",
    "inventory-equipment.js",
    "map-background.js",
    "movement-map.js",
    "styles.css",
  ]) {
    assert.equal(fs.existsSync(path.join(dashboardDir, file)), true);
  }

  const index = fs.readFileSync(path.join(dashboardDir, "index.html"), "utf8");
  assert.match(index, /Letzter Incident/);
  assert.match(index, /Persistence: UNKNOWN/);
  assert.match(index, /data-control="restart"/);
  assert.match(index, /data-config/);
  assert.match(index, /id="config-dialog"/);
  assert.match(index, /config-form\.js/);
  assert.match(index, /id="rotation-stop-character"/);
  assert.match(index, /id="rotation-start-character"/);
  assert.match(index, /id="rotate-characters"/);
  assert.match(index, /character-runtime-config-revision/);
  assert.match(index, /character-config-push-status/);
  assert.match(index, /character-movement-owner/);
  assert.match(index, /character-movement-command/);
  assert.match(index, /character-movement-reason/);
  assert.match(index, /character-safe-point/);
  assert.match(index, /character-stuck-state/);
  assert.match(index, /character-movement-live-test/);
  assert.match(index, /character-combat-live-test/);
  assert.match(index, /character-class-skill-live-test/);
  assert.match(index, /character-group-live-test/);
  assert.match(index, /character-combat/);
  assert.match(index, /character-combat-target/);
  assert.match(index, /character-combat-cooldowns/);
  assert.match(index, /character-class-skills/);
  assert.match(index, /character-class-skill-action/);
  assert.match(index, /character-group-combat/);
  assert.match(index, /character-group-tether/);
  assert.match(index, /character-farm-intelligence/);
  assert.match(index, /character-farm-why-monster/);
  assert.match(index, /character-farm-why-spot/);
  assert.match(index, /data-movement-live-test/);
  assert.match(index, /data-combat-live-test/);
  assert.match(index, /data-class-skill-live-test/);
  assert.match(index, /id="movement-map-background"/);
  assert.match(index, /id="show-nearby-monsters"/);
  assert.match(index, /id="show-nearby-npcs"/);
  assert.match(index, /map-background\.js/);
});

test("dashboard panels and character cards support persistent collapsing", () => {
  const dashboardApp = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "app.js"),
    "utf8",
  );
  const styles = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "styles.css"),
    "utf8",
  );

  assert.match(dashboardApp, /initializeDashboardCollapsibles/);
  assert.match(dashboardApp, /initializeCollapsible/);
  assert.match(dashboardApp, /localStorage/);
  assert.match(dashboardApp, /movement-panel/);
  assert.match(styles, /\.collapse-toggle/);
  assert.match(styles, /\.panel\.is-collapsed/);
  assert.match(styles, /\.character-card\.is-collapsed/);
  assert.doesNotMatch(dashboardApp, /â|Â/);
});

test("dashboard visible character views include connected characters only", () => {
  const dashboardApp = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "app.js"),
    "utf8",
  );

  assert.match(
    dashboardApp,
    /function onlineCharacters\(\)[\s\S]*character\.connected === true/,
  );
  assert.match(dashboardApp, /availableMaps\(onlineCharacters\(\)\)/);
  assert.match(
    dashboardApp,
    /renderMovementMap\([\s\S]*characters: onlineCharacters\(\)/,
  );
  assert.match(
    dashboardApp,
    /renderAccountInventory\([\s\S]*characters: onlineCharacters\(\)/,
  );
  assert.match(
    dashboardApp,
    /function renderCharacters\(\)[\s\S]*const characters = onlineCharacters\(\)/,
  );
});

test("dashboard module and coordinator remain syntactically valid", () => {
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const runtimeKernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const characterThread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(dashboard));
  assert.doesNotThrow(() => new Function(coordinator));
  assert.match(dashboard, /\/headless\/api\/incidents/);
  assert.match(dashboard, /incidents\/latest/);
  assert.match(coordinator, /attachHeadlessDashboard/);
  assert.match(coordinator, /control_emergency_stop/);
  assert.match(coordinator, /emergency_stop_applied/);
  assert.match(coordinator, /StructuredLogger/);
  assert.match(coordinator, /IncidentRecorder/);
  assert.match(coordinator, /FileRevisionCache/);
  assert.match(coordinator, /running_code_revision/);
  assert.match(coordinator, /installed_code_revision/);
  assert.match(coordinator, /PersistenceService/);
  assert.match(coordinator, /IPC_MESSAGE_REJECTED/);
  assert.match(coordinator, /normalizeIpcMessage/);
  assert.match(coordinator, /registerAccountCharacters/);
  assert.match(coordinator, /registered_character_count/);
  assert.match(coordinator, /control_rotation/);
  assert.match(coordinator, /CHARACTER_ROTATION_REQUESTED/);
  assert.match(coordinator, /CHARACTER_ROTATION_COMPLETED/);
  assert.match(dashboard, /\/headless\/api\/rotation/);
  assert.match(
    dashboard,
    /router\.get\("\/headless\/api\/characters\/:name\/config"/,
  );
  assert.match(dashboard, /\/headless\/api\/characters\/:name\/config/);
  assert.match(dashboard, /SENSITIVE_CONFIG_KEY_NOT_ALLOWED/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/movement/,
  );
  assert.match(dashboard, /\/headless\/api\/characters\/:name\/tests\/combat/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/class-skill/,
  );
  assert.match(dashboard, /\/headless\/api\/characters\/:name\/tests\/group/);
  assert.match(dashboard, /\/headless\/api\/maps\/:name\/scene/);
  assert.match(dashboard, /nearby_entities/);
  assert.match(coordinator, /control_character_config/);
  assert.match(coordinator, /CHARACTER_CONFIG_PUSH_REQUESTED/);
  assert.match(coordinator, /CHARACTER_CONFIG_APPLIED/);
  assert.match(coordinator, /CharacterConfigService/);
  assert.match(coordinator, /getPersistenceHealth/);
  assert.match(coordinator, /restoreDesiredRuntimeState/);
  assert.match(coordinator, /saveCharacterRuntimeState/);
  assert.match(coordinator, /saveCharacterSnapshot/);
  assert.match(coordinator, /UNEXPECTED_CHARACTER_EXIT/);
  assert.match(coordinator, /dashboard\?\.publish/);
  assert.match(coordinator, /updateCharacterMovementRuntime/);
  assert.match(coordinator, /run_movement_live_test/);
  assert.match(coordinator, /movement_live_test_result/);
  assert.match(coordinator, /run_combat_live_test/);
  assert.match(coordinator, /combat_live_test_result/);
  assert.match(coordinator, /run_class_skill_live_test/);
  assert.match(coordinator, /class_skill_live_test_result/);
  assert.match(coordinator, /run_group_live_test/);
  assert.match(coordinator, /group_live_test_result/);
  assert.match(runtimeKernel, /movement:\s*this\.movement\.status\(\)/);
  assert.match(runtimeKernel, /combat:\s*this\.combat\.status\(\)/);
  assert.match(coordinator, /combat_runtime/);
  assert.match(coordinator, /class_skill_runtime/);
  assert.match(coordinator, /group_combat_runtime/);
  assert.match(coordinator, /farm_intelligence_runtime/);
  assert.match(coordinator, /inventory_intelligence_runtime/);
  assert.match(coordinator, /inventory_live_test/);
  assert.match(coordinator, /merrit_live_test/);
  assert.match(coordinator, /merrit_runtime/);
  assert.match(coordinator, /fishing_live_test/);
  assert.match(coordinator, /fishing_runtime/);
  assert.match(coordinator, /fishing_material_request/);
  assert.match(coordinator, /FISHING_MATERIAL_REQUEST_STARTED/);
  assert.match(coordinator, /FISHING_MATERIAL_REQUEST_COMPLETED/);
  assert.match(coordinator, /My_Ranger1/);
  assert.match(coordinator, /My_Ranger2/);
  assert.match(coordinator, /My_Ranger3/);
  assert.match(coordinator, /saveCooldown/);
  assert.match(coordinator, /appendFarmStatistic/);
  assert.match(runtimeKernel, /classSkills/);
  assert.match(runtimeKernel, /groupCombat/);
  assert.match(runtimeKernel, /farmIntelligence/);
  assert.match(runtimeKernel, /inventoryIntelligence/);
  assert.match(runtimeKernel, /merchantMerrit/);
  assert.match(runtimeKernel, /merchantFishing/);
  assert.match(runtimeKernel, /MERRIT_AUTONOMY_JOB_ID/);
  assert.match(runtimeKernel, /FISHING_AUTONOMY_JOB_ID/);
  assert.match(runtimeKernel, /runMerritLiveTest/);
  assert.match(runtimeKernel, /runFishingLiveTest/);
  assert.match(runtimeKernel, /runMaterialGatherTask/);
  assert.match(runtimeKernel, /reportFishingMaterialRequestResult/);
  assert.match(runtimeKernel, /FARM_INTELLIGENCE_JOB_ID/);
  assert.match(runtimeKernel, /INVENTORY_INTELLIGENCE_JOB_ID/);
  assert.match(runtimeKernel, /GROUP_COMBAT_JOB_ID/);
  assert.match(runtimeKernel, /CLASS_SKILL_JOB_ID/);
  assert.match(runtimeKernel, /runMovementLiveTest/);
  assert.match(runtimeKernel, /runCombatLiveTest/);
  assert.match(runtimeKernel, /runClassSkillLiveTest/);
  assert.match(characterThread, /movement_live_test/);
  assert.match(characterThread, /movement_live_test_result/);
  assert.match(characterThread, /combat_live_test/);
  assert.match(characterThread, /combat_live_test_result/);
  assert.match(characterThread, /class_skill_live_test/);
  assert.match(characterThread, /class_skill_live_test_result/);
  assert.match(characterThread, /merrit_live_test/);
  assert.match(characterThread, /merrit_live_test_result/);
  assert.match(characterThread, /fishing_live_test/);
  assert.match(characterThread, /fishing_live_test_result/);
  assert.match(characterThread, /material_gather_task/);
  assert.match(characterThread, /material_gather_task_result/);
  assert.match(characterThread, /fishing_material_request_result/);
});

test("dashboard public live state keeps nearby entity telemetry but not map scene blobs", () => {
  const character = publicCharacterState("My_Ranger1", {
    connected: true,
    live_state: {
      map: "main",
      x: 10,
      y: 20,
      nearby_entities: [
        {
          id: "goo-1",
          kind: "monster",
          name: "Green Goo",
          x: 25,
          y: 30,
        },
      ],
      map_scene: {
        map: "main",
        placements: new Array(1000).fill([0, 0, 0]),
      },
    },
  });

  assert.equal(character.game.nearby_entities.length, 1);
  assert.equal(character.game.map_scene, undefined);
});

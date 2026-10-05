"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  evaluatePhase20IntegrationSupervisorResult,
  formatCompactResult,
  runPhase20IntegrationSupervisorLiveTest,
} = require("../scripts/run_phase20_integration_live_e2e");

function passingPayload(overrides = {}) {
  return {
    result: {
      testId: "phase20-integration-live-1",
      phase: "20.0a",
      outcome: "PASS",
      reason: "PHASE20_INTEGRATION_BOOTSTRAP_CONFIRMED",
      evidence: {
        merchant: "My_Merchant",
        farmers: ["My_Mage", "My_Priest", "My_Ranger1"],
        selectedCharacters: [
          "My_Mage",
          "My_Priest",
          "My_Ranger1",
          "My_Merchant",
        ],
        allOnline: true,
        allRunning: true,
        normalRuntimeAll: true,
        activeCharacters: 4,
        maxOnlineCharacters: 4,
        slotLimitValid: true,
        runtimeSources: [
          {
            name: "My_Mage",
            connected: true,
            lifecycleState: "ONLINE",
            desiredRuntimeState: "RUNNING",
            typescriptFile: "bot/main.js",
            lifecycleOnlyProbe: false,
            normalRuntime: true,
          },
          {
            name: "My_Priest",
            connected: true,
            lifecycleState: "ONLINE",
            desiredRuntimeState: "RUNNING",
            typescriptFile: "bot/main.js",
            lifecycleOnlyProbe: false,
            normalRuntime: true,
          },
          {
            name: "My_Ranger1",
            connected: true,
            lifecycleState: "ONLINE",
            desiredRuntimeState: "RUNNING",
            typescriptFile: "bot/main.js",
            lifecycleOnlyProbe: false,
            normalRuntime: true,
          },
          {
            name: "My_Merchant",
            connected: true,
            lifecycleState: "ONLINE",
            desiredRuntimeState: "RUNNING",
            typescriptFile: "bot/main.js",
            lifecycleOnlyProbe: false,
            normalRuntime: true,
          },
        ],
      },
      scope: {
        normalRuntime: true,
        lifecycleOnlyProbe: false,
        lifecycleMutationDispatched: true,
        gameplayMutationForced: false,
        valueMutationForced: false,
        automaticLogisticsDispatchSuppressed: true,
        combatEvidenceRequired: false,
        logisticsEvidenceRequired: false,
      },
      cleanup: {
        runtimeStateRestored: true,
        originallyRunning: ["My_Merchant"],
        restoredRunning: ["My_Merchant"],
      },
      ...overrides,
    },
  };
}

test("Phase 20.0a launcher accepts complete 3+1 normal-runtime evidence", () => {
  const result = evaluatePhase20IntegrationSupervisorResult(passingPayload());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "PHASE20_INTEGRATION_BOOTSTRAP_CONFIRMED");
  assert.equal(result.identityValid, true);
  assert.equal(result.runtimeValid, true);
  assert.equal(result.scopeValid, true);
  assert.equal(result.cleanupValid, true);
});

test("Phase 20.0a launcher rejects lifecycle-only or non-bot runtime", () => {
  const lifecycleOnly = passingPayload();
  lifecycleOnly.result.evidence.runtimeSources[0].lifecycleOnlyProbe = true;
  lifecycleOnly.result.evidence.runtimeSources[0].normalRuntime = false;

  let result = evaluatePhase20IntegrationSupervisorResult(lifecycleOnly);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.runtimeValid, false);

  const wrongSource = passingPayload();
  wrongSource.result.evidence.runtimeSources[0].typescriptFile =
    "caracAL/examples/crabs_with_tophats.js";

  result = evaluatePhase20IntegrationSupervisorResult(wrongSource);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.runtimeValid, false);
});

test("Phase 20.0a launcher requires exact three farmers plus one Merchant", () => {
  const payload = passingPayload();
  payload.result.evidence.farmers = ["My_Mage", "My_Priest"];
  payload.result.evidence.selectedCharacters = [
    "My_Mage",
    "My_Priest",
    "My_Merchant",
  ];

  const result = evaluatePhase20IntegrationSupervisorResult(payload);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.identityValid, false);
});

test("Phase 20.0a launcher rejects slot overflow and missing cleanup", () => {
  const overflow = passingPayload();
  overflow.result.evidence.activeCharacters = 5;
  overflow.result.evidence.slotLimitValid = false;

  let result = evaluatePhase20IntegrationSupervisorResult(overflow);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.runtimeValid, false);

  const dirty = passingPayload();
  dirty.result.cleanup.runtimeStateRestored = false;

  result = evaluatePhase20IntegrationSupervisorResult(dirty);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.cleanupValid, false);
});

test("Phase 20.0a compact output exposes normal runtime and cleanup evidence", () => {
  const output = formatCompactResult(
    evaluatePhase20IntegrationSupervisorResult(passingPayload()),
  );

  assert.match(output, /Phase 20\.0a 3\+1 Runtime Bootstrap Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /Merchant: My_Merchant/);
  assert.match(output, /All online: yes/);
  assert.match(output, /All RUNNING: yes/);
  assert.match(output, /All bot\/main\.js: yes/);
  assert.match(output, /Active characters: 4/);
  assert.match(output, /Lifecycle-only probe: no/);
  assert.match(output, /Automatic logistics suppressed: yes/);
  assert.match(output, /Runtime state restored: yes/);
});

test("Phase 20.0a launcher uses only the dedicated local test POST", async () => {
  const calls = [];
  const payload = passingPayload();

  const result = await runPhase20IntegrationSupervisorLiveTest({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(payload);
        },
      };
    },
  });

  assert.deepEqual(result, payload);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/headless\/api\/tests\/phase20-integration$/);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
});

test("Phase 20.0a source uses normal bot runtime with guarded setup and cleanup", () => {
  const launcher = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "scripts",
      "run_phase20_integration_live_e2e.js",
    ),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.doesNotMatch(launcher, /CARACAL_OBSERVER_ONLY/);
  assert.match(launcher, /\/headless\/api\/tests\/phase20-integration/);
  assert.match(launcher, /ensureDashboardAvailable\(readState\)/);

  assert.match(
    dashboard,
    /router\.post\([\s\S]*"\/headless\/api\/tests\/phase20-integration"/,
  );
  assert.match(dashboard, /runPhase20IntegrationLiveTest/);

  assert.match(coordinator, /async function run_phase20_integration_live_test/);
  assert.match(coordinator, /PHASE20_INTEGRATION_REQUIRES_NORMAL_SUPERVISOR/);
  assert.match(coordinator, /phase20_integration_live_test_active = true/);
  assert.match(
    coordinator,
    /movement_live_test_typescript_override\s*=\s*MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE/,
  );
  assert.match(
    coordinator,
    /full_autonomy_live_test_lifecycle_only\s*=\s*false/,
  );
  assert.match(
    coordinator,
    /source\.typescriptFile === MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE/,
  );
  assert.match(coordinator, /restore_phase20_integration_live_test_state/);
  assert.match(coordinator, /automaticLogisticsDispatchSuppressed:\s*true/);
  assert.match(coordinator, /combatEvidenceRequired:\s*stage === "20\.0b"/);
  assert.match(coordinator, /logisticsEvidenceRequired:\s*false/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  evaluateFullAutonomySupervisorResult,
  formatCompactResult,
  observerRuntimeEnv,
  runFullAutonomySupervisorLiveTest,
} = require("../scripts/run_full_autonomy_live_e2e");

function passingPayload(overrides = {}) {
  return {
    result: {
      testId: "full-autonomy-live-1",
      outcome: "PASS",
      reason: "FULL_AUTONOMY_LIVE_E2E_CONFIRMED",
      action: {
        type: "ROTATE",
        startCharacter: "My_Merchant",
        stopCharacter: "My_Mage",
      },
      evidence: {
        activeSources: ["My_Mage", "My_Priest", "My_Ranger1", "My_Ranger2"],
        sourceCharacter: "My_Mage",
        targetCharacter: "My_Merchant",
        rotationObserved: true,
        sourceStopped: true,
        targetOnline: true,
        sourceAuthority: "FULL_AUTONOMY",
        targetAuthority: "FULL_AUTONOMY",
        lifecycleOnlyConfirmed: true,
        maxOnlineCharacters: 4,
      },
      scope: {
        observerOnly: true,
        lifecycleOnlyProbe: true,
        lifecycleMutationDispatched: true,
        gameplayMutationDispatched: false,
        valueMutationDispatched: false,
        policyOverride: true,
      },
      cleanup: {
        runtimeStateRestored: true,
      },
      ...overrides,
    },
  };
}

test("Full Autonomy live launcher accepts complete lifecycle-only rotation evidence", () => {
  const result = evaluateFullAutonomySupervisorResult(passingPayload());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "FULL_AUTONOMY_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidenceValid, true);
  assert.equal(result.scopeValid, true);
  assert.equal(result.cleanupValid, true);
});

test("Full Autonomy live launcher rejects missing Full Autonomy authority", () => {
  const payload = passingPayload();
  payload.result.evidence.targetAuthority = "ROTATION";

  const result = evaluateFullAutonomySupervisorResult(payload);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.evidenceValid, false);
});

test("Full Autonomy live launcher rejects gameplay or value mutations", () => {
  for (const key of ["gameplayMutationDispatched", "valueMutationDispatched"]) {
    const payload = passingPayload();
    payload.result.scope[key] = true;

    const result = evaluateFullAutonomySupervisorResult(payload);
    assert.equal(result.outcome, "FAIL");
    assert.equal(result.scopeValid, false);
  }
});

test("Full Autonomy live launcher requires runtime-state restore", () => {
  const payload = passingPayload();
  payload.result.cleanup.runtimeStateRestored = false;

  const result = evaluateFullAutonomySupervisorResult(payload);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.cleanupValid, false);
});

test("Full Autonomy compact output exposes lifecycle mutation and cleanup scope", () => {
  const output = formatCompactResult(
    evaluateFullAutonomySupervisorResult(passingPayload()),
  );

  assert.match(output, /Full Autonomy Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /Action: ROTATE/);
  assert.match(output, /Source character: My_Mage/);
  assert.match(output, /Target character: My_Merchant/);
  assert.match(output, /Rotation observed: yes/);
  assert.match(output, /Source authority: FULL_AUTONOMY/);
  assert.match(output, /Target authority: FULL_AUTONOMY/);
  assert.match(output, /Lifecycle-only runtime: yes/);
  assert.match(output, /Lifecycle mutation dispatched: yes/);
  assert.match(output, /Gameplay mutation dispatched: no/);
  assert.match(output, /Value mutation dispatched: no/);
  assert.match(output, /Runtime state restored: yes/);
});

test("Full Autonomy observer bootstrap always forces observer-only supervisor mode", () => {
  const env = observerRuntimeEnv({
    TEST_ENV: "kept",
    CARACAL_OBSERVER_ONLY: "0",
  });

  assert.equal(env.TEST_ENV, "kept");
  assert.equal(env.CARACAL_OBSERVER_ONLY, "1");
});

test("Full Autonomy launcher uses only the dedicated local test POST", async () => {
  const calls = [];
  const payload = passingPayload();

  const result = await runFullAutonomySupervisorLiveTest({
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
  assert.match(calls[0].url, /\/headless\/api\/tests\/full-autonomy$/);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
});

test("Full Autonomy live gate source stays lifecycle-only and preflight-gated", () => {
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_full_autonomy_live_e2e.js"),
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
  const characterThread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.match(launcher, /CARACAL_OBSERVER_ONLY:\s*"1"/);
  assert.match(launcher, /\/headless\/api\/state/);
  assert.match(launcher, /method:\s*"GET"/);
  assert.match(launcher, /\/headless\/api\/tests\/full-autonomy/);
  assert.match(launcher, /method:\s*"POST"/);
  assert.doesNotMatch(launcher, /\/headless\/api\/rotation/);
  assert.doesNotMatch(launcher, /\/control$/);

  assert.match(
    dashboard,
    /router\.post\("\/headless\/api\/tests\/full-autonomy"/,
  );
  assert.match(dashboard, /runFullAutonomyLiveTest/);

  assert.match(coordinator, /async function run_full_autonomy_live_test/);
  assert.match(coordinator, /FULL_AUTONOMY_LIVE_TEST_REQUIRES_OBSERVER_ONLY/);
  assert.match(coordinator, /FULL_AUTONOMY_LIVE_TEST_REQUIRES_IDLE_SUPERVISOR/);
  assert.match(coordinator, /FULL_AUTONOMY_LIVE_TEST_ROTATION_NOT_PLANNED/);
  assert.match(coordinator, /preflight_decision\.action\?\.type !== "ROTATE"/);
  assert.match(coordinator, /allowObserverOnly:\s*true/);
  assert.match(coordinator, /safetyBlockReason:\s*null/);
  assert.match(coordinator, /gameplayMutationDispatched:\s*false/);
  assert.match(coordinator, /valueMutationDispatched:\s*false/);
  assert.match(coordinator, /restore_full_autonomy_live_test_state/);
  assert.match(coordinator, /runtimeStateRestored/);

  assert.match(characterThread, /proc_args\.lifecycle_only_probe === true/);
  assert.match(characterThread, /extensions\.lifecycle_only_probe = true/);
  assert.match(characterThread, /type:\s*"connected"/);
  const bypassIndex = characterThread.indexOf(
    "proc_args.lifecycle_only_probe === true",
  );
  const runnerIndex = characterThread.indexOf(
    "const runner_context = await make_runner",
    bypassIndex,
  );
  assert.notEqual(bypassIndex, -1);
  assert.notEqual(runnerIndex, -1);
  assert.equal(bypassIndex < runnerIndex, true);
});

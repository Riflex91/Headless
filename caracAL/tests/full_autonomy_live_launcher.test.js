"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  evaluateFullAutonomyLiveResult,
  formatCompactResult,
  observerRuntimeEnv,
  parseCliArgs,
  runFullAutonomySupervisorLiveTest,
} = require("../scripts/run_full_autonomy_live_e2e");

function passingPayload() {
  return {
    result: {
      outcome: "PASS",
      reason: "FULL_AUTONOMY_LIVE_RECONCILIATION_CONFIRMED",
      character: "My_Merchant",
      role: "MERCHANT",
      plan: {
        state: "READY",
      },
      linkage: {
        accountStrategy: true,
        lifecycle: true,
        farming: true,
        merchant: true,
        economy: true,
        encounters: true,
      },
      decision: {
        state: "READY",
        reason: "FULL_AUTONOMY_START_REQUIRED",
        action: {
          type: "START",
          character: "My_Merchant",
        },
      },
      observed: {
        desiredState: "RUNNING",
        desiredStateSource: "FULL_AUTONOMY",
        lifecycleState: "ONLINE",
        connected: true,
        lifecycleOnlyProbe: true,
        selectedCharacters: 4,
        maxOnlineCharacters: 4,
      },
      scope: {
        observerOnly: true,
        lifecycleOnlyProbe: true,
        lifecycleMutationDispatched: true,
        socketConnectionDispatched: true,
        gameplayMutationDispatched: false,
        movementMutationDispatched: false,
        combatMutationDispatched: false,
        valueMutationDispatched: false,
        equipmentMutationDispatched: false,
      },
      cleanup: {
        runtimeStateRestored: true,
        probeProcessStopped: true,
        originalDesiredState: "STOPPED",
        originalDesiredStateSource: "CONFIG",
      },
    },
  };
}

test("Full Autonomy live evidence passes only with linked modules and restored lifecycle-only execution", () => {
  const result = evaluateFullAutonomyLiveResult(passingPayload());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "FULL_AUTONOMY_LIVE_RECONCILIATION_CONFIRMED");
  assert.equal(result.evidence.linkageComplete, true);
  assert.equal(result.evidence.desiredStateReconciled, true);
  assert.equal(result.evidence.lifecycleOnly, true);
  assert.equal(result.evidence.noGameplayMutation, true);
  assert.equal(result.evidence.noValueMutation, true);
  assert.equal(result.evidence.restored, true);
});

test("Full Autonomy live evidence does not pass without state restoration", () => {
  const payload = passingPayload();
  payload.result.cleanup.runtimeStateRestored = false;

  const result = evaluateFullAutonomyLiveResult(payload);

  assert.notEqual(result.outcome, "PASS");
  assert.equal(result.evidence.restored, false);
});

test("Full Autonomy live evidence rejects gameplay or value mutations", () => {
  const gameplay = passingPayload();
  gameplay.result.scope.gameplayMutationDispatched = true;
  assert.notEqual(evaluateFullAutonomyLiveResult(gameplay).outcome, "PASS");

  const value = passingPayload();
  value.result.scope.valueMutationDispatched = true;
  assert.notEqual(evaluateFullAutonomyLiveResult(value).outcome, "PASS");
});

test("Full Autonomy compact output exposes reconciliation and safety evidence", () => {
  const output = formatCompactResult(
    evaluateFullAutonomyLiveResult(passingPayload()),
  );

  assert.match(output, /Full Autonomy Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /Plan state: READY/);
  assert.match(output, /Account Strategy linked: yes/);
  assert.match(output, /Lifecycle linked: yes/);
  assert.match(output, /Farming linked: yes/);
  assert.match(output, /Merchant linked: yes/);
  assert.match(output, /Economy linked: yes/);
  assert.match(output, /Encounters linked: yes/);
  assert.match(output, /Selected characters: 4\/4/);
  assert.match(output, /Probe action: START/);
  assert.match(output, /Desired State reconciled: yes/);
  assert.match(output, /Desired State authority: FULL_AUTONOMY/);
  assert.match(output, /Lifecycle-only probe: yes/);
  assert.match(output, /Gameplay mutation dispatched: no/);
  assert.match(output, /Value mutation dispatched: no/);
  assert.match(output, /Runtime state restored: yes/);
  assert.match(output, /Probe process stopped: yes/);
});

test("Full Autonomy supervisor live test uses only the dedicated local POST", async () => {
  const calls = [];
  const payload = passingPayload();

  const result = await runFullAutonomySupervisorLiveTest("My_Merchant", 900, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
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
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    character: "My_Merchant",
    settleMs: 900,
  });
});

test("Full Autonomy live launcher forces observer-only temporary runtime mode", () => {
  const env = observerRuntimeEnv({
    TEST_ENV: "kept",
    CARACAL_OBSERVER_ONLY: "0",
  });

  assert.equal(env.TEST_ENV, "kept");
  assert.equal(env.CARACAL_OBSERVER_ONLY, "1");
});

test("Full Autonomy live launcher parses optional character and verbose mode", () => {
  assert.deepEqual(parseCliArgs(["--character=My_Ranger2", "--verbose"]), {
    requestedCharacter: "My_Ranger2",
    verbose: true,
  });
  assert.deepEqual(parseCliArgs([]), {
    requestedCharacter: null,
    verbose: false,
  });
});

test("Full Autonomy live wiring uses shared production dispatch and lifecycle-only runtime", () => {
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
  assert.match(launcher, /\/headless\/api\/tests\/full-autonomy/);
  assert.match(launcher, /method:\s*"POST"/);
  assert.doesNotMatch(launcher, /\/headless\/api\/rotation/);
  assert.doesNotMatch(launcher, /\/characters\/.*\/control/);

  assert.match(coordinator, /async function run_full_autonomy_live_test/);
  assert.match(coordinator, /dispatch_full_autonomy_decision/);
  assert.match(coordinator, /authority:\s*"FULL_AUTONOMY"/);
  assert.match(coordinator, /FULL_AUTONOMY_LIVE_TEST_OBSERVER_ONLY_REQUIRED/);
  assert.match(coordinator, /FULL_AUTONOMY_LIVE_TEST_SUPERVISOR_NOT_READY/);
  assert.match(coordinator, /coordinator_ready = true/);
  assert.match(
    coordinator,
    /lifecycle_only_probe:\s*char_block\.lifecycle_only_probe/,
  );
  assert.match(coordinator, /gameplayMutationDispatched:\s*false/);
  assert.match(coordinator, /valueMutationDispatched:\s*false/);
  assert.match(coordinator, /runtimeStateRestored/);
  assert.match(coordinator, /probeProcessStopped/);

  assert.match(dashboard, /\/headless\/api\/tests\/full-autonomy/);
  assert.match(dashboard, /runFullAutonomyLiveTest/);

  assert.match(characterThread, /proc_args\.lifecycle_only_probe === true/);
  assert.match(characterThread, /extensions\.lifecycle_only_probe = true/);
  assert.match(
    characterThread,
    /sendIpcMessage\(process, \{ type: "connected" \}\)/,
  );
});

test("Full Autonomy lifecycle-only branch returns before runner construction", () => {
  const characterThread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const probe = characterThread.indexOf(
    "if (proc_args.lifecycle_only_probe === true)",
  );
  const runner = characterThread.indexOf("const is_typescript =", probe);

  assert.notEqual(probe, -1);
  assert.notEqual(runner, -1);
  assert.match(characterThread.slice(probe, runner), /return;/);
});

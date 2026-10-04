"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  armedPrerequisites,
  evaluateArmedResult,
  evaluateReadOnly,
  observerRuntimeEnv,
  parseCliArgs,
  requestDispatch,
} = require("../scripts/run_goal_dispatch_live_e2e");

function snapshot({
  enabled = true,
  state = "READY",
  dispatchAllowed = true,
  pending = 0,
  unknownHold = null,
} = {}) {
  return {
    goal_execution: {
      enabled,
      state,
      reason:
        state === "READY"
          ? "GOAL_EXECUTION_ADAPTER_DISPATCH_READY"
          : "GOAL_EXECUTION_DISABLED",
      dispatchAllowed,
      dispatchImplemented: false,
      mutationDispatched: false,
      action:
        state === "READY"
          ? {
              type: "GOAL_HANDOFF",
              goalId: "goal-1",
              taskId: "goal-1:3",
              kind: "FARM_ITEM",
            }
          : null,
    },
    goal_adapter: {
      state: state === "READY" ? "READY" : "EMPTY",
      reason:
        state === "READY"
          ? "GOAL_ADAPTER_FARM_REQUEST_READY"
          : "GOAL_ADAPTER_EXECUTION_DISABLED",
      dispatchAllowed: false,
      dispatchImplemented: false,
      requestDispatched: false,
      mutationDispatched: false,
      request:
        state === "READY"
          ? {
              version: 1,
              type: "GOAL_RUNTIME_METHOD",
              goalId: "goal-1",
              taskId: "goal-1:3",
              kind: "FARM_ITEM",
              characterName: "My_Ranger1",
              dispatchAllowed: false,
              dispatchImplemented: false,
            }
          : null,
    },
    goal_dispatch: {
      implemented: true,
      explicitOneShotOnly: true,
      automaticReconcileEnabled: false,
      retryEnabled: false,
      preflightRequired: true,
      currentServerPlanOnly: true,
      staleIdentityGuardRequired: true,
      pending,
      timeoutMs: 420000,
      unknownHold,
      lastResult: null,
    },
  };
}

function dispatchPayload({ outcome = "PASS", unknownHoldActive = false } = {}) {
  return {
    result: {
      requestId: "goal-adapter-dispatch-1",
      characterName: "My_Ranger1",
      error: null,
      result: {
        requestId: "goal-adapter-dispatch-1",
        outcome,
        reason:
          outcome === "PASS"
            ? "GOAL_ADAPTER_DISPATCH_FARM_CONFIRMED"
            : "GOAL_ADAPTER_DISPATCH_FARM_UNKNOWN",
        goalId: "goal-1",
        taskId: "goal-1:3",
        kind: "FARM_ITEM",
        scope: {
          authorized: true,
          preflightRequired: true,
          maxExecutionInvocations: 1,
          blindRetryUsed: false,
          mutationPathInvoked: true,
        },
      },
      scope: {
        explicitOneShot: true,
        preflightVerified: true,
        retryUsed: false,
        unknownHoldActive,
      },
    },
  };
}

test("armed mode requires both CLI and environment opt-in", () => {
  assert.equal(parseCliArgs([], {}).armed, false);
  assert.equal(
    parseCliArgs(["--armed"], { CARACAL_GOAL_DISPATCH_ARMED: "0" }).armed,
    false,
  );
  assert.equal(
    parseCliArgs([], { CARACAL_GOAL_DISPATCH_ARMED: "1" }).armed,
    false,
  );
  assert.equal(
    parseCliArgs(["--armed"], { CARACAL_GOAL_DISPATCH_ARMED: "1" }).armed,
    true,
  );
});

test("read-only mode accepts default-OFF dispatch infrastructure without mutation", () => {
  const result = evaluateReadOnly(
    snapshot({
      enabled: false,
      state: "DISABLED",
      dispatchAllowed: false,
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_DISPATCH_LIVE_READ_ONLY_CONFIRMED");
  assert.equal(result.scope.armed, false);
  assert.equal(result.scope.dashboardGetOnly, true);
  assert.equal(result.scope.dispatchRequested, false);
  assert.equal(result.scope.gameplayMutationDispatched, false);
  assert.equal(result.scope.valueMutationDispatched, false);
  assert.equal(result.scope.lifecycleMutationDispatched, false);
});

test("observer bootstrap always forces observer-only mode", () => {
  const env = observerRuntimeEnv({
    CARACAL_OBSERVER_ONLY: "0",
    KEEP: "yes",
  });

  assert.equal(env.CARACAL_OBSERVER_ONLY, "1");
  assert.equal(env.KEEP, "yes");
});

test("armed prerequisites require READY execution, explicit target, no pending and no hold", () => {
  assert.equal(armedPrerequisites(snapshot()).ready, true);

  const disabled = armedPrerequisites(
    snapshot({
      enabled: false,
      state: "DISABLED",
      dispatchAllowed: false,
    }),
  );
  assert.equal(disabled.ready, false);
  assert.ok(disabled.errors.includes("GOAL_EXECUTION_DISABLED"));

  const pending = armedPrerequisites(snapshot({ pending: 1 }));
  assert.equal(pending.ready, false);
  assert.ok(pending.errors.includes("GOAL_DISPATCH_ALREADY_RUNNING"));

  const held = armedPrerequisites(
    snapshot({
      unknownHold: {
        active: true,
        reason: "GOAL_ADAPTER_DISPATCH_TIMEOUT_OUTCOME_UNKNOWN",
      },
    }),
  );
  assert.equal(held.ready, false);
  assert.ok(held.errors.includes("GOAL_DISPATCH_UNKNOWN_HOLD_ACTIVE"));
});

test("armed request sends only expected Goal identity and never an adapter request", async () => {
  const calls = [];
  const before = snapshot();
  const response = await requestDispatch(before, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(dispatchPayload());
        },
      };
    },
  });

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/headless\/api\/goals\/adapter-dispatch$/);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    expectedGoalId: "goal-1",
    expectedTaskId: "goal-1:3",
  });
  assert.doesNotMatch(calls[0].options.body, /"request"/);
  assert.doesNotMatch(calls[0].options.body, /characterName/);
});

test("armed PASS evidence proves exact identity and one-shot runtime scope", () => {
  const before = snapshot();
  const response = {
    ok: true,
    status: 200,
    body: dispatchPayload(),
  };
  const after = snapshot();

  const result = evaluateArmedResult(before, response, after);

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_DISPATCH_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.identityValid, true);
  assert.equal(result.evidence.oneShotValid, true);
  assert.equal(result.evidence.terminalOutcome, true);
  assert.equal(result.evidence.dispatchPendingAfter, 0);
  assert.equal(result.scope.armed, true);
  assert.equal(result.scope.dispatchRequested, true);
  assert.equal(result.scope.preflightVerified, true);
  assert.equal(result.scope.retryUsed, false);
  assert.equal(result.scope.maxExecutionInvocations, 1);
});

test("armed UNKNOWN is valid evidence only when persistent hold is active", () => {
  const before = snapshot();
  const response = {
    ok: true,
    status: 200,
    body: dispatchPayload({
      outcome: "UNKNOWN",
      unknownHoldActive: true,
    }),
  };

  const withoutHold = evaluateArmedResult(before, response, snapshot());
  assert.equal(withoutHold.outcome, "FAIL");
  assert.equal(withoutHold.evidence.unknownOutcome, true);
  assert.equal(withoutHold.evidence.holdValid, false);

  const withHold = evaluateArmedResult(
    before,
    response,
    snapshot({
      unknownHold: {
        active: true,
        reason: "GOAL_ADAPTER_DISPATCH_UNKNOWN_HOLD",
      },
    }),
  );
  assert.equal(withHold.outcome, "PASS");
  assert.equal(withHold.evidence.holdValid, true);
  assert.equal(withHold.evidence.unknownHoldActiveAfter, true);
});

test("launcher source keeps observer bootstrap out of armed execution path", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_goal_dispatch_live_e2e.js"),
    "utf8",
  );

  assert.match(source, /CARACAL_GOAL_DISPATCH_ARMED/);
  assert.match(source, /--armed/);
  assert.match(source, /if \(!args\.armed\)/);
  assert.match(source, /inspectWithObserverBootstrap/);
  assert.match(source, /await readState\(\)/);
  assert.match(source, /UNKNOWN\/TIMEOUT is terminal/);
  assert.doesNotMatch(source, /setInterval\s*\(/);

  const armedStart = source.indexOf("let before;");
  const requestStart = source.indexOf(
    "const response = await requestDispatch",
    armedStart,
  );
  assert.ok(armedStart >= 0);
  assert.ok(requestStart > armedStart);
  const armedBlock = source.slice(armedStart, requestStart);
  assert.doesNotMatch(armedBlock, /startManagedRuntime/);
  assert.doesNotMatch(armedBlock, /ensureDashboardAvailable/);
  assert.doesNotMatch(armedBlock, /startObserverRuntime/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { GoalReconciler } = require("../src/GoalReconciler");
const {
  requestFingerprint,
} = require("../src/GoalAdapterDispatchSupervisor");

function request(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "goal-1",
    taskId: "goal-1:1",
    kind: "TRAIN_CHARACTER",
    bridge: "CharacterTrainingTaskRunner",
    runtimeMethod: "runCharacterTrainingTask",
    characterName: "My_Mage",
    arguments: { targetLevel: 42, monsterType: "goo" },
    dispatchAllowed: false,
    dispatchImplemented: false,
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    enabled: true,
    state: "READY",
    reason: "GOAL_EXECUTION_ADAPTER_DISPATCH_READY",
    dispatchAllowed: true,
    dispatchImplemented: false,
    mutationDispatched: false,
    action: {
      goalId: "goal-1",
      taskId: "goal-1:1",
      kind: "TRAIN_CHARACTER",
    },
    ...overrides,
  };
}

function adapter(req = request(), overrides = {}) {
  return {
    state: "READY",
    reason: "GOAL_ADAPTER_TRAINING_REQUEST_READY",
    dispatchAllowed: false,
    dispatchImplemented: false,
    requestDispatched: false,
    mutationDispatched: false,
    request: req,
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    requestId: "dispatch-1",
    characterName: "My_Mage",
    error: null,
    result: {
      outcome: "PASS",
      reason: "GOAL_ADAPTER_DISPATCH_TRAINING_CONFIRMED",
      goalId: "goal-1",
      taskId: "goal-1:1",
      kind: "TRAIN_CHARACTER",
      ...overrides,
    },
    scope: {
      explicitOneShot: true,
      preflightVerified: true,
      retryUsed: false,
      unknownHoldActive: false,
    },
  };
}

function setup({
  enabled = true,
  execution = decision(),
  plan = adapter(),
  dispatchState = {
    active: false,
    pending: 0,
    unknownHold: null,
  },
  dispatchImpl = async () => response(),
} = {}) {
  const state = { execution, plan, dispatchState };
  const calls = [];
  const persisted = [];
  const emitted = [];
  let now = 1000;
  const reconciler = new GoalReconciler({
    enabled,
    reconcileIntervalMs: 5000,
    getExecutionDecision: () => {
      calls.push(["decision"]);
      return state.execution;
    },
    getAdapterPlan: () => {
      calls.push(["adapter"]);
      return state.plan;
    },
    getDispatchState: () => state.dispatchState,
    dispatch: async (input) => {
      calls.push(["dispatch", input]);
      return dispatchImpl(input);
    },
    emit: (event, characterName, details) =>
      emitted.push({ event, characterName, details }),
    persistLastCycle: async (cycle) => persisted.push(cycle),
    now: () => now++,
  });
  return { reconciler, state, calls, persisted, emitted };
}

test("reconciler is default-safe and dispatches nothing when disabled", async () => {
  const s = setup({ enabled: false });
  const result = await s.reconciler.run();

  assert.equal(result.state, "DISABLED");
  assert.equal(result.reason, "GOAL_RECONCILE_DISABLED");
  assert.equal(result.dispatched, false);
  assert.equal(s.calls.some(([name]) => name === "dispatch"), false);
  assert.equal(s.reconciler.snapshot().maxActionsPerCycle, 1);
  assert.equal(s.reconciler.snapshot().blindRetryEnabled, false);
});

test("non-READY execution is a no-op and never reaches adapter dispatch", async () => {
  const s = setup({
    execution: decision({
      state: "STABLE",
      reason: "GOAL_EXECUTION_NO_READY_HANDOFF",
      dispatchAllowed: false,
      action: null,
    }),
  });

  const result = await s.reconciler.run();

  assert.equal(result.state, "STABLE");
  assert.equal(result.reason, "GOAL_EXECUTION_NO_READY_HANDOFF");
  assert.equal(result.dispatched, false);
  assert.deepEqual(s.calls, [["decision"]]);
});

test("READY cycle dispatches exactly one current Goal task", async () => {
  const s = setup();
  const result = await s.reconciler.run("INTERVAL");

  assert.equal(result.state, "DISPATCHED");
  assert.equal(result.reason, "GOAL_RECONCILE_DISPATCH_CONFIRMED");
  assert.equal(result.dispatched, true);
  assert.equal(result.goalId, "goal-1");
  assert.equal(result.taskId, "goal-1:1");
  assert.equal(result.runtimeOutcome, "PASS");
  assert.equal(result.scope.maxActionsPerCycle, 1);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(result.scope.preflightVerified, true);
  assert.deepEqual(
    s.calls.filter(([name]) => name === "dispatch"),
    [
      [
        "dispatch",
        {
          expectedGoalId: "goal-1",
          expectedTaskId: "goal-1:1",
        },
      ],
    ],
  );
  assert.equal(s.persisted.length, 1);
});

test("each reconcile cycle reads a fresh execution and adapter plan", async () => {
  const s = setup();
  await s.reconciler.run("FIRST");

  const nextRequest = request({
    goalId: "goal-2",
    taskId: "goal-2:4",
    kind: "ACCUMULATE_GOLD",
    characterName: "My_Rogue",
  });
  s.state.execution = decision({
    action: {
      goalId: "goal-2",
      taskId: "goal-2:4",
      kind: "ACCUMULATE_GOLD",
    },
  });
  s.state.plan = adapter(nextRequest);

  await s.reconciler.run("SECOND");

  const dispatches = s.calls.filter(([name]) => name === "dispatch");
  assert.equal(dispatches.length, 2);
  assert.deepEqual(dispatches[1][1], {
    expectedGoalId: "goal-2",
    expectedTaskId: "goal-2:4",
  });
});

test("exact persisted UNKNOWN hold blocks mutation before dispatch", async () => {
  const req = request();
  const s = setup({
    plan: adapter(req),
    dispatchState: {
      active: false,
      pending: 0,
      unknownHold: {
        active: true,
        requestId: "unknown-1",
        requestFingerprint: requestFingerprint(req),
        reason: "GOAL_ADAPTER_DISPATCH_TIMEOUT_OUTCOME_UNKNOWN",
      },
    },
  });

  const result = await s.reconciler.run();

  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reason, "GOAL_RECONCILE_UNKNOWN_HOLD_ACTIVE");
  assert.equal(result.dispatched, false);
  assert.equal(result.unknownHoldActive, true);
  assert.equal(s.calls.some(([name]) => name === "dispatch"), false);
});

test("superseded UNKNOWN fingerprint is allowed to reach supervisor dispatch", async () => {
  const old = request({ arguments: { targetLevel: 41, monsterType: "goo" } });
  const current = request();
  const s = setup({
    plan: adapter(current),
    dispatchState: {
      active: false,
      pending: 0,
      unknownHold: {
        active: true,
        requestId: "old",
        requestFingerprint: requestFingerprint(old),
        reason: "OLD_UNKNOWN",
      },
    },
  });

  const result = await s.reconciler.run();

  assert.equal(result.state, "DISPATCHED");
  assert.equal(s.calls.filter(([name]) => name === "dispatch").length, 1);
});

test("runtime UNKNOWN hold ends the cycle and prevents immediate follow-up mutation", async () => {
  const req = request();
  const s = setup({
    dispatchImpl: async () => ({
      ...response({
        outcome: "UNKNOWN",
        reason: "GOAL_ADAPTER_DISPATCH_TRAINING_UNKNOWN",
      }),
      scope: {
        explicitOneShot: true,
        preflightVerified: true,
        retryUsed: false,
        unknownHoldActive: true,
      },
    }),
  });

  const first = await s.reconciler.run();
  assert.equal(first.state, "BLOCKED");
  assert.equal(first.reason, "GOAL_RECONCILE_UNKNOWN_HOLD_SET");
  assert.equal(first.unknownHoldActive, true);

  s.state.dispatchState = {
    active: false,
    pending: 0,
    unknownHold: {
      active: true,
      requestId: "dispatch-1",
      requestFingerprint: requestFingerprint(req),
      reason: "UNKNOWN",
    },
  };
  const second = await s.reconciler.run();

  assert.equal(second.reason, "GOAL_RECONCILE_UNKNOWN_HOLD_ACTIVE");
  assert.equal(s.calls.filter(([name]) => name === "dispatch").length, 1);
});

test("concurrent reconcile call cannot start a second dispatch", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const s = setup({
    dispatchImpl: async () => {
      await gate;
      return response();
    },
  });

  const first = s.reconciler.run("FIRST");
  await new Promise((resolve) => setImmediate(resolve));
  const second = await s.reconciler.run("SECOND");

  assert.equal(second.state, "BLOCKED");
  assert.equal(second.reason, "GOAL_RECONCILE_ALREADY_RUNNING");
  assert.equal(s.calls.filter(([name]) => name === "dispatch").length, 1);

  release();
  const firstResult = await first;
  assert.equal(firstResult.state, "DISPATCHED");
});

test("dispatch UNKNOWN exception becomes a blocked cycle without retry", async () => {
  const error = new Error("unknown result");
  error.code = "GOAL_ADAPTER_DISPATCH_OUTCOME_UNKNOWN";
  const s = setup({
    dispatchImpl: async () => {
      throw error;
    },
  });

  const result = await s.reconciler.run();

  assert.equal(result.state, "BLOCKED");
  assert.equal(result.reason, "GOAL_RECONCILE_UNKNOWN_HOLD_ACTIVE");
  assert.equal(result.unknownHoldActive, true);
  assert.equal(s.calls.filter(([name]) => name === "dispatch").length, 1);
});

test("reconciler itself contains no timer, lifecycle or retry loop", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalReconciler.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /controlRotation/);
  assert.doesNotMatch(source, /while\s*\(/);
  assert.match(source, /maxActionsPerCycle:\s*1/);
  assert.match(source, /blindRetryEnabled:\s*false/);
  assert.match(source, /requiresFreshPlanEachCycle:\s*true/);
});

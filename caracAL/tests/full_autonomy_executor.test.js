"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFullAutonomyExecutionDecision,
  readFullAutonomyExecutionPolicy,
} = require("../src/FullAutonomyExecutor");

function recommendation(
  name,
  {
    selected,
    currentDesiredState,
    desiredStateSource = "CONFIG",
    lifecycleState = "STOPPED",
    connected = false,
    manualStopProtected = false,
  },
) {
  return {
    name,
    selected,
    manualStopProtected,
    currentDesiredState,
    desiredStateSource,
    recommendedDesiredState: selected ? "RUNNING" : "STOPPED",
    signals: {
      lifecycle: {
        state: lifecycleState,
        connected,
        enabled: currentDesiredState !== "STOPPED",
      },
    },
  };
}

function plan(recommendations, overrides = {}) {
  return {
    state: "READY",
    maxOnlineCharacters: 4,
    recommendations,
    ...overrides,
  };
}

const enabledPolicy = {
  enabled: true,
  reconcileIntervalMs: 5000,
  maxActionsPerCycle: 1,
};

test("Full Autonomy execution is disabled by default", () => {
  const policy = readFullAutonomyExecutionPolicy({});
  const decision = buildFullAutonomyExecutionDecision(plan([]), { policy });

  assert.equal(policy.enabled, false);
  assert.equal(decision.state, "DISABLED");
  assert.equal(decision.reason, "FULL_AUTONOMY_EXECUTION_DISABLED");
  assert.equal(decision.action, null);
});

test("Full Autonomy execution policy is explicitly opt-in and bounded", () => {
  assert.deepEqual(
    readFullAutonomyExecutionPolicy({
      full_autonomy: {
        enabled: true,
        reconcile_interval_ms: 50,
      },
    }),
    {
      enabled: true,
      reconcileIntervalMs: 1000,
      maxActionsPerCycle: 1,
    },
  );
});

test("Observer-only, emergency stop, shutdown and in-flight execution block mutations", () => {
  const source = plan([
    recommendation("My_Merchant", {
      selected: true,
      currentDesiredState: "STOPPED",
    }),
  ]);

  const cases = [
    [{ observerOnly: true }, "FULL_AUTONOMY_OBSERVER_ONLY"],
    [{ emergencyStopActive: true }, "FULL_AUTONOMY_EMERGENCY_STOP_ACTIVE"],
    [
      { coordinatorShuttingDown: true },
      "FULL_AUTONOMY_COORDINATOR_SHUTTING_DOWN",
    ],
    [{ executionInFlight: true }, "FULL_AUTONOMY_EXECUTION_IN_FLIGHT"],
  ];

  for (const [flags, reason] of cases) {
    const decision = buildFullAutonomyExecutionDecision(source, {
      policy: enabledPolicy,
      ...flags,
    });
    assert.equal(decision.state, "BLOCKED");
    assert.equal(decision.reason, reason);
    assert.equal(decision.action, null);
  }
});

test("Account Strategy readiness gates lifecycle execution", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([], { state: "PARTIAL" }),
    { policy: enabledPolicy },
  );

  assert.equal(decision.state, "BLOCKED");
  assert.equal(decision.reason, "FULL_AUTONOMY_PLAN_NOT_READY");
});

test("Lifecycle transitions block overlapping autonomy actions", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Merchant", {
        selected: true,
        currentDesiredState: "RUNNING",
        lifecycleState: "CONNECTING",
      }),
      recommendation("My_Mage", {
        selected: true,
        currentDesiredState: "STOPPED",
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.equal(decision.state, "BLOCKED");
  assert.equal(decision.reason, "FULL_AUTONOMY_LIFECYCLE_TRANSITION_ACTIVE");
  assert.equal(decision.blockedCharacter, "My_Merchant");
  assert.equal(decision.action, null);
});

test("Executor selects rotation when target must start and an unselected character is active", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Merchant", {
        selected: true,
        currentDesiredState: "RUNNING",
        lifecycleState: "ONLINE",
        connected: true,
      }),
      recommendation("My_Warrior", {
        selected: false,
        currentDesiredState: "RUNNING",
        lifecycleState: "ONLINE",
        connected: true,
      }),
      recommendation("My_Mage", {
        selected: true,
        currentDesiredState: "STOPPED",
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.equal(decision.state, "READY");
  assert.equal(decision.reason, "FULL_AUTONOMY_ROTATION_REQUIRED");
  assert.deepEqual(decision.action, {
    type: "ROTATE",
    startCharacter: "My_Mage",
    stopCharacter: "My_Warrior",
  });
});

test("Executor starts a selected stopped character when a slot is free", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Merchant", {
        selected: true,
        currentDesiredState: "RUNNING",
        lifecycleState: "ONLINE",
        connected: true,
      }),
      recommendation("My_Mage", {
        selected: true,
        currentDesiredState: "STOPPED",
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.deepEqual(decision.action, {
    type: "START",
    character: "My_Mage",
  });
});

test("Executor resumes an autonomy-paused selected character", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Mage", {
        selected: true,
        currentDesiredState: "PAUSED",
        desiredStateSource: "FULL_AUTONOMY",
        lifecycleState: "PAUSED",
        connected: true,
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.deepEqual(decision.action, {
    type: "RESUME",
    character: "My_Mage",
  });
});

test("Manual pause is never overridden automatically", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Mage", {
        selected: true,
        currentDesiredState: "PAUSED",
        desiredStateSource: "MANUAL_PAUSE",
        lifecycleState: "PAUSED",
        connected: true,
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.equal(decision.state, "STABLE");
  assert.equal(decision.action, null);
});

test("Manual stop protection never produces a start action", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Warrior", {
        selected: false,
        currentDesiredState: "STOPPED",
        desiredStateSource: "MANUAL_STOP",
        manualStopProtected: true,
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.equal(decision.state, "STABLE");
  assert.equal(decision.action, null);
});

test("Executor stops an unselected running character when no replacement is needed", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Ranger3", {
        selected: false,
        currentDesiredState: "RUNNING",
        lifecycleState: "ONLINE",
        connected: true,
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.deepEqual(decision.action, {
    type: "STOP",
    character: "My_Ranger3",
  });
});

test("Executor never dispatches more than one action per cycle", () => {
  const decision = buildFullAutonomyExecutionDecision(
    plan([
      recommendation("My_Ranger1", {
        selected: true,
        currentDesiredState: "STOPPED",
      }),
      recommendation("My_Ranger2", {
        selected: true,
        currentDesiredState: "STOPPED",
      }),
    ]),
    { policy: enabledPolicy },
  );

  assert.equal(decision.maxActionsPerCycle, 1);
  assert.deepEqual(decision.action, {
    type: "START",
    character: "My_Ranger1",
  });
});

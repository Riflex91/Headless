"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL_EXECUTION_STATES,
  actionFromHandoff,
  buildGoalExecutionDecision,
  handoffSafetyEvidence,
  readGoalExecutionPolicy,
} = require("../src/GoalExecutor");

const enabledPolicy = {
  enabled: true,
  reconcileIntervalMs: 5000,
  maxActionsPerCycle: 1,
};

function readyHandoff({
  kind = "FARM_ITEM",
  adapter = "FarmIntelligence",
  subsystem = "FullAutonomy/FarmIntelligence",
  mutationDomain = "GAMEPLAY",
  fullAutonomyRequired = true,
  fullAutonomySatisfied = true,
} = {}) {
  return {
    timestamp: 1000,
    state: "READY",
    reason: "GOAL_HANDOFF_READY",
    readOnly: true,
    executionEnabled: false,
    handoffDispatched: false,
    gameplayMutationDispatched: false,
    valueMutationDispatched: false,
    lifecycleMutationDispatched: false,
    selectedGoal: {
      goalId: "goal-1",
      type: "FARM_ITEM",
      priority: 90,
      characterName: "My_Ranger1",
      state: "PLANNED",
      reason: "GOAL_PLAN_READY",
      target: {
        itemName: "gem0",
        quantity: 10,
      },
      metadata: {},
    },
    handoff: {
      taskId: "goal-1:3",
      kind,
      mode: "EXECUTION_INTENT",
      adapter,
      subsystem,
      mutationDomain,
      characterName: "My_Ranger1",
      target: {
        itemName: "gem0",
        quantity: 10,
      },
      dispatchAllowed: false,
      executionEnabled: false,
      mutationDispatched: false,
      goalExecutorRequired: true,
      fullAutonomy: {
        required: fullAutonomyRequired,
        executionEnabled: fullAutonomyRequired,
        state: fullAutonomyRequired ? "STABLE" : null,
        reason: fullAutonomyRequired ? "FULL_AUTONOMY_RECONCILED" : null,
        satisfied: fullAutonomySatisfied,
      },
    },
    blockedGoals: [],
    summary: {
      totalGoals: 1,
      activeGoals: 1,
      readyGoals: 1,
      blockedGoals: 0,
    },
    safety: {
      valid: true,
      readOnly: true,
      executionDisabled: true,
      noMutationDispatched: true,
      policyValid: true,
      tasksSafe: true,
    },
  };
}

test("Goal execution is disabled by default", () => {
  const policy = readGoalExecutionPolicy({});
  const decision = buildGoalExecutionDecision(readyHandoff(), { policy });

  assert.equal(policy.enabled, false);
  assert.equal(decision.state, GOAL_EXECUTION_STATES.DISABLED);
  assert.equal(decision.reason, "GOAL_EXECUTION_DISABLED");
  assert.equal(decision.action, null);
  assert.equal(decision.dispatchAllowed, false);
  assert.equal(decision.dispatchImplemented, false);
  assert.equal(decision.mutationDispatched, false);
});

test("Goal execution policy is explicit opt-in and bounded", () => {
  assert.deepEqual(
    readGoalExecutionPolicy({
      goal_execution: {
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

test("Observer, emergency stop, shutdown and in-flight execution fail closed", () => {
  const cases = [
    [{ observerOnly: true }, "GOAL_EXECUTION_OBSERVER_ONLY"],
    [{ emergencyStopActive: true }, "GOAL_EXECUTION_EMERGENCY_STOP_ACTIVE"],
    [
      { coordinatorShuttingDown: true },
      "GOAL_EXECUTION_COORDINATOR_SHUTTING_DOWN",
    ],
    [{ executionInFlight: true }, "GOAL_EXECUTION_IN_FLIGHT"],
  ];

  for (const [flags, reason] of cases) {
    const decision = buildGoalExecutionDecision(readyHandoff(), {
      policy: enabledPolicy,
      ...flags,
    });
    assert.equal(decision.state, GOAL_EXECUTION_STATES.BLOCKED);
    assert.equal(decision.reason, reason);
    assert.equal(decision.action, null);
    assert.equal(decision.dispatchAllowed, false);
  }
});

test("Controlled operations block Goal execution decisions", () => {
  const decision = buildGoalExecutionDecision(readyHandoff(), {
    policy: enabledPolicy,
    safetyBlockReason: "CONTROLLED_OPERATION_ACTIVE",
  });

  assert.equal(decision.state, GOAL_EXECUTION_STATES.BLOCKED);
  assert.equal(decision.reason, "GOAL_EXECUTION_SAFETY_BLOCK_ACTIVE");
  assert.equal(decision.safetyBlockReason, "CONTROLLED_OPERATION_ACTIVE");
  assert.equal(decision.action, null);
});

test("Empty and blocked Goal handoffs never become dispatch actions", () => {
  const empty = buildGoalExecutionDecision(
    {
      state: "EMPTY",
      reason: "GOAL_HANDOFF_NO_READY_GOAL",
    },
    { policy: enabledPolicy },
  );
  assert.equal(empty.state, GOAL_EXECUTION_STATES.STABLE);
  assert.equal(empty.reason, "GOAL_EXECUTION_NO_READY_HANDOFF");
  assert.equal(empty.action, null);

  const blocked = buildGoalExecutionDecision(
    {
      state: "BLOCKED",
      reason: "GOAL_HANDOFF_ALL_ACTIVE_GOALS_BLOCKED",
    },
    { policy: enabledPolicy },
  );
  assert.equal(blocked.state, GOAL_EXECUTION_STATES.BLOCKED);
  assert.equal(blocked.reason, "GOAL_EXECUTION_HANDOFF_NOT_READY");
  assert.equal(blocked.handoffState, "BLOCKED");
  assert.equal(blocked.action, null);
});

test("Unsafe handoff projections are rejected before adapter selection", () => {
  const unsafe = readyHandoff();
  unsafe.gameplayMutationDispatched = true;

  const evidence = handoffSafetyEvidence(unsafe);
  const decision = buildGoalExecutionDecision(unsafe, {
    policy: enabledPolicy,
  });

  assert.equal(evidence.valid, false);
  assert.equal(evidence.rootSafe, false);
  assert.equal(decision.state, GOAL_EXECUTION_STATES.BLOCKED);
  assert.equal(decision.reason, "GOAL_EXECUTION_HANDOFF_SAFETY_INVALID");
  assert.equal(decision.action, null);
});

test("Required Full Autonomy readiness gates Goal execution", () => {
  const decision = buildGoalExecutionDecision(
    readyHandoff({
      fullAutonomyRequired: true,
      fullAutonomySatisfied: false,
    }),
    { policy: enabledPolicy },
  );

  assert.equal(decision.state, GOAL_EXECUTION_STATES.BLOCKED);
  assert.equal(decision.reason, "GOAL_EXECUTION_FULL_AUTONOMY_NOT_READY");
  assert.equal(decision.action, null);
});

test("Non-lifecycle Goal routes do not require Full Autonomy readiness", () => {
  const decision = buildGoalExecutionDecision(
    readyHandoff({
      kind: "PLAN_CRAFT",
      adapter: "CraftController/EconomyArbiter",
      subsystem: "CraftController/EconomyArbiter",
      mutationDomain: "VALUE",
      fullAutonomyRequired: false,
      fullAutonomySatisfied: false,
    }),
    { policy: enabledPolicy },
  );

  assert.equal(decision.state, GOAL_EXECUTION_STATES.READY);
  assert.equal(decision.reason, "GOAL_EXECUTION_ADAPTER_DISPATCH_READY");
  assert.equal(decision.action.kind, "PLAN_CRAFT");
  assert.equal(decision.dispatchAllowed, true);
  assert.equal(decision.dispatchImplemented, false);
  assert.equal(decision.mutationDispatched, false);
});

test("Ready handoff becomes one adapter-dispatch decision without mutation", () => {
  const source = readyHandoff();
  const action = actionFromHandoff(source);
  const decision = buildGoalExecutionDecision(source, {
    policy: enabledPolicy,
  });

  assert.deepEqual(action, {
    type: "GOAL_HANDOFF",
    goalId: "goal-1",
    taskId: "goal-1:3",
    kind: "FARM_ITEM",
    adapter: "FarmIntelligence",
    subsystem: "FullAutonomy/FarmIntelligence",
    mutationDomain: "GAMEPLAY",
    characterName: "My_Ranger1",
    target: {
      itemName: "gem0",
      quantity: 10,
    },
    metadata: {},
    requiresAdapterDispatcher: true,
  });
  assert.deepEqual(decision.action, action);
  assert.equal(decision.maxActionsPerCycle, 1);
  assert.equal(decision.dispatchAllowed, true);
  assert.equal(decision.dispatchImplemented, false);
  assert.equal(decision.mutationDispatched, false);
});

test("Goal execution decision preserves adapter runtime metadata", () => {
  const source = readyHandoff();
  source.selectedGoal.metadata = {
    runtime: {
      workerCharacter: "My_Ranger1",
      monsterType: "goo",
    },
  };

  const decision = buildGoalExecutionDecision(source, {
    policy: enabledPolicy,
  });

  assert.deepEqual(decision.action.metadata, {
    runtime: {
      workerCharacter: "My_Ranger1",
      monsterType: "goo",
    },
  });
});

test("Unsupported handoff kinds fail closed", () => {
  const source = readyHandoff({
    kind: "PREPARE_ENCOUNTER",
    adapter: "Phase20/Encounter",
    subsystem: "Phase20/Encounter",
    mutationDomain: "GAMEPLAY_LIFECYCLE",
  });

  const decision = buildGoalExecutionDecision(source, {
    policy: enabledPolicy,
  });

  assert.equal(decision.state, GOAL_EXECUTION_STATES.BLOCKED);
  assert.equal(decision.reason, "GOAL_EXECUTION_HANDOFF_UNSUPPORTED");
  assert.equal(decision.action, null);
});

test("Coordinator and dashboard project Goal execution decisions without a dispatcher", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(coordinator, /buildGoalExecutionDecision/);
  assert.match(coordinator, /readGoalExecutionPolicy/);
  assert.match(coordinator, /getGoalExecutionState:\s*goal_execution_state/);
  assert.match(coordinator, /goal_execution_dispatch_implemented:\s*false/);
  assert.doesNotMatch(coordinator, /function reconcile_goal_execution/);
  assert.doesNotMatch(coordinator, /dispatch_goal_execution/);

  assert.match(dashboard, /goal_execution:\s*goalExecutionState/);
  assert.match(dashboard, /getGoalExecutionState/);
  assert.match(dashboard, /dispatchImplemented:\s*false/);
});

test("Goal execution gate has no mutation or controller dependency", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalExecutor.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /controlRotation/);
  assert.doesNotMatch(source, /socket\.emit/);
  assert.doesNotMatch(source, /saveGoal/);
  assert.doesNotMatch(source, /CraftController/);
  assert.doesNotMatch(source, /FarmIntelligenceController/);
});

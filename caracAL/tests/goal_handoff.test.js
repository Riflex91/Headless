"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL_HANDOFF_STATES,
  buildGoalHandoff,
  fullAutonomyGuard,
  goalPlanGuard,
} = require("../src/GoalHandoff");

function plannedGoal({
  goalId = "farm-gem0",
  type = "FARM_ITEM",
  priority = 50,
  characterName = null,
  kind = "FARM_ITEM",
  subsystem = "FullAutonomy/FarmIntelligence",
  target = { itemName: "gem0", quantity: 10 },
  metadata = {},
} = {}) {
  return {
    goalId,
    type,
    priority,
    characterName,
    status: "ACTIVE",
    state: "PLANNED",
    reason: "GOAL_PLAN_READY",
    target,
    metadata,
    tasks: [
      {
        taskId: `${goalId}:1`,
        kind: "VERIFY_INVENTORY",
        subsystem: "InventoryIntelligence",
        description: "Read current evidence",
        executionAllowed: false,
        mutationDispatched: false,
      },
      {
        taskId: `${goalId}:2`,
        kind,
        subsystem,
        description: "Execution intent",
        characterName,
        executionAllowed: false,
        mutationDispatched: false,
      },
    ],
  };
}

function blockedGoal({
  goalId = "level-stopped",
  priority = 100,
  reason = "MANUAL_STOP_PROTECTED",
} = {}) {
  return {
    goalId,
    type: "LEVEL_CHARACTER",
    priority,
    characterName: "My_Ranger1",
    status: "ACTIVE",
    state: "BLOCKED",
    reason,
    target: {
      characterName: "My_Ranger1",
      level: 80,
    },
    tasks: [
      {
        taskId: `${goalId}:1`,
        kind: "TRAIN_CHARACTER",
        subsystem: "FullAutonomy/FarmIntelligence",
        description: "Blocked training intent",
        status: "BLOCKED",
        executionAllowed: false,
        mutationDispatched: false,
      },
    ],
  };
}

function plan(goals = []) {
  return {
    timestamp: 1000,
    state: goals.length > 0 ? "READY" : "EMPTY",
    reason: goals.length > 0 ? "GOAL_PLANS_READY" : "GOALS_EMPTY",
    readOnly: true,
    executionEnabled: false,
    gameplayMutationDispatched: false,
    valueMutationDispatched: false,
    lifecycleMutationDispatched: false,
    goals,
    policy: {
      intentExecutionSeparated: true,
      manualStopRespected: true,
      fullAutonomyHandoffOnly: true,
      directGameplayMutationAllowed: false,
      directValueMutationAllowed: false,
      directLifecycleMutationAllowed: false,
    },
  };
}

test("Goal handoff selects the highest-priority ready Goal", () => {
  const result = buildGoalHandoff(
    plan([
      plannedGoal({
        goalId: "gold",
        type: "ACCUMULATE_GOLD",
        priority: 40,
        kind: "ACCUMULATE_GOLD",
        subsystem: "FarmIntelligence/EconomyArbiter",
        target: { amount: 1000000 },
      }),
      plannedGoal({
        goalId: "farm",
        priority: 90,
      }),
    ]),
    {
      fullAutonomy: {
        executionEnabled: true,
        execution: {
          state: "STABLE",
          reason: "FULL_AUTONOMY_RECONCILED",
        },
      },
      now: () => 1234,
    },
  );

  assert.equal(result.timestamp, 1234);
  assert.equal(result.state, GOAL_HANDOFF_STATES.READY);
  assert.equal(result.reason, "GOAL_HANDOFF_READY");
  assert.equal(result.selectedGoal.goalId, "farm");
  assert.deepEqual(result.selectedGoal.metadata, {});
  assert.equal(result.handoff.kind, "FARM_ITEM");
  assert.equal(result.handoff.adapter, "FarmIntelligence");
  assert.equal(result.handoff.dispatchAllowed, false);
  assert.equal(result.handoff.executionEnabled, false);
  assert.equal(result.handoff.mutationDispatched, false);
  assert.equal(result.handoff.goalExecutorRequired, true);
  assert.equal(result.handoff.fullAutonomy.required, true);
  assert.equal(result.handoff.fullAutonomy.satisfied, true);
});

test("Blocked high-priority Goals are skipped without bypassing Manual STOP", () => {
  const result = buildGoalHandoff(
    plan([
      blockedGoal({ priority: 100 }),
      plannedGoal({
        goalId: "gold",
        type: "ACCUMULATE_GOLD",
        priority: 50,
        kind: "ACCUMULATE_GOLD",
        subsystem: "FarmIntelligence/EconomyArbiter",
        target: { amount: 500000 },
      }),
    ]),
  );

  assert.equal(result.state, "READY");
  assert.equal(result.selectedGoal.goalId, "gold");
  assert.equal(result.summary.readyGoals, 1);
  assert.equal(result.summary.blockedGoals, 1);
  assert.deepEqual(result.blockedGoals, [
    {
      goalId: "level-stopped",
      type: "LEVEL_CHARACTER",
      priority: 100,
      reason: "MANUAL_STOP_PROTECTED",
      characterName: "My_Ranger1",
    },
  ]);
  assert.equal(result.policy.manualStopRespected, true);
  assert.equal(result.policy.blockedGoalsSkipped, true);
});

test("Goal handoff blocks when every active Goal is blocked", () => {
  const result = buildGoalHandoff(plan([blockedGoal()]));

  assert.equal(result.state, GOAL_HANDOFF_STATES.BLOCKED);
  assert.equal(result.reason, "GOAL_HANDOFF_ALL_ACTIVE_GOALS_BLOCKED");
  assert.equal(result.selectedGoal, null);
  assert.equal(result.handoff, null);
  assert.equal(result.handoffDispatched, false);
});

test("Paused and terminal Goals do not become execution handoffs", () => {
  const paused = plannedGoal({ goalId: "paused" });
  paused.status = "PAUSED";
  paused.state = "PAUSED";

  const completed = plannedGoal({ goalId: "done" });
  completed.status = "COMPLETED";
  completed.state = "COMPLETE";
  completed.tasks = [];

  const cancelled = plannedGoal({ goalId: "cancelled" });
  cancelled.status = "CANCELLED";
  cancelled.state = "CANCELLED";
  cancelled.tasks = [];

  const result = buildGoalHandoff(plan([paused, completed, cancelled]));

  assert.equal(result.state, GOAL_HANDOFF_STATES.EMPTY);
  assert.equal(result.reason, "GOAL_HANDOFF_NO_READY_GOAL");
  assert.equal(result.summary.activeGoals, 0);
  assert.equal(result.handoff, null);
});

test("Unsupported execution tasks fail closed", () => {
  const source = plannedGoal({
    goalId: "unsupported",
    kind: "UNKNOWN_EXECUTION",
    subsystem: "UnknownSubsystem",
  });

  const result = buildGoalHandoff(plan([source]));

  assert.equal(result.state, GOAL_HANDOFF_STATES.BLOCKED);
  assert.equal(result.reason, "GOAL_HANDOFF_TASK_UNSUPPORTED");
  assert.equal(result.selectedGoal.goalId, "unsupported");
  assert.equal(result.handoff, null);
});

test("Phase 20 encounter handoff remains explicitly deferred", () => {
  const source = plannedGoal({
    goalId: "boss",
    type: "PREPARE_BOSS",
    priority: 80,
    kind: "PREPARE_ENCOUNTER",
    subsystem: "Phase20/Encounter",
    target: { bossName: "dragold" },
  });

  const result = buildGoalHandoff(plan([source]));

  assert.equal(result.state, GOAL_HANDOFF_STATES.BLOCKED);
  assert.equal(result.reason, "PHASE20_ENCOUNTER_PLANNING_DEFERRED");
  assert.equal(result.handoff, null);
});

test("Full Autonomy readiness is evidence only and never dispatches", () => {
  const guard = fullAutonomyGuard(
    {
      executionEnabled: false,
      execution: {
        state: "DISABLED",
        reason: "FULL_AUTONOMY_EXECUTION_DISABLED",
      },
    },
    {
      requiresFullAutonomy: true,
    },
  );

  assert.deepEqual(guard, {
    required: true,
    executionEnabled: false,
    state: "DISABLED",
    reason: "FULL_AUTONOMY_EXECUTION_DISABLED",
    satisfied: false,
  });

  assert.equal(
    fullAutonomyGuard(
      {
        executionEnabled: true,
        execution: {},
      },
      {
        requiresFullAutonomy: true,
      },
    ).satisfied,
    false,
  );

  const result = buildGoalHandoff(plan([plannedGoal()]), {
    fullAutonomy: {
      executionEnabled: false,
      execution: {
        state: "DISABLED",
        reason: "FULL_AUTONOMY_EXECUTION_DISABLED",
      },
    },
  });

  assert.equal(result.state, "READY");
  assert.equal(result.handoff.fullAutonomy.satisfied, false);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.handoffDispatched, false);
  assert.equal(result.lifecycleMutationDispatched, false);
  assert.equal(result.gameplayMutationDispatched, false);
  assert.equal(result.valueMutationDispatched, false);
});

test("Goal handoff fails closed when the upstream Goal plan safety boundary is invalid", () => {
  const unsafe = plan([plannedGoal()]);
  unsafe.gameplayMutationDispatched = true;

  const guard = goalPlanGuard(unsafe);
  const result = buildGoalHandoff(unsafe);

  assert.equal(guard.valid, false);
  assert.equal(guard.noMutationDispatched, false);
  assert.equal(result.state, GOAL_HANDOFF_STATES.BLOCKED);
  assert.equal(result.reason, "GOAL_HANDOFF_GOAL_PLAN_SAFETY_INVALID");
  assert.equal(result.handoff, null);
  assert.equal(result.handoffDispatched, false);
});

test("Goal handoff contract has no mutation executor dependency", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalHandoff.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /controlRotation/);
  assert.doesNotMatch(source, /socket\.emit/);
  assert.doesNotMatch(source, /saveGoal/);
  assert.doesNotMatch(source, /executeNext/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL_HANDOFF_STATES,
  TASK_LANES,
  buildGoalHandoff,
  candidateForGoal,
  goalPlanSafety,
} = require("../src/GoalHandoff");

function task(
  kind,
  subsystem,
  {
    goalId = "goal-1",
    index = 1,
    status = "PLANNED",
    executionAllowed = false,
    mutationDispatched = false,
  } = {},
) {
  return {
    taskId: `${goalId}:${index}`,
    kind,
    subsystem,
    description: `Task ${kind}`,
    status,
    executionAllowed,
    mutationDispatched,
  };
}

function goal({
  goalId = "goal-1",
  type = "FARM_ITEM",
  priority = 50,
  status = "ACTIVE",
  state = "PLANNED",
  characterName = null,
  tasks = null,
} = {}) {
  return {
    goalId,
    type,
    priority,
    status,
    state,
    reason: state === "BLOCKED" ? "MANUAL_STOP_PROTECTED" : "GOAL_PLAN_READY",
    readOnly: true,
    executionEnabled: false,
    target: {
      itemName: "gem0",
      quantity: 10,
      characterName,
    },
    tasks:
      tasks ||
      [
        task("VERIFY_INVENTORY", "InventoryIntelligence", {
          goalId,
          index: 1,
        }),
        task("FARM_ITEM", "FullAutonomy/FarmIntelligence", {
          goalId,
          index: 2,
        }),
      ],
  };
}

function plan(goals = [], overrides = {}) {
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
    summary: {},
    policy: {
      intentExecutionSeparated: true,
      manualStopRespected: true,
      fullAutonomyHandoffOnly: true,
      directGameplayMutationAllowed: false,
      directValueMutationAllowed: false,
      directLifecycleMutationAllowed: false,
    },
    ...overrides,
  };
}

test("Goal handoff selects the highest-priority ACTIVE PLANNED goal", () => {
  const handoff = buildGoalHandoff(
    plan([
      goal({
        goalId: "low",
        priority: 30,
        type: "ACCUMULATE_GOLD",
        tasks: [
          task("MEASURE_GOLD", "AccountStrategy", {
            goalId: "low",
            index: 1,
          }),
          task("ACCUMULATE_GOLD", "FarmIntelligence/EconomyArbiter", {
            goalId: "low",
            index: 2,
          }),
        ],
      }),
      goal({
        goalId: "high",
        priority: 90,
        characterName: "My_Ranger1",
      }),
    ]),
    { now: () => 1234 },
  );

  assert.equal(handoff.timestamp, 1234);
  assert.equal(handoff.state, GOAL_HANDOFF_STATES.READY);
  assert.equal(handoff.reason, "GOAL_HANDOFF_READY");
  assert.equal(handoff.readOnly, true);
  assert.equal(handoff.executionEnabled, false);
  assert.equal(handoff.dispatchAllowed, false);
  assert.equal(handoff.selectedGoal.goalId, "high");
  assert.equal(handoff.selectedGoal.priority, 90);
  assert.equal(handoff.selectedGoal.characterName, "My_Ranger1");
  assert.equal(handoff.selectedTask.kind, "FARM_ITEM");
  assert.equal(
    handoff.selectedTask.lane,
    TASK_LANES.FARM_ITEM,
  );
  assert.deepEqual(handoff.selectedTask.owners, [
    "FullAutonomy",
    "FarmIntelligence",
  ]);
  assert.equal(handoff.selectedTask.executionAllowed, false);
  assert.equal(handoff.selectedTask.mutationDispatched, false);
  assert.equal(handoff.summary.actionable, 2);
});

test("Goal handoff uses deterministic goalId ordering for equal priority", () => {
  const handoff = buildGoalHandoff(
    plan([
      goal({ goalId: "goal-b", priority: 75 }),
      goal({ goalId: "goal-a", priority: 75 }),
    ]),
  );

  assert.equal(handoff.state, "READY");
  assert.equal(handoff.selectedGoal.goalId, "goal-a");
  assert.deepEqual(
    handoff.candidates.map((candidate) => candidate.goalId),
    ["goal-a", "goal-b"],
  );
});

test("Manual STOP-blocked goal is never selected over a lower-priority planned goal", () => {
  const blocked = goal({
    goalId: "manual-stop",
    priority: 100,
    state: "BLOCKED",
    characterName: "My_Ranger1",
    tasks: [
      task("ASSESS_TRAINING", "AccountStrategy", {
        goalId: "manual-stop",
        index: 1,
        status: "BLOCKED",
      }),
      task("TRAIN_CHARACTER", "FullAutonomy/FarmIntelligence", {
        goalId: "manual-stop",
        index: 2,
        status: "BLOCKED",
      }),
    ],
  });
  const planned = goal({
    goalId: "safe-lower",
    priority: 40,
  });

  const handoff = buildGoalHandoff(plan([blocked, planned]));

  assert.equal(handoff.state, "READY");
  assert.equal(handoff.selectedGoal.goalId, "safe-lower");
  assert.equal(
    handoff.candidates.some((candidate) => candidate.goalId === "manual-stop"),
    false,
  );
  assert.equal(handoff.summary.waiting, 1);
  assert.equal(handoff.policy.manualStopInheritedFromGoalPlanner, true);
});

test("Goal handoff waits when active goals are blocked or invalid", () => {
  const blocked = goal({
    goalId: "blocked",
    state: "BLOCKED",
    tasks: [
      task("TRAIN_CHARACTER", "FullAutonomy/FarmIntelligence", {
        goalId: "blocked",
        status: "BLOCKED",
      }),
    ],
  });
  const invalid = goal({
    goalId: "invalid",
    state: "INVALID",
    tasks: [],
  });

  const handoff = buildGoalHandoff(plan([blocked, invalid]));

  assert.equal(handoff.state, GOAL_HANDOFF_STATES.WAITING);
  assert.equal(handoff.reason, "GOAL_HANDOFF_WAITING_ON_GOALS");
  assert.equal(handoff.selectedGoal, null);
  assert.equal(handoff.selectedTask, null);
  assert.equal(handoff.summary.waiting, 2);
});

test("Goal handoff is idle when no active actionable goals remain", () => {
  const handoff = buildGoalHandoff(
    plan([
      goal({ goalId: "paused", status: "PAUSED", state: "PAUSED", tasks: [] }),
      goal({
        goalId: "complete",
        status: "COMPLETED",
        state: "COMPLETE",
        tasks: [],
      }),
      goal({
        goalId: "cancelled",
        status: "CANCELLED",
        state: "CANCELLED",
        tasks: [],
      }),
    ]),
  );

  assert.equal(handoff.state, GOAL_HANDOFF_STATES.IDLE);
  assert.equal(handoff.reason, "GOAL_HANDOFF_NO_ACTIONABLE_GOALS");
  assert.equal(handoff.summary.active, 0);
  assert.equal(handoff.summary.actionable, 0);
});

test("Goal handoff fails closed when GoalPlanner safety boundary is invalid", () => {
  const unsafePlan = plan([goal()], {
    executionEnabled: true,
    gameplayMutationDispatched: true,
  });

  const safety = goalPlanSafety(unsafePlan);
  const handoff = buildGoalHandoff(unsafePlan);

  assert.equal(safety.valid, false);
  assert.equal(safety.executionDisabled, false);
  assert.equal(safety.noMutationDispatched, false);
  assert.equal(handoff.state, GOAL_HANDOFF_STATES.BLOCKED);
  assert.equal(handoff.reason, "GOAL_HANDOFF_SAFETY_BOUNDARY_INVALID");
  assert.equal(handoff.selectedGoal, null);
  assert.equal(handoff.dispatchAllowed, false);
});

test("Goal handoff fails closed on malformed PLANNED task shape", () => {
  const malformed = goal({
    goalId: "malformed",
    tasks: [
      {
        taskId: "malformed:1",
        kind: "FARM_ITEM",
        subsystem: null,
        description: "Missing subsystem",
        status: "PLANNED",
        executionAllowed: false,
        mutationDispatched: false,
      },
    ],
  });

  const candidate = candidateForGoal(malformed);
  const handoff = buildGoalHandoff(plan([malformed]));

  assert.equal(candidate.malformed, true);
  assert.equal(handoff.state, GOAL_HANDOFF_STATES.BLOCKED);
  assert.equal(handoff.reason, "GOAL_HANDOFF_PLANNED_TASK_INVALID");
  assert.equal(handoff.summary.malformed, 1);
});

test("Goal handoff lane mapping preserves subsystem ownership without execution", () => {
  const cases = [
    ["FARM_ITEM", "FullAutonomy/FarmIntelligence", "FULL_AUTONOMY_FARM"],
    [
      "TRAIN_CHARACTER",
      "FullAutonomy/FarmIntelligence",
      "FULL_AUTONOMY_FARM",
    ],
    ["ACQUIRE_GEAR", "FarmIntelligence/InventoryIntelligence", "FARM_INVENTORY"],
    ["ACCUMULATE_GOLD", "FarmIntelligence/EconomyArbiter", "FARM_ECONOMY"],
    ["PLAN_CRAFT", "CraftController/EconomyArbiter", "CRAFT_ECONOMY"],
  ];

  for (const [kind, subsystem, expectedLane] of cases) {
    const currentGoal = goal({
      goalId: kind.toLowerCase(),
      tasks: [
        task(kind, subsystem, {
          goalId: kind.toLowerCase(),
        }),
      ],
    });
    const handoff = buildGoalHandoff(plan([currentGoal]));
    assert.equal(handoff.selectedTask.lane, expectedLane);
    assert.equal(handoff.selectedTask.executionAllowed, false);
    assert.equal(handoff.dispatchAllowed, false);
  }
});

test("Goal handoff source has no executor or mutation dependency", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalHandoff.js"),
    "utf8",
  );

  assert.match(source, /readOnly: true/);
  assert.match(source, /executionEnabled: false/);
  assert.match(source, /dispatchAllowed: false/);
  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /FullAutonomyExecutor/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /executeNext/);
  assert.doesNotMatch(source, /socket\.emit/);
});

test("Goal handoff is wired through supervisor and dashboard state only", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(coordinator, /buildGoalHandoff/);
  assert.match(coordinator, /goal_handoff_state/);
  assert.match(coordinator, /getGoalHandoffState:\s*goal_handoff_state/);
  assert.match(dashboard, /goal_handoff:\s*goalHandoffState/);
  assert.match(dashboard, /getGoalHandoffState\?\.\(\)/);
  assert.doesNotMatch(coordinator, /goal_handoff_state[\s\S]{0,500}control_character/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL_TYPES,
  buildGoalPlan,
  normalizeGoalRow,
} = require("../src/GoalPlanner");

function setup() {
  return {
    accountStrategy: {
      state: "READY",
      profiles: [
        {
          name: "My_Ranger1",
          class: "ranger",
          level: 79,
          gold: 120000,
          capabilities: ["DPS", "AOE", "RANGED"],
          gear: {
            equipment: {
              mainhand: { name: "bow", level: 8 },
            },
          },
        },
        {
          name: "My_Merchant",
          class: "merchant",
          level: 80,
          gold: 500000,
          capabilities: ["SUPPORT", "ECONOMY", "LOGISTICS"],
          gear: { equipment: {} },
        },
      ],
    },
    characterManage: {
      My_Ranger1: {
        account_owned: true,
        desired_runtime_state: "RUNNING",
        desired_runtime_state_source: "CONFIG",
        live_state: {
          items: [
            { name: "gem0", q: 3 },
            { name: "bow", level: 7 },
          ],
        },
      },
      My_Merchant: {
        account_owned: true,
        desired_runtime_state: "RUNNING",
        desired_runtime_state_source: "CONFIG",
        live_state: {
          items: [
            { name: "gem0", q: 2 },
            { name: "fireblade", level: 5 },
          ],
        },
      },
    },
  };
}

test("Phase 19 normalizes persisted goal priority and target character", () => {
  const goal = normalizeGoalRow({
    goal_id: "g-1",
    character_name: "My_Ranger1",
    status: "ACTIVE",
    goal: {
      type: "LEVEL_CHARACTER",
      priority: 120,
      target: { level: 80 },
    },
    updated_at: 5000,
  });

  assert.equal(goal.goalId, "g-1");
  assert.equal(goal.characterName, "My_Ranger1");
  assert.equal(goal.type, GOAL_TYPES.LEVEL_CHARACTER);
  assert.equal(goal.priority, 100);
});

test("Phase 19 plans and prioritizes all supported goal types read-only", () => {
  const context = setup();
  const plan = buildGoalPlan(
    [
      {
        goal_id: "farm",
        status: "ACTIVE",
        goal: {
          type: "FARM_ITEM",
          priority: 90,
          target: { itemName: "gem0", quantity: 10 },
        },
      },
      {
        goal_id: "level",
        character_name: "My_Ranger1",
        status: "ACTIVE",
        goal: {
          type: "LEVEL_CHARACTER",
          priority: 80,
          target: { level: 80 },
        },
      },
      {
        goal_id: "gear",
        character_name: "My_Ranger1",
        status: "ACTIVE",
        goal: {
          type: "ACQUIRE_GEAR",
          priority: 70,
          target: { itemName: "bow", level: 8 },
        },
      },
      {
        goal_id: "gold",
        status: "ACTIVE",
        goal: {
          type: "ACCUMULATE_GOLD",
          priority: 60,
          target: { amount: 1000000 },
        },
      },
      {
        goal_id: "craft",
        status: "ACTIVE",
        goal: {
          type: "CRAFT_ITEM",
          priority: 50,
          target: { itemName: "fireblade", quantity: 1 },
        },
      },
      {
        goal_id: "boss",
        status: "ACTIVE",
        goal: {
          type: "PREPARE_BOSS",
          priority: 40,
          target: {
            bossName: "dragold",
            requiredCapabilities: ["DPS", "SUPPORT"],
          },
        },
      },
    ],
    { ...context, now: () => 1234 },
  );

  assert.equal(plan.timestamp, 1234);
  assert.equal(plan.state, "READY");
  assert.equal(plan.readOnly, true);
  assert.equal(plan.executionEnabled, false);
  assert.equal(plan.gameplayMutationDispatched, false);
  assert.equal(plan.valueMutationDispatched, false);
  assert.equal(plan.lifecycleMutationDispatched, false);
  assert.deepEqual(
    plan.goals.map((goal) => goal.goalId),
    ["farm", "level", "gear", "gold", "craft", "boss"],
  );
  assert.equal(plan.summary.total, 6);
  assert.equal(plan.summary.byType.FARM_ITEM, 1);
  assert.equal(plan.summary.byType.PREPARE_BOSS, 1);
  assert.equal(plan.policy.intentExecutionSeparated, true);
});

test("FARM_ITEM reports observed progress without dispatching work", () => {
  const context = setup();
  const plan = buildGoalPlan(
    [
      {
        goal_id: "farm",
        status: "ACTIVE",
        goal: {
          type: "FARM_ITEM",
          target: { itemName: "gem0", quantity: 10 },
        },
      },
    ],
    context,
  );
  const goal = plan.goals[0];

  assert.equal(goal.state, "PLANNED");
  assert.equal(goal.progress.current, 5);
  assert.equal(goal.progress.target, 10);
  assert.equal(goal.completion.met, false);
  assert.equal(goal.tasks[1].subsystem, "FarmIntelligence");
  assert.equal(
    goal.tasks.every((task) => task.executionAllowed === false),
    true,
  );
  assert.equal(
    goal.tasks.every((task) => task.mutationDispatched === false),
    true,
  );
});

test("LEVEL_CHARACTER completion comes from Account Strategy evidence", () => {
  const context = setup();
  context.accountStrategy.profiles[0].level = 80;

  const plan = buildGoalPlan(
    [
      {
        goal_id: "level",
        character_name: "My_Ranger1",
        status: "ACTIVE",
        goal: {
          type: "LEVEL_CHARACTER",
          target: { level: 80 },
        },
      },
    ],
    context,
  );
  const goal = plan.goals[0];

  assert.equal(goal.state, "COMPLETE");
  assert.equal(goal.reason, "GOAL_COMPLETION_CRITERIA_MET");
  assert.equal(goal.completion.source, "OBSERVED_EVIDENCE");
  assert.equal(goal.tasks.length, 0);
});

test("gear, gold and craft goals reuse existing read-only evidence", () => {
  const context = setup();
  const plan = buildGoalPlan(
    [
      {
        goal_id: "gear",
        character_name: "My_Ranger1",
        status: "ACTIVE",
        goal: {
          type: "ACQUIRE_GEAR",
          target: { itemName: "bow", level: 8 },
        },
      },
      {
        goal_id: "gold",
        status: "ACTIVE",
        goal: {
          type: "ACCUMULATE_GOLD",
          target: { amount: 1000000 },
        },
      },
      {
        goal_id: "craft",
        status: "ACTIVE",
        goal: {
          type: "CRAFT_ITEM",
          target: { itemName: "fireblade", quantity: 1 },
        },
      },
    ],
    context,
  );

  const gear = plan.goals.find((goal) => goal.goalId === "gear");
  const gold = plan.goals.find((goal) => goal.goalId === "gold");
  const craft = plan.goals.find((goal) => goal.goalId === "craft");

  assert.equal(gear.state, "COMPLETE");
  assert.equal(gear.completion.criteria[0].status, "MET");
  assert.equal(gold.progress.current, 620000);
  assert.equal(gold.progress.state, "IN_PROGRESS");
  assert.match(gold.tasks[1].subsystem, /EconomyArbiter/);
  assert.equal(craft.state, "COMPLETE");
  assert.equal(craft.tasks.length, 0);
});

test("PREPARE_BOSS remains blocked until Phase 20 encounter planning", () => {
  const context = setup();
  const plan = buildGoalPlan(
    [
      {
        goal_id: "boss",
        status: "ACTIVE",
        goal: {
          type: "PREPARE_BOSS",
          target: {
            bossName: "dragold",
            requiredCapabilities: ["DPS", "SUPPORT"],
          },
        },
      },
    ],
    context,
  );
  const goal = plan.goals[0];

  assert.equal(goal.state, "BLOCKED");
  assert.equal(
    goal.reason,
    "PHASE20_ENCOUNTER_PLANNING_DEFERRED",
  );
  assert.equal(goal.completion.criteria[0].status, "MET");
  assert.equal(goal.completion.criteria[1].status, "UNKNOWN");
  assert.equal(
    goal.tasks.every((task) => task.status === "BLOCKED"),
    true,
  );
});

test("Manual STOP blocks a fixed-character goal without lifecycle mutation", () => {
  const context = setup();
  context.characterManage.My_Ranger1.desired_runtime_state = "STOPPED";
  context.characterManage.My_Ranger1.desired_runtime_state_source =
    "MANUAL_STOP";

  const plan = buildGoalPlan(
    [
      {
        goal_id: "level",
        character_name: "My_Ranger1",
        status: "ACTIVE",
        goal: {
          type: "LEVEL_CHARACTER",
          target: { level: 80 },
        },
      },
    ],
    context,
  );
  const goal = plan.goals[0];

  assert.equal(goal.state, "BLOCKED");
  assert.equal(goal.reason, "MANUAL_STOP_PROTECTED");
  assert.equal(goal.preconditions[0].ready, false);
  assert.equal(plan.lifecycleMutationDispatched, false);
});

test("paused, cancelled and persisted-completed goals emit no tasks", () => {
  const context = setup();
  const plan = buildGoalPlan(
    [
      {
        goal_id: "paused",
        status: "PAUSED",
        goal: {
          type: "FARM_ITEM",
          target: { itemName: "gem0", quantity: 10 },
        },
      },
      {
        goal_id: "cancelled",
        status: "CANCELLED",
        goal: {
          type: "FARM_ITEM",
          target: { itemName: "gem0", quantity: 10 },
        },
      },
      {
        goal_id: "complete",
        status: "COMPLETED",
        goal: {
          type: "FARM_ITEM",
          target: { itemName: "gem0", quantity: 999 },
        },
      },
    ],
    context,
  );

  assert.equal(
    plan.goals.find((goal) => goal.goalId === "paused").state,
    "PAUSED",
  );
  assert.equal(
    plan.goals.find((goal) => goal.goalId === "cancelled").state,
    "CANCELLED",
  );
  assert.equal(
    plan.goals.find((goal) => goal.goalId === "complete").state,
    "COMPLETE",
  );
  assert.equal(
    plan.goals.every((goal) => goal.tasks.length === 0),
    true,
  );
});

test("invalid goals fail closed and GoalPlanner has no mutation executor", () => {
  const context = setup();
  const plan = buildGoalPlan(
    [
      {
        goal_id: "bad",
        status: "ACTIVE",
        goal: { type: "FARM_ITEM", target: {} },
      },
      {
        goal_id: "unknown",
        status: "ACTIVE",
        goal: { type: "DO_SOMETHING", target: {} },
      },
    ],
    context,
  );
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalPlanner.js"),
    "utf8",
  );

  assert.equal(plan.state, "PARTIAL");
  assert.equal(plan.summary.invalid, 2);
  assert.equal(
    plan.goals.every((goal) => goal.tasks.length === 0),
    true,
  );
  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /executeNext/);
  assert.doesNotMatch(source, /socket\.emit/);
});

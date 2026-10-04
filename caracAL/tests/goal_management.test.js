"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL_MUTATIONS,
  GoalManagementService,
  assertStatusTransition,
  normalizeGoalId,
} = require("../src/GoalManagement");

class FakePersistence {
  constructor(now = 1000) {
    this.rows = new Map();
    this.now = now;
    this.saveCount = 0;
  }

  getGoal(goalId) {
    const row = this.rows.get(goalId);
    return row ? JSON.parse(JSON.stringify(row)) : null;
  }

  async saveGoal(goalId, { characterName, status, goal }) {
    this.saveCount += 1;
    this.now += 1;
    this.rows.set(goalId, {
      character_name: characterName || null,
      status,
      goal: JSON.parse(JSON.stringify(goal)),
      updated_at: this.now,
    });
  }
}

function planningContext({ manualStopped = false, level = 79 } = {}) {
  return {
    accountStrategy: {
      state: "READY",
      profiles: [
        {
          name: "My_Ranger1",
          class: "ranger",
          level,
          gold: 100000,
          capabilities: ["DPS", "AOE", "RANGED"],
          gear: { equipment: {} },
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
        desired_runtime_state: manualStopped ? "STOPPED" : "RUNNING",
        desired_runtime_state_source: manualStopped ? "MANUAL_STOP" : "CONFIG",
        live_state: {
          items: [{ name: "gem0", q: 2 }],
        },
      },
      My_Merchant: {
        account_owned: true,
        desired_runtime_state: "RUNNING",
        desired_runtime_state_source: "CONFIG",
        live_state: {
          items: [],
        },
      },
    },
  };
}

function createService(options = {}) {
  const persistence = options.persistence || new FakePersistence();
  const events = [];
  const context = options.context || planningContext();
  const service = new GoalManagementService({
    persistence,
    getPlanningContext: () => context,
    onMutation: (event) => events.push(event),
  });
  return { service, persistence, events, context };
}

test("Phase 19 Goal management creates normalized persisted intent only", async () => {
  const { service, persistence, events } = createService();

  const result = await service.create({
    goalId: "farm-gem0",
    goal: {
      type: "farm_item",
      priority: 90,
      target: {
        itemName: "gem0",
        quantity: 10,
      },
      metadata: {
        source: "dashboard",
      },
    },
  });

  assert.equal(result.mutation, GOAL_MUTATIONS.CREATE);
  assert.equal(result.goal.goal_id, "farm-gem0");
  assert.equal(result.goal.status, "ACTIVE");
  assert.equal(result.goal.goal.type, "FARM_ITEM");
  assert.equal(result.goal.goal.priority, 90);
  assert.equal(result.plan.state, "PLANNED");
  assert.equal(result.plan.executionEnabled, false);
  assert.equal(persistence.saveCount, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "GOAL_CREATED");
});

test("Goal creation rejects duplicate ids and invalid definitions before persistence", async () => {
  const { service, persistence } = createService();

  await assert.rejects(
    () =>
      service.create({
        goalId: "bad-target",
        goal: {
          type: "FARM_ITEM",
          target: {},
        },
      }),
    (error) => error.code === "GOAL_DEFINITION_INVALID",
  );
  assert.equal(persistence.saveCount, 0);

  await service.create({
    goalId: "farm-gem0",
    goal: {
      type: "FARM_ITEM",
      target: { itemName: "gem0", quantity: 10 },
    },
  });
  await assert.rejects(
    () =>
      service.create({
        goalId: "farm-gem0",
        goal: {
          type: "FARM_ITEM",
          target: { itemName: "gem0", quantity: 20 },
        },
      }),
    (error) => error.code === "GOAL_ALREADY_EXISTS",
  );
  assert.equal(persistence.saveCount, 1);
});

test("Manual STOP permits Goal intent persistence but keeps the plan blocked", async () => {
  const { service } = createService({
    context: planningContext({ manualStopped: true }),
  });

  const result = await service.create({
    goalId: "level-ranger",
    characterName: "My_Ranger1",
    goal: {
      type: "LEVEL_CHARACTER",
      target: { level: 80 },
    },
  });

  assert.equal(result.goal.status, "ACTIVE");
  assert.equal(result.plan.state, "BLOCKED");
  assert.equal(result.plan.reason, "MANUAL_STOP_PROTECTED");
  assert.equal(result.plan.executionEnabled, false);
});

test("PREPARE_BOSS intent persists while Phase 20 execution remains blocked", async () => {
  const { service } = createService();

  const result = await service.create({
    goalId: "prepare-dragold",
    goal: {
      type: "PREPARE_BOSS",
      target: {
        bossName: "dragold",
        requiredCapabilities: ["DPS", "SUPPORT"],
      },
    },
  });

  assert.equal(result.plan.state, "BLOCKED");
  assert.equal(result.plan.reason, "PHASE20_ENCOUNTER_PLANNING_DEFERRED");
  assert.equal(result.plan.executionEnabled, false);
});

test("Goal lifecycle supports pause resume complete and cancel transitions", async () => {
  const { service } = createService();

  const created = await service.create({
    goalId: "farm-gem0",
    goal: {
      type: "FARM_ITEM",
      target: { itemName: "gem0", quantity: 10 },
    },
  });
  const paused = await service.update("farm-gem0", {
    status: "PAUSED",
    expectedUpdatedAt: created.goal.updated_at,
  });
  const resumed = await service.update("farm-gem0", {
    status: "ACTIVE",
    expectedUpdatedAt: paused.goal.updated_at,
  });
  const completed = await service.update("farm-gem0", {
    status: "COMPLETED",
    expectedUpdatedAt: resumed.goal.updated_at,
  });

  assert.equal(paused.mutation, GOAL_MUTATIONS.STATUS);
  assert.equal(paused.goal.status, "PAUSED");
  assert.equal(paused.plan.state, "PAUSED");
  assert.equal(resumed.goal.status, "ACTIVE");
  assert.equal(resumed.plan.state, "PLANNED");
  assert.equal(completed.goal.status, "COMPLETED");
  assert.equal(completed.plan.state, "COMPLETE");

  await assert.rejects(
    () => service.update("farm-gem0", { status: "ACTIVE" }),
    (error) => error.code === "GOAL_STATUS_TRANSITION_INVALID",
  );

  const other = await service.create({
    goalId: "farm-other",
    goal: {
      type: "FARM_ITEM",
      target: { itemName: "gem0", quantity: 20 },
    },
  });
  const cancelled = await service.update("farm-other", {
    status: "CANCELLED",
    expectedUpdatedAt: other.goal.updated_at,
  });
  assert.equal(cancelled.goal.status, "CANCELLED");
  assert.equal(cancelled.plan.state, "CANCELLED");
});

test("terminal Goal definitions cannot be edited", async () => {
  const { service } = createService();

  const created = await service.create({
    goalId: "terminal",
    goal: {
      type: "FARM_ITEM",
      target: { itemName: "gem0", quantity: 10 },
    },
  });
  const completed = await service.update("terminal", {
    status: "COMPLETED",
    expectedUpdatedAt: created.goal.updated_at,
  });

  await assert.rejects(
    () =>
      service.update("terminal", {
        goal: {
          priority: 100,
        },
        expectedUpdatedAt: completed.goal.updated_at,
      }),
    (error) => error.code === "GOAL_TERMINAL",
  );
});

test("Goal definition updates are validated and preserve unspecified fields", async () => {
  const { service } = createService();

  const created = await service.create({
    goalId: "farm-gem0",
    characterName: "My_Ranger1",
    goal: {
      type: "FARM_ITEM",
      priority: 30,
      target: { itemName: "gem0", quantity: 10 },
      metadata: { owner: "user" },
    },
  });
  const updated = await service.update("farm-gem0", {
    goal: {
      priority: 80,
      target: { itemName: "gem0", quantity: 25 },
    },
    expectedUpdatedAt: created.goal.updated_at,
  });

  assert.equal(updated.mutation, GOAL_MUTATIONS.UPDATE);
  assert.equal(updated.goal.goal.type, "FARM_ITEM");
  assert.equal(updated.goal.goal.priority, 80);
  assert.deepEqual(updated.goal.goal.metadata, { owner: "user" });
  assert.equal(updated.goal.goal.target.quantity, 25);
  assert.equal(updated.goal.character_name, "My_Ranger1");
});

test("Goal updates reject stale snapshots and ambiguous mutations", async () => {
  const { service, persistence } = createService();

  const created = await service.create({
    goalId: "farm-gem0",
    goal: {
      type: "FARM_ITEM",
      target: { itemName: "gem0", quantity: 10 },
    },
  });

  await assert.rejects(
    () =>
      service.update("farm-gem0", {
        status: "PAUSED",
        expectedUpdatedAt: created.goal.updated_at - 1,
      }),
    (error) => error.code === "GOAL_STALE_UPDATE",
  );
  await assert.rejects(
    () =>
      service.update("farm-gem0", {
        status: "PAUSED",
        goal: { priority: 90 },
      }),
    (error) => error.code === "GOAL_UPDATE_AMBIGUOUS",
  );
  assert.equal(persistence.saveCount, 1);
});

test("Goal identifiers and status transition table fail closed", () => {
  assert.equal(normalizeGoalId("farm:gem0-1"), "farm:gem0-1");
  assert.throws(
    () => normalizeGoalId("../bad goal"),
    (error) => error.code === "GOAL_ID_INVALID",
  );
  assert.throws(
    () => assertStatusTransition("COMPLETED", "ACTIVE"),
    (error) => error.code === "GOAL_STATUS_TRANSITION_INVALID",
  );
});

test("Goal intent API is wired through Coordinator without Full Autonomy execution", () => {
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(dashboard, /router\.post\(\s*"\/headless\/api\/goals"/);
  assert.match(
    dashboard,
    /router\.patch\(\s*"\/headless\/api\/goals\/:goalId"/,
  );
  assert.match(coordinator, /new GoalManagementService/);
  assert.match(
    coordinator,
    /createGoal:\s*\(input\) => goal_management\.create/,
  );
  assert.match(
    coordinator,
    /updateGoal:\s*\(goalId, input\) => goal_management\.update/,
  );
  assert.doesNotMatch(dashboard, /\/headless\/api\/goals[^\n]*delete/i);
});

test("Goal management source has no gameplay or lifecycle mutation dependency", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalManagement.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /controlRotation/);
  assert.doesNotMatch(source, /socket\.emit/);
  assert.doesNotMatch(source, /pontyBuy/);
  assert.doesNotMatch(source, /tradeList/);
});

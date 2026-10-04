"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL_ADAPTER_CAPABILITIES,
  GOAL_ADAPTER_REQUEST_VERSION,
  GOAL_ADAPTER_STATES,
  buildGoalAdapterPlan,
} = require("../src/GoalAdapter");

function readyDecision({
  kind = "FARM_ITEM",
  characterName = null,
  target = { itemName: "gem0", quantity: 10 },
  metadata = {},
  mutationDomain = "GAMEPLAY",
} = {}) {
  return {
    enabled: true,
    state: "READY",
    reason: "GOAL_EXECUTION_ADAPTER_DISPATCH_READY",
    dispatchAllowed: true,
    dispatchImplemented: false,
    mutationDispatched: false,
    maxActionsPerCycle: 1,
    reconcileIntervalMs: 5000,
    action: {
      type: "GOAL_HANDOFF",
      goalId: "goal-1",
      taskId: "goal-1:3",
      kind,
      adapter: "TestAdapter",
      subsystem: "TestSubsystem",
      mutationDomain,
      characterName,
      target,
      metadata,
      requiresAdapterDispatcher: true,
    },
  };
}

test("disabled Goal execution produces an empty adapter plan", () => {
  const result = buildGoalAdapterPlan({
    state: "DISABLED",
    reason: "GOAL_EXECUTION_DISABLED",
    dispatchAllowed: false,
    dispatchImplemented: false,
    mutationDispatched: false,
    action: null,
  });

  assert.equal(result.state, GOAL_ADAPTER_STATES.EMPTY);
  assert.equal(result.reason, "GOAL_ADAPTER_EXECUTION_DISABLED");
  assert.equal(result.request, null);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.dispatchImplemented, false);
  assert.equal(result.requestDispatched, false);
  assert.equal(result.mutationDispatched, false);
});

test("adapter rejects execution decisions that are not ready or already dispatched", () => {
  const blocked = readyDecision();
  blocked.state = "BLOCKED";
  blocked.dispatchAllowed = false;

  assert.equal(
    buildGoalAdapterPlan(blocked).reason,
    "GOAL_ADAPTER_EXECUTION_DECISION_NOT_READY",
  );

  const alreadyImplemented = readyDecision();
  alreadyImplemented.dispatchImplemented = true;
  assert.equal(
    buildGoalAdapterPlan(alreadyImplemented).reason,
    "GOAL_ADAPTER_EXECUTION_BOUNDARY_INVALID",
  );

  const mutated = readyDecision();
  mutated.mutationDispatched = true;
  assert.equal(
    buildGoalAdapterPlan(mutated).reason,
    "GOAL_ADAPTER_EXECUTION_BOUNDARY_INVALID",
  );
});

test("FARM_ITEM requires explicit runtime hints and never invents them", () => {
  const result = buildGoalAdapterPlan(
    readyDecision({
      kind: "FARM_ITEM",
      characterName: null,
      metadata: {
        runtime: {
          workerCharacter: "My_Ranger1",
        },
      },
    }),
  );

  assert.equal(result.state, GOAL_ADAPTER_STATES.BLOCKED);
  assert.equal(result.reason, "GOAL_ADAPTER_FARM_RUNTIME_HINTS_REQUIRED");
  assert.deepEqual(result.details.missing, [
    "monsterType",
    "recipient",
    "recipientPosition",
  ]);
  assert.equal(result.request, null);
  assert.equal(result.policy.noInventedExecutionParameters, true);
});

test("fixed-character FARM_ITEM stays blocked for delivery-based material worker", () => {
  const result = buildGoalAdapterPlan(
    readyDecision({
      kind: "FARM_ITEM",
      characterName: "My_Ranger1",
      metadata: {
        runtime: {
          workerCharacter: "My_Ranger1",
          monsterType: "goo",
          recipient: "My_Merchant",
          recipientPosition: { map: "main", x: 10, y: 20 },
        },
      },
    }),
  );

  assert.equal(result.state, GOAL_ADAPTER_STATES.BLOCKED);
  assert.equal(result.reason, "GOAL_ADAPTER_FARM_FIXED_CHARACTER_UNSUPPORTED");
  assert.deepEqual(result.details, { characterName: "My_Ranger1" });
  assert.equal(result.request, null);
});

test("account-wide FARM_ITEM maps to existing MaterialGatheringTaskRunner contract", () => {
  const result = buildGoalAdapterPlan(
    readyDecision({
      kind: "FARM_ITEM",
      characterName: null,
      target: { itemName: "gem0", quantity: 4 },
      metadata: {
        runtime: {
          workerCharacter: "My_Ranger1",
          monsterType: "goo",
          recipient: "My_Merchant",
          recipientPosition: { map: "main", x: -120, y: 75 },
          itemLevel: 0,
          timeoutMs: 120000,
          pollMs: 200,
        },
      },
    }),
    { now: () => 1234 },
  );

  assert.equal(result.timestamp, 1234);
  assert.equal(result.state, GOAL_ADAPTER_STATES.READY);
  assert.equal(result.reason, "GOAL_ADAPTER_FARM_REQUEST_READY");
  assert.deepEqual(result.capability, GOAL_ADAPTER_CAPABILITIES.FARM_ITEM);
  assert.deepEqual(result.request, {
    version: GOAL_ADAPTER_REQUEST_VERSION,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "goal-1",
    taskId: "goal-1:3",
    kind: "FARM_ITEM",
    bridge: "MaterialGatheringTaskRunner",
    runtimeMethod: "runMaterialGatherTask",
    characterName: "My_Ranger1",
    arguments: {
      itemName: "gem0",
      quantity: 4,
      monsterType: "goo",
      recipient: "My_Merchant",
      recipientPosition: { map: "main", x: -120, y: 75 },
      itemLevel: 0,
      timeoutMs: 120000,
      pollMs: 200,
    },
    runtimeGuards: [
      "TARGET_RUNTIME_RUNNING",
      "TARGET_RANGER_REQUIRED",
      "NO_CONTROLLED_ACTIVITY",
      "EMERGENCY_STOP_CLEAR",
      "UNKNOWN_OUTCOME_NO_BLIND_RETRY",
    ],
    mutationDomain: "GAMEPLAY_VALUE",
    dispatchAllowed: false,
    dispatchImplemented: false,
  });
  assert.equal(result.requestDispatched, false);
  assert.equal(result.mutationDispatched, false);
});

test("invalid optional FARM_ITEM runtime hints fail closed", () => {
  const decision = readyDecision({
    characterName: null,
    metadata: {
      runtime: {
        workerCharacter: "My_Ranger1",
        monsterType: "goo",
        recipient: "My_Merchant",
        recipientPosition: { map: "main", x: 0, y: 0 },
        itemLevel: -1,
      },
    },
  });

  assert.equal(
    buildGoalAdapterPlan(decision).reason,
    "GOAL_ADAPTER_FARM_ITEM_LEVEL_INVALID",
  );

  decision.action.metadata.runtime.itemLevel = 0;
  decision.action.metadata.runtime.timeoutMs = 0;
  assert.equal(
    buildGoalAdapterPlan(decision).reason,
    "GOAL_ADAPTER_FARM_TIMEOUT_INVALID",
  );

  delete decision.action.metadata.runtime.timeoutMs;
  decision.action.metadata.runtime.pollMs = 0;
  assert.equal(
    buildGoalAdapterPlan(decision).reason,
    "GOAL_ADAPTER_FARM_POLL_INVALID",
  );
});

test("TRAIN_CHARACTER maps to explicit scheduler-driven training pulse", () => {
  const result = buildGoalAdapterPlan(
    readyDecision({
      kind: "TRAIN_CHARACTER",
      characterName: "My_Mage",
      target: {
        characterName: "My_Mage",
        level: 42,
      },
      metadata: {
        runtime: {
          monsterType: "goo",
          timeoutMs: 60000,
          pollMs: 200,
        },
      },
      mutationDomain: "GAMEPLAY",
    }),
    { now: () => 3333 },
  );

  assert.equal(result.timestamp, 3333);
  assert.equal(result.state, GOAL_ADAPTER_STATES.READY);
  assert.equal(result.reason, "GOAL_ADAPTER_TRAINING_REQUEST_READY");
  assert.deepEqual(
    result.capability,
    GOAL_ADAPTER_CAPABILITIES.TRAIN_CHARACTER,
  );
  assert.deepEqual(result.request, {
    version: GOAL_ADAPTER_REQUEST_VERSION,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "goal-1",
    taskId: "goal-1:3",
    kind: "TRAIN_CHARACTER",
    bridge: "CharacterTrainingTaskRunner",
    runtimeMethod: "runCharacterTrainingTask",
    characterName: "My_Mage",
    arguments: {
      targetLevel: 42,
      monsterType: "goo",
      timeoutMs: 60000,
      pollMs: 200,
    },
    runtimeGuards: [
      "TARGET_RUNTIME_RUNNING",
      "NO_CONTROLLED_ACTIVITY",
      "COMBAT_SCHEDULER_REQUIRED",
      "EMERGENCY_STOP_CLEAR",
      "SCOPED_COMBAT_OVERRIDE_MUST_BE_CLEARED",
      "UNKNOWN_OUTCOME_NO_BLIND_RETRY",
    ],
    mutationDomain: "GAMEPLAY",
    dispatchAllowed: false,
    dispatchImplemented: false,
  });
});

test("TRAIN_CHARACTER requires explicit monster source and exact target worker", () => {
  const missing = buildGoalAdapterPlan(
    readyDecision({
      kind: "TRAIN_CHARACTER",
      characterName: "My_Mage",
      target: { characterName: "My_Mage", level: 42 },
      metadata: { runtime: {} },
    }),
  );
  assert.equal(missing.state, GOAL_ADAPTER_STATES.BLOCKED);
  assert.equal(missing.reason, "GOAL_ADAPTER_TRAINING_RUNTIME_HINTS_REQUIRED");
  assert.deepEqual(missing.details.missing, ["monsterType"]);

  const mismatch = buildGoalAdapterPlan(
    readyDecision({
      kind: "TRAIN_CHARACTER",
      characterName: "My_Mage",
      target: { characterName: "My_Mage", level: 42 },
      metadata: {
        runtime: {
          workerCharacter: "My_Ranger1",
          monsterType: "goo",
        },
      },
    }),
  );
  assert.equal(mismatch.state, GOAL_ADAPTER_STATES.BLOCKED);
  assert.equal(
    mismatch.reason,
    "GOAL_ADAPTER_TRAINING_WORKER_MUST_MATCH_TARGET",
  );
  assert.deepEqual(mismatch.details, {
    characterName: "My_Mage",
    workerCharacter: "My_Ranger1",
  });
});

test("ACQUIRE_GEAR maps to retained minimum-level gear gathering", () => {
  const result = buildGoalAdapterPlan(
    readyDecision({
      kind: "ACQUIRE_GEAR",
      characterName: "My_Ranger1",
      target: {
        itemName: "helmet",
        level: 2,
        characterName: "My_Ranger1",
      },
      metadata: {
        runtime: {
          monsterType: "goo",
          timeoutMs: 90000,
          pollMs: 150,
        },
      },
      mutationDomain: "GAMEPLAY_VALUE",
    }),
    { now: () => 2222 },
  );

  assert.equal(result.timestamp, 2222);
  assert.equal(result.state, GOAL_ADAPTER_STATES.READY);
  assert.equal(result.reason, "GOAL_ADAPTER_GEAR_REQUEST_READY");
  assert.deepEqual(result.capability, GOAL_ADAPTER_CAPABILITIES.ACQUIRE_GEAR);
  assert.deepEqual(result.request, {
    version: GOAL_ADAPTER_REQUEST_VERSION,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "goal-1",
    taskId: "goal-1:3",
    kind: "ACQUIRE_GEAR",
    bridge: "MaterialGatheringTaskRunner",
    runtimeMethod: "runMaterialGatherTask",
    characterName: "My_Ranger1",
    arguments: {
      itemName: "helmet",
      minimumItemLevel: 2,
      monsterType: "goo",
      quantity: 1,
      deliveryMode: "KEEP_ON_WORKER",
      timeoutMs: 90000,
      pollMs: 150,
    },
    runtimeGuards: [
      "TARGET_RUNTIME_RUNNING",
      "TARGET_RANGER_REQUIRED",
      "NO_CONTROLLED_ACTIVITY",
      "EMERGENCY_STOP_CLEAR",
      "UNKNOWN_OUTCOME_NO_BLIND_RETRY",
      "QUALIFYING_GEAR_MUST_REMAIN_ON_WORKER",
    ],
    mutationDomain: "GAMEPLAY_VALUE",
    dispatchAllowed: false,
    dispatchImplemented: false,
  });
});

test("ACQUIRE_GEAR requires explicit farm source and matching fixed worker", () => {
  const missingSource = buildGoalAdapterPlan(
    readyDecision({
      kind: "ACQUIRE_GEAR",
      characterName: null,
      target: { itemName: "helmet", level: 0 },
      metadata: {
        runtime: {
          workerCharacter: "My_Ranger1",
        },
      },
    }),
  );
  assert.equal(missingSource.state, GOAL_ADAPTER_STATES.BLOCKED);
  assert.equal(
    missingSource.reason,
    "GOAL_ADAPTER_GEAR_RUNTIME_HINTS_REQUIRED",
  );
  assert.deepEqual(missingSource.details.missing, ["monsterType"]);

  const mismatch = buildGoalAdapterPlan(
    readyDecision({
      kind: "ACQUIRE_GEAR",
      characterName: "My_Ranger2",
      target: {
        itemName: "helmet",
        level: 1,
        characterName: "My_Ranger2",
      },
      metadata: {
        runtime: {
          workerCharacter: "My_Ranger1",
          monsterType: "goo",
        },
      },
    }),
  );
  assert.equal(mismatch.state, GOAL_ADAPTER_STATES.BLOCKED);
  assert.equal(mismatch.reason, "GOAL_ADAPTER_GEAR_WORKER_MUST_MATCH_TARGET");
  assert.deepEqual(mismatch.details, {
    characterName: "My_Ranger2",
    workerCharacter: "My_Ranger1",
  });
});

test("PLAN_CRAFT maps to guarded preflight plus one scoped one-shot", () => {
  const result = buildGoalAdapterPlan(
    readyDecision({
      kind: "PLAN_CRAFT",
      characterName: "My_Merchant",
      target: { itemName: "fireblade", quantity: 2 },
      mutationDomain: "VALUE",
    }),
  );

  assert.equal(result.state, GOAL_ADAPTER_STATES.READY);
  assert.equal(result.reason, "GOAL_ADAPTER_CRAFT_REQUEST_READY");
  assert.deepEqual(result.capability, GOAL_ADAPTER_CAPABILITIES.PLAN_CRAFT);
  assert.equal(result.request.type, "GOAL_RUNTIME_SEQUENCE");
  assert.equal(result.request.bridge, "CraftController");
  assert.deepEqual(result.request.preflight, {
    runtimeMethod: "runCraftMaterialPlan",
    arguments: { recipe: "fireblade" },
    readOnly: true,
  });
  assert.deepEqual(result.request.scopedConfigOverride, {
    craft: {
      enabled: true,
      allowedRecipes: ["fireblade"],
    },
  });
  assert.deepEqual(result.request.execution, {
    runtimeMethod: "executeCraftNext",
    maxInvocations: 1,
  });
  assert.deepEqual(result.request.cleanup, {
    clearConfigOverride: true,
    refreshPlanning: true,
  });
  assert.deepEqual(result.request.completionTarget, {
    itemName: "fireblade",
    quantity: 2,
  });
  assert.equal(result.request.dispatchAllowed, false);
  assert.equal(result.request.dispatchImplemented, false);
  assert.equal(result.mutationDispatched, false);
});

test("PLAN_CRAFT accepts an explicit runtime worker hint without inventing a character", () => {
  const hinted = buildGoalAdapterPlan(
    readyDecision({
      kind: "PLAN_CRAFT",
      characterName: null,
      target: { itemName: "fireblade", quantity: 1 },
      metadata: {
        runtime: {
          workerCharacter: "My_Merchant",
        },
      },
      mutationDomain: "VALUE",
    }),
  );

  assert.equal(hinted.state, GOAL_ADAPTER_STATES.READY);
  assert.equal(hinted.request.characterName, "My_Merchant");

  const fixed = buildGoalAdapterPlan(
    readyDecision({
      kind: "PLAN_CRAFT",
      characterName: "My_Merchant",
      target: { itemName: "fireblade", quantity: 1 },
      metadata: {
        runtime: {
          workerCharacter: "My_Ranger1",
        },
      },
      mutationDomain: "VALUE",
    }),
  );

  assert.equal(fixed.request.characterName, "My_Merchant");
});

test("unsupported runtime workers remain explicitly blocked", () => {
  const cases = [
    ["ACCUMULATE_GOLD", "GOAL_ADAPTER_GOLD_RUNTIME_WORKER_MISSING"],
  ];

  for (const [kind, reason] of cases) {
    const result = buildGoalAdapterPlan(
      readyDecision({
        kind,
        target: {},
      }),
    );
    assert.equal(result.state, GOAL_ADAPTER_STATES.BLOCKED);
    assert.equal(result.reason, reason);
    assert.equal(result.request, null);
    assert.equal(result.details.capability.translationSupported, false);
  }
});

test("Coordinator and dashboard project Goal adapter plans without dispatch wiring", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(coordinator, /buildGoalAdapterPlan/);
  assert.match(coordinator, /getGoalAdapterState:\s*goal_adapter_state/);
  assert.match(coordinator, /function goal_adapter_state\(\)/);
  assert.doesNotMatch(coordinator, /function reconcile_goal_adapter/);
  assert.doesNotMatch(coordinator, /dispatch_goal_adapter/);
  assert.doesNotMatch(coordinator, /goal_runtime_request/);

  assert.match(dashboard, /goal_adapter:\s*goalAdapterState/);
  assert.match(dashboard, /getGoalAdapterState/);
  assert.match(dashboard, /requestDispatched:\s*false/);
  assert.match(dashboard, /mutationDispatched:\s*false/);
});

test("Goal adapter contract contains no dispatch or mutation implementation", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalAdapter.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /sendIpcMessage/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /controlRotation/);
  assert.doesNotMatch(source, /socket\.emit/);
  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /\.executeNext\s*\(/);
  assert.doesNotMatch(source, /\.runMaterialGatherTask\s*\(/);
  assert.doesNotMatch(source, /\.runCraftMaterialPlan\s*\(/);
});

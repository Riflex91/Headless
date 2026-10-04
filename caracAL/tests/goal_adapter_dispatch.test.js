"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

function preflight({
  outcome = "PASS",
  kind = "FARM_ITEM",
  goalId = "goal-1",
  taskId = "goal-1:3",
  evidence = {},
} = {}) {
  return {
    requestId: "preflight-1",
    outcome,
    reason:
      outcome === "PASS"
        ? "GOAL_ADAPTER_PREFLIGHT_FARM_CONFIRMED"
        : "TEST_BLOCKED",
    goalId,
    taskId,
    kind,
    character: {
      name: "My_Ranger1",
      ctype: "ranger",
    },
    evidence,
    scope: {
      readOnly: true,
      ipcResponseOnly: true,
      gameplayMutationDispatched: false,
      valueMutationDispatched: false,
      lifecycleMutationDispatched: false,
      blindRetryAllowed: false,
    },
    cleanup: {
      farmOverrideCleared: true,
    },
  };
}

function farmRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "goal-1",
    taskId: "goal-1:3",
    kind: "FARM_ITEM",
    bridge: "MaterialGatheringTaskRunner",
    runtimeMethod: "runMaterialGatherTask",
    characterName: "My_Ranger1",
    arguments: {
      itemName: "spidersilk",
      quantity: 2,
      monsterType: "spider",
      recipient: "My_Merchant",
      recipientPosition: {
        map: "main",
        x: 100,
        y: 200,
      },
      itemLevel: 0,
      timeoutMs: 30000,
      pollMs: 100,
    },
    dispatchAllowed: false,
    dispatchImplemented: false,
    ...overrides,
  };
}

function gearRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "gear-1",
    taskId: "gear-1:2",
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
      timeoutMs: 45000,
      pollMs: 100,
    },
    dispatchAllowed: false,
    dispatchImplemented: false,
    ...overrides,
  };
}

function trainingRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "train-1",
    taskId: "train-1:1",
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
    dispatchAllowed: false,
    dispatchImplemented: false,
    ...overrides,
  };
}

function goldRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "gold-1",
    taskId: "gold-1:1",
    kind: "ACCUMULATE_GOLD",
    bridge: "CharacterGoldTaskRunner",
    runtimeMethod: "runCharacterGoldTask",
    characterName: "My_Rogue",
    arguments: {
      goalAmount: 1000000,
      scope: "ACCOUNT",
      monsterType: "goo",
      timeoutMs: 60000,
      pollMs: 200,
    },
    dispatchAllowed: false,
    dispatchImplemented: false,
    ...overrides,
  };
}

function craftRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_SEQUENCE",
    goalId: "craft-1",
    taskId: "craft-1:2",
    kind: "PLAN_CRAFT",
    bridge: "CraftController",
    dispatchAllowed: false,
    dispatchImplemented: false,
    preflight: {
      runtimeMethod: "runCraftMaterialPlan",
      arguments: {
        recipe: "rod",
      },
      readOnly: true,
    },
    scopedConfigOverride: {
      craft: {
        enabled: true,
        allowedRecipes: ["rod"],
      },
    },
    execution: {
      runtimeMethod: "executeCraftNext",
      maxInvocations: 1,
    },
    cleanup: {
      clearConfigOverride: true,
      refreshPlanning: true,
    },
    ...overrides,
  };
}

function setup({
  preflightResult = preflight(),
  materialResult = {
    outcome: "PASS",
    reason: "MATERIAL_GATHER_AND_DELIVERY_CONFIRMED",
  },
  trainingResult = {
    outcome: "PASS",
    reason: "CHARACTER_TRAINING_PROGRESS_CONFIRMED",
    targetReached: false,
    levelIncreased: false,
    xpIncreased: true,
  },
  goldResult = {
    outcome: "PASS",
    reason: "CHARACTER_GOLD_PROGRESS_CONFIRMED",
    targetReached: false,
    goldIncreased: true,
  },
  craftActionStatus = "CONFIRMED",
  craftSelectedRecipe = "rod",
} = {}) {
  const calls = [];
  let craftOverride = null;
  const { GoalAdapterDispatchRunner } = core("goal-adapter-dispatch.lib.ts");

  const runner = new GoalAdapterDispatchRunner({
    preflight: async (request, options) => {
      calls.push(["preflight", request, options]);
      return preflightResult;
    },
    runMaterialGatherTask: async (options) => {
      calls.push(["material", options]);
      return {
        requestId: options.requestId,
        outcome: materialResult.outcome,
        reason: materialResult.reason,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        worker: "My_Ranger1",
        itemName: options.itemName,
        itemLevel: options.itemLevel ?? null,
        minimumItemLevel: options.minimumItemLevel ?? null,
        monsterType: options.monsterType,
        quantity: options.quantity,
        deliveryMode: options.deliveryMode || "DELIVER",
        recipient: options.recipient ?? null,
        inventory: {
          initialQuantity: 0,
          gatheredQuantity: options.quantity,
          deliveredQuantity:
            options.deliveryMode === "KEEP_ON_WORKER" ? 0 : options.quantity,
        },
        evidence: {
          combatControllerUsed: true,
          attackUnknownReconciled: false,
          lootConfirmed: true,
          materialObserved: true,
          deliveryConfirmed:
            options.deliveryMode !== "KEEP_ON_WORKER" &&
            materialResult.outcome === "PASS",
          keptOnWorkerConfirmed:
            options.deliveryMode === "KEEP_ON_WORKER" &&
            materialResult.outcome === "PASS" &&
            materialResult.keptOnWorkerConfirmed !== false,
          blindRetryUsed: false,
        },
        cleanup: {
          combatOverrideCleared: true,
          preferredTargetCleared: true,
        },
      };
    },
    runCharacterTrainingTask: async (options) => {
      calls.push(["training", options]);
      return {
        requestId: options.requestId,
        outcome: trainingResult.outcome,
        reason: trainingResult.reason,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        character: "My_Mage",
        monsterType: options.monsterType,
        targetLevel: options.targetLevel,
        progress: {
          startLevel: 40,
          startXp: 1000,
          finalLevel: trainingResult.levelIncreased ? 41 : 40,
          finalXp: trainingResult.xpIncreased ? 1010 : 1000,
          targetReached: trainingResult.targetReached,
          levelIncreased: trainingResult.levelIncreased,
          xpIncreased: trainingResult.xpIncreased,
        },
        evidence: {
          schedulerDrivenCombat: true,
          combatStatusObserved: true,
          targetMonsterObserved: true,
          navigationStatus: "CONFIRMED",
          blindRetryUsed: false,
        },
        cleanup: {
          combatOverrideCleared: true,
        },
      };
    },
    runCharacterGoldTask: async (options) => {
      calls.push(["gold", options]);
      return {
        requestId: options.requestId,
        outcome: goldResult.outcome,
        reason: goldResult.reason,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        character: "My_Rogue",
        monsterType: options.monsterType,
        goalAmount: options.goalAmount,
        scope: options.scope,
        progress: {
          startGold: 500000,
          finalGold: goldResult.goldIncreased ? 500025 : 500000,
          targetReached: goldResult.targetReached,
          goldIncreased: goldResult.goldIncreased,
        },
        evidence: {
          schedulerDrivenCombat: true,
          combatStatusObserved: true,
          targetMonsterObserved: true,
          navigationStatus: "CONFIRMED",
          blindRetryUsed: false,
        },
        cleanup: {
          combatOverrideCleared: true,
        },
      };
    },
    craft: {
      setConfigOverride(value) {
        craftOverride = value;
        calls.push(["craftOverride", value]);
      },
      clearConfigOverride() {
        craftOverride = null;
        calls.push(["craftOverride", null]);
      },
      tick() {
        calls.push(["craftTick", craftOverride]);
        if (!craftOverride) {
          return {
            state: "EMPTY",
            selected: null,
            lastAction: {
              status: craftActionStatus,
            },
          };
        }
        return {
          state: "READY",
          selected: {
            recipe: craftSelectedRecipe,
          },
          lastAction: null,
        };
      },
      async executeNext() {
        calls.push(["craftExecute"]);
        return {
          state: craftActionStatus === "UNKNOWN" ? "UNKNOWN_HOLD" : "EMPTY",
          selected: null,
          lastAction: {
            status: craftActionStatus,
            recipe: "rod",
          },
        };
      },
    },
    now: () => 1000,
  });

  return { runner, calls, getCraftOverride: () => craftOverride };
}

test("dispatch is blocked without explicit authorization before preflight", async () => {
  const s = setup();

  const result = await s.runner.run(farmRequest(), {
    requestId: "dispatch-1",
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_NOT_AUTHORIZED");
  assert.equal(result.scope.authorized, false);
  assert.equal(result.scope.mutationPathInvoked, false);
  assert.deepEqual(s.calls, []);
});

test("dispatch preserves the non-dispatchable adapter contract", async () => {
  const s = setup();

  const result = await s.runner.run(farmRequest({ dispatchAllowed: true }), {
    requestId: "dispatch-1",
    authorized: true,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_CONTRACT_INVALID");
  assert.deepEqual(s.calls, []);
});

test("dispatch requires a fresh matching read-only preflight PASS", async () => {
  const blocked = setup({
    preflightResult: preflight({ outcome: "BLOCKED" }),
  });
  const blockedResult = await blocked.runner.run(farmRequest(), {
    requestId: "dispatch-1",
    authorized: true,
  });
  assert.equal(blockedResult.outcome, "BLOCKED");
  assert.equal(
    blockedResult.reason,
    "GOAL_ADAPTER_DISPATCH_PREFLIGHT_NOT_CONFIRMED",
  );
  assert.equal(
    blocked.calls.some(([name]) => name === "material"),
    false,
  );

  const mismatch = setup({
    preflightResult: preflight({ taskId: "other" }),
  });
  const mismatchResult = await mismatch.runner.run(farmRequest(), {
    requestId: "dispatch-2",
    authorized: true,
  });
  assert.equal(mismatchResult.outcome, "BLOCKED");
  assert.equal(
    mismatchResult.reason,
    "GOAL_ADAPTER_DISPATCH_PREFLIGHT_NOT_CONFIRMED",
  );
});

test("FARM_ITEM invokes the existing material worker exactly once after preflight", async () => {
  const s = setup();
  const result = await s.runner.run(farmRequest(), {
    requestId: "dispatch-1",
    authorized: true,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_FARM_CONFIRMED");
  assert.equal(result.scope.authorized, true);
  assert.equal(result.scope.preflightRequired, true);
  assert.equal(result.scope.maxExecutionInvocations, 1);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(result.scope.mutationPathInvoked, true);
  assert.equal(s.calls.filter(([name]) => name === "preflight").length, 1);
  assert.equal(s.calls.filter(([name]) => name === "material").length, 1);
  const material = s.calls.find(([name]) => name === "material")[1];
  assert.deepEqual(material, {
    requestId: "dispatch-1:farm",
    itemName: "spidersilk",
    itemLevel: 0,
    monsterType: "spider",
    quantity: 2,
    recipient: "My_Merchant",
    recipientPosition: {
      map: "main",
      x: 100,
      y: 200,
    },
    timeoutMs: 30000,
    pollMs: 100,
  });
});

test("FARM_ITEM UNKNOWN is surfaced without blind retry", async () => {
  const s = setup({
    materialResult: {
      outcome: "UNKNOWN",
      reason: "MATERIAL_ATTACK_OUTCOME_UNKNOWN",
    },
  });

  const result = await s.runner.run(farmRequest(), {
    requestId: "dispatch-1",
    authorized: true,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.match(result.reason, /MATERIAL_ATTACK_OUTCOME_UNKNOWN/);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "material").length, 1);
});

test("TRAIN_CHARACTER invokes exactly one bounded training pulse after preflight", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "TRAIN_CHARACTER",
      goalId: "train-1",
      taskId: "train-1:1",
    }),
  });

  const result = await s.runner.run(trainingRequest(), {
    requestId: "dispatch-training",
    authorized: true,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_TRAINING_CONFIRMED");
  assert.equal(result.scope.mutationPathInvoked, true);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "preflight").length, 1);
  assert.equal(s.calls.filter(([name]) => name === "training").length, 1);
  assert.deepEqual(s.calls.find(([name]) => name === "training")[1], {
    requestId: "dispatch-training:training",
    targetLevel: 42,
    monsterType: "goo",
    timeoutMs: 60000,
    pollMs: 200,
  });
  assert.equal(result.execution.training.progress.xpIncreased, true);
});

test("TRAIN_CHARACTER rejects a worker PASS without observable progress", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "TRAIN_CHARACTER",
      goalId: "train-1",
      taskId: "train-1:1",
    }),
    trainingResult: {
      outcome: "PASS",
      reason: "CHARACTER_TRAINING_PROGRESS_CONFIRMED",
      targetReached: false,
      levelIncreased: false,
      xpIncreased: false,
    },
  });

  const result = await s.runner.run(trainingRequest(), {
    requestId: "dispatch-training",
    authorized: true,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(
    result.reason,
    "GOAL_ADAPTER_DISPATCH_TRAINING_PROGRESS_NOT_CONFIRMED",
  );
  assert.equal(s.calls.filter(([name]) => name === "training").length, 1);
});

test("TRAIN_CHARACTER UNKNOWN is surfaced without retry", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "TRAIN_CHARACTER",
      goalId: "train-1",
      taskId: "train-1:1",
    }),
    trainingResult: {
      outcome: "UNKNOWN",
      reason: "CHARACTER_TRAINING_ATTACK_OUTCOME_UNKNOWN",
      targetReached: false,
      levelIncreased: false,
      xpIncreased: false,
    },
  });

  const result = await s.runner.run(trainingRequest(), {
    requestId: "dispatch-training",
    authorized: true,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.match(result.reason, /CHARACTER_TRAINING_ATTACK_OUTCOME_UNKNOWN/);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "training").length, 1);
});

test("ACCUMULATE_GOLD invokes exactly one bounded gold pulse after preflight", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "ACCUMULATE_GOLD",
      goalId: "gold-1",
      taskId: "gold-1:1",
    }),
  });

  const result = await s.runner.run(goldRequest(), {
    requestId: "dispatch-gold",
    authorized: true,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_GOLD_CONFIRMED");
  assert.equal(result.scope.mutationPathInvoked, true);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "preflight").length, 1);
  assert.equal(s.calls.filter(([name]) => name === "gold").length, 1);
  assert.deepEqual(s.calls.find(([name]) => name === "gold")[1], {
    requestId: "dispatch-gold:gold",
    goalAmount: 1000000,
    scope: "ACCOUNT",
    monsterType: "goo",
    timeoutMs: 60000,
    pollMs: 200,
  });
  assert.equal(result.execution.gold.progress.goldIncreased, true);
});

test("ACCUMULATE_GOLD rejects a worker PASS without observable gold progress", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "ACCUMULATE_GOLD",
      goalId: "gold-1",
      taskId: "gold-1:1",
    }),
    goldResult: {
      outcome: "PASS",
      reason: "CHARACTER_GOLD_PROGRESS_CONFIRMED",
      targetReached: false,
      goldIncreased: false,
    },
  });

  const result = await s.runner.run(goldRequest(), {
    requestId: "dispatch-gold",
    authorized: true,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(
    result.reason,
    "GOAL_ADAPTER_DISPATCH_GOLD_PROGRESS_NOT_CONFIRMED",
  );
  assert.equal(s.calls.filter(([name]) => name === "gold").length, 1);
});

test("ACCUMULATE_GOLD UNKNOWN is surfaced without retry", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "ACCUMULATE_GOLD",
      goalId: "gold-1",
      taskId: "gold-1:1",
    }),
    goldResult: {
      outcome: "UNKNOWN",
      reason: "CHARACTER_GOLD_ATTACK_OUTCOME_UNKNOWN",
      targetReached: false,
      goldIncreased: false,
    },
  });

  const result = await s.runner.run(goldRequest(), {
    requestId: "dispatch-gold",
    authorized: true,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.match(result.reason, /CHARACTER_GOLD_ATTACK_OUTCOME_UNKNOWN/);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "gold").length, 1);
});

test("ACQUIRE_GEAR invokes retained material worker exactly once after preflight", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "ACQUIRE_GEAR",
      goalId: "gear-1",
      taskId: "gear-1:2",
    }),
  });

  const result = await s.runner.run(gearRequest(), {
    requestId: "dispatch-gear",
    authorized: true,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_GEAR_CONFIRMED");
  assert.equal(result.scope.mutationPathInvoked, true);
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "preflight").length, 1);
  assert.equal(s.calls.filter(([name]) => name === "material").length, 1);
  const material = s.calls.find(([name]) => name === "material")[1];
  assert.deepEqual(material, {
    requestId: "dispatch-gear:gear",
    itemName: "helmet",
    minimumItemLevel: 2,
    monsterType: "goo",
    quantity: 1,
    deliveryMode: "KEEP_ON_WORKER",
    timeoutMs: 45000,
    pollMs: 100,
  });
  assert.equal(
    result.execution.materialGather.evidence.keptOnWorkerConfirmed,
    true,
  );
});

test("ACQUIRE_GEAR rejects a worker PASS without retained gear evidence", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "ACQUIRE_GEAR",
      goalId: "gear-1",
      taskId: "gear-1:2",
    }),
    materialResult: {
      outcome: "PASS",
      reason: "MATERIAL_GATHER_KEEP_ON_WORKER_CONFIRMED",
      keptOnWorkerConfirmed: false,
    },
  });

  const result = await s.runner.run(gearRequest(), {
    requestId: "dispatch-gear",
    authorized: true,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_GEAR_NOT_CONFIRMED");
  assert.equal(s.calls.filter(([name]) => name === "material").length, 1);
});

test("ACQUIRE_GEAR contract rejects delivery mode drift before mutation", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "ACQUIRE_GEAR",
      goalId: "gear-1",
      taskId: "gear-1:2",
    }),
  });

  const result = await s.runner.run(
    gearRequest({
      arguments: {
        itemName: "helmet",
        minimumItemLevel: 2,
        monsterType: "goo",
        quantity: 1,
        deliveryMode: "DELIVER",
      },
    }),
    {
      requestId: "dispatch-gear",
      authorized: true,
    },
  );

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_GEAR_CONTRACT_INVALID");
  assert.equal(result.scope.mutationPathInvoked, false);
  assert.equal(
    s.calls.some(([name]) => name === "material"),
    false,
  );
});

test("PLAN_CRAFT requires preflight evidence that the recipe is already ready", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "PLAN_CRAFT",
      goalId: "craft-1",
      taskId: "craft-1:2",
      evidence: {
        recipe: "rod",
        materialTargetSelected: true,
        alreadyReady: false,
      },
    }),
  });

  const result = await s.runner.run(craftRequest(), {
    requestId: "dispatch-craft",
    authorized: true,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_CRAFT_NOT_READY");
  assert.equal(
    s.calls.some(([name]) => name === "craftExecute"),
    false,
  );
});

test("PLAN_CRAFT executes exactly one scoped CraftController action and cleans up", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "PLAN_CRAFT",
      goalId: "craft-1",
      taskId: "craft-1:2",
      evidence: {
        recipe: "rod",
        alreadyReady: true,
        materialTargetSelected: false,
      },
    }),
  });

  const result = await s.runner.run(craftRequest(), {
    requestId: "dispatch-craft",
    authorized: true,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_CRAFT_CONFIRMED");
  assert.equal(result.scope.mutationPathInvoked, true);
  assert.equal(s.calls.filter(([name]) => name === "craftExecute").length, 1);
  assert.equal(result.cleanup.craftOverrideCleared, true);
  assert.equal(result.cleanup.craftPlanningRefreshed, true);
  assert.equal(s.getCraftOverride(), null);
});

test("PLAN_CRAFT selection drift blocks before mutation and still cleans up", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "PLAN_CRAFT",
      goalId: "craft-1",
      taskId: "craft-1:2",
      evidence: {
        recipe: "rod",
        alreadyReady: true,
      },
    }),
    craftSelectedRecipe: "other",
  });

  const result = await s.runner.run(craftRequest(), {
    requestId: "dispatch-craft",
    authorized: true,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_CRAFT_SELECTION_DRIFT");
  assert.equal(result.scope.mutationPathInvoked, false);
  assert.equal(
    s.calls.some(([name]) => name === "craftExecute"),
    false,
  );
  assert.equal(result.cleanup.craftOverrideCleared, true);
  assert.equal(result.cleanup.craftPlanningRefreshed, true);
});

test("PLAN_CRAFT UNKNOWN is surfaced without a second execution", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "PLAN_CRAFT",
      goalId: "craft-1",
      taskId: "craft-1:2",
      evidence: {
        recipe: "rod",
        alreadyReady: true,
      },
    }),
    craftActionStatus: "UNKNOWN",
  });

  const result = await s.runner.run(craftRequest(), {
    requestId: "dispatch-craft",
    authorized: true,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_CRAFT_UNKNOWN");
  assert.equal(result.scope.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "craftExecute").length, 1);
});

test("unsupported Goal kinds never reach a mutation dependency", async () => {
  const s = setup({
    preflightResult: preflight({
      kind: "ACCUMULATE_GOLD",
      goalId: "gold-1",
      taskId: "gold-1:2",
    }),
  });
  const result = await s.runner.run(
    {
      version: 1,
      goalId: "gold-1",
      taskId: "gold-1:2",
      kind: "ACCUMULATE_GOLD",
      dispatchAllowed: false,
      dispatchImplemented: false,
    },
    { requestId: "dispatch-gold", authorized: true },
  );

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_DISPATCH_KIND_UNSUPPORTED");
  assert.equal(result.scope.mutationPathInvoked, false);
  assert.equal(
    s.calls.some(([name]) => ["material", "craftExecute"].includes(name)),
    false,
  );
});

test("runtime, thread and supervisor expose only guarded explicit one-shot dispatch", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
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

  assert.match(kernel, /GoalAdapterDispatchRunner/);
  assert.match(kernel, /private goalAdapterDispatchRunning = false/);
  assert.match(kernel, /async runGoalAdapterDispatch\(/);
  assert.match(kernel, /authorized: options\.authorized === true/);
  assert.match(kernel, /maxExecutionInvocations: 1/);
  assert.match(kernel, /blindRetryAllowed: false/);
  assert.doesNotMatch(
    kernel.slice(
      kernel.indexOf("async runGoalAdapterDispatch("),
      kernel.indexOf(
        "async runMaterialGatherTask(",
        kernel.indexOf("async runGoalAdapterDispatch("),
      ),
    ),
    /setInterval\s*\(/,
  );

  assert.match(thread, /case "goal_adapter_dispatch"/);
  assert.match(thread, /authorization\.goal_execution_enabled === true/);
  assert.match(thread, /authorization\.one_shot === true/);
  assert.match(thread, /authorization\.preflight_required === true/);
  assert.match(thread, /type: "goal_adapter_dispatch_result"/);

  assert.match(coordinator, /GoalAdapterDispatchSupervisor/);
  assert.match(coordinator, /goal_adapter_dispatch_result/);
  assert.match(
    coordinator,
    /goal_execution_automatic_reconcile_enabled:\s*false/,
  );
  assert.doesNotMatch(coordinator, /function reconcile_goal_execution/);
  assert.match(dashboard, /"\/headless\/api\/goals\/adapter-dispatch"/);
  assert.match(dashboard, /expectedGoalId/);
  assert.match(dashboard, /expectedTaskId/);
});

test("Goal adapter dispatcher has no internal retry or lifecycle control path", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "goal-adapter-dispatch.lib.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /controlRotation/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /while\s*\(/);
  assert.doesNotMatch(source, /for\s*\([^)]*retry/i);
  assert.match(source, /maxExecutionInvocations: 1/);
  assert.match(source, /blindRetryUsed: false/);
});

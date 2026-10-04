"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadPreflight() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "goal-adapter-preflight.lib.ts",
    ),
  );
}

function farmRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "farm-gem0",
    taskId: "farm-gem0:3",
    kind: "FARM_ITEM",
    bridge: "MaterialGatheringTaskRunner",
    runtimeMethod: "runMaterialGatherTask",
    characterName: "My_Ranger1",
    dispatchAllowed: false,
    dispatchImplemented: false,
    arguments: {
      itemName: "gem0",
      quantity: 4,
      monsterType: "goo",
      recipient: "My_Merchant",
      recipientPosition: {
        map: "main",
        x: 10,
        y: 20,
      },
    },
    ...overrides,
  };
}

function craftRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_SEQUENCE",
    goalId: "craft-rod",
    taskId: "craft-rod:2",
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
  character = { name: "My_Ranger1", ctype: "ranger" },
  farmStatus = null,
  farmTickError = null,
  craftPlan = null,
  craftPlanError = null,
} = {}) {
  const { GoalAdapterPreflightRunner } = loadPreflight();
  const calls = [];
  let override = null;
  let tickCount = 0;

  const farmIntelligence = {
    setConfigOverride(config) {
      calls.push(["farm:set", config]);
      override = config;
    },
    clearConfigOverride() {
      calls.push(["farm:clear"]);
      override = null;
    },
    tick() {
      tickCount += 1;
      calls.push(["farm:tick", tickCount]);
      if (farmTickError && tickCount === 1) throw farmTickError;
      return (
        farmStatus || {
          state: "READY",
          reason: "FARM_CANDIDATE_SELECTED",
          candidates: [
            {
              monster: "goo",
              estimated: {
                dropItems: ["gem0"],
              },
            },
          ],
        }
      );
    },
  };

  const runner = new GoalAdapterPreflightRunner({
    farmIntelligence,
    character: () => ({ ...character }),
    craftMaterialPlan: async (recipe) => {
      calls.push(["craft:plan", recipe]);
      if (craftPlanError) throw craftPlanError;
      return (
        craftPlan || {
          outcome: "PASS",
          reason: "CRAFT_MATERIAL_RECIPE_ALREADY_READY",
          requestedRecipe: recipe,
          selected: null,
          candidates: [],
          rejectedSources: [],
        }
      );
    },
    now: () => 1234,
  });

  return {
    runner,
    calls,
    get override() {
      return override;
    },
  };
}

test("Goal adapter preflight rejects unsupported request versions", async () => {
  const setupResult = setup();

  const result = await setupResult.runner.run(farmRequest({ version: 2 }), {
    requestId: "preflight-1",
  });

  assert.equal(result.requestId, "preflight-1");
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_PREFLIGHT_VERSION_UNSUPPORTED");
  assert.equal(result.evidence.expectedVersion, 1);
  assert.equal(result.evidence.observedVersion, 2);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.gameplayMutationDispatched, false);
  assert.equal(result.scope.valueMutationDispatched, false);
  assert.equal(result.scope.lifecycleMutationDispatched, false);
  assert.deepEqual(setupResult.calls, []);
});

test("Goal adapter preflight rejects dispatch-enabled request contracts", async () => {
  const setupResult = setup();

  const allowed = await setupResult.runner.run(
    farmRequest({ dispatchAllowed: true }),
  );
  assert.equal(allowed.outcome, "BLOCKED");
  assert.equal(
    allowed.reason,
    "GOAL_ADAPTER_PREFLIGHT_DISPATCH_BOUNDARY_INVALID",
  );
  assert.deepEqual(setupResult.calls, []);

  const implemented = await setupResult.runner.run(
    farmRequest({ dispatchImplemented: true }),
  );
  assert.equal(implemented.outcome, "BLOCKED");
  assert.equal(
    implemented.reason,
    "GOAL_ADAPTER_PREFLIGHT_DISPATCH_BOUNDARY_INVALID",
  );
  assert.deepEqual(setupResult.calls, []);
});

test("FARM_ITEM preflight confirms exact explicit monster to item source", async () => {
  const setupResult = setup();

  const result = await setupResult.runner.run(farmRequest());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_PREFLIGHT_FARM_CONFIRMED");
  assert.equal(result.goalId, "farm-gem0");
  assert.equal(result.kind, "FARM_ITEM");
  assert.equal(result.character.name, "My_Ranger1");
  assert.equal(result.character.ctype, "ranger");
  assert.deepEqual(result.evidence.dropItems, ["gem0"]);
  assert.equal(result.cleanup.farmOverrideCleared, true);
  assert.equal(setupResult.override, null);
  assert.deepEqual(setupResult.calls[0], [
    "farm:set",
    {
      farming: {
        enabled: true,
        goalMonster: "goo",
        goalItems: ["gem0"],
      },
    },
  ]);
  assert.deepEqual(setupResult.calls.slice(-2), [
    ["farm:clear"],
    ["farm:tick", 2],
  ]);
});

test("FARM_ITEM preflight blocks when explicit monster cannot confirm requested drop", async () => {
  const setupResult = setup({
    farmStatus: {
      state: "READY",
      reason: "FARM_CANDIDATE_SELECTED",
      candidates: [
        {
          monster: "bee",
          estimated: {
            dropItems: ["honey"],
          },
        },
        {
          monster: "goo",
          estimated: {
            dropItems: ["slime"],
          },
        },
      ],
    },
  });

  const result = await setupResult.runner.run(farmRequest());

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(
    result.reason,
    "GOAL_ADAPTER_PREFLIGHT_FARM_SOURCE_NOT_CONFIRMED",
  );
  assert.equal(result.evidence.candidateCount, 2);
  assert.equal(result.cleanup.farmOverrideCleared, true);
  assert.equal(setupResult.override, null);
});

test("FARM_ITEM preflight requires the exact ranger worker", async () => {
  const wrongCharacter = setup({
    character: { name: "My_Ranger2", ctype: "ranger" },
  });

  const mismatch = await wrongCharacter.runner.run(farmRequest());
  assert.equal(mismatch.outcome, "BLOCKED");
  assert.equal(mismatch.reason, "GOAL_ADAPTER_PREFLIGHT_FARM_WORKER_MISMATCH");
  assert.deepEqual(wrongCharacter.calls, []);

  const wrongClass = setup({
    character: { name: "My_Ranger1", ctype: "mage" },
  });
  const classMismatch = await wrongClass.runner.run(farmRequest());
  assert.equal(
    classMismatch.reason,
    "GOAL_ADAPTER_PREFLIGHT_FARM_WORKER_MISMATCH",
  );
  assert.deepEqual(wrongClass.calls, []);
});

test("FARM_ITEM preflight always clears scoped override after runtime errors", async () => {
  const setupResult = setup({
    farmTickError: new Error("farm projection failed"),
  });

  const result = await setupResult.runner.run(farmRequest());

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "GOAL_ADAPTER_PREFLIGHT_FARM_RUNTIME_ERROR");
  assert.equal(result.evidence.error, "farm projection failed");
  assert.equal(result.cleanup.farmOverrideCleared, true);
  assert.equal(setupResult.override, null);
  assert.deepEqual(setupResult.calls.slice(-2), [
    ["farm:clear"],
    ["farm:tick", 2],
  ]);
});

test("PLAN_CRAFT preflight requires the guarded one-shot and cleanup contract", async () => {
  const setupResult = setup({
    character: { name: "My_Merchant", ctype: "merchant" },
  });

  const cases = [
    craftRequest({
      scopedConfigOverride: {
        craft: { enabled: true, allowedRecipes: ["other"] },
      },
    }),
    craftRequest({
      execution: { runtimeMethod: "executeCraftNext", maxInvocations: 2 },
    }),
    craftRequest({
      cleanup: { clearConfigOverride: false, refreshPlanning: true },
    }),
  ];

  for (const request of cases) {
    const result = await setupResult.runner.run(request);
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(
      result.reason,
      "GOAL_ADAPTER_PREFLIGHT_CRAFT_CONTRACT_INVALID",
    );
  }
  assert.deepEqual(setupResult.calls, []);
});

test("PLAN_CRAFT preflight passes when recipe is already ready", async () => {
  const setupResult = setup({
    character: { name: "My_Merchant", ctype: "merchant" },
  });

  const result = await setupResult.runner.run(craftRequest());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_PREFLIGHT_CRAFT_CONFIRMED");
  assert.equal(result.evidence.recipe, "rod");
  assert.equal(result.evidence.alreadyReady, true);
  assert.equal(result.evidence.materialTargetSelected, false);
  assert.deepEqual(setupResult.calls, [["craft:plan", "rod"]]);
});

test("PLAN_CRAFT preflight passes for a safe material preparation target", async () => {
  const setupResult = setup({
    character: { name: "My_Merchant", ctype: "merchant" },
    craftPlan: {
      outcome: "PASS",
      reason: "CRAFT_MATERIAL_TARGET_SELECTED",
      requestedRecipe: "rod",
      selected: {
        recipe: "rod",
        missingRequirement: {
          name: "spidersilk",
          quantity: 1,
        },
        source: {
          monsterType: "spider",
        },
      },
      candidates: [],
      rejectedSources: [],
    },
  });

  const result = await setupResult.runner.run(craftRequest());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOAL_ADAPTER_PREFLIGHT_CRAFT_CONFIRMED");
  assert.equal(result.evidence.alreadyReady, false);
  assert.equal(result.evidence.materialTargetSelected, true);
  assert.equal(result.evidence.selectedRecipe, "rod");
});

test("PLAN_CRAFT preflight blocks unsafe or mismatched material plans", async () => {
  const unsafe = setup({
    craftPlan: {
      outcome: "FAIL",
      reason: "CRAFT_MATERIAL_SAFE_SOURCE_NOT_FOUND",
      requestedRecipe: "rod",
      selected: null,
      candidates: [],
      rejectedSources: [{ source: { monsterType: "spiderbl" } }],
    },
  });

  const blocked = await unsafe.runner.run(craftRequest());
  assert.equal(blocked.outcome, "BLOCKED");
  assert.equal(blocked.reason, "GOAL_ADAPTER_PREFLIGHT_CRAFT_NOT_READY");
  assert.equal(blocked.evidence.rejectedSources, 1);

  const mismatched = setup({
    craftPlan: {
      outcome: "PASS",
      reason: "CRAFT_MATERIAL_TARGET_SELECTED",
      requestedRecipe: "other",
      selected: { recipe: "other" },
      candidates: [],
      rejectedSources: [],
    },
  });
  const mismatch = await mismatched.runner.run(craftRequest());
  assert.equal(mismatch.outcome, "BLOCKED");
  assert.equal(mismatch.reason, "GOAL_ADAPTER_PREFLIGHT_CRAFT_NOT_READY");
});

test("PLAN_CRAFT preflight reports runtime planning errors without mutation", async () => {
  const setupResult = setup({
    craftPlanError: new Error("craft plan failed"),
  });

  const result = await setupResult.runner.run(craftRequest());

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "GOAL_ADAPTER_PREFLIGHT_CRAFT_RUNTIME_ERROR");
  assert.equal(result.evidence.error, "craft plan failed");
  assert.equal(result.scope.valueMutationDispatched, false);
});

test("unsupported adapter kinds remain blocked", async () => {
  const setupResult = setup();
  const result = await setupResult.runner.run({
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "gold",
    taskId: "gold:2",
    kind: "ACCUMULATE_GOLD",
    dispatchAllowed: false,
    dispatchImplemented: false,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "GOAL_ADAPTER_PREFLIGHT_KIND_UNSUPPORTED");
  assert.deepEqual(setupResult.calls, []);
});

test("runtime and CharacterThread keep Goal adapter preflight read-only with supervisor orchestration", () => {
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

  assert.match(kernel, /GoalAdapterPreflightRunner/);
  assert.match(kernel, /async runGoalAdapterPreflight\(/);
  assert.match(kernel, /goalAdapterPreflightRunning/);
  assert.match(
    kernel,
    /craftMaterialPlan:\s*\(recipe\)\s*=>\s*this\.runCraftMaterialPlan\(recipe\)/,
  );

  const start = kernel.indexOf("async runGoalAdapterPreflight(");
  const dispatchStart = kernel.indexOf("async runGoalAdapterDispatch(", start);
  const materialStart = kernel.indexOf("async runMaterialGatherTask(", start);
  const end =
    dispatchStart > start
      ? dispatchStart
      : materialStart;
  assert.ok(start >= 0);
  assert.ok(end > start);
  const preflightBlock = kernel.slice(start, end);
  assert.doesNotMatch(preflightBlock, /this\.runMaterialGatherTask\s*\(/);
  assert.doesNotMatch(preflightBlock, /this\.executeCraftNext\s*\(/);
  assert.doesNotMatch(preflightBlock, /this\.actions\./);
  assert.doesNotMatch(preflightBlock, /this\.movement\./);
  assert.doesNotMatch(preflightBlock, /this\.combat\./);

  assert.match(thread, /case "goal_adapter_preflight"/);
  assert.match(
    thread,
    /runGoalAdapterPreflight\(m\.request, \{ requestId \}\)/,
  );
  assert.match(thread, /type: "goal_adapter_preflight_result"/);
  assert.match(coordinator, /GoalAdapterPreflightSupervisor/);
  assert.match(coordinator, /goal_adapter_preflight_supervisor\.run/);
  assert.doesNotMatch(coordinator, /dispatch_goal_adapter/);
  assert.doesNotMatch(coordinator, /reconcile_goal_adapter/);
});

test("Goal adapter runtime preflight contains no gameplay or value mutation path", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "goal-adapter-preflight.lib.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /MovementController/);
  assert.doesNotMatch(source, /CombatController/);
  assert.doesNotMatch(source, /\.smart\s*\(/);
  assert.doesNotMatch(source, /\.attack\s*\(/);
  assert.doesNotMatch(source, /\.loot\s*\(/);
  assert.doesNotMatch(source, /\.executeNext\s*\(/);
  assert.doesNotMatch(source, /\.runMaterialGatherTask\s*\(/);
  assert.doesNotMatch(source, /\.executeCraftNext\s*\(/);
});

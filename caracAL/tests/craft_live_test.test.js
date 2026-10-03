"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

function createHarness(actionStatus = "CONFIRMED") {
  const state = {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      x: 92,
      y: 670,
      moving: false,
      gold: 100,
    },
    inventory: [
      { slot: 7, item: { name: "whiteegg", q: 10 } },
    ],
  };

  const intelligenceStatus = () => ({
    state: "READY",
    entries: [
      {
        slot: 7,
        name: "whiteegg",
        disposition: "CRAFT",
        protected: false,
        protections: [],
      },
    ],
  });

  const planned = {
    timestamp: 1,
    enabled: true,
    state: "READY",
    reason: "CRAFT_CANDIDATE_READY",
    executionMode: "EXPLICIT_ONE_SHOT",
    selected: {
      recipe: "cake",
      cost: 5,
      requirements: [
        { quantity: 10, name: "whiteegg", level: null },
      ],
      itemSlots: [7],
      reason: "CRAFT_POLICY_ELIGIBLE",
    },
    candidates: [],
    decisions: [],
    unknownHold: null,
    lastAction: null,
    summary: {
      configuredRecipes: 1,
      eligibleCandidates: 1,
      protectedIngredients: 0,
      insufficientIngredients: 0,
      insufficientGoldRecipes: 0,
    },
  };

  let lastCraftStatus = planned;
  let executeCalls = 0;

  const deps = {
    game: {
      character: () => ({ ...state.character }),
      inventory: () =>
        state.inventory.map((entry) => ({
          slot: entry.slot,
          item: entry.item ? { ...entry.item } : null,
        })),
      npcs: () => [
        {
          id: "craftsman",
          name: "Leo",
          map: "main",
          x: 92,
          y: 670,
        },
      ],
      gameData: () => ({
        craft: {
          cake: {
            items: [[10, "whiteegg"]],
            cost: 5,
          },
        },
      }),
    },
    inventoryIntelligence: {
      status: intelligenceStatus,
      tick: intelligenceStatus,
      setConfigOverride: () => {},
      clearConfigOverride: () => {},
    },
    craft: {
      status: () => lastCraftStatus,
      tick: () => lastCraftStatus,
      setConfigOverride: () => {},
      clearConfigOverride: () => {},
      executeNext: async () => {
        executeCalls += 1;
        if (actionStatus === "CONFIRMED") {
          state.inventory = [
            { slot: 7, item: null },
            { slot: 8, item: { name: "cake", q: 1 } },
          ];
          state.character.gold = 95;
        }
        lastCraftStatus = {
          ...planned,
          state: actionStatus === "UNKNOWN" ? "UNKNOWN_HOLD" : "EMPTY",
          selected: null,
          lastAction: {
            id: "A-craft-1",
            status: actionStatus,
            why:
              actionStatus === "UNKNOWN"
                ? "CRAFT_OUTCOME_UNVERIFIED"
                : "CRAFT_RESULT_CONFIRMED",
            error: null,
            recipe: "cake",
            itemSlots: [7],
          },
        };
        return lastCraftStatus;
      },
    },
    movement: {
      status: () => ({ owner: null, active: null }),
      smart: async () => {
        throw new Error("movement should not be required");
      },
    },
    runtimePreflight: () => ({
      map: "main",
      craftInProgress: false,
    }),
    characterName: () => "My_Merchant",
    now: (() => {
      let now = 1000;
      return () => (now += 10);
    })(),
    sleep: async () => {},
  };

  return { deps, executeCalls: () => executeCalls };
}

test("Craft live runner performs one exact confirmed Craft and observes all mutations", async () => {
  const { CraftLiveTestRunner } = core("craft-live-test.lib.ts");
  const harness = createHarness("CONFIRMED");
  const runner = new CraftLiveTestRunner(harness.deps);

  const result = await runner.run({
    requestId: "craft-live-test",
    recipe: "cake",
    itemSlots: [7],
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_LIVE_E2E_CONFIRMED");
  assert.equal(harness.executeCalls(), 1);
  assert.equal(result.target.recipe, "cake");
  assert.deepEqual(result.target.itemSlots, [7]);
  assert.equal(result.target.cost, 5);
  assert.equal(result.evidence.actionDispatchedOnce, true);
  assert.equal(result.evidence.actionConfirmed, true);
  assert.equal(result.evidence.ingredientConsumed, true);
  assert.equal(result.evidence.outputIncreased, true);
  assert.equal(result.evidence.goldSpent, true);
  assert.equal(result.evidence.mutationObserved, true);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(result.cleanup.inventoryConfigOverrideCleared, true);
  assert.equal(result.cleanup.craftConfigOverrideCleared, true);
});

test("Craft live runner treats UNKNOWN as terminal and does not retry", async () => {
  const { CraftLiveTestRunner } = core("craft-live-test.lib.ts");
  const harness = createHarness("UNKNOWN");
  const runner = new CraftLiveTestRunner(harness.deps);

  const result = await runner.run({
    requestId: "craft-live-unknown",
    recipe: "cake",
    itemSlots: [7],
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CRAFT_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(harness.executeCalls(), 1);
  assert.equal(result.evidence.actionDispatchedOnce, true);
  assert.equal(result.evidence.actionConfirmed, false);
  assert.equal(result.evidence.blindRetryAvoided, true);
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", fileName),
  );
}

function makeState() {
  return {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      x: 0,
      y: 0,
      gold: 10000,
      moving: false,
    },
    inventory: [
      { name: "iron", q: 2 },
      { name: "wood", q: 1 },
      { name: "raregem", level: 2 },
      null,
    ],
    G: {
      items: {
        iron: { name: "Iron" },
        wood: { name: "Wood" },
        raregem: { name: "Rare Gem" },
        swordx: { name: "Crafted Sword" },
      },
      craft: {
        swordx: {
          cost: 500,
          items: [
            [2, "iron"],
            [1, "wood"],
            [1, "raregem", 2],
          ],
        },
        broken: {
          cost: 100,
          items: [["bad", "iron"]],
        },
      },
    },
  };
}

function makeIntelligence(state, overrides = {}) {
  const protectedSlots = new Set(overrides.protectedSlots || []);
  return {
    status() {
      const entries = state.inventory
        .map((item, slot) => ({ item, slot }))
        .filter(({ item }) => item)
        .map(({ item, slot }) => ({
          slot,
          name: item.name,
          level: Number.isInteger(item.level) ? item.level : 0,
          quantity: Number.isInteger(item.q) ? item.q : 1,
          definitionKnown: true,
          itemType: "material",
          disposition: overrides.dispositionBySlot?.[slot] || "CRAFT",
          protected: protectedSlots.has(slot),
          protections: protectedSlots.has(slot) ? ["RESERVED"] : [],
          why: "test",
        }));
      return {
        timestamp: 1000,
        enabled: true,
        state: "READY",
        reason: "INVENTORY_INTELLIGENCE_READY",
        entries,
        summary: {
          totalItems: entries.length,
          protectedItems: entries.filter((entry) => entry.protected).length,
          dispositions: {},
          protections: {},
        },
      };
    },
  };
}

function makeSetup({
  config = { craft: { enabled: true, allowedRecipes: ["swordx"] } },
  state = makeState(),
  protectedSlots = [],
  dispositionBySlot = {},
  craft = async () => ({
    id: "A-1",
    status: "CONFIRMED",
    why: "CRAFT_RESULT_CONFIRMED",
    evidence: { structuredSuccess: true },
  }),
} = {}) {
  const { CraftController } = coreModule("craft-controller.lib.ts");
  let now = 1000;
  let calls = 0;
  const requests = [];

  const game = {
    character() {
      return { ...state.character };
    },
    inventory() {
      return state.inventory.map((item, slot) => ({
        slot,
        item: item ? { ...item } : null,
      }));
    },
    gameData() {
      return state.G;
    },
  };

  const actions = {
    async craft(request) {
      calls += 1;
      requests.push(request);
      return craft(request, state);
    },
  };

  const controller = new CraftController(
    game,
    actions,
    makeIntelligence(state, { protectedSlots, dispositionBySlot }),
    {
      now: () => now,
      config: () => config,
    },
  );

  return {
    controller,
    state,
    requests,
    calls: () => calls,
    advance(ms = 1000) {
      now += ms;
    },
  };
}

test("Craft remains inert until recipes are explicitly allowed", async () => {
  const setup = makeSetup({
    config: { craft: { enabled: true } },
  });

  const planned = setup.controller.tick();
  const executed = await setup.controller.executeNext();

  assert.equal(planned.state, "EMPTY");
  assert.equal(planned.reason, "CRAFT_POLICY_NO_ALLOWED_RECIPES");
  assert.equal(planned.executionMode, "EXPLICIT_ONE_SHOT");
  assert.equal(executed.state, "EMPTY");
  assert.equal(setup.calls(), 0);
});

test("Craft selects exact safe recipe ingredients deterministically", () => {
  const setup = makeSetup();
  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "CRAFT_CANDIDATE_READY");
  assert.deepEqual(status.selected, {
    recipe: "swordx",
    cost: 500,
    requirements: [
      { quantity: 2, name: "iron", level: null },
      { quantity: 1, name: "wood", level: null },
      { quantity: 1, name: "raregem", level: 2 },
    ],
    itemSlots: [0, 1, 2],
    reason: "CRAFT_POLICY_ELIGIBLE",
  });
  assert.equal(status.summary.configuredRecipes, 1);
  assert.equal(status.summary.eligibleCandidates, 1);
  assert.equal(setup.calls(), 0);
});

test("Craft rejects protected ingredients and never dispatches them", async () => {
  const setup = makeSetup({ protectedSlots: [1] });

  const planned = setup.controller.tick();
  const executed = await setup.controller.executeNext();

  assert.equal(planned.state, "EMPTY");
  assert.equal(planned.decisions[0].reason, "CRAFT_INGREDIENT_PROTECTED");
  assert.equal(planned.summary.protectedIngredients, 1);
  assert.equal(executed.state, "EMPTY");
  assert.equal(setup.calls(), 0);
});

test("Craft requires CRAFT intelligence disposition for every ingredient", () => {
  const setup = makeSetup({
    dispositionBySlot: { 1: "KEEP" },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "EMPTY");
  assert.equal(status.decisions[0].reason, "CRAFT_INGREDIENTS_INSUFFICIENT");
  assert.equal(status.summary.insufficientIngredients, 1);
});

test("Craft checks known gold before selecting a recipe", () => {
  const state = makeState();
  state.character.gold = 100;
  const setup = makeSetup({ state });

  const status = setup.controller.tick();

  assert.equal(status.state, "EMPTY");
  assert.equal(status.decisions[0].reason, "CRAFT_GOLD_INSUFFICIENT");
  assert.equal(status.summary.insufficientGoldRecipes, 1);
});

test("Craft ignores invalid recipe metadata", () => {
  const setup = makeSetup({
    config: { craft: { enabled: true, allowedRecipes: ["broken"] } },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "EMPTY");
  assert.equal(status.decisions[0].reason, "CRAFT_RECIPE_UNKNOWN_OR_INVALID");
});

test("Craft executeNext dispatches exactly one explicit boundary mutation", async () => {
  const setup = makeSetup();
  const status = await setup.controller.executeNext();

  assert.equal(setup.calls(), 1);
  assert.deepEqual(setup.requests[0], {
    module: "CraftController",
    why: "CRAFT_POLICY_SELECTED",
    recipe: "swordx",
    itemSlots: [0, 1, 2],
  });
  assert.equal(status.lastAction.status, "CONFIRMED");
  assert.equal(status.lastAction.recipe, "swordx");
});

test("Craft UNKNOWN creates a no-blind-retry hold until ingredient state changes", async () => {
  const setup = makeSetup({
    craft: async () => ({
      id: "A-unknown",
      status: "UNKNOWN",
      why: "CRAFT_OUTCOME_UNCERTAIN",
      error: "socket timeout",
    }),
  });

  const first = await setup.controller.executeNext();
  assert.equal(setup.calls(), 1);
  assert.equal(first.state, "UNKNOWN_HOLD");
  assert.equal(first.reason, "CRAFT_UNKNOWN_HOLD_ACTIVE");
  assert.equal(first.selected, null);
  assert.equal(first.unknownHold.actionId, "A-unknown");

  const second = await setup.controller.executeNext();
  assert.equal(setup.calls(), 1);
  assert.equal(second.state, "UNKNOWN_HOLD");

  setup.state.inventory[0].q = 1;
  setup.advance();
  const reconciled = setup.controller.tick();

  assert.equal(reconciled.unknownHold, null);
  assert.equal(reconciled.state, "EMPTY");
});

test("Craft can be disabled without dispatching", async () => {
  const setup = makeSetup({
    config: {
      craft: {
        enabled: false,
        allowedRecipes: ["swordx"],
      },
    },
  });

  const planned = setup.controller.tick();
  const executed = await setup.controller.executeNext();

  assert.equal(planned.state, "DISABLED");
  assert.equal(executed.state, "DISABLED");
  assert.equal(setup.calls(), 0);
});

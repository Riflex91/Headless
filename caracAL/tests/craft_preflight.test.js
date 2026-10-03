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

function makeSetup({
  character = {
    name: "My_Merchant",
    ctype: "merchant",
    map: "main",
    x: 0,
    y: 0,
    gold: 10000,
    moving: false,
  },
  inventory = [
    { name: "iron", q: 2 },
    { name: "wood", q: 1 },
    { name: "raregem", level: 2 },
  ],
  station = {
    id: "craftsman",
    name: "Leo",
    role: "craftsman",
    map: "main",
    x: 92,
    y: 670,
    visible: true,
    positions: [{ x: 92, y: 670 }],
    items: [],
  },
  inventoryState = "READY",
} = {}) {
  const { CraftController } = coreModule("craft-controller.lib.ts");
  const { CraftPreflightRunner } = coreModule("craft-preflight.lib.ts");

  const state = {
    character: { ...character },
    inventory: inventory.map((item) => (item ? { ...item } : null)),
  };

  let craftCalls = 0;
  const intelligence = {
    tick() {
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
          disposition: "CRAFT",
          protected: false,
          protections: [],
          why: "test",
        }));
      return {
        timestamp: 1000,
        enabled: true,
        state: inventoryState,
        reason: "INVENTORY_INTELLIGENCE_READY",
        entries,
        summary: {
          totalItems: entries.length,
          protectedItems: 0,
          dispositions: {},
          protections: {},
        },
      };
    },
    status() {
      return this.tick();
    },
  };

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
      return {
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
        },
      };
    },
    npcs(mapName) {
      return station && (!mapName || station.map === mapName)
        ? [{ ...station }]
        : [];
    },
  };

  const craft = new CraftController(
    game,
    {
      async craft() {
        craftCalls += 1;
        throw new Error("preflight must not mutate");
      },
    },
    intelligence,
    {
      now: () => 1000,
      config: () => ({ craft: { enabled: true } }),
    },
  );

  const runner = new CraftPreflightRunner({
    game,
    inventoryIntelligence: intelligence,
    craft,
    characterName: () => "My_Merchant",
    now: () => 1000,
  });

  return {
    runner,
    craft,
    craftCalls: () => craftCalls,
  };
}

test("Craft preflight scans recipes, selects a safe candidate and locates Leo without mutation", () => {
  const setup = makeSetup();
  const result = setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_PREFLIGHT_COMPLETED");
  assert.equal(result.recipeCount, 1);
  assert.equal(result.readyForCraft, true);
  assert.equal(result.selected.recipe, "swordx");
  assert.deepEqual(result.selected.itemSlots, [0, 1, 2]);
  assert.equal(result.station.located, true);
  assert.equal(result.station.id, "craftsman");
  assert.equal(result.station.name, "Leo");
  assert.equal(result.station.map, "main");
  assert.equal(result.station.x, 92);
  assert.equal(result.station.y, 670);
  assert.equal(result.station.travelRequired, true);
  assert.equal(result.evidence.inventoryIntelligenceReady, true);
  assert.equal(result.evidence.recipeMetadataObserved, true);
  assert.equal(result.evidence.craftPlanReadOnly, true);
  assert.equal(result.evidence.stationIdentityVerified, true);
  assert.equal(result.evidence.selectedCandidateConsistent, true);
  assert.equal(result.evidence.noMutationDispatched, true);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.craftMutationForced, false);
  assert.equal(result.cleanup.craftConfigOverrideCleared, true);
  assert.equal(setup.craftCalls(), 0);
  assert.equal(setup.craft.status().reason, "CRAFT_POLICY_NO_ALLOWED_RECIPES");
});

test("Craft preflight can PASS with no live-ready candidate", () => {
  const setup = makeSetup({
    inventory: [{ name: "iron", q: 1 }],
  });
  const result = setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.readyForCraft, false);
  assert.equal(result.selected, null);
  assert.equal(result.craft.state, "EMPTY");
  assert.equal(result.craft.summary.eligibleCandidates, 0);
  assert.equal(setup.craftCalls(), 0);
});

test("Craft preflight fails closed when Leo cannot be located", () => {
  const setup = makeSetup({ station: null });
  const result = setup.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CRAFT_PREFLIGHT_STATION_NOT_FOUND");
  assert.equal(result.readyForCraft, false);
  assert.equal(result.station.located, false);
  assert.equal(result.cleanup.craftConfigOverrideCleared, true);
  assert.equal(setup.craftCalls(), 0);
});

test("Craft preflight fails closed when inventory intelligence is not ready", () => {
  const setup = makeSetup({ inventoryState: "DISABLED" });
  const result = setup.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CRAFT_PREFLIGHT_RUNTIME_NOT_READY");
  assert.equal(result.readyForCraft, false);
  assert.equal(result.evidence.noMutationDispatched, true);
  assert.equal(result.cleanup.craftConfigOverrideCleared, true);
  assert.equal(setup.craftCalls(), 0);
});

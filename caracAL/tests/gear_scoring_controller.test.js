"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadController() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "gear-scoring-controller.lib.ts",
    ),
  ).GearScoringController;
}

function makeController({
  ctype = "ranger",
  items = [],
  equipment = {},
  gameData = {},
  config = {},
  events = [],
} = {}) {
  const GearScoringController = loadController();
  let now = 1000;
  const controller = new GearScoringController(
    {
      character: () => ({ ctype }),
      inventory: () =>
        items.map((item, slot) => ({
          slot,
          item: item ? { ...item } : null,
        })),
      equipment: () =>
        Object.fromEntries(
          Object.entries(equipment).map(([slot, item]) => [
            slot,
            item ? { ...item } : null,
          ]),
        ),
      gameData: () => JSON.parse(JSON.stringify(gameData)),
    },
    {
      now: () => now,
      config: () => config,
      onEvent: (event) => events.push(event),
    },
  );

  return {
    controller,
    events,
    advance(ms) {
      now += ms;
    },
  };
}

test("gear scoring reads inventory, equipment and Adventure Land upgrade stats", () => {
  const setup = makeController({
    items: [
      { name: "bow", level: 2 },
      { name: "hpot1", q: 100 },
      null,
    ],
    equipment: {
      helmet: { name: "helmet", level: 0 },
    },
    gameData: {
      items: {
        bow: {
          type: "weapon",
          wtype: "bow",
          attack: 10,
          str: 2,
          upgrade: { attack: 2 },
        },
        helmet: {
          type: "helmet",
          armor: 20,
        },
        hpot1: {
          type: "pot",
        },
      },
    },
  });

  const status = setup.controller.tick();
  const inventory = status.entries.find(
    (entry) => entry.location === "INVENTORY",
  );
  const equipped = status.entries.find(
    (entry) => entry.location === "EQUIPMENT",
  );

  assert.equal(status.state, "READY");
  assert.equal(status.profile, "ranger");
  assert.equal(status.entries.length, 2);
  assert.equal(inventory.name, "bow");
  assert.equal(inventory.level, 2);
  assert.equal(inventory.stats.attack, 14);
  assert.equal(inventory.stats.str, 2);
  assert.equal(inventory.contributions.attack, 14);
  assert.equal(inventory.contributions.str, 4);
  assert.equal(inventory.score, 18);
  assert.equal(inventory.slotGroup, "weapon");
  assert.equal(equipped.name, "helmet");
  assert.equal(equipped.score, 10);
  assert.equal(status.summary.inventoryGear, 1);
  assert.equal(status.summary.equippedGear, 1);
  assert.equal(status.summary.scoredItems, 2);
  assert.equal(status.summary.equipmentScore, 10);
  assert.equal(status.summary.bestInventoryScore, 18);
});

test("gear scoring supports transparent generic and class-specific weight overrides", () => {
  const setup = makeController({
    ctype: "mage",
    items: [{ name: "staff", level: 1 }],
    gameData: {
      items: {
        staff: {
          type: "weapon",
          attack: 10,
          int: 4,
          upgrade: { attack: 2 },
        },
      },
    },
    config: {
      gear: {
        scoring: {
          weights: {
            attack: 2,
            int: 1,
          },
          classWeights: {
            mage: {
              int: 5,
            },
          },
        },
      },
    },
  });

  const status = setup.controller.tick();
  const entry = status.entries[0];

  assert.equal(status.weights.attack, 2);
  assert.equal(status.weights.int, 5);
  assert.equal(entry.stats.attack, 12);
  assert.equal(entry.stats.int, 4);
  assert.equal(entry.contributions.attack, 24);
  assert.equal(entry.contributions.int, 20);
  assert.equal(entry.score, 44);
});

test("unknown equipped gear remains explicit instead of receiving an invented score", () => {
  const setup = makeController({
    items: [{ name: "mystery" }],
    equipment: {
      mainhand: { name: "unknown_weapon", level: 3 },
    },
    gameData: {
      items: {},
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.entries.length, 1);
  assert.equal(status.entries[0].location, "EQUIPMENT");
  assert.equal(status.entries[0].definitionKnown, false);
  assert.equal(status.entries[0].score, null);
  assert.equal(status.entries[0].why, "GEAR_SCORE_UNKNOWN_ITEM_METADATA");
  assert.equal(status.summary.unknownItems, 1);
  assert.equal(status.summary.scoredItems, 0);
});

test("gear scoring can be disabled and emits only when meaningful status changes", () => {
  const events = [];
  const config = {
    gear: {
      scoring: {
        enabled: false,
      },
    },
  };
  const setup = makeController({
    items: [{ name: "bow" }],
    gameData: {
      items: {
        bow: { type: "weapon", attack: 10 },
      },
    },
    config,
    events,
  });

  let status = setup.controller.tick();
  assert.equal(status.state, "DISABLED");
  assert.equal(status.entries.length, 0);
  assert.equal(events.length, 1);

  setup.advance(1000);
  status = setup.controller.tick();
  assert.equal(status.state, "DISABLED");
  assert.equal(events.length, 1);

  config.gear.scoring.enabled = true;
  setup.advance(1000);
  status = setup.controller.tick();
  assert.equal(status.state, "READY");
  assert.equal(events.length, 2);
  assert.equal(events[1].type, "GEAR_SCORING_UPDATED");
});

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
      "inventory-intelligence-controller.lib.ts",
    ),
  ).InventoryIntelligenceController;
}

function makeController({
  items,
  gameData,
  inventory = {},
  gear = {},
  events = [],
} = {}) {
  const InventoryIntelligenceController = loadController();
  let now = 1000;
  const controller = new InventoryIntelligenceController(
    {
      inventory: () =>
        (items || []).map((item, slot) => ({
          slot,
          item: item ? { ...item } : null,
        })),
      equipment: () => ({}),
      gameData: () => JSON.parse(JSON.stringify(gameData || {})),
    },
    {
      now: () => now,
      config: () => ({ inventory, gear }),
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

test("inventory intelligence covers every Phase 10 disposition", () => {
  const setup = makeController({
    items: [
      { name: "keepme" },
      { name: "bankme" },
      { name: "sellme" },
      { name: "exchangeme" },
      { name: "craftme" },
      { name: "gearme" },
      { name: "upgrademe" },
      { name: "consumeme" },
      { name: "questme" },
      { name: "reservedme" },
      { name: "mystery" },
    ],
    gameData: {
      items: {
        keepme: { type: "material" },
        bankme: { type: "material" },
        sellme: { type: "material" },
        exchangeme: { type: "material", e: 5 },
        craftme: { type: "material" },
        gearme: { type: "weapon", wtype: "bow" },
        upgrademe: { type: "material" },
        consumeme: { type: "pot" },
        questme: { type: "quest", quest: true },
        reservedme: { type: "material" },
      },
      craft: {
        crafted_output: {
          items: [[1, "craftme", 0]],
        },
      },
    },
    inventory: {
      intelligence: { enabled: true },
      dispositions: {
        BANK: ["bankme"],
        SELL: ["sellme"],
        UPGRADE: ["upgrademe"],
      },
      reservedItems: ["reservedme"],
    },
  });

  const status = setup.controller.tick();
  const byName = Object.fromEntries(
    status.entries.map((entry) => [entry.name, entry]),
  );

  assert.equal(status.state, "READY");
  assert.equal(byName.keepme.disposition, "KEEP");
  assert.equal(byName.bankme.disposition, "BANK");
  assert.equal(byName.sellme.disposition, "SELL");
  assert.equal(byName.exchangeme.disposition, "EXCHANGE");
  assert.equal(byName.craftme.disposition, "CRAFT");
  assert.equal(byName.gearme.disposition, "GEAR");
  assert.equal(byName.upgrademe.disposition, "UPGRADE");
  assert.equal(byName.consumeme.disposition, "CONSUMABLE");
  assert.equal(byName.questme.disposition, "QUEST");
  assert.equal(byName.reservedme.disposition, "RESERVED");
  assert.equal(byName.mystery.disposition, "UNKNOWN");

  for (const disposition of [
    "KEEP",
    "BANK",
    "SELL",
    "EXCHANGE",
    "CRAFT",
    "GEAR",
    "UPGRADE",
    "CONSUMABLE",
    "QUEST",
    "RESERVED",
    "UNKNOWN",
  ]) {
    assert.equal(status.summary.dispositions[disposition], 1);
  }
});

test("inventory intelligence applies all protection classes conservatively", () => {
  const setup = makeController({
    items: [
      { name: "locked", locked: true },
      { name: "event" },
      { name: "quest" },
      { name: "future" },
      { name: "reserved" },
      { name: "unknown" },
      { name: "valuable" },
    ],
    gameData: {
      items: {
        locked: { type: "material" },
        event: { type: "event", event: true },
        quest: { type: "quest", quest: true },
        future: { type: "weapon" },
        reserved: { type: "material" },
        valuable: { type: "material" },
      },
    },
    inventory: {
      intelligenceEnabled: true,
      futureGearItems: ["future"],
      reservedItems: ["reserved"],
      valuableItems: ["valuable"],
    },
  });

  const status = setup.controller.tick();
  const byName = Object.fromEntries(
    status.entries.map((entry) => [entry.name, entry]),
  );

  assert.deepEqual(byName.locked.protections, ["LOCKED"]);
  assert.deepEqual(byName.event.protections, ["EVENT"]);
  assert.deepEqual(byName.quest.protections, ["QUEST"]);
  assert.deepEqual(byName.future.protections, ["FUTURE_GEAR"]);
  assert.deepEqual(byName.reserved.protections, ["RESERVED"]);
  assert.deepEqual(byName.unknown.protections, ["UNKNOWN"]);
  assert.deepEqual(byName.valuable.protections, ["VALUABLE"]);
  assert.equal(status.summary.protectedItems, 7);

  for (const protection of [
    "LOCKED",
    "EVENT",
    "QUEST",
    "FUTURE_GEAR",
    "RESERVED",
    "UNKNOWN",
    "VALUABLE",
  ]) {
    assert.equal(status.summary.protections[protection], 1);
  }
});

test("safety classifications override unsafe explicit disposition requests", () => {
  const setup = makeController({
    items: [
      { name: "quest" },
      { name: "reserved" },
      { name: "future" },
      { name: "unknown" },
    ],
    gameData: {
      items: {
        quest: { quest: true },
        reserved: {},
        future: { type: "weapon" },
      },
    },
    inventory: {
      dispositions: {
        SELL: ["quest", "reserved", "future", "unknown"],
      },
      reservedItems: ["reserved"],
      futureGearItems: ["future"],
    },
  });

  const status = setup.controller.tick();
  const byName = Object.fromEntries(
    status.entries.map((entry) => [entry.name, entry]),
  );

  assert.equal(byName.quest.disposition, "QUEST");
  assert.equal(byName.reserved.disposition, "RESERVED");
  assert.equal(byName.future.disposition, "GEAR");
  assert.equal(byName.unknown.disposition, "UNKNOWN");
});

test("inventory intelligence can be disabled and only emits on changes", () => {
  const events = [];
  const setup = makeController({
    items: [{ name: "keepme" }],
    gameData: { items: { keepme: {} } },
    inventory: {
      intelligence: { enabled: false },
    },
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
});

test("inventory intelligence protects dynamically detected Future Gear slots", () => {
  const setup = makeController({
    items: [{ name: "candidate_bow", level: 2 }],
    gameData: {
      items: {
        candidate_bow: {
          type: "weapon",
          wtype: "bow",
          attack: 20,
        },
      },
    },
    inventory: {
      intelligence: { enabled: true },
    },
  });

  setup.controller.setDynamicFutureGearSlots([0]);
  const status = setup.controller.tick();
  const entry = status.entries[0];

  assert.equal(entry.disposition, "GEAR");
  assert.equal(entry.protected, true);
  assert.deepEqual(entry.protections, ["FUTURE_GEAR"]);
  assert.equal(status.summary.protections.FUTURE_GEAR, 1);
});


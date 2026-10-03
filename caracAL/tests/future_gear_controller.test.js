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
      "future-gear-controller.lib.ts",
    ),
  ).FutureGearController;
}

function scoring(entries = [], state = "READY") {
  return {
    state,
    entries: entries.map((entry) => ({ ...entry })),
  };
}

function inventoryEntry(slot, name, score, slotGroup, level = 0) {
  return {
    location: "INVENTORY",
    slot,
    name,
    level,
    definitionKnown: true,
    itemType: slotGroup,
    slotGroup,
    score,
    stats: {},
    contributions: {},
    why: "GEAR_SCORE_WEIGHTED_ADVENTURE_LAND_STATS",
  };
}

function equipmentEntry(slot, name, score, level = 0) {
  return {
    location: "EQUIPMENT",
    slot,
    name,
    level,
    definitionKnown: score !== null,
    itemType: null,
    slotGroup: slot,
    score,
    stats: {},
    contributions: {},
    why:
      score === null
        ? "GEAR_SCORE_UNKNOWN_ITEM_METADATA"
        : "GEAR_SCORE_WEIGHTED_ADVENTURE_LAND_STATS",
  };
}

function makeController({
  entries = [],
  equipment = {},
  config = {},
  events = [],
  scoringState = "READY",
} = {}) {
  const FutureGearController = loadController();
  let now = 1000;
  const gearScoring = {
    status: () => scoring(entries, scoringState),
  };
  const controller = new FutureGearController(
    {
      equipment: () =>
        Object.fromEntries(
          Object.entries(equipment).map(([slot, item]) => [
            slot,
            item ? { ...item } : null,
          ]),
        ),
    },
    gearScoring,
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

test("Future Gear marks a strictly better inventory weapon", () => {
  const setup = makeController({
    entries: [
      inventoryEntry(3, "better_bow", 30, "weapon"),
      inventoryEntry(4, "worse_bow", 18, "weapon"),
      equipmentEntry("mainhand", "bow", 20),
    ],
    equipment: {
      mainhand: { name: "bow", level: 2 },
    },
  });

  const status = setup.controller.tick();
  const better = status.entries.find((entry) => entry.inventorySlot === 3);
  const worse = status.entries.find((entry) => entry.inventorySlot === 4);

  assert.equal(status.state, "READY");
  assert.equal(better.candidate, true);
  assert.equal(better.baselineSlot, "mainhand");
  assert.equal(better.baselineScore, 20);
  assert.equal(better.scoreDelta, 10);
  assert.equal(better.reason, "FUTURE_GEAR_SCORE_IMPROVEMENT");
  assert.equal(worse.candidate, false);
  assert.equal(worse.decision, "NOT_BETTER");
  assert.deepEqual(setup.controller.candidateSlots(), [3]);
  assert.equal(status.summary.candidates, 1);
  assert.equal(status.summary.notBetter, 1);
});

test("Future Gear compares rings against the weaker occupied ring slot", () => {
  const setup = makeController({
    entries: [
      inventoryEntry(7, "candidate_ring", 9, "ring"),
      equipmentEntry("ring1", "strong_ring", 12),
      equipmentEntry("ring2", "weak_ring", 7),
    ],
    equipment: {
      ring1: { name: "strong_ring" },
      ring2: { name: "weak_ring" },
    },
  });

  const entry = setup.controller.tick().entries[0];

  assert.equal(entry.candidate, true);
  assert.deepEqual(entry.targetSlots, ["ring1", "ring2"]);
  assert.equal(entry.baselineSlot, "ring2");
  assert.equal(entry.baselineScore, 7);
  assert.equal(entry.scoreDelta, 2);
});

test("Future Gear treats an available empty compatible slot as baseline zero", () => {
  const setup = makeController({
    entries: [inventoryEntry(2, "quiver", 5, "offhand")],
    equipment: {
      mainhand: { name: "bow" },
      offhand: null,
    },
  });

  const entry = setup.controller.tick().entries[0];

  assert.equal(entry.candidate, true);
  assert.equal(entry.baselineSlot, "offhand");
  assert.equal(entry.baselineScore, 0);
  assert.equal(entry.scoreDelta, 5);
  assert.equal(entry.reason, "FUTURE_GEAR_EMPTY_SLOT_IMPROVEMENT");
});

test("Future Gear refuses to claim improvement when occupied baseline score is unknown", () => {
  const setup = makeController({
    entries: [
      inventoryEntry(1, "candidate_bow", 50, "weapon"),
      equipmentEntry("mainhand", "mystery_weapon", null),
    ],
    equipment: {
      mainhand: { name: "mystery_weapon" },
    },
  });

  const status = setup.controller.tick();
  const entry = status.entries[0];

  assert.equal(entry.candidate, false);
  assert.equal(entry.decision, "BASELINE_UNKNOWN");
  assert.equal(entry.reason, "FUTURE_GEAR_BASELINE_UNKNOWN");
  assert.equal(status.summary.baselineUnknown, 1);
  assert.deepEqual(setup.controller.candidateSlots(), []);
});

test("Future Gear keeps unresolved slot groups non-candidates", () => {
  const setup = makeController({
    entries: [inventoryEntry(9, "odd_gear", 99, "mysteryslot")],
    equipment: {
      mainhand: { name: "bow" },
    },
  });

  const entry = setup.controller.tick().entries[0];

  assert.equal(entry.candidate, false);
  assert.equal(entry.decision, "SLOT_UNRESOLVED");
  assert.equal(entry.reason, "FUTURE_GEAR_SLOT_UNRESOLVED");
});

test("Future Gear honors minimum score delta without mutating gear", () => {
  const setup = makeController({
    entries: [
      inventoryEntry(5, "small_upgrade", 25, "weapon"),
      equipmentEntry("mainhand", "bow", 20),
    ],
    equipment: {
      mainhand: { name: "bow" },
    },
    config: {
      gear: {
        futureGearPolicy: {
          minScoreDelta: 5,
        },
      },
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.minScoreDelta, 5);
  assert.equal(status.entries[0].scoreDelta, 5);
  assert.equal(status.entries[0].candidate, false);
  assert.equal(status.entries[0].decision, "NOT_BETTER");
});

test("Future Gear can be disabled and emits only meaningful status changes", () => {
  const config = {
    gear: {
      futureGearPolicy: {
        enabled: false,
      },
    },
  };
  const events = [];
  const setup = makeController({
    entries: [inventoryEntry(1, "bow", 20, "weapon")],
    equipment: { mainhand: null },
    config,
    events,
  });

  let status = setup.controller.tick();
  assert.equal(status.state, "DISABLED");
  assert.equal(events.length, 1);

  setup.advance(1000);
  status = setup.controller.tick();
  assert.equal(status.state, "DISABLED");
  assert.equal(events.length, 1);

  config.gear.futureGearPolicy.enabled = true;
  setup.advance(1000);
  status = setup.controller.tick();
  assert.equal(status.state, "READY");
  assert.equal(events.length, 2);
  assert.equal(events[1].type, "FUTURE_GEAR_UPDATED");
});

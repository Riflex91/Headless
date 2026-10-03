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
      "expected-value-controller.lib.ts",
    ),
  ).ExpectedValueController;
}

function upgradeStatus(candidates = []) {
  return {
    timestamp: 1000,
    enabled: true,
    state: candidates.length ? "READY" : "EMPTY",
    reason: candidates.length
      ? "UPGRADE_CANDIDATE_READY"
      : "UPGRADE_NO_ELIGIBLE_CANDIDATE",
    executionMode: "EXPLICIT_ONE_SHOT",
    selected: candidates[0] || null,
    candidates,
    decisions: [],
    unknownHold: null,
    lastAction: null,
    summary: {
      upgradeDispositionItems: candidates.length,
      protectedUpgradeItems: 0,
      eligibleCandidates: candidates.length,
      scrollPolicyLevels: 1,
    },
  };
}

function compoundStatus(candidates = []) {
  return {
    timestamp: 1000,
    enabled: true,
    state: candidates.length ? "READY" : "EMPTY",
    reason: candidates.length
      ? "COMPOUND_CANDIDATE_READY"
      : "COMPOUND_NO_ELIGIBLE_CANDIDATE",
    executionMode: "EXPLICIT_ONE_SHOT",
    selected: candidates[0] || null,
    candidates,
    decisions: [],
    unknownHold: null,
    lastAction: null,
    summary: {
      compoundDispositionItems: candidates.length * 3,
      protectedCompoundItems: 0,
      eligibleCandidates: candidates.length,
      scrollPolicyGrades: 1,
    },
  };
}

function upgradeCandidate(overrides = {}) {
  return {
    itemSlot: 0,
    name: "sword",
    currentLevel: 0,
    maxLevel: 3,
    scrollName: "scroll0",
    scrollSlot: 3,
    offeringSlot: null,
    reason: "UPGRADE_POLICY_ELIGIBLE",
    ...overrides,
  };
}

function compoundCandidate(overrides = {}) {
  return {
    itemSlots: [0, 1, 2],
    name: "ring",
    currentLevel: 0,
    maxLevel: 3,
    itemGrade: 0,
    scrollName: "cscroll0",
    scrollSlot: 3,
    offeringSlot: null,
    reason: "COMPOUND_POLICY_ELIGIBLE",
    ...overrides,
  };
}

function makeController({
  inventory = [],
  gameData = { items: {} },
  upgrades = [],
  compounds = [],
  config = {},
  events = [],
} = {}) {
  const ExpectedValueController = loadController();
  let now = 1000;
  const controller = new ExpectedValueController(
    {
      inventory: () =>
        inventory.map((item, slot) => ({
          slot,
          item: item ? { ...item } : null,
        })),
      gameData: () => JSON.parse(JSON.stringify(gameData)),
    },
    {
      status: () => upgradeStatus(upgrades),
    },
    {
      status: () => compoundStatus(compounds),
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
    setNow(value) {
      now = value;
    },
  };
}

function baseGameData() {
  return {
    items: {
      sword: {
        name: "Sword",
        type: "weapon",
        g: 6000,
        igrade: 0,
        grades: [7, 9, 10, 12],
        upgrade: { attack: 2 },
      },
      ring: {
        name: "Ring",
        type: "ring",
        g: 12000,
        igrade: 0,
        grades: [3, 7, 10, 12],
        compound: { dex: 1 },
      },
      scroll0: {
        name: "Upgrade Scroll",
        type: "uscroll",
        grade: 0,
        g: 1000,
      },
      scroll1: {
        name: "High Upgrade Scroll",
        type: "uscroll",
        grade: 1,
        g: 40000,
      },
      scroll2: {
        name: "Rare Upgrade Scroll",
        type: "uscroll",
        grade: 2,
        g: 1600000,
      },
      cscroll0: {
        name: "Compound Scroll",
        type: "cscroll",
        grade: 0,
        g: 6400,
      },
      cscroll1: {
        name: "High Compound Scroll",
        type: "cscroll",
        grade: 1,
        g: 240000,
      },
      cscroll2: {
        name: "Rare Compound Scroll",
        type: "cscroll",
        grade: 2,
        g: 9200000,
      },
    },
  };
}

test("Expected Value models one-step Upgrade from official base odds and intrinsic value", () => {
  const setup = makeController({
    inventory: [
      { name: "sword", level: 0 },
      null,
      null,
      { name: "scroll0", q: 5 },
    ],
    gameData: baseGameData(),
    upgrades: [upgradeCandidate()],
  });

  const status = setup.controller.tick();
  const estimate = status.estimates[0];

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "EXPECTED_VALUE_READY");
  assert.equal(estimate.kind, "UPGRADE");
  assert.equal(estimate.probabilityGrade, 0);
  assert.equal(estimate.itemGrade, 0);
  assert.equal(estimate.scrollGrade, 0);
  assert.equal(estimate.successProbability, 0.9999999);
  assert.equal(estimate.currentItemValueGold, 3600);
  assert.equal(estimate.successItemValueGold, 4100);
  assert.equal(estimate.scrollReplacementCostGold, 1000);
  assert.equal(estimate.inputValueGold, 4600);
  assert.equal(estimate.expectedOutcomeValueGold, 4100);
  assert.equal(estimate.expectedDeltaGold, -500);
  assert.equal(estimate.decision, "NEGATIVE_EV");
  assert.equal(status.summary.evaluated, 1);
  assert.equal(status.summary.negative, 1);
  assert.equal(status.summary.bestExpectedDeltaGold, -500);
  assert.equal(status.model.dynamicGraceIncluded, false);
  assert.equal(status.model.offeringsIncluded, false);
  assert.equal(status.model.marketPricesIncluded, false);
});

test("Expected Value models one-step Compound using three consumed items", () => {
  const setup = makeController({
    inventory: [
      { name: "ring", level: 0 },
      { name: "ring", level: 0 },
      { name: "ring", level: 0 },
      { name: "cscroll0", q: 5 },
    ],
    gameData: baseGameData(),
    compounds: [compoundCandidate()],
  });

  const status = setup.controller.tick();
  const estimate = status.estimates[0];

  assert.equal(status.state, "READY");
  assert.equal(estimate.kind, "COMPOUND");
  assert.equal(estimate.successProbability, 0.99);
  assert.equal(estimate.currentItemValueGold, 21600);
  assert.equal(estimate.successItemValueGold, 25707);
  assert.equal(estimate.scrollReplacementCostGold, 6400);
  assert.equal(estimate.inputValueGold, 28000);
  assert.equal(estimate.expectedOutcomeValueGold, 25449.93);
  assert.equal(estimate.expectedDeltaGold, -2550.07);
  assert.equal(estimate.decision, "NEGATIVE_EV");
  assert.equal(status.summary.compoundCandidates, 1);
});

test("Expected Value applies the official higher-grade scroll base adjustment", () => {
  const setup = makeController({
    inventory: [
      { name: "sword", level: 0 },
      null,
      null,
      { name: "scroll1", q: 1 },
    ],
    gameData: baseGameData(),
    upgrades: [
      upgradeCandidate({
        scrollName: "scroll1",
      }),
    ],
  });

  const estimate = setup.controller.tick().estimates[0];

  assert.equal(estimate.scrollGrade, 1);
  assert.equal(estimate.successProbability, 1);
  assert.equal(estimate.scrollReplacementCostGold, 40000);
});

test("Expected Value stays conservative when model metadata is incomplete", () => {
  const gameData = baseGameData();
  delete gameData.items.sword.g;

  const setup = makeController({
    inventory: [
      { name: "sword", level: 0 },
      null,
      null,
      { name: "scroll0", q: 1 },
    ],
    gameData,
    upgrades: [upgradeCandidate()],
  });

  const status = setup.controller.tick();
  const estimate = status.estimates[0];

  assert.equal(status.state, "EMPTY");
  assert.equal(status.reason, "EXPECTED_VALUE_MODEL_INPUT_UNKNOWN");
  assert.equal(estimate.decision, "UNKNOWN");
  assert.equal(estimate.expectedDeltaGold, null);
  assert.equal(
    estimate.reason,
    "EXPECTED_VALUE_UPGRADE_MODEL_INPUT_UNKNOWN",
  );
  assert.equal(status.summary.unknown, 1);
  assert.equal(status.summary.evaluated, 0);
});

test("Expected Value supports disabling and emits only when state changes", () => {
  const events = [];
  const setup = makeController({
    config: {
      expectedValue: {
        enabled: false,
      },
    },
    events,
  });

  const first = setup.controller.tick();
  setup.setNow(2000);
  const second = setup.controller.tick();

  assert.equal(first.state, "DISABLED");
  assert.equal(first.reason, "EXPECTED_VALUE_DISABLED");
  assert.equal(second.state, "DISABLED");
  assert.equal(events.length, 1);
});

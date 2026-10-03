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
    items: [
      { name: "ring", level: 0 },
      { name: "ring", level: 0 },
      { name: "ring", level: 0 },
      { name: "cscroll0", q: 5 },
      { name: "cscroll1", q: 2 },
      { name: "reserved_ring", level: 0 },
      { name: "reserved_ring", level: 0 },
      { name: "reserved_ring", level: 0 },
    ],
    G: {
      items: {
        ring: { name: "Ring", compound: { dex: 1 } },
        reserved_ring: { name: "Reserved Ring", compound: { dex: 1 } },
        cscroll0: { name: "Compound Scroll" },
        cscroll1: { name: "High Compound Scroll" },
      },
    },
  };
}

function intelligenceEntry({
  slot = 0,
  name = "ring",
  level = 0,
  disposition = "COMPOUND",
  protected: isProtected = false,
  protections = [],
} = {}) {
  return {
    slot,
    name,
    level,
    quantity: 1,
    definitionKnown: true,
    itemType: "ring",
    disposition,
    protected: isProtected,
    protections,
    why: "test",
  };
}

function defaultEntries() {
  return [
    intelligenceEntry({ slot: 0 }),
    intelligenceEntry({ slot: 1 }),
    intelligenceEntry({ slot: 2 }),
    intelligenceEntry({
      slot: 3,
      name: "cscroll0",
      disposition: "KEEP",
    }),
    intelligenceEntry({
      slot: 4,
      name: "cscroll1",
      disposition: "KEEP",
    }),
  ];
}

function makeIntelligence(entries = defaultEntries()) {
  return {
    status() {
      return {
        timestamp: 1000,
        enabled: true,
        state: entries.length ? "READY" : "EMPTY",
        reason: entries.length
          ? "INVENTORY_INTELLIGENCE_READY"
          : "INVENTORY_INTELLIGENCE_EMPTY",
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

function makeController({
  state = makeState(),
  entries = defaultEntries(),
  config = {
    compound: {
      enabled: true,
      maxLevel: 3,
      scrollByGrade: {
        0: "cscroll0",
        1: "cscroll1",
      },
    },
  },
  itemGrade = () => 0,
  compound = async () => ({
    id: "A-1",
    module: "CompoundController",
    action: "COMPOUND",
    why: "COMPOUND_POLICY_SELECTED",
    correlationId: "C-1",
    createdAt: 1000,
    dispatchedAt: 1001,
    completedAt: 1002,
    status: "CONFIRMED",
    evidence: { compoundSucceeded: true },
  }),
} = {}) {
  const { CompoundController } = coreModule("compound-controller.lib.ts");
  let now = 1000;
  let calls = 0;
  const requests = [];
  const actions = {
    async compound(request) {
      calls += 1;
      requests.push(request);
      return compound(request, state);
    },
  };
  const game = {
    inventory() {
      return state.items.map((item, slot) => ({
        slot,
        item: item ? { ...item } : null,
      }));
    },
    gameData() {
      return state.G;
    },
    itemGrade(item) {
      return itemGrade(item);
    },
  };
  const controller = new CompoundController(
    game,
    actions,
    makeIntelligence(entries),
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

test("Compound plans one deterministic unprotected triple with grade-compatible scroll", () => {
  const setup = makeController();
  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "COMPOUND_CANDIDATE_READY");
  assert.equal(status.executionMode, "EXPLICIT_ONE_SHOT");
  assert.equal(status.candidates.length, 1);
  assert.deepEqual(status.selected, {
    itemSlots: [0, 1, 2],
    name: "ring",
    currentLevel: 0,
    maxLevel: 3,
    itemGrade: 0,
    scrollName: "cscroll0",
    scrollSlot: 3,
    offeringSlot: null,
    reason: "COMPOUND_POLICY_ELIGIBLE",
  });
  assert.equal(setup.calls(), 0);
});

test("Compound refuses protected triples and requires three usable items", () => {
  const entries = defaultEntries();
  entries[2] = intelligenceEntry({
    slot: 2,
    protected: true,
    protections: ["RESERVED"],
  });
  const setup = makeController({ entries });

  const status = setup.controller.tick();

  assert.equal(status.state, "EMPTY");
  assert.equal(status.selected, null);
  assert.equal(status.decisions[0].reason, "COMPOUND_ITEMS_PROTECTED");
  assert.equal(status.summary.protectedCompoundItems, 1);
});

test("Compound requires explicit max-level and grade-scroll policies", () => {
  const noMax = makeController({
    config: {
      compound: {
        enabled: true,
        scrollByGrade: { 0: "cscroll0" },
      },
    },
  }).controller.tick();
  assert.equal(noMax.state, "EMPTY");
  assert.equal(
    noMax.decisions[0].reason,
    "COMPOUND_MAX_LEVEL_POLICY_MISSING",
  );

  const noScroll = makeController({
    config: {
      compound: {
        enabled: true,
        maxLevel: 3,
      },
    },
  }).controller.tick();
  assert.equal(noScroll.state, "EMPTY");
  assert.equal(
    noScroll.decisions[0].reason,
    "COMPOUND_SCROLL_POLICY_MISSING",
  );
});

test("Compound rejects wrong scroll grade and non-compoundable definitions", () => {
  const wrongScroll = makeController({
    config: {
      compound: {
        enabled: true,
        maxLevel: 3,
        scrollByGrade: { 0: "cscroll1" },
      },
    },
  }).controller.tick();
  assert.equal(wrongScroll.state, "EMPTY");
  assert.equal(
    wrongScroll.decisions[0].reason,
    "COMPOUND_SCROLL_GRADE_MISMATCH",
  );

  const state = makeState();
  delete state.G.items.ring.compound;
  const notCompoundable = makeController({ state }).controller.tick();
  assert.equal(notCompoundable.state, "EMPTY");
  assert.equal(
    notCompoundable.decisions[0].reason,
    "COMPOUND_ITEM_NOT_COMPOUNDABLE",
  );
});

test("Compound executeNext dispatches exactly one mutation without offering", async () => {
  const setup = makeController();

  const status = await setup.controller.executeNext();

  assert.equal(setup.calls(), 1);
  assert.deepEqual(setup.requests[0], {
    module: "CompoundController",
    why: "COMPOUND_POLICY_SELECTED",
    itemSlots: [0, 1, 2],
    scrollSlot: 3,
    offeringSlot: null,
  });
  assert.equal(status.lastAction.status, "CONFIRMED");
  assert.equal(status.lastAction.compoundSucceeded, true);
});

test("Compound UNKNOWN creates a no-blind-retry hold until observed state changes", async () => {
  const setup = makeController({
    compound: async () => ({
      id: "A-unknown",
      module: "CompoundController",
      action: "COMPOUND",
      why: "COMPOUND_POLICY_SELECTED",
      correlationId: "C-unknown",
      createdAt: 1000,
      dispatchedAt: 1001,
      completedAt: 1002,
      status: "UNKNOWN",
      error: "socket timeout",
    }),
  });

  const first = await setup.controller.executeNext();
  assert.equal(setup.calls(), 1);
  assert.equal(first.state, "UNKNOWN_HOLD");
  assert.equal(first.reason, "COMPOUND_UNKNOWN_HOLD_ACTIVE");
  assert.equal(first.selected, null);
  assert.equal(first.unknownHold.actionId, "A-unknown");

  const second = await setup.controller.executeNext();
  assert.equal(setup.calls(), 1);
  assert.equal(second.state, "UNKNOWN_HOLD");

  setup.state.items[3].q = 4;
  setup.advance();
  const reconciled = setup.controller.tick();

  assert.equal(reconciled.unknownHold, null);
  assert.equal(reconciled.state, "READY");
  assert.equal(reconciled.selected.currentLevel, 0);
});

test("Compound can be disabled without dispatching", async () => {
  const setup = makeController({
    config: {
      compound: {
        enabled: false,
        maxLevel: 3,
        scrollByGrade: { 0: "cscroll0" },
      },
    },
  });

  const planned = setup.controller.tick();
  const executed = await setup.controller.executeNext();

  assert.equal(planned.state, "DISABLED");
  assert.equal(executed.state, "DISABLED");
  assert.equal(setup.calls(), 0);
});

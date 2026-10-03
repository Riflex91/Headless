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

function intelligenceEntry({
  slot,
  name,
  level = 0,
  protected: isProtected = false,
  protections = [],
  disposition = "KEEP",
}) {
  return {
    slot,
    name,
    level,
    quantity: 1,
    definitionKnown: true,
    itemType: name.startsWith("cscroll") ? "scroll" : "ring",
    disposition,
    protected: isProtected,
    protections,
    why: "test",
  };
}

function makeSetup({
  items = [
    { name: "ring", level: 0 },
    { name: "ring", level: 0 },
    { name: "ring", level: 0 },
    { name: "cscroll0", q: 5 },
  ],
  entries = [
    intelligenceEntry({ slot: 0, name: "ring", disposition: "KEEP" }),
    intelligenceEntry({ slot: 1, name: "ring", disposition: "KEEP" }),
    intelligenceEntry({ slot: 2, name: "ring", disposition: "KEEP" }),
    intelligenceEntry({ slot: 3, name: "cscroll0", disposition: "KEEP" }),
  ],
  itemGrade = () => 0,
  executeNext,
} = {}) {
  const { CompoundLiveTestRunner } = coreModule("compound-live-test.lib.ts");

  const state = {
    items: items.map((item) => (item ? { ...item } : null)),
    now: 1000,
  };

  let intelligenceOverride = null;
  let compoundOverride = null;
  let executionCalls = 0;
  let compoundStatus = {
    timestamp: 1000,
    enabled: true,
    state: "EMPTY",
    reason: "COMPOUND_NO_ELIGIBLE_CANDIDATE",
    executionMode: "EXPLICIT_ONE_SHOT",
    selected: null,
    candidates: [],
    decisions: [],
    unknownHold: null,
    lastAction: null,
    summary: {
      compoundDispositionItems: 0,
      protectedCompoundItems: 0,
      eligibleCandidates: 0,
      scrollPolicyGrades: 0,
    },
  };

  const inventoryIntelligence = {
    status() {
      return {
        timestamp: state.now,
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
    tick() {
      return this.status();
    },
    setConfigOverride(value) {
      intelligenceOverride = value;
    },
    clearConfigOverride() {
      intelligenceOverride = null;
    },
  };

  const compound = {
    status() {
      return compoundStatus;
    },
    tick() {
      if (compoundOverride) {
        compoundStatus = {
          ...compoundStatus,
          state: "READY",
          reason: "COMPOUND_CANDIDATE_READY",
          selected: {
            itemSlots: [0, 1, 2],
            name: "ring",
            currentLevel: 0,
            maxLevel: 1,
            itemGrade: 0,
            scrollName: "cscroll0",
            scrollSlot: 3,
            offeringSlot: null,
            reason: "COMPOUND_POLICY_ELIGIBLE",
          },
        };
      }
      return compoundStatus;
    },
    async executeNext() {
      executionCalls += 1;
      if (executeNext) {
        compoundStatus = await executeNext({
          state,
          compoundStatus,
          executionCalls,
        });
      } else {
        state.items[0] = { name: "ring", level: 1 };
        state.items[1] = null;
        state.items[2] = null;
        state.items[3] = { name: "cscroll0", q: 4 };
        compoundStatus = {
          ...compoundStatus,
          state: "EMPTY",
          reason: "COMPOUND_NO_ELIGIBLE_CANDIDATE",
          selected: null,
          lastAction: {
            id: "A-1",
            status: "CONFIRMED",
            why: "COMPOUND_POLICY_SELECTED",
            error: null,
            itemSlots: [0, 1, 2],
            name: "ring",
            fromLevel: 0,
            scrollSlot: 3,
            scrollName: "cscroll0",
            compoundSucceeded: true,
          },
        };
      }
      return compoundStatus;
    },
    setConfigOverride(value) {
      compoundOverride = value;
    },
    clearConfigOverride() {
      compoundOverride = null;
    },
  };

  const runner = new CompoundLiveTestRunner({
    game: {
      inventory() {
        return state.items.map((item, slot) => ({
          slot,
          item: item ? { ...item } : null,
        }));
      },
      gameData() {
        return {
          items: {
            ring: { compound: { dex: 1 } },
            cscroll0: {},
            cscroll1: {},
          },
        };
      },
      itemGrade(item) {
        return itemGrade(item);
      },
    },
    inventoryIntelligence,
    compound,
    characterName: () => "My_Merchant",
    now: () => state.now,
    sleep: async (ms) => {
      state.now += ms;
    },
  });

  return {
    runner,
    state,
    executionCalls: () => executionCalls,
    intelligenceOverride: () => intelligenceOverride,
    compoundOverride: () => compoundOverride,
  };
}

test("Compound live runner confirms exactly one real triple mutation", async () => {
  const s = makeSetup();
  const result = await s.runner.run({
    itemName: "ring",
    itemSlots: [0, 1, 2],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "COMPOUND_LIVE_E2E_CONFIRMED");
  assert.equal(s.executionCalls(), 1);
  assert.equal(result.evidence.exactTripleObserved, true);
  assert.equal(result.evidence.itemGradesKnown, true);
  assert.equal(result.evidence.itemGradesMatch, true);
  assert.equal(result.evidence.scrollGradeCompatible, true);
  assert.equal(result.evidence.actionDispatchedOnce, true);
  assert.equal(result.evidence.actionConfirmed, true);
  assert.equal(result.evidence.mutationObserved, true);
  assert.equal(result.scope.mutationScope, "single-compound-attempt-only");
  assert.equal(result.cleanup.inventoryConfigOverrideCleared, true);
  assert.equal(result.cleanup.compoundConfigOverrideCleared, true);
  assert.equal(s.intelligenceOverride(), null);
  assert.equal(s.compoundOverride(), null);
});

test("Compound live runner requires three distinct explicit slots", async () => {
  const s = makeSetup();
  const result = await s.runner.run({
    itemName: "ring",
    itemSlots: [0, 0, 2],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(
    result.reason,
    "COMPOUND_LIVE_EXPLICIT_ITEM_SLOTS_AND_SCROLL_REQUIRED",
  );
  assert.equal(s.executionCalls(), 0);
});

test("Compound live runner refuses protected item before mutation", async () => {
  const entries = [
    intelligenceEntry({ slot: 0, name: "ring" }),
    intelligenceEntry({
      slot: 1,
      name: "ring",
      protected: true,
      protections: ["FUTURE_GEAR"],
    }),
    intelligenceEntry({ slot: 2, name: "ring" }),
    intelligenceEntry({ slot: 3, name: "cscroll0" }),
  ];
  const s = makeSetup({ entries });
  const result = await s.runner.run({
    itemName: "ring",
    itemSlots: [0, 1, 2],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_LIVE_SAFE_TRIPLE_OR_SCROLL_NOT_FOUND");
  assert.equal(s.executionCalls(), 0);
});

test("Compound live runner rejects a scroll that does not match real item grade", async () => {
  const s = makeSetup({
    items: [
      { name: "ring", level: 0 },
      { name: "ring", level: 0 },
      { name: "ring", level: 0 },
      { name: "cscroll1", q: 5 },
    ],
    entries: [
      intelligenceEntry({ slot: 0, name: "ring" }),
      intelligenceEntry({ slot: 1, name: "ring" }),
      intelligenceEntry({ slot: 2, name: "ring" }),
      intelligenceEntry({ slot: 3, name: "cscroll1" }),
    ],
    itemGrade: () => 0,
  });
  const result = await s.runner.run({
    itemName: "ring",
    itemSlots: [0, 1, 2],
    scrollName: "cscroll1",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_LIVE_SAFE_TRIPLE_OR_SCROLL_NOT_FOUND");
  assert.equal(s.executionCalls(), 0);
});

test("Compound live runner returns UNKNOWN and never retries", async () => {
  const s = makeSetup({
    executeNext: async ({ compoundStatus }) => ({
      ...compoundStatus,
      state: "UNKNOWN_HOLD",
      reason: "COMPOUND_UNKNOWN_HOLD_ACTIVE",
      selected: null,
      lastAction: {
        id: "A-unknown",
        status: "UNKNOWN",
        why: "COMPOUND_POLICY_SELECTED",
        error: "socket timeout",
        itemSlots: [0, 1, 2],
        name: "ring",
        fromLevel: 0,
        scrollSlot: 3,
        scrollName: "cscroll0",
        compoundSucceeded: null,
      },
    }),
  });
  const result = await s.runner.run({
    itemName: "ring",
    itemSlots: [0, 1, 2],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "COMPOUND_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(s.executionCalls(), 1);
  assert.equal(result.evidence.blindRetryAvoided, true);
});

test("Compound live runner times out when CONFIRMED state does not mutate", async () => {
  const s = makeSetup({
    executeNext: async ({ compoundStatus }) => ({
      ...compoundStatus,
      selected: null,
      lastAction: {
        id: "A-confirmed",
        status: "CONFIRMED",
        why: "COMPOUND_POLICY_SELECTED",
        error: null,
        itemSlots: [0, 1, 2],
        name: "ring",
        fromLevel: 0,
        scrollSlot: 3,
        scrollName: "cscroll0",
        compoundSucceeded: false,
      },
    }),
  });
  const result = await s.runner.run({
    itemName: "ring",
    itemSlots: [0, 1, 2],
    scrollName: "cscroll0",
    settleTimeoutMs: 500,
    settlePollMs: 100,
  });

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(
    result.reason,
    "COMPOUND_LIVE_CONFIRMED_BUT_STATE_CHANGE_NOT_OBSERVED",
  );
  assert.equal(s.executionCalls(), 1);
});

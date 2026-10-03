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
      { name: "sword", level: 0 },
      { name: "scroll0", q: 3 },
      { name: "scroll1", q: 2 },
      { name: "reserved_sword", level: 0 },
    ],
    G: {
      items: {
        sword: { name: "Sword", upgrade: { attack: 2 } },
        reserved_sword: {
          name: "Reserved Sword",
          upgrade: { attack: 2 },
        },
        scroll0: { name: "Upgrade Scroll" },
        scroll1: { name: "High Upgrade Scroll" },
      },
    },
  };
}

function intelligenceEntry({
  slot = 0,
  name = "sword",
  level = 0,
  disposition = "UPGRADE",
  protected: isProtected = false,
  protections = [],
} = {}) {
  return {
    slot,
    name,
    level,
    quantity: 1,
    definitionKnown: true,
    itemType: "weapon",
    disposition,
    protected: isProtected,
    protections,
    why: "test",
  };
}

function makeIntelligence(entries = [intelligenceEntry()]) {
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
  entries = [intelligenceEntry()],
  config = {
    upgrade: {
      enabled: true,
      maxLevel: 3,
      scrollByCurrentLevel: {
        0: "scroll0",
        1: "scroll1",
      },
    },
  },
  upgrade = async () => ({
    id: "A-1",
    module: "UpgradeController",
    action: "UPGRADE",
    why: "UPGRADE_POLICY_SELECTED",
    correlationId: "C-1",
    createdAt: 1000,
    dispatchedAt: 1001,
    completedAt: 1002,
    status: "CONFIRMED",
    evidence: { upgradeSucceeded: true },
  }),
} = {}) {
  const { UpgradeController } = coreModule("upgrade-controller.lib.ts");
  let now = 1000;
  let calls = 0;
  const requests = [];
  const actions = {
    async upgrade(request) {
      calls += 1;
      requests.push(request);
      return upgrade(request, state);
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
  };
  const controller = new UpgradeController(
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

test("Upgrade plans only explicit unprotected UPGRADE inventory entries", () => {
  const setup = makeController();
  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "UPGRADE_CANDIDATE_READY");
  assert.equal(status.executionMode, "EXPLICIT_ONE_SHOT");
  assert.equal(status.candidates.length, 1);
  assert.deepEqual(status.selected, {
    itemSlot: 0,
    name: "sword",
    currentLevel: 0,
    maxLevel: 3,
    scrollName: "scroll0",
    scrollSlot: 1,
    offeringSlot: null,
    reason: "UPGRADE_POLICY_ELIGIBLE",
  });
  assert.equal(setup.calls(), 0);
});

test("Upgrade refuses protected UPGRADE entries", () => {
  const setup = makeController({
    entries: [
      intelligenceEntry({
        protected: true,
        protections: ["RESERVED"],
      }),
    ],
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "EMPTY");
  assert.equal(status.selected, null);
  assert.equal(status.decisions[0].reason, "UPGRADE_ITEM_PROTECTED");
  assert.equal(status.summary.protectedUpgradeItems, 1);
});

test("Upgrade requires explicit max-level and scroll policies", () => {
  const noMax = makeController({
    config: {
      upgrade: {
        enabled: true,
        scrollByCurrentLevel: { 0: "scroll0" },
      },
    },
  }).controller.tick();
  assert.equal(noMax.state, "EMPTY");
  assert.equal(
    noMax.decisions[0].reason,
    "UPGRADE_MAX_LEVEL_POLICY_MISSING",
  );

  const noScroll = makeController({
    config: {
      upgrade: {
        enabled: true,
        maxLevel: 3,
      },
    },
  }).controller.tick();
  assert.equal(noScroll.state, "EMPTY");
  assert.equal(
    noScroll.decisions[0].reason,
    "UPGRADE_SCROLL_POLICY_MISSING",
  );
});

test("Upgrade respects max level and requires the configured scroll in inventory", () => {
  const maxedState = makeState();
  maxedState.items[0].level = 3;
  const maxed = makeController({ state: maxedState }).controller.tick();
  assert.equal(maxed.state, "EMPTY");
  assert.equal(maxed.decisions[0].reason, "UPGRADE_MAX_LEVEL_REACHED");

  const missingScrollState = makeState();
  missingScrollState.items[1] = null;
  const missingScroll = makeController({
    state: missingScrollState,
  }).controller.tick();
  assert.equal(missingScroll.state, "EMPTY");
  assert.equal(missingScroll.decisions[0].reason, "UPGRADE_SCROLL_MISSING");
});

test("Upgrade executeNext dispatches exactly one boundary mutation without offering", async () => {
  const setup = makeController();

  const status = await setup.controller.executeNext();

  assert.equal(setup.calls(), 1);
  assert.deepEqual(setup.requests[0], {
    module: "UpgradeController",
    why: "UPGRADE_POLICY_SELECTED",
    itemSlot: 0,
    scrollSlot: 1,
    offeringSlot: null,
  });
  assert.equal(status.lastAction.status, "CONFIRMED");
  assert.equal(status.lastAction.upgradeSucceeded, true);
});

test("Upgrade UNKNOWN creates a no-blind-retry hold for the unchanged item", async () => {
  const setup = makeController({
    upgrade: async () => ({
      id: "A-unknown",
      module: "UpgradeController",
      action: "UPGRADE",
      why: "UPGRADE_POLICY_SELECTED",
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
  assert.equal(first.reason, "UPGRADE_UNKNOWN_HOLD_ACTIVE");
  assert.equal(first.selected, null);
  assert.equal(first.unknownHold.actionId, "A-unknown");

  const second = await setup.controller.executeNext();
  assert.equal(setup.calls(), 1);
  assert.equal(second.state, "UNKNOWN_HOLD");

  setup.state.items[0].level = 1;
  setup.advance();
  const reconciled = setup.controller.tick();

  assert.equal(reconciled.unknownHold, null);
  assert.equal(reconciled.state, "READY");
  assert.equal(reconciled.selected.currentLevel, 1);
  assert.equal(reconciled.selected.scrollName, "scroll1");
  assert.equal(reconciled.selected.scrollSlot, 2);
});

test("Upgrade can be disabled without dispatching", async () => {
  const setup = makeController({
    config: {
      upgrade: {
        enabled: false,
        maxLevel: 3,
        scrollByCurrentLevel: { 0: "scroll0" },
      },
    },
  });

  const planned = setup.controller.tick();
  const executed = await setup.controller.executeNext();

  assert.equal(planned.state, "DISABLED");
  assert.equal(executed.state, "DISABLED");
  assert.equal(setup.calls(), 0);
});

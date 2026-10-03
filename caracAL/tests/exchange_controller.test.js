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
      { name: "seashell", q: 20 },
      { name: "token", q: 4 },
      { name: "junk", q: 99 },
      { name: "reserved", q: 10 },
    ],
    G: {
      items: {
        seashell: { name: "Sea Shell", e: 20 },
        token: { name: "Token", e: 5 },
        junk: { name: "Junk" },
        reserved: { name: "Reserved", e: 10 },
      },
    },
  };
}

function intelligenceEntry({
  slot = 0,
  name = "seashell",
  quantity = 20,
  disposition = "EXCHANGE",
  protected: isProtected = false,
  protections = [],
} = {}) {
  return {
    slot,
    name,
    level: 0,
    quantity,
    definitionKnown: true,
    itemType: "material",
    disposition,
    protected: isProtected,
    protections,
    why: "test",
  };
}

function makeIntelligence(entries) {
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
  config = { exchange: { enabled: true } },
  exchange = async () => ({
    id: "A-1",
    module: "ExchangeController",
    action: "EXCHANGE",
    why: "EXCHANGE_POLICY_SELECTED",
    correlationId: "C-1",
    createdAt: 1000,
    dispatchedAt: 1001,
    completedAt: 1002,
    status: "CONFIRMED",
    evidence: { exchangeSucceeded: true },
  }),
} = {}) {
  const { ExchangeController } = coreModule("exchange-controller.lib.ts");
  let now = 1000;
  let calls = 0;
  const requests = [];
  const actions = {
    async exchange(request) {
      calls += 1;
      requests.push(request);
      return exchange(request, state);
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

  const controller = new ExchangeController(
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

test("Exchange plans one deterministic explicit EXCHANGE candidate", () => {
  const setup = makeController();
  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "EXCHANGE_CANDIDATE_READY");
  assert.equal(status.executionMode, "EXPLICIT_ONE_SHOT");
  assert.deepEqual(status.selected, {
    itemSlot: 0,
    name: "seashell",
    quantity: 20,
    requiredQuantity: 20,
    reason: "EXCHANGE_POLICY_ELIGIBLE",
  });
  assert.equal(setup.calls(), 0);
});

test("Exchange refuses protected inventory entries", () => {
  const setup = makeController({
    entries: [
      intelligenceEntry({
        slot: 3,
        name: "reserved",
        quantity: 10,
        protected: true,
        protections: ["RESERVED"],
      }),
    ],
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "EMPTY");
  assert.equal(status.selected, null);
  assert.equal(status.decisions[0].reason, "EXCHANGE_ITEM_PROTECTED");
  assert.equal(status.summary.protectedExchangeItems, 1);
});

test("Exchange requires an exchangeable definition and enough quantity", () => {
  const insufficient = makeController({
    entries: [
      intelligenceEntry({
        slot: 1,
        name: "token",
        quantity: 4,
      }),
    ],
  }).controller.tick();
  assert.equal(insufficient.state, "EMPTY");
  assert.equal(
    insufficient.decisions[0].reason,
    "EXCHANGE_QUANTITY_INSUFFICIENT",
  );
  assert.equal(insufficient.decisions[0].requiredQuantity, 5);

  const notExchangeable = makeController({
    entries: [
      intelligenceEntry({
        slot: 2,
        name: "junk",
        quantity: 99,
      }),
    ],
  }).controller.tick();
  assert.equal(notExchangeable.state, "EMPTY");
  assert.equal(
    notExchangeable.decisions[0].reason,
    "EXCHANGE_ITEM_NOT_EXCHANGEABLE",
  );
});

test("Exchange respects explicit allowed item and slot policies", () => {
  const blockedItem = makeController({
    config: {
      exchange: {
        enabled: true,
        allowedItems: ["token"],
      },
    },
  }).controller.tick();
  assert.equal(blockedItem.state, "EMPTY");
  assert.equal(blockedItem.summary.exchangeDispositionItems, 0);

  const blockedSlot = makeController({
    config: {
      exchange: {
        enabled: true,
        allowedSlots: [1],
      },
    },
  }).controller.tick();
  assert.equal(blockedSlot.state, "EMPTY");
  assert.equal(blockedSlot.summary.exchangeDispositionItems, 0);
});

test("Exchange executeNext dispatches exactly one boundary mutation", async () => {
  const setup = makeController();
  const status = await setup.controller.executeNext();

  assert.equal(setup.calls(), 1);
  assert.deepEqual(setup.requests[0], {
    module: "ExchangeController",
    why: "EXCHANGE_POLICY_SELECTED",
    itemSlot: 0,
  });
  assert.equal(status.lastAction.status, "CONFIRMED");
  assert.equal(status.lastAction.exchangeSucceeded, true);
});

test("Exchange UNKNOWN creates a no-blind-retry hold until state changes", async () => {
  const setup = makeController({
    exchange: async () => ({
      id: "A-unknown",
      module: "ExchangeController",
      action: "EXCHANGE",
      why: "EXCHANGE_POLICY_SELECTED",
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
  assert.equal(first.reason, "EXCHANGE_UNKNOWN_HOLD_ACTIVE");
  assert.equal(first.selected, null);
  assert.equal(first.unknownHold.actionId, "A-unknown");

  const second = await setup.controller.executeNext();
  assert.equal(setup.calls(), 1);
  assert.equal(second.state, "UNKNOWN_HOLD");

  setup.state.items[0].q = 19;
  setup.advance();
  const reconciled = setup.controller.tick();

  assert.equal(reconciled.unknownHold, null);
  assert.equal(reconciled.state, "EMPTY");
});

test("Exchange can be disabled without dispatching", async () => {
  const setup = makeController({
    config: {
      exchange: {
        enabled: false,
      },
    },
  });

  const planned = setup.controller.tick();
  const executed = await setup.controller.executeNext();

  assert.equal(planned.state, "DISABLED");
  assert.equal(executed.state, "DISABLED");
  assert.equal(setup.calls(), 0);
});

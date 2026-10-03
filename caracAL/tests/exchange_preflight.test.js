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
  item = { name: "seashell", q: 20 },
  protected: isProtected = false,
  protections = [],
  station = {
    id: "exchange",
    name: "Xyn",
    role: "exchange",
    map: "main",
    x: -25,
    y: -478,
    visible: true,
    positions: [{ x: -25, y: -478 }],
    items: [],
  },
  character = {
    map: "main",
    x: -1102,
    y: 0,
    moving: false,
  },
  inventoryState = "READY",
} = {}) {
  const { ExchangeController } = coreModule("exchange-controller.lib.ts");
  const { ExchangePreflightRunner } = coreModule("exchange-preflight.lib.ts");

  const state = {
    item: item ? { ...item } : null,
    character: { ...character },
  };
  const entries = state.item
    ? [
        {
          slot: 0,
          name: state.item.name,
          level: 0,
          quantity: Number.isInteger(state.item.q) ? state.item.q : 1,
          definitionKnown: true,
          itemType: "material",
          disposition: "EXCHANGE",
          protected: isProtected,
          protections: [...protections],
          why: "test",
        },
      ]
    : [];

  const inventoryIntelligence = {
    tick() {
      return {
        timestamp: 1000,
        enabled: true,
        state: inventoryState,
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
    status() {
      return this.tick();
    },
  };

  const game = {
    character() {
      return { ...state.character };
    },
    inventory() {
      return [{ slot: 0, item: state.item ? { ...state.item } : null }];
    },
    gameData() {
      return {
        items: {
          seashell: { name: "Sea Shell", e: 20 },
          token: { name: "Token", e: 5 },
        },
      };
    },
    npcs(mapName) {
      return station && (!mapName || station.map === mapName)
        ? [{ ...station }]
        : [];
    },
  };

  let exchangeCalls = 0;
  const exchange = new ExchangeController(
    game,
    {
      async exchange() {
        exchangeCalls += 1;
        throw new Error("preflight must not mutate");
      },
    },
    inventoryIntelligence,
    {
      now: () => 1000,
      config: () => ({ exchange: { enabled: true } }),
    },
  );

  const runner = new ExchangePreflightRunner({
    game,
    inventoryIntelligence,
    exchange,
    characterName: () => "My_Merchant",
    now: () => 1000,
  });

  return {
    runner,
    exchangeCalls: () => exchangeCalls,
  };
}

test("Exchange preflight confirms Xyn and a deterministic live-ready candidate without mutation", () => {
  const setup = makeSetup();
  const result = setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "EXCHANGE_PREFLIGHT_COMPLETED");
  assert.equal(result.readyForExchange, true);
  assert.equal(result.selected.itemSlot, 0);
  assert.equal(result.selected.name, "seashell");
  assert.equal(result.selected.requiredQuantity, 20);
  assert.equal(result.station.located, true);
  assert.equal(result.station.id, "exchange");
  assert.equal(result.station.name, "Xyn");
  assert.equal(result.station.map, "main");
  assert.equal(result.station.x, -25);
  assert.equal(result.station.y, -478);
  assert.equal(result.station.travelRequired, true);
  assert.equal(result.evidence.inventoryIntelligenceReady, true);
  assert.equal(result.evidence.exchangePlanReadOnly, true);
  assert.equal(result.evidence.stationIdentityVerified, true);
  assert.equal(result.evidence.selectedCandidateConsistent, true);
  assert.equal(result.evidence.noMutationDispatched, true);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.exchangeMutationForced, false);
  assert.equal(setup.exchangeCalls(), 0);
});

test("Exchange preflight reports insufficient quantity without dispatching", () => {
  const setup = makeSetup({
    item: { name: "token", q: 4 },
  });
  const result = setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.readyForExchange, false);
  assert.equal(result.selected, null);
  assert.equal(result.summary.exchangeDispositionItems, 1);
  assert.equal(result.summary.eligibleCandidates, 0);
  assert.equal(result.summary.insufficientQuantityItems, 1);
  assert.equal(
    result.candidates[0].reason,
    "EXCHANGE_QUANTITY_INSUFFICIENT",
  );
  assert.equal(setup.exchangeCalls(), 0);
});

test("Exchange preflight keeps protected exchange inventory ineligible", () => {
  const setup = makeSetup({
    protected: true,
    protections: ["RESERVED"],
  });
  const result = setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.readyForExchange, false);
  assert.equal(result.summary.protectedItems, 1);
  assert.equal(result.candidates[0].reason, "EXCHANGE_ITEM_PROTECTED");
  assert.equal(setup.exchangeCalls(), 0);
});

test("Exchange preflight fails closed when Xyn cannot be located", () => {
  const setup = makeSetup({ station: null });
  const result = setup.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "EXCHANGE_PREFLIGHT_STATION_NOT_FOUND");
  assert.equal(result.station.located, false);
  assert.equal(result.readyForExchange, false);
  assert.equal(setup.exchangeCalls(), 0);
});

test("Exchange preflight fails closed when inventory intelligence is not ready", () => {
  const setup = makeSetup({ inventoryState: "DISABLED" });
  const result = setup.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "EXCHANGE_PREFLIGHT_RUNTIME_NOT_READY");
  assert.equal(result.readyForExchange, false);
  assert.equal(result.evidence.noMutationDispatched, true);
  assert.equal(setup.exchangeCalls(), 0);
});

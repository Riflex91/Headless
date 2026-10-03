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
  itemName = "marketparcel",
  itemSlot = 41,
  quantity = 1,
  protected: isProtected = false,
  protections = [],
  exchangeStatus = "CONFIRMED",
  exchangeSucceeded = true,
  exchangeMutation = true,
  travelStatus = "CONFIRMED",
  startPosition = { map: "main", x: -206, y: -217, moving: false },
  runtimePreflight = { map: "main", exchangeInProgress: false },
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
} = {}) {
  const { ExchangeController } = coreModule("exchange-controller.lib.ts");
  const { ExchangeLiveTestRunner } = coreModule("exchange-live-test.lib.ts");

  const state = {
    character: { ...startPosition },
    inventory: Array.from({ length: 42 }, (_, slot) => ({
      slot,
      item: slot === itemSlot ? { name: itemName, q: quantity, level: 0 } : null,
    })),
  };

  let intelligenceOverride = null;
  const inventoryIntelligence = {
    tick() {
      const entries = state.inventory
        .filter((slot) => slot.item)
        .map((slot) => {
          const rule =
            intelligenceOverride?.inventory?.rules?.[slot.item.name] || null;
          const disposition =
            rule || (slot.item.name === "marketparcel" ? "EXCHANGE" : "KEEP");
          return {
            slot: slot.slot,
            name: slot.item.name,
            level: slot.item.level || 0,
            quantity: slot.item.q || 1,
            definitionKnown: true,
            itemType: "material",
            disposition,
            protected: isProtected,
            protections: [...protections],
            why: "test",
          };
        });
      return {
        timestamp: 1000,
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
    status() {
      return this.tick();
    },
    setConfigOverride(value) {
      intelligenceOverride = value;
    },
    clearConfigOverride() {
      intelligenceOverride = null;
    },
  };

  let exchangeCalls = 0;
  const game = {
    character() {
      return { ...state.character };
    },
    inventory() {
      return state.inventory.map((entry) => ({
        slot: entry.slot,
        item: entry.item ? { ...entry.item } : null,
      }));
    },
    gameData() {
      return {
        items: {
          marketparcel: { name: "Market Parcel", e: 1 },
        },
      };
    },
    npcs(mapName) {
      return station && (!mapName || station.map === mapName)
        ? [{ ...station }]
        : [];
    },
  };

  const actions = {
    async exchange(request) {
      exchangeCalls += 1;
      if (exchangeMutation) {
        state.inventory[request.itemSlot].item = null;
      }
      return {
        id: "A-EXCHANGE-1",
        status: exchangeStatus,
        why:
          exchangeStatus === "CONFIRMED"
            ? "EXCHANGE_RESULT_CONFIRMED"
            : exchangeStatus === "UNKNOWN"
            ? "EXCHANGE_OUTCOME_UNCERTAIN"
            : "EXCHANGE_API_REJECTED",
        error:
          exchangeStatus === "UNKNOWN"
            ? "uncertain"
            : exchangeStatus === "REJECTED"
            ? "distance"
            : null,
        evidence: {
          exchangeSucceeded,
        },
      };
    },
  };

  const exchange = new ExchangeController(
    game,
    actions,
    inventoryIntelligence,
    {
      now: () => 1000,
      config: () => ({ exchange: { enabled: true } }),
    },
  );

  let travelCalls = 0;
  const movement = {
    async smart(request) {
      travelCalls += 1;
      if (travelStatus === "CONFIRMED") {
        state.character = {
          map: request.destination.map,
          x: request.destination.x,
          y: request.destination.y,
          moving: false,
        };
      }
      return {
        id: "A-TRAVEL-1",
        status: travelStatus,
      };
    },
    status() {
      return {
        owner: null,
        mode: "IDLE",
        path: null,
        safePoint: null,
        stuck: {},
        active: null,
      };
    },
  };

  const runner = new ExchangeLiveTestRunner({
    game,
    inventoryIntelligence,
    exchange,
    movement,
    runtimePreflight: () => ({ ...runtimePreflight }),
    characterName: () => "My_Merchant",
    now: (() => {
      let value = 1000;
      return () => {
        value += 100;
        return value;
      };
    })(),
    sleep: async () => {},
  });

  return {
    runner,
    exchangeCalls: () => exchangeCalls,
    travelCalls: () => travelCalls,
  };
}

test("Exchange live runner confirms one real marketparcel exchange after station travel", async () => {
  const setup = makeSetup();
  const result = await setup.runner.run({
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "EXCHANGE_LIVE_E2E_CONFIRMED");
  assert.equal(result.target.itemName, "marketparcel");
  assert.equal(result.target.itemSlot, 41);
  assert.equal(result.target.requiredQuantity, 1);
  assert.equal(result.before.totalQuantity, 1);
  assert.equal(result.after.totalQuantity, 0);
  assert.equal(result.evidence.stationTravelRequired, true);
  assert.equal(result.evidence.stationTravelConfirmed, true);
  assert.equal(result.evidence.stationProximityReady, true);
  assert.equal(result.evidence.movementIdleBeforeDispatch, true);
  assert.equal(result.evidence.localPreflightReadOnly, true);
  assert.equal(result.evidence.exchangeOperationIdle, true);
  assert.equal(result.evidence.itemLockClear, true);
  assert.equal(result.evidence.mapAllowsExchange, true);
  assert.equal(result.evidence.itemStillExactBeforeDispatch, true);
  assert.equal(result.evidence.quantityStillSufficientBeforeDispatch, true);
  assert.equal(result.evidence.exactCandidateStillSelected, true);
  assert.equal(result.evidence.actionDispatchedOnce, true);
  assert.equal(result.evidence.actionConfirmed, true);
  assert.equal(result.evidence.quantityConsumed, true);
  assert.equal(result.evidence.mutationObserved, true);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(result.scope.mutationScope, "single-exchange-attempt-only");
  assert.equal(result.cleanup.inventoryConfigOverrideCleared, true);
  assert.equal(result.cleanup.exchangeConfigOverrideCleared, true);
  assert.equal(setup.exchangeCalls(), 1);
  assert.equal(setup.travelCalls(), 1);
});

test("Exchange live runner returns terminal UNKNOWN without retry", async () => {
  const setup = makeSetup({
    exchangeStatus: "UNKNOWN",
    exchangeSucceeded: null,
    exchangeMutation: false,
  });
  const result = await setup.runner.run({
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "EXCHANGE_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(result.evidence.actionDispatchedOnce, true);
  assert.equal(result.evidence.actionConfirmed, false);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(setup.exchangeCalls(), 1);
});

test("Exchange live runner never dispatches Exchange when station travel is UNKNOWN", async () => {
  const setup = makeSetup({ travelStatus: "UNKNOWN" });
  const result = await setup.runner.run({
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(
    result.reason,
    "EXCHANGE_LIVE_STATION_TRAVEL_UNKNOWN_NO_EXCHANGE_DISPATCH",
  );
  assert.equal(result.evidence.actionDispatchedOnce, false);
  assert.equal(setup.exchangeCalls(), 0);
  assert.equal(setup.travelCalls(), 1);
});

test("Exchange live runner fails closed when just-in-time local preflight is unsafe", async () => {
  const setup = makeSetup({
    runtimePreflight: { map: "main", exchangeInProgress: true },
  });
  const result = await setup.runner.run({
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "EXCHANGE_LIVE_LOCAL_PREFLIGHT_BLOCKED");
  assert.equal(result.evidence.exchangeOperationIdle, false);
  assert.equal(result.evidence.actionDispatchedOnce, false);
  assert.equal(setup.exchangeCalls(), 0);
});

test("Exchange live runner refuses protected Exchange inventory before movement or mutation", async () => {
  const setup = makeSetup({
    protected: true,
    protections: ["RESERVED"],
  });
  const result = await setup.runner.run({
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "EXCHANGE_LIVE_SAFE_ITEM_NOT_FOUND");
  assert.equal(result.evidence.itemUnprotectedBefore, false);
  assert.equal(setup.travelCalls(), 0);
  assert.equal(setup.exchangeCalls(), 0);
});

test("Exchange live runner requires explicit exact item and slot", async () => {
  const setup = makeSetup();
  const result = await setup.runner.run({
    itemName: "",
    itemSlot: -1,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "EXCHANGE_LIVE_EXPLICIT_ITEM_AND_SLOT_REQUIRED");
  assert.equal(setup.travelCalls(), 0);
  assert.equal(setup.exchangeCalls(), 0);
});

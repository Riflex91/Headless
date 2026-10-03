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
      "market-trading-controller.lib.ts",
    ),
  ).MarketTradingController;
}

function setup({
  openStatus = "CONFIRMED",
  listStatus = "CONFIRMED",
  unlistStatus = "CONFIRMED",
  closeStatus = "CONFIRMED",
  settleOpen = true,
  settleList = true,
  settleUnlist = true,
  settleClose = true,
  standInitiallyOpen = false,
  quantity = 5,
} = {}) {
  const MarketTradingController = loadController();
  const state = {
    stand: standInitiallyOpen,
    quantity,
    tradeSlots: {},
  };
  let now = 1000;
  let pending = [];
  const counts = {
    open: 0,
    list: 0,
    unlist: 0,
    close: 0,
  };

  function applyPending() {
    const operations = pending;
    pending = [];
    for (const operation of operations) {
      if (operation.type === "OPEN") {
        state.stand = true;
      } else if (operation.type === "LIST") {
        state.quantity -= 1;
        state.tradeSlots[operation.slot] = {
          name: "hpot0",
          q: 1,
          price: operation.price,
        };
      } else if (operation.type === "UNLIST") {
        delete state.tradeSlots[operation.slot];
        state.quantity += 1;
      } else if (operation.type === "CLOSE") {
        state.stand = false;
      }
    }
  }

  const game = {
    character() {
      return {
        name: "My_Merchant",
        ctype: "merchant",
        map: "main",
        x: 0,
        y: 0,
        hp: 100,
        maxHp: 100,
        mp: 100,
        maxMp: 100,
        level: 58,
        xp: 0,
        attack: 0,
        frequency: 0,
        armor: 0,
        resistance: 0,
        range: 0,
        gold: 1000,
        target: null,
        rip: false,
        moving: false,
        stand: state.stand,
      };
    },
    inventory() {
      return [
        {
          slot: 0,
          item:
            state.quantity > 0
              ? {
                  name: "hpot0",
                  q: state.quantity,
                }
              : null,
        },
        {
          slot: 1,
          item: { name: "stand0" },
        },
        {
          slot: 2,
          item: null,
        },
      ];
    },
    tradeSlots() {
      return { ...state.tradeSlots };
    },
    gameData() {
      return {
        items: {
          hpot0: { type: "pot", g: 20, s: true },
          mpot0: { type: "pot", g: 20, s: true },
          stand0: { type: "stand", stand: "stand0" },
        },
      };
    },
  };

  const actions = {
    async openStand() {
      counts.open += 1;
      if (settleOpen) pending.push({ type: "OPEN" });
      return { id: "open-1", status: openStatus };
    },
    async tradeList(request) {
      counts.list += 1;
      assert.equal(request.inventorySlot, 0);
      assert.equal(request.slot, "trade1");
      assert.equal(request.quantity, 1);
      assert.equal(request.price, 100000000);
      if (settleList) {
        pending.push({
          type: "LIST",
          slot: request.slot,
          price: request.price,
        });
      }
      return { id: "list-1", status: listStatus };
    },
    async tradeUnlist(request) {
      counts.unlist += 1;
      if (settleUnlist) {
        pending.push({ type: "UNLIST", slot: request.slot });
      }
      return { id: "unlist-1", status: unlistStatus };
    },
    async closeStand() {
      counts.close += 1;
      if (settleClose) pending.push({ type: "CLOSE" });
      return { id: "close-1", status: closeStatus };
    },
  };

  const controller = new MarketTradingController(game, actions, {
    now: () => now,
    pollMs: 10,
    settlementTimeoutMs: 50,
    sleep: async (ms) => {
      now += ms;
      applyPending();
    },
  });

  return {
    controller,
    state,
    counts,
  };
}

test("market trading lists and unlists exactly once and restores baseline", async () => {
  const { controller, counts } = setup();
  const result = await controller.roundTrip("market-live-1");

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MARKET_TRADING_ROUND_TRIP_SETTLED");
  assert.equal(result.itemName, "hpot0");
  assert.equal(result.tradeSlot, "trade1");
  assert.equal(result.listingPrice, 100000000);
  assert.equal(result.openStand.settled, true);
  assert.equal(result.list.settled, true);
  assert.equal(result.unlist.settled, true);
  assert.equal(result.closeStand.settled, true);
  assert.equal(result.listingObserved, true);
  assert.equal(result.tradeSlotCleared, true);
  assert.equal(result.itemBaselineRestored, true);
  assert.equal(result.standBaselineRestored, true);
  assert.equal(result.blindRetryPerformed, false);
  assert.equal(result.foreignTradeMutationPerformed, false);
  assert.deepEqual(counts, {
    open: 1,
    list: 1,
    unlist: 1,
    close: 1,
  });
});

test("market trading reconciles UNKNOWN list from state without retry", async () => {
  const { controller, counts } = setup({ listStatus: "UNKNOWN" });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.list.actionStatus, "UNKNOWN");
  assert.equal(result.list.settled, true);
  assert.equal(result.blindRetryPerformed, false);
  assert.equal(counts.list, 1);
  assert.equal(counts.unlist, 1);
});

test("unresolved UNKNOWN list stops before unlist and closes stand", async () => {
  const { controller, counts, state } = setup({
    listStatus: "UNKNOWN",
    settleList: false,
  });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "MARKET_TRADING_LIST_OUTCOME_UNKNOWN");
  assert.equal(counts.list, 1);
  assert.equal(counts.unlist, 0);
  assert.equal(counts.close, 1);
  assert.equal(state.stand, false);
  assert.equal(result.blindRetryPerformed, false);
});

test("unresolved UNKNOWN unlist never retries and closes stand", async () => {
  const { controller, counts, state } = setup({
    unlistStatus: "UNKNOWN",
    settleUnlist: false,
  });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "MARKET_TRADING_UNLIST_OUTCOME_UNKNOWN");
  assert.equal(counts.list, 1);
  assert.equal(counts.unlist, 1);
  assert.equal(counts.close, 1);
  assert.equal(state.stand, false);
  assert.equal(result.blindRetryPerformed, false);
});

test("market trading refuses an already-open stand baseline", async () => {
  const { controller, counts } = setup({ standInitiallyOpen: true });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MARKET_TRADING_REQUIRES_CLOSED_STAND_BASELINE");
  assert.deepEqual(counts, {
    open: 0,
    list: 0,
    unlist: 0,
    close: 0,
  });
});

test("market trading requires an empty inventory slot before listing", async () => {
  const MarketTradingController = loadController();
  const game = {
    character: () => ({
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      mp: 100,
      maxMp: 100,
      level: 58,
      xp: 0,
      attack: 0,
      frequency: 0,
      armor: 0,
      resistance: 0,
      range: 0,
      gold: 1000,
      target: null,
      rip: false,
      moving: false,
      stand: false,
    }),
    inventory: () => [
      { slot: 0, item: { name: "hpot0", q: 5 } },
      { slot: 1, item: { name: "stand0" } },
    ],
    tradeSlots: () => ({}),
    gameData: () => ({
      items: {
        hpot0: { type: "pot", g: 20 },
        stand0: { type: "stand", stand: "stand0" },
      },
    }),
  };
  const actions = {
    openStand: async () => ({ id: "open", status: "CONFIRMED" }),
    closeStand: async () => ({ id: "close", status: "CONFIRMED" }),
    tradeList: async () => ({ id: "list", status: "CONFIRMED" }),
    tradeUnlist: async () => ({ id: "unlist", status: "CONFIRMED" }),
  };

  const result = await new MarketTradingController(game, actions).roundTrip();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MARKET_TRADING_REQUIRES_EMPTY_INVENTORY_SLOT");
});

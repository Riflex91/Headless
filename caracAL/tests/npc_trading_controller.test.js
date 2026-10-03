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
      "npc-trading-controller.lib.ts",
    ),
  );
}

function setup({
  travelStatus = "CONFIRMED",
  buyStatus = "DISPATCHED",
  sellStatus = "DISPATCHED",
  settleBuy = true,
  settleSell = true,
  initialGold = 1000,
  initialQuantity = 5,
} = {}) {
  const { NpcTradingController } = loadController();
  const state = {
    gold: initialGold,
    quantity: initialQuantity,
    map: "main",
  };
  let now = 1000;
  let pending = null;
  let travelCalls = 0;
  let travelDestination = null;
  let buyCalls = 0;
  let sellCalls = 0;

  const inventory = () => [
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
      item: null,
    },
  ];

  const game = {
    character() {
      return {
        name: "My_Merchant",
        ctype: "merchant",
        map: state.map,
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
        gold: state.gold,
        target: null,
        rip: false,
        moving: false,
      };
    },
    inventory,
    gameData() {
      return {
        items: {
          hpot0: { name: "hpot0", g: 20 },
          mpot0: { name: "mpot0", g: 20 },
        },
      };
    },
  };

  const movement = {
    async smart(request) {
      travelCalls += 1;
      travelDestination = request.destination;
      if (travelStatus === "CONFIRMED") {
        state.map = "main";
      }
      return {
        id: "move-1",
        status: travelStatus,
      };
    },
  };

  const actions = {
    async buy(request) {
      buyCalls += 1;
      if (settleBuy) {
        pending = {
          type: "BUY",
          amount: request.quantity,
          price: 20,
        };
      }
      return {
        id: "buy-1",
        status: buyStatus,
      };
    },
    async sell(request) {
      sellCalls += 1;
      if (settleSell) {
        pending = {
          type: "SELL",
          amount: request.quantity,
          proceeds: 12,
        };
      }
      return {
        id: "sell-1",
        status: sellStatus,
      };
    },
  };

  const controller = new NpcTradingController(game, actions, movement, {
    now: () => now,
    pollMs: 10,
    settlementTimeoutMs: 50,
    sleep: async (ms) => {
      now += ms;
      if (!pending) return;
      if (pending.type === "BUY") {
        state.quantity += pending.amount;
        state.gold -= pending.amount * pending.price;
      } else {
        state.quantity -= pending.amount;
        state.gold += pending.amount * pending.proceeds;
      }
      pending = null;
    },
  });

  return {
    controller,
    state,
    counts: () => ({ travelCalls, buyCalls, sellCalls }),
    travelDestination: () => travelDestination,
  };
}

test("NPC trade round trip buys and sells exactly once with bounded cost", async () => {
  const { controller, counts, travelDestination } = setup();
  const result = await controller.roundTrip("npc-live-1");

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "NPC_TRADING_ROUND_TRIP_SETTLED");
  assert.equal(result.itemName, "hpot0");
  assert.equal(result.unitPrice, 20);
  assert.equal(travelDestination(), "potions");
  assert.equal(result.travel.settled, true);
  assert.equal(result.buy.settled, true);
  assert.equal(result.sell.settled, true);
  assert.equal(result.buyGoldDelta, 20);
  assert.equal(result.sellGoldDelta, 12);
  assert.equal(result.netGoldCost, 8);
  assert.equal(result.itemBaselineRestored, true);
  assert.equal(result.blindRetryPerformed, false);
  assert.deepEqual(counts(), {
    travelCalls: 1,
    buyCalls: 1,
    sellCalls: 1,
  });
});

test("NPC trading reconciles UNKNOWN buy from state without retry", async () => {
  const { controller, counts } = setup({ buyStatus: "UNKNOWN" });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.buy.actionStatus, "UNKNOWN");
  assert.equal(result.buy.settled, true);
  assert.equal(result.blindRetryPerformed, false);
  assert.deepEqual(counts(), {
    travelCalls: 1,
    buyCalls: 1,
    sellCalls: 1,
  });
});

test("NPC trading unresolved UNKNOWN buy stops before sell", async () => {
  const { controller, counts } = setup({
    buyStatus: "UNKNOWN",
    settleBuy: false,
  });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "NPC_TRADING_BUY_OUTCOME_UNKNOWN");
  assert.equal(result.sell.actionId, null);
  assert.deepEqual(counts(), {
    travelCalls: 1,
    buyCalls: 1,
    sellCalls: 0,
  });
});

test("NPC trading unresolved UNKNOWN travel stops before value mutation", async () => {
  const { controller, counts } = setup({ travelStatus: "UNKNOWN" });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "NPC_TRADING_TRAVEL_OUTCOME_UNKNOWN");
  assert.deepEqual(counts(), {
    travelCalls: 1,
    buyCalls: 0,
    sellCalls: 0,
  });
});

test("NPC trading times out once instead of retrying unsettled sell", async () => {
  const { controller, counts } = setup({ settleSell: false });
  const result = await controller.roundTrip();

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.reason, "NPC_TRADING_SELL_SETTLEMENT_TIMEOUT");
  assert.equal(result.blindRetryPerformed, false);
  assert.deepEqual(counts(), {
    travelCalls: 1,
    buyCalls: 1,
    sellCalls: 1,
  });
});

test("safe NPC trade item selection uses cheapest allowlisted item", () => {
  const { selectSafeNpcTradeItem } = loadController();
  const selected = selectSafeNpcTradeItem({
    items: {
      hpot0: { name: "hpot0", g: 20 },
      mpot0: { name: "mpot0", g: 10 },
      expensive: { name: "expensive", g: 100000 },
    },
  });

  assert.deepEqual(selected, {
    itemName: "mpot0",
    unitPrice: 10,
  });
});

test("NPC potion items resolve to Adventure Land potions smart-move alias", () => {
  const { npcVendorDestination } = loadController();

  assert.equal(npcVendorDestination("hpot0"), "potions");
  assert.equal(npcVendorDestination("mpot0"), "potions");
  assert.equal(npcVendorDestination("unknown"), null);
});

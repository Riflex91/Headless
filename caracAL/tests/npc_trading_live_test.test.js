"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadRunner() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "npc-trading-live-test.lib.ts",
    ),
  ).NpcTradingLiveTestRunner;
}

function successfulRoundTrip() {
  return {
    outcome: "PASS",
    reason: "NPC_TRADING_ROUND_TRIP_SETTLED",
    itemName: "hpot0",
    unitPrice: 20,
    baseline: {
      characterGold: 1000,
      itemQuantity: 5,
    },
    afterBuy: {
      characterGold: 980,
      itemQuantity: 6,
    },
    final: {
      characterGold: 992,
      itemQuantity: 5,
    },
    travel: {
      actionId: "move-1",
      actionStatus: "CONFIRMED",
      settled: true,
    },
    buy: {
      actionId: "buy-1",
      actionStatus: "CONFIRMED",
      settled: true,
    },
    sell: {
      actionId: "sell-1",
      actionStatus: "CONFIRMED",
      settled: true,
    },
    buyGoldDelta: 20,
    sellGoldDelta: 12,
    netGoldCost: 8,
    itemBaselineRestored: true,
    blindRetryPerformed: false,
  };
}

test("NPC trading live runner requires complete round-trip evidence", async () => {
  let now = 1000;
  const runner = new (loadRunner())({
    npcTrading: {
      async roundTrip(correlationId) {
        assert.equal(correlationId, "npc-live-1");
        return successfulRoundTrip();
      },
    },
    now: () => now++,
  });

  const result = await runner.run({ requestId: "npc-live-1" });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "NPC_TRADING_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.safeItemSelected, true);
  assert.equal(result.evidence.travelDispatchedOnce, true);
  assert.equal(result.evidence.buyDispatchedOnce, true);
  assert.equal(result.evidence.buySettled, true);
  assert.equal(result.evidence.sellDispatchedOnce, true);
  assert.equal(result.evidence.sellSettled, true);
  assert.equal(result.evidence.itemBaselineRestored, true);
  assert.equal(result.evidence.boundedGoldCost, true);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(result.scope.marketTradingMutationAllowed, false);
  assert.equal(result.scope.bankMutationAllowed, false);
});

test("NPC trading live runner preserves UNKNOWN outcome", async () => {
  const roundTrip = successfulRoundTrip();
  roundTrip.outcome = "UNKNOWN";
  roundTrip.reason = "NPC_TRADING_BUY_OUTCOME_UNKNOWN";
  roundTrip.buy.settled = false;
  roundTrip.sell.actionId = null;
  roundTrip.sell.settled = false;
  roundTrip.final = roundTrip.afterBuy;
  roundTrip.itemBaselineRestored = false;

  const runner = new (loadRunner())({
    npcTrading: {
      async roundTrip() {
        return roundTrip;
      },
    },
  });

  const result = await runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "NPC_TRADING_BUY_OUTCOME_UNKNOWN");
  assert.equal(result.evidence.blindRetryAvoided, true);
});

test("NPC trading live runner downgrades incomplete PASS evidence", async () => {
  const roundTrip = successfulRoundTrip();
  roundTrip.sell.actionId = null;

  const runner = new (loadRunner())({
    npcTrading: {
      async roundTrip() {
        return roundTrip;
      },
    },
  });

  const result = await runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "NPC_TRADING_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.sellDispatchedOnce, false);
});

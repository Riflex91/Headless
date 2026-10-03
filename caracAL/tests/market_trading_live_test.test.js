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
      "market-trading-live-test.lib.ts",
    ),
  ).MarketTradingLiveTestRunner;
}

function successfulRoundTrip() {
  return {
    outcome: "PASS",
    reason: "MARKET_TRADING_ROUND_TRIP_SETTLED",
    itemName: "hpot0",
    inventorySlot: 0,
    tradeSlot: "trade1",
    listingPrice: 100000000,
    itemQuantityBefore: 5,
    itemQuantityAfter: 5,
    standInitiallyOpen: false,
    standFinallyOpen: false,
    standOpenedByTest: true,
    standClosedByTest: true,
    openStand: {
      actionId: "open-1",
      actionStatus: "CONFIRMED",
      settled: true,
    },
    list: {
      actionId: "list-1",
      actionStatus: "CONFIRMED",
      settled: true,
    },
    unlist: {
      actionId: "unlist-1",
      actionStatus: "CONFIRMED",
      settled: true,
    },
    closeStand: {
      actionId: "close-1",
      actionStatus: "CONFIRMED",
      settled: true,
    },
    listingObserved: true,
    tradeSlotCleared: true,
    itemBaselineRestored: true,
    standBaselineRestored: true,
    blindRetryPerformed: false,
    foreignTradeMutationPerformed: false,
  };
}

test("market trading live runner confirms complete own-listing round trip", async () => {
  let now = 1000;
  const runner = new (loadRunner())({
    marketTrading: {
      async roundTrip(correlationId) {
        assert.equal(correlationId, "market-live-1");
        return successfulRoundTrip();
      },
    },
    now: () => now++,
  });

  const result = await runner.run({ requestId: "market-live-1" });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MARKET_TRADING_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.safeItemSelected, true);
  assert.equal(result.evidence.standOpened, true);
  assert.equal(result.evidence.listDispatchedOnce, true);
  assert.equal(result.evidence.listingObserved, true);
  assert.equal(result.evidence.unlistDispatchedOnce, true);
  assert.equal(result.evidence.unlistSettled, true);
  assert.equal(result.evidence.tradeSlotCleared, true);
  assert.equal(result.evidence.itemBaselineRestored, true);
  assert.equal(result.evidence.standBaselineRestored, true);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(result.evidence.foreignTradeMutationAvoided, true);
  assert.equal(result.scope.foreignMarketBuyMutationAllowed, false);
  assert.equal(result.scope.foreignMarketSellMutationAllowed, false);
  assert.equal(result.scope.npcTradingMutationAllowed, false);
});

test("market trading live runner preserves UNKNOWN outcome", async () => {
  const roundTrip = successfulRoundTrip();
  roundTrip.outcome = "UNKNOWN";
  roundTrip.reason = "MARKET_TRADING_UNLIST_OUTCOME_UNKNOWN";
  roundTrip.unlist.settled = false;
  roundTrip.tradeSlotCleared = false;
  roundTrip.itemBaselineRestored = false;

  const runner = new (loadRunner())({
    marketTrading: {
      async roundTrip() {
        return roundTrip;
      },
    },
  });

  const result = await runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "MARKET_TRADING_UNLIST_OUTCOME_UNKNOWN");
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(result.evidence.foreignTradeMutationAvoided, true);
});

test("market trading live runner downgrades incomplete PASS evidence", async () => {
  const roundTrip = successfulRoundTrip();
  roundTrip.unlist.actionId = null;

  const runner = new (loadRunner())({
    marketTrading: {
      async roundTrip() {
        return roundTrip;
      },
    },
  });

  const result = await runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MARKET_TRADING_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.unlistDispatchedOnce, false);
});

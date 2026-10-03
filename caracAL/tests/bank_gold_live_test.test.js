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
      "bank-gold-live-test.lib.ts",
    ),
  ).BankGoldLiveTestRunner;
}

function bankStatus(state = "READY") {
  return {
    timestamp: 1000,
    enabled: true,
    state,
    reason:
      state === "READY" ? "BANK_AVAILABLE" : "BANK_TRAVEL_OUTCOME_UNKNOWN",
    roadmapStage: state === "READY" ? "Bank bereit" : "Travel",
    character: {
      name: "My_Merchant",
      map: state === "READY" ? "bank" : "main",
      x: 0,
      y: -37,
      moving: false,
    },
    bank: {
      available: state === "READY",
      gold: state === "READY" ? 11110 : null,
      packs: state === "READY" ? ["items0", "items1"] : [],
    },
    target: {
      map: "bank",
      pack: "items0",
      goldPrice: 0,
      shellPrice: 0,
      source: "bank_packs",
    },
    movement: {
      owner: null,
      mode: "IDLE",
    },
    lastAction: null,
  };
}

function successfulRoundTrip() {
  return {
    outcome: "PASS",
    reason: "BANK_GOLD_ROUND_TRIP_SETTLED",
    amount: 1,
    baseline: {
      characterGold: 100,
      bankGold: 11110,
    },
    deposit: {
      operation: "DEPOSIT",
      outcome: "PASS",
      reason: "BANK_GOLD_DEPOSIT_SETTLED",
      action: {
        id: "deposit-1",
        status: "DISPATCHED",
      },
      evidence: {
        operation: "DEPOSIT",
        amount: 1,
        before: { characterGold: 100, bankGold: 11110 },
        after: { characterGold: 99, bankGold: 11111 },
        characterDelta: 1,
        bankDelta: 1,
        exactSettlement: true,
      },
    },
    withdraw: {
      operation: "WITHDRAW",
      outcome: "PASS",
      reason: "BANK_GOLD_WITHDRAW_SETTLED",
      action: {
        id: "withdraw-1",
        status: "DISPATCHED",
      },
      evidence: {
        operation: "WITHDRAW",
        amount: 1,
        before: { characterGold: 99, bankGold: 11111 },
        after: { characterGold: 100, bankGold: 11110 },
        characterDelta: 1,
        bankDelta: 1,
        exactSettlement: true,
      },
    },
    final: {
      characterGold: 100,
      bankGold: 11110,
    },
    baselineRestored: true,
    blindRetryPerformed: false,
  };
}

function setup({
  travelStates = [bankStatus("READY")],
  roundTrip = successfulRoundTrip(),
} = {}) {
  const BankGoldLiveTestRunner = loadRunner();
  let now = 1000;
  let travelIndex = 0;
  let configOverride = null;
  let roundTripCalls = 0;

  const bankTravel = {
    setConfigOverride(config) {
      configOverride = config;
    },
    clearConfigOverride() {
      configOverride = null;
    },
    status() {
      return travelStates[Math.min(travelIndex, travelStates.length - 1)];
    },
    async tick() {
      const value =
        travelStates[Math.min(travelIndex, travelStates.length - 1)];
      travelIndex += 1;
      return value;
    },
  };

  const bankGold = {
    async roundTrip(options) {
      roundTripCalls += 1;
      return {
        ...roundTrip,
        amount: options.amount,
      };
    },
  };

  const runner = new BankGoldLiveTestRunner({
    bankTravel,
    bankGold,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  return {
    runner,
    getOverride: () => configOverride,
    getRoundTripCalls: () => roundTripCalls,
  };
}

test("bank gold live runner confirms exact deposit/withdraw settlement", async () => {
  const env = setup();
  const result = await env.runner.run({
    requestId: "bank-gold-live-1",
    amount: 1,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "BANK_GOLD_LIVE_E2E_CONFIRMED");
  assert.equal(result.amount, 1);
  assert.equal(result.evidence.bankReady, true);
  assert.equal(result.evidence.depositDispatchedOnce, true);
  assert.equal(result.evidence.depositSettled, true);
  assert.equal(result.evidence.withdrawDispatchedOnce, true);
  assert.equal(result.evidence.withdrawSettled, true);
  assert.equal(result.evidence.baselineRestored, true);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(result.scope.bankGoldMutationAllowed, true);
  assert.equal(result.scope.bankItemMutationAllowed, false);
  assert.equal(result.cleanup.configOverrideCleared, true);
  assert.equal(result.cleanup.goldBaselineRestored, true);
  assert.equal(env.getOverride(), null);
  assert.equal(env.getRoundTripCalls(), 1);
});

test("bank gold live runner stops before mutation when travel is UNKNOWN", async () => {
  const env = setup({
    travelStates: [bankStatus("UNKNOWN")],
  });
  const result = await env.runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "BANK_GOLD_LIVE_BANK_TRAVEL_UNKNOWN");
  assert.equal(result.roundTrip, null);
  assert.equal(env.getRoundTripCalls(), 0);
  assert.equal(result.cleanup.configOverrideCleared, true);
});

test("bank gold live runner propagates unresolved settlement without retry", async () => {
  const roundTrip = successfulRoundTrip();
  roundTrip.outcome = "UNKNOWN";
  roundTrip.reason = "BANK_GOLD_WITHDRAW_OUTCOME_UNKNOWN";
  roundTrip.withdraw.outcome = "UNKNOWN";
  roundTrip.withdraw.evidence = null;
  roundTrip.baselineRestored = false;
  roundTrip.final = { characterGold: 99, bankGold: 11111 };

  const env = setup({ roundTrip });
  const result = await env.runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "BANK_GOLD_WITHDRAW_OUTCOME_UNKNOWN");
  assert.equal(result.evidence.withdrawSettled, false);
  assert.equal(result.evidence.baselineRestored, false);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(env.getRoundTripCalls(), 1);
});

test("bank gold live runner downgrades incomplete PASS evidence", async () => {
  const roundTrip = successfulRoundTrip();
  roundTrip.withdraw.action.id = null;

  const env = setup({ roundTrip });
  const result = await env.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "BANK_GOLD_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.withdrawDispatchedOnce, false);
});

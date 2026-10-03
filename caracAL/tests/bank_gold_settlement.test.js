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
      "bank-gold-settlement.lib.ts",
    ),
  ).BankGoldSettlementController;
}

function setup({
  characterGold = 100,
  bankGold = 50,
  depositStatus = "DISPATCHED",
  withdrawStatus = "DISPATCHED",
  settleDeposit = true,
  settleWithdraw = true,
} = {}) {
  const BankGoldSettlementController = loadController();
  const state = {
    characterGold,
    bankGold,
    bankAvailable: true,
  };
  let now = 1000;
  let pending = null;
  let depositCalls = 0;
  let withdrawCalls = 0;

  const game = {
    character() {
      return {
        name: "My_Merchant",
        ctype: "merchant",
        map: "bank",
        x: 0,
        y: -37,
        hp: 3000,
        maxHp: 3000,
        mp: 1900,
        maxMp: 1900,
        level: 58,
        xp: 0,
        attack: 0,
        frequency: 0,
        armor: 0,
        resistance: 0,
        range: 0,
        gold: state.characterGold,
        target: null,
        rip: false,
        moving: false,
      };
    },
    bank() {
      return {
        available: state.bankAvailable,
        gold: state.bankGold,
        packs: [{ name: "items0", items: [] }],
        access: [],
      };
    },
  };

  const actions = {
    async bankDepositGold(request) {
      depositCalls += 1;
      if (settleDeposit) {
        pending = {
          operation: "DEPOSIT",
          amount: request.amount,
        };
      }
      return {
        id: "deposit-1",
        status: depositStatus,
      };
    },
    async bankWithdrawGold(request) {
      withdrawCalls += 1;
      if (settleWithdraw) {
        pending = {
          operation: "WITHDRAW",
          amount: request.amount,
        };
      }
      return {
        id: "withdraw-1",
        status: withdrawStatus,
      };
    },
  };

  const controller = new BankGoldSettlementController(game, actions, {
    now: () => now,
    pollMs: 10,
    settlementTimeoutMs: 50,
    sleep: async (ms) => {
      now += ms;
      if (!pending) return;
      if (pending.operation === "DEPOSIT") {
        state.characterGold -= pending.amount;
        state.bankGold += pending.amount;
      } else {
        state.characterGold += pending.amount;
        state.bankGold -= pending.amount;
      }
      pending = null;
    },
  });

  return {
    controller,
    state,
    counts: () => ({ depositCalls, withdrawCalls }),
  };
}

test("bank gold round trip settles delayed deposit and withdraw exactly once", async () => {
  const { controller, counts } = setup();
  const result = await controller.roundTrip({
    amount: 1,
    correlationId: "bank-gold-live-1",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "BANK_GOLD_ROUND_TRIP_SETTLED");
  assert.equal(result.deposit.outcome, "PASS");
  assert.equal(result.withdraw.outcome, "PASS");
  assert.equal(result.deposit.evidence.exactSettlement, true);
  assert.equal(result.withdraw.evidence.exactSettlement, true);
  assert.equal(result.baselineRestored, true);
  assert.equal(result.blindRetryPerformed, false);
  assert.deepEqual(counts(), { depositCalls: 1, withdrawCalls: 1 });
});

test("bank gold reconciles an UNKNOWN action from exact state without retry", async () => {
  const { controller, counts } = setup({ depositStatus: "UNKNOWN" });
  const result = await controller.roundTrip({ amount: 1 });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.deposit.action.status, "UNKNOWN");
  assert.equal(result.deposit.evidence.exactSettlement, true);
  assert.equal(result.baselineRestored, true);
  assert.equal(result.blindRetryPerformed, false);
  assert.deepEqual(counts(), { depositCalls: 1, withdrawCalls: 1 });
});

test("unresolved UNKNOWN deposit stops before withdraw and never retries", async () => {
  const { controller, counts } = setup({
    depositStatus: "UNKNOWN",
    settleDeposit: false,
  });
  const result = await controller.roundTrip({ amount: 1 });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "BANK_GOLD_DEPOSIT_OUTCOME_UNKNOWN");
  assert.equal(result.withdraw, null);
  assert.equal(result.blindRetryPerformed, false);
  assert.deepEqual(counts(), { depositCalls: 1, withdrawCalls: 0 });
});

test("unsettled dispatched deposit times out before withdraw", async () => {
  const { controller, counts } = setup({ settleDeposit: false });
  const result = await controller.roundTrip({ amount: 1 });

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.reason, "BANK_GOLD_DEPOSIT_SETTLEMENT_TIMEOUT");
  assert.equal(result.withdraw, null);
  assert.deepEqual(counts(), { depositCalls: 1, withdrawCalls: 0 });
});

test("bank gold round trip rejects unavailable bank state before mutation", async () => {
  const { controller, state, counts } = setup();
  state.bankAvailable = false;

  await assert.rejects(
    controller.roundTrip({ amount: 1 }),
    /requires visible bank state/,
  );
  assert.deepEqual(counts(), { depositCalls: 0, withdrawCalls: 0 });
});

test("bank gold round trip requires sufficient character gold", async () => {
  const { controller, counts } = setup({ characterGold: 0 });

  await assert.rejects(
    controller.roundTrip({ amount: 1 }),
    /requires sufficient character gold/,
  );
  assert.deepEqual(counts(), { depositCalls: 0, withdrawCalls: 0 });
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadLedgerModule() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "action-ledger.lib.ts",
    ),
  );
}

test("action ledger records dispatch and confirmation evidence", () => {
  const { ActionLedger } = loadLedgerModule();
  let now = 1000;
  const events = [];
  const ledger = new ActionLedger({
    now: () => now,
    nextActionId: () => "A-1",
    nextCorrelationId: () => "C-1",
    emit: (event) => events.push(event),
  });

  const action = ledger.create({
    module: "CombatController",
    action: "ATTACK",
    why: "SAFE_TARGET",
    expectedCost: { mp: 0 },
    expectedEffect: { damage: true },
    before: { targetHp: 100 },
  });

  assert.equal(action.status, null);
  assert.equal(action.id, "A-1");
  assert.equal(action.correlationId, "C-1");

  now = 1100;
  const dispatched = ledger.dispatch(action.id, { packet: "sent" });
  assert.equal(dispatched.status, "DISPATCHED");
  assert.equal(dispatched.dispatchedAt, 1100);

  now = 1300;
  const confirmed = ledger.confirm(action.id, {
    why: "TARGET_HP_DECREASED",
    after: { targetHp: 70 },
    evidence: { hpDelta: -30 },
  });

  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.durationMs, 200);
  assert.deepEqual(confirmed.after, { targetHp: 70 });
  assert.deepEqual(confirmed.evidence, { hpDelta: -30 });
  assert.deepEqual(
    events.map((event) => event.type),
    ["ACTION_INTENT", "ACTION_DISPATCHED", "ACTION_CONFIRMED"],
  );
});

test("emergency stop blocks new action before dispatch", () => {
  const { ActionLedger } = loadLedgerModule();
  const events = [];
  const ledger = new ActionLedger({
    now: () => 1000,
    nextActionId: () => "A-stop",
    nextCorrelationId: () => "C-stop",
    isEmergencyStopActive: () => true,
    emit: (event) => events.push(event),
  });

  const action = ledger.create({
    module: "Economy",
    action: "BUY",
    why: "RESTOCK",
  });

  assert.equal(action.status, "BLOCKED");
  assert.equal(action.dispatchedAt, undefined);
  assert.equal(events.at(-1).type, "ACTION_BLOCKED");
  assert.equal(events.at(-1).why, "EMERGENCY_STOP_ACTIVE");
});

test("emergency stop can allow an explicit safety action", () => {
  const { ActionLedger } = loadLedgerModule();
  const ledger = new ActionLedger({
    now: () => 1000,
    nextActionId: () => "A-cancel",
    nextCorrelationId: () => "C-cancel",
    isEmergencyStopActive: () => true,
    allowDuringEmergencyStop: (action) => action === "MOVEMENT_CANCEL",
  });

  const action = ledger.create({
    module: "Movement",
    action: "MOVEMENT_CANCEL",
    why: "EMERGENCY_STOP",
  });

  assert.equal(action.status, null);
  const dispatched = ledger.dispatch(action.id);
  assert.equal(dispatched.status, "DISPATCHED");
});

test("emergency stop can block pending action at dispatch time", () => {
  const { ActionLedger } = loadLedgerModule();
  let stopped = false;
  const ledger = new ActionLedger({
    now: () => 1000,
    nextActionId: () => "A-late",
    nextCorrelationId: () => "C-late",
    isEmergencyStopActive: () => stopped,
  });

  const action = ledger.create({
    module: "Merchant",
    action: "SEND_ITEM",
    why: "FARMER_SUPPLY",
  });

  stopped = true;
  const blocked = ledger.dispatch(action.id);

  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.dispatchedAt, undefined);
});

test("dispatched actions cannot be relabeled BLOCKED", () => {
  const { ActionLedger } = loadLedgerModule();
  const ledger = new ActionLedger({
    now: () => 1000,
    nextActionId: () => "A-dispatched",
    nextCorrelationId: () => "C-dispatched",
  });

  const action = ledger.create({
    module: "Trade",
    action: "SEND_GOLD",
    why: "CONTROLLED_TRANSFER",
  });
  ledger.dispatch(action.id);

  assert.throws(
    () => ledger.block(action.id, "EMERGENCY_STOP_AFTER_DISPATCH"),
    /cannot block from DISPATCHED/,
  );
  assert.equal(ledger.get(action.id).status, "DISPATCHED");
});

test("UNKNOWN actions reject blind retry", () => {
  const { ActionLedger } = loadLedgerModule();
  const ledger = new ActionLedger({
    now: () => 1000,
    nextActionId: () => "A-unknown",
    nextCorrelationId: () => "C-unknown",
  });

  const action = ledger.create({
    module: "Bank",
    action: "DEPOSIT_ITEM",
    why: "INVENTORY_PRESSURE",
  });
  ledger.dispatch(action.id);
  ledger.unknown(action.id, {
    why: "POST_STATE_UNVERIFIABLE",
    evidence: { timeout: true },
  });

  assert.equal(ledger.canRetry(action.id), false);
  assert.throws(
    () => ledger.assertRetryAllowed(action.id),
    /must not be retried blindly/,
  );
});

test("rejected and blocked actions are explicitly retryable", () => {
  const { ActionLedger } = loadLedgerModule();
  let actionId = 0;
  const ledger = new ActionLedger({
    now: () => 1000,
    nextActionId: () => `A-${++actionId}`,
    nextCorrelationId: () => `C-${actionId}`,
  });

  const rejected = ledger.create({
    module: "Exchange",
    action: "EXCHANGE",
    why: "SAFE_TEST",
  });
  ledger.dispatch(rejected.id);
  ledger.reject(rejected.id, { why: "SERVER_REJECTED" });
  assert.equal(ledger.canRetry(rejected.id), true);
  assert.doesNotThrow(() => ledger.assertRetryAllowed(rejected.id));

  const blocked = ledger.create({
    module: "Movement",
    action: "MOVE",
    why: "WAIT_FOR_OWNER",
  });
  ledger.block(blocked.id, "ARBITRATION_BLOCK");
  assert.equal(ledger.canRetry(blocked.id), true);
});

test("OutcomeTransaction is a narrow status transition wrapper", () => {
  const { ActionLedger, OutcomeTransaction } = loadLedgerModule();
  let now = 1000;
  const ledger = new ActionLedger({
    now: () => now,
    nextActionId: () => "A-tx",
    nextCorrelationId: () => "C-tx",
  });

  const action = ledger.create({
    module: "Test",
    action: "CONTROLLED_MUTATION",
    why: "TEST",
  });
  const tx = new OutcomeTransaction(ledger, action.id);

  tx.dispatch({ request: "sent" });
  now = 1200;
  const result = tx.confirmed({
    why: "POSTCONDITION_MATCHED",
    after: { ok: true },
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.durationMs, 200);
});

test(
  "action authorization blocks governed intent before dispatch and records policy metadata",
  () => {
    const { ActionLedger } = loadLedgerModule();
    const events = [];
    const ledger = new ActionLedger({
      now: () => 1000,
      nextActionId: () => "A-policy",
      nextCorrelationId: () => "C-policy",
      authorizeIntent: (intent) =>
        intent.module === "MerchantFishingController"
          ? {
              allowed: false,
              reason: "ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED",
              data: {
                lane: "BACKGROUND",
                selectedLane: "MERRIT",
                arbiterState: "READY",
              },
            }
          : null,
      emit: (event) => events.push(event),
    });

    const blocked = ledger.create({
      module: "MerchantFishingController",
      action: "SKILL",
      why: "FISHING_EXECUTE_SKILL",
      metadata: { skill: "fishing" },
    });

    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.dispatchedAt, undefined);
    assert.deepEqual(blocked.metadata.policyBlock, {
      reason: "ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED",
      lane: "BACKGROUND",
      selectedLane: "MERRIT",
      arbiterState: "READY",
    });
    assert.equal(events.at(-1).type, "ACTION_BLOCKED");
    assert.equal(
      events.at(-1).why,
      "ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED",
    );

    const ungoverned = ledger.create({
      module: "CombatController",
      action: "ATTACK",
      why: "SAFE_TARGET",
    });
      assert.equal(ungoverned.status, null);
  },
);

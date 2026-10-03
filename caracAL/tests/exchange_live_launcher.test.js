"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  verifyExchangeLiveResult,
} = require("../scripts/run_exchange_live_e2e");

function passResult() {
  return {
    outcome: "PASS",
    reason: "EXCHANGE_LIVE_E2E_CONFIRMED",
    target: {
      itemName: "marketparcel",
      itemSlot: 41,
      requiredQuantity: 1,
    },
    before: {
      item: {
        slot: 41,
        name: "marketparcel",
        level: 0,
        quantity: 1,
        property: null,
        present: true,
      },
      totalQuantity: 1,
    },
    after: {
      item: {
        slot: 41,
        name: null,
        level: null,
        quantity: 0,
        property: null,
        present: false,
      },
      totalQuantity: 0,
    },
    exchange: {
      lastAction: {
        id: "A-EXCHANGE-1",
        status: "CONFIRMED",
        exchangeSucceeded: true,
      },
    },
    evidence: {
      inventoryIntelligenceReady: true,
      itemDefinitionExchangeable: true,
      exactItemObserved: true,
      quantitySufficient: true,
      itemUnprotectedBefore: true,
      exactCandidateSelected: true,
      stationLocated: true,
      stationId: "exchange",
      stationMap: "main",
      stationX: -25,
      stationY: -478,
      stationDistanceBefore: 318,
      stationTravelRequired: true,
      stationTravelConfirmed: true,
      stationTravelActionId: "A-MOVE-1",
      stationTravelStatus: "CONFIRMED",
      stationDistanceAfter: 0,
      stationProximityReady: true,
      movementIdleBeforeDispatch: true,
      localPreflightReadOnly: true,
      exchangeOperationIdle: true,
      itemLockClear: true,
      mapAllowsExchange: true,
      itemStillExactBeforeDispatch: true,
      quantityStillSufficientBeforeDispatch: true,
      exactCandidateStillSelected: true,
      actionDispatchedOnce: true,
      actionConfirmed: true,
      exchangeSucceeded: true,
      itemStateChanged: true,
      quantityConsumed: true,
      mutationObserved: true,
      blindRetryAvoided: true,
    },
    scope: {
      movementMutationAllowed: true,
      upgradeMutationAllowed: false,
      compoundMutationAllowed: false,
      exchangeMutationAllowed: true,
      craftMutationAllowed: false,
      irreversibleMutation: true,
      blindRetryAllowed: false,
      mutationScope: "single-exchange-attempt-only",
    },
    cleanup: {
      inventoryConfigOverrideCleared: true,
      exchangeConfigOverrideCleared: true,
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
  };
}

test("Exchange live launcher independently confirms complete PASS evidence", () => {
  const result = verifyExchangeLiveResult(passResult(), {
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "EXCHANGE_LIVE_E2E_CONFIRMED");
  assert.equal(result.verifier.explicitTargetObserved, true);
  assert.equal(result.verifier.stationReady, true);
  assert.equal(result.verifier.localPreflightReady, true);
  assert.equal(result.verifier.actionDispatchedOnce, true);
  assert.equal(result.verifier.actionConfirmed, true);
  assert.equal(result.verifier.quantityConsumed, true);
  assert.equal(result.verifier.cleanupComplete, true);
  assert.equal(result.verifier.scopeRestricted, true);
});

test("Exchange live launcher rejects missing station readiness evidence", () => {
  const source = passResult();
  source.evidence.stationProximityReady = false;

  const result = verifyExchangeLiveResult(source, {
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "EXCHANGE_LIVE_E2E_EVIDENCE_INCOMPLETE");
  assert.equal(result.verifier.stationReady, false);
});

test("Exchange live launcher rejects missing local preflight evidence", () => {
  const source = passResult();
  source.evidence.exchangeOperationIdle = false;

  const result = verifyExchangeLiveResult(source, {
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.verifier.localPreflightReady, false);
});

test("Exchange live launcher requires observed quantity consumption", () => {
  const source = passResult();
  source.after.totalQuantity = 1;
  source.evidence.quantityConsumed = false;

  const result = verifyExchangeLiveResult(source, {
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.verifier.quantityConsumed, false);
});

test("Exchange live launcher preserves UNKNOWN no-retry evidence", () => {
  const source = passResult();
  source.outcome = "UNKNOWN";
  source.reason = "EXCHANGE_LIVE_OUTCOME_UNKNOWN_NO_RETRY";
  source.exchange.lastAction.status = "UNKNOWN";
  source.evidence.actionConfirmed = false;
  source.evidence.quantityConsumed = false;
  source.evidence.mutationObserved = false;
  source.after.totalQuantity = 1;

  const result = verifyExchangeLiveResult(source, {
    itemName: "marketparcel",
    itemSlot: 41,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "EXCHANGE_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(result.verifier.blindRetryAvoided, true);
});

test("Exchange live wiring stays explicit and single-attempt only", () => {
  const root = path.join(__dirname, "..");
  const thread = fs.readFileSync(
    path.join(root, "src", "CharacterThread.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const runtime = fs.readFileSync(
    path.join(root, "TYPECODE", "bot", "core", "runtime-kernel.lib.ts"),
    "utf8",
  );
  const liveRunner = fs.readFileSync(
    path.join(root, "TYPECODE", "bot", "core", "exchange-live-test.lib.ts"),
    "utf8",
  );

  assert.match(thread, /case "exchange_live_test"/);
  assert.match(thread, /runExchangeLiveTest/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/exchange/,
  );
  assert.match(coordinator, /run_exchange_live_test/);
  assert.match(coordinator, /single-exchange-attempt-only/);
  assert.match(runtime, /EXCHANGE_LIVE_TEST_STARTED/);
  assert.match(runtime, /runExchangeLiveTest/);
  assert.match(runtime, /movement: this\.movement/);
  assert.match(liveRunner, /executionAttempts \+= 1/);
  assert.equal(
    (liveRunner.match(/exchange\.executeNext\(\)/g) || []).length,
    1,
  );
  assert.match(liveRunner, /EXCHANGE_LIVE_OUTCOME_UNKNOWN_NO_RETRY/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineLogisticsLiveTestResult,
  logisticsLiveTestDiagnostics,
  logisticsLiveTestEvidence,
} = require("../src/LogisticsLiveTest");
const { MerchantLogisticsPlanner } = require("../src/MerchantLogisticsPlanner");

function runtimeEvents() {
  return [
    {
      source: "bot_runtime",
      module: "LogisticsLiveTest",
      type: "LOGISTICS_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "LogisticsLiveTest",
      type: "LOGISTICS_LIVE_TEST_COMPLETED",
      data: {
        result: {
          inventory: {
            state: "READY",
            allEntriesExplained: true,
            unknownItemsProtected: true,
          },
          safetyProbe: {
            outcome: "BLOCKED",
            reason: "CLAIM_SELF_TRANSFER_BLOCKED",
            actionId: null,
          },
        },
      },
    },
  ];
}

test("logistics supervisor evidence accepts a real empty claim board without forcing value mutations", () => {
  const evidence = logisticsLiveTestEvidence(runtimeEvents(), {
    board: {
      merchantIndependent: true,
      merchants: [{ name: "My_Merchant", live: true }],
      claims: [],
      suppressed: [],
    },
    planner: {
      transferHistory: [],
      outcomeHolds: [],
    },
    account: {
      merchantCount: 1,
      farmerCount: 3,
    },
    execution: {
      readyClaims: 0,
      configEligibleClaims: 0,
      dispatchableClaims: 0,
      emergencyStopActive: false,
    },
    dispatcherSuppressedDuringTest: true,
  });

  assert.equal(evidence.claimsObserved, false);
  assert.equal(evidence.claimsNotForced, true);
  assert.equal(evidence.unknownNoRetryNotForced, true);

  const combined = combineLogisticsLiveTestResult(
    {
      outcome: "PASS",
      reason: "LOGISTICS_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );
  assert.equal(combined.outcome, "PASS");
  assert.equal(combined.reason, "LOGISTICS_LIVE_E2E_CONFIRMED");
});

test("logistics supervisor proves priority, routing and UNKNOWN no-retry when naturally present", () => {
  const evidence = logisticsLiveTestEvidence(runtimeEvents(), {
    board: {
      merchantIndependent: true,
      merchants: [{ name: "My_Merchant", live: true }],
      claims: [
        {
          id: "POTION_DELIVERY:My_Ranger:My_Merchant:hpot0:",
          type: "POTION_DELIVERY",
          farmer: "My_Ranger",
          merchant: { name: "My_Merchant", live: true },
          priority: 90,
          status: "READY",
          direction: "My_Merchant->My_Ranger",
        },
        {
          id: "GOLD_PICKUP:My_Ranger:My_Merchant::",
          type: "GOLD_PICKUP",
          farmer: "My_Ranger",
          merchant: { name: "My_Merchant", live: true },
          priority: 50,
          status: "READY",
          direction: "My_Ranger->My_Merchant",
        },
      ],
      suppressed: [
        {
          id: "ITEM_DELIVERY:My_Ranger:My_Merchant:computer:",
          status: "SUPPRESSED",
          suppressionReason: "OUTCOME_UNCERTAIN",
        },
        {
          id: "INVENTORY_PRESSURE:My_Ranger:My_Merchant:gem0:0",
          suppressionReason: "ANTI_PINGPONG",
        },
      ],
    },
    planner: {
      transferHistory: [
        {
          itemName: "gem0",
          from: "My_Merchant",
          to: "My_Ranger",
          at: 1000,
        },
      ],
      outcomeHolds: [
        {
          id: "ITEM_DELIVERY:My_Ranger:My_Merchant:computer:",
          outcome: "UNKNOWN",
          reason: "SEND_ITEM_OUTCOME_UNCERTAIN",
          at: 1000,
          retryAt: null,
        },
      ],
    },
    account: {
      merchantCount: 1,
      farmerCount: 3,
    },
    execution: {
      readyClaims: 2,
      configEligibleClaims: 1,
      dispatchableClaims: 1,
      emergencyStopActive: false,
    },
    dispatcherSuppressedDuringTest: true,
  });

  assert.equal(evidence.claimsObserved, true);
  assert.equal(evidence.claimsPriorityOrdered, true);
  assert.equal(evidence.claimRoutingValid, true);
  assert.equal(evidence.antiPingPongSuppressions, 1);
  assert.equal(evidence.unknownNoRetryObserved, true);
  assert.equal(evidence.unknownHoldsSuppressed, true);
});

test("planner diagnostics expose anti-pingpong and uncertain outcome state read-only", () => {
  const planner = new MerchantLogisticsPlanner({ now: () => 1000 });
  planner.recordTransfer({
    itemName: "gem0",
    from: "My_Merchant",
    to: "My_Ranger",
  });
  planner.recordClaimOutcome(
    {
      id: "claim-unknown",
    },
    {
      outcome: "UNKNOWN",
      reason: "SEND_ITEM_OUTCOME_UNCERTAIN",
    },
  );

  const diagnostics = planner.diagnostics();

  assert.equal(diagnostics.transferHistory.length, 1);
  assert.equal(diagnostics.outcomeHolds.length, 1);
  assert.equal(diagnostics.outcomeHolds[0].outcome, "UNKNOWN");
  assert.equal(diagnostics.outcomeHolds[0].retryAt, null);
});

test("logistics diagnostics preserve explicit non-forcing mutation scope", () => {
  const diagnostics = logisticsLiveTestDiagnostics(
    {
      requestId: "logistics-1",
      outcome: "PASS",
      reason: "LOGISTICS_LIVE_E2E_CONFIRMED",
      durationMs: 25,
      character: { name: "My_Merchant", ctype: "merchant" },
      inventory: {
        state: "READY",
        classifiedEntries: 3,
        allEntriesExplained: true,
        unknownItemsProtected: true,
      },
      safetyProbe: {
        outcome: "BLOCKED",
        reason: "CLAIM_SELF_TRANSFER_BLOCKED",
        actionId: null,
      },
      scope: {
        readOnly: true,
        valueMutationForced: false,
        sendItemForced: false,
        sendGoldForced: false,
        mluckForced: false,
        mutationScope: "not forced",
      },
      cleanup: {
        inventoryOverrideCleared: true,
        runtimeStateRestored: true,
        dispatcherRestored: true,
      },
    },
    {
      evidence: {
        claimsObserved: false,
        claimsNotForced: true,
        claimCount: 0,
        readyClaims: 0,
        antiPingPongSuppressions: 0,
        unknownHoldCount: 0,
        unknownNoRetryNotForced: true,
        runtimeTestStarted: true,
        runtimeTestCompleted: true,
        runtimeProbeBlocked: true,
        inventoryProjectionVisible: true,
        inventorySafetyConfirmed: true,
        merchantIndependent: true,
        merchantAccountDetected: true,
        farmerAccountDetected: true,
        claimsPriorityOrdered: true,
        claimRoutingValid: true,
        antiPingPongStateVisible: true,
        unknownHoldsSuppressed: true,
        dispatcherSuppressedDuringTest: true,
      },
    },
  );

  assert.equal(diagnostics.navigation.required, false);
  assert.equal(diagnostics.expected.value_mutation_forced, false);
  assert.equal(diagnostics.observed.claims_not_forced, true);
});

test("coordinator, thread, dashboard and launcher expose autonomous logistics live path", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_logistics_live_e2e.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(coordinator));
  assert.doesNotThrow(() => new Function(dashboard));
  assert.doesNotThrow(() => new Function(thread));
  assert.doesNotThrow(() => new Function(launcher));

  assert.match(coordinator, /run_logistics_live_test/);
  assert.match(coordinator, /logistics_live_test_active/);
  assert.match(coordinator, /LOGISTICS_LIVE_TEST_RESULT_RECEIVED/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/logistics/,
  );
  assert.match(thread, /case "logistics_live_test"/);
  assert.match(thread, /runLogisticsLiveTest/);
  assert.match(launcher, /selectLogisticsLiveTestMerchant/);
  assert.match(launcher, /Stopping temporary caracAL runtime/);
});

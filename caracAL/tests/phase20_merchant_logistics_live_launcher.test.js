"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  evaluatePhase20MerchantLogisticsResult,
  formatCompactResult,
} = require("../scripts/run_phase20_merchant_logistics_live_e2e");

function runtimeSource(name) {
  return {
    name,
    connected: true,
    lifecycleState: "ONLINE",
    desiredRuntimeState: "RUNNING",
    typescriptFile: "bot/main.js",
    lifecycleOnlyProbe: false,
    normalRuntime: true,
  };
}

function bankProbe(id) {
  return {
    ok: true,
    result: {
      bankTravel: {
        state: "READY",
        reason: "BANK_AVAILABLE",
        lastAction: {
          id,
          status: "CONFIRMED",
          destination: "bank",
        },
      },
    },
  };
}

function passingPayload() {
  const farmers = ["My_Mage", "My_Priest", "My_Ranger1"];
  const attackCounts = {
    My_Mage: 3,
    My_Priest: 4,
    My_Ranger1: 5,
  };
  const focusObserved = {
    My_Mage: true,
    My_Priest: true,
    My_Ranger1: true,
  };
  return {
    result: {
      testId: "phase20-integration-live-c",
      phase: "20.0c",
      outcome: "PASS",
      reason: "PHASE20_INTEGRATION_MERCHANT_LOGISTICS_CONFIRMED",
      evidence: {
        merchant: "My_Merchant",
        farmers,
        selectedCharacters: [...farmers, "My_Merchant"],
        allOnline: true,
        allRunning: true,
        normalRuntimeAll: true,
        activeCharacters: 4,
        maxOnlineCharacters: 4,
        slotLimitValid: true,
        runtimeSources: [
          ...farmers.map(runtimeSource),
          runtimeSource("My_Merchant"),
        ],
        groupCombat: {
          apply: { ok: true },
          observed: true,
          partyFormed: true,
          confirmedAttackCount: 12,
          attackCounts,
          unknownAttackCount: 0,
          unknownMovementCount: 0,
          focusObserved,
          movementOwnerValid: true,
          merchantOnlineDuringCombat: true,
          merchantNotInParty: true,
        },
        groupCombatParallel: {
          observed: true,
          partyFormed: true,
          confirmedAttackCount: 12,
          attackCounts,
          unknownAttackCount: 0,
          unknownMovementCount: 0,
          focusObserved,
          movementOwnerValid: true,
          pass: true,
        },
        merchantParallel: {
          autonomousBeforeValid: true,
          logisticsRendezvousValid: true,
          autonomousAfterValid: true,
          merchantOnlineAfter: true,
          merchantNotInParty: true,
          unknownMovementCount: 0,
          processExitCount: 0,
          reconnectCount: 0,
          autonomousBefore: bankProbe("BANK-BEFORE"),
          autonomousAfter: bankProbe("BANK-AFTER"),
        },
        logistics: {
          sourceFarmer: "My_Ranger1",
          sourceGoldAtPlan: 1000,
          merchantIndependent: true,
          dispatchStarted: true,
          settled: true,
          dispatchCount: 1,
          confirmed: true,
          noBlindRetry: true,
          observation: {
            requestId: "logistics-claim-1",
            result: {
              outcome: "CONFIRMED",
              reason: "SEND_GOLD_STATE_CONFIRMED",
              fulfilled: true,
              amount: 1,
              actionId: "A-GOLD-1",
            },
          },
        },
      },
      scope: {
        normalRuntime: true,
        lifecycleOnlyProbe: false,
        lifecycleMutationDispatched: true,
        gameplayMutationForced: true,
        valueMutationForced: true,
        automaticLogisticsDispatchSuppressed: true,
        controlledLogisticsDispatchEnabled: true,
        combatEvidenceRequired: true,
        logisticsEvidenceRequired: true,
        merchantAutonomyEvidenceRequired: true,
      },
      cleanup: {
        groupProbeCleared: true,
        merchantProbeCleared: true,
        logisticsOverridesRestored: true,
        runtimeStateRestored: true,
        originallyRunning: ["My_Merchant"],
        restoredRunning: ["My_Merchant"],
      },
    },
  };
}

test("Phase 20.0c evaluator accepts complete parallel autonomy and logistics evidence", () => {
  const result = evaluatePhase20MerchantLogisticsResult(passingPayload());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.identityValid, true);
  assert.equal(result.runtimeValid, true);
  assert.equal(result.groupValid, true);
  assert.equal(result.merchantValid, true);
  assert.equal(result.logisticsValid, true);
  assert.equal(result.scopeValid, true);
  assert.equal(result.cleanupValid, true);
});

test("Phase 20.0c evaluator rejects UNKNOWN logistics even without a retry", () => {
  const payload = passingPayload();
  payload.result.outcome = "FAIL";
  payload.result.reason = "PHASE20_MERCHANT_LOGISTICS_OUTCOME_UNKNOWN_NO_RETRY";
  payload.result.evidence.logistics.confirmed = false;
  payload.result.evidence.logistics.observation.result = {
    outcome: "UNKNOWN",
    reason: "SEND_GOLD_OUTCOME_UNVERIFIED",
    fulfilled: false,
    amount: 1,
    actionId: "A-GOLD-1",
  };

  const result = evaluatePhase20MerchantLogisticsResult(payload);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.logisticsValid, false);
});

test("Phase 20.0c evaluator requires merchant to resume independent work", () => {
  const payload = passingPayload();
  payload.result.evidence.merchantParallel.autonomousAfterValid = false;
  payload.result.evidence.merchantParallel.autonomousAfter =
    payload.result.evidence.merchantParallel.autonomousBefore;

  const result = evaluatePhase20MerchantLogisticsResult(payload);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.merchantValid, false);
});

test("Phase 20.0c evaluator rejects Merchant party membership or stalled farmers", () => {
  const payload = passingPayload();
  payload.result.evidence.groupCombat.merchantNotInParty = false;
  payload.result.evidence.groupCombatParallel.attackCounts.My_Mage = 0;

  const result = evaluatePhase20MerchantLogisticsResult(payload);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.groupValid, false);
});

test("Phase 20.0c compact output surfaces autonomy, logistics and cleanup gates", () => {
  const output = formatCompactResult(
    evaluatePhase20MerchantLogisticsResult(passingPayload()),
  );

  assert.match(output, /Phase 20\.0c Merchant Parallel Autonomy \+ Logistics/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /Merchant autonomous before: yes/);
  assert.match(output, /Logistics dispatch count: 1/);
  assert.match(output, /Logistics confirmed: yes/);
  assert.match(output, /Merchant autonomous after: yes/);
  assert.match(output, /Runtime state restored: yes/);
});

test("Phase 20.0c source reuses production controllers and a single logistics dispatch", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );

  assert.match(coordinator, /stage === "20\.0c"/);
  assert.match(coordinator, /phase20_apply_logistics_overrides/);
  assert.match(coordinator, /dispatch_merchant_logistics_claim\(\)/);
  assert.match(coordinator, /LOGISTICS_CLAIM_RESULT_TIMEOUT_MS \+ 5000/);
  assert.match(coordinator, /PHASE20_MERCHANT_LOGISTICS_OUTCOME_UNKNOWN_NO_RETRY/);
  assert.match(coordinator, /phase20_restore_runtime_config_overrides/);
  assert.match(thread, /case "phase20_merchant_probe"/);
  assert.match(thread, /runPhase20MerchantProbe/);
  assert.match(kernel, /this\.bankTravel\.tick\(\)/);
  assert.match(kernel, /this\.movement\.smart\(\{/);
  assert.match(kernel, /clearPhase20MerchantProbe/);
  assert.doesNotMatch(coordinator, /send_gold\s*\(/);
  assert.doesNotMatch(coordinator, /send_item\s*\(/);
  assert.doesNotMatch(coordinator, /smart_move\s*\(/);
});

test("Phase 20.0c source keeps dispatch suppressed outside the controlled window", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(coordinator, /phase20_integration_logistics_dispatch_enabled/);
  assert.match(
    coordinator,
    /phase20_integration_live_test_active &&\s*!phase20_integration_logistics_dispatch_enabled/,
  );
  assert.match(coordinator, /phase20_integration_logistics_dispatch_enabled = false/);
});

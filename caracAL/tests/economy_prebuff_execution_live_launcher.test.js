"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  combineEconomyPrebuffExecutionSupervisorResult,
  coupledExecutionEvidence,
  evidenceComplete,
} = require("../scripts/run_economy_prebuff_execution_live_e2e");

function probe(overrides = {}) {
  return {
    requestId: "gear-scoring-live-1-coupled-execution",
    outcome: "PASS",
    reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    beforeArbiter: {
      policy: { enforcementEnabled: false },
    },
    execution: {
      timestamp: 2,
      state: "CONFIRMED",
      reason: "ECONOMY_PREBUFF_COUPLED_EXECUTION_CONFIRMED",
      busy: false,
      correlationId: "corr-1",
      activeLane: null,
      kind: "UPGRADE",
      name: "helmet",
      selectedSkill: "massproductionpp",
      prebuffAction: {
        id: "skill-1",
        status: "CONFIRMED",
        why: "ECONOMY_PREBUFF_COUPLED_EXECUTION",
        error: null,
      },
      economyAction: {
        id: "upgrade-1",
        status: "CONFIRMED",
        why: "UPGRADE_POLICY_SELECTED",
        error: null,
      },
      unknownStage: null,
      policy: {
        explicitOneShot: true,
        arbiterEnforcementRequired: true,
        prebuffMustConfirmBeforeEconomy: true,
        revalidateAfterPrebuff: true,
        maxValueMutations: 1,
        blindRetryAllowed: false,
        supportedKinds: ["UPGRADE", "COMPOUND"],
        exchangeSupported: false,
      },
    },
    evidence: {
      enforcementEnabledObserved: true,
      exactlyOnePrebuffAttempt: true,
      valueMutationAttempted: true,
      maxValueMutationsRespected: true,
      blindRetryAllowed: false,
      unknownHold: null,
      confirmedCoupling: true,
    },
    scope: {
      readOnly: false,
      irreversibleMutationAllowed: true,
      prebuffMutationForced: true,
      valueMutationForced: true,
      maxValueMutations: 1,
      movementMutationForced: false,
      combatMutationForced: false,
      equipmentMutationForced: false,
      upgradeMutationForced: true,
      compoundMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
      logisticsMutationForced: false,
      merchantMutationForced: false,
    },
    restored: {
      policy: { enforcementEnabled: false },
    },
    cleanup: {
      configRestored: true,
      schedulerRestored: true,
    },
    ...overrides,
  };
}

function supervisor(overrides = {}) {
  const coupledExecution = overrides.coupledExecution || probe();
  return {
    request_id: "gear-scoring-live-1",
    outcome: "PASS",
    reason: "GEAR_SCORING_LIVE_RUNTIME_E2E_CONFIRMED",
    character: "My_Merchant",
    before: {},
    after: {
      economyPrebuffExecution: coupledExecution.execution,
    },
    coupledExecution,
    scope: {
      readOnly: false,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: true,
      prebuffMutationForced: true,
      equipmentMutationForced: false,
      runtimeOverrideApplied: true,
      maxValueMutations: 1,
      blindRetryAllowed: false,
      ...(overrides.scope || {}),
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
      ...(overrides.cleanup || {}),
    },
  };
}

test("coupled execution live verifier accepts one confirmed prebuff and one value mutation", () => {
  const evidence = coupledExecutionEvidence(probe());
  const result = combineEconomyPrebuffExecutionSupervisorResult(supervisor());

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.prebuffConfirmed, true);
  assert.equal(evidence.economyConfirmed, true);
  assert.equal(evidence.maxValueMutations, 1);
  assert.equal(evidence.blindRetryAllowed, false);
  assert.equal(result.outcome, "PASS");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
  );
  assert.equal(result.scope.readOnly, false);
  assert.equal(result.scope.maxValueMutations, 1);
});

test("coupled execution live verifier rejects UNKNOWN and never treats it as PASS", () => {
  const unknown = probe({
    outcome: "UNKNOWN",
    reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_OUTCOME_UNKNOWN_NO_RETRY",
    execution: {
      ...probe().execution,
      state: "UNKNOWN_HOLD",
      reason: "ECONOMY_PREBUFF_ECONOMY_OUTCOME_UNKNOWN",
      activeLane: "ECONOMY",
      economyAction: {
        id: "upgrade-unknown",
        status: "UNKNOWN",
        why: "UPGRADE_POLICY_SELECTED",
        error: "outcome uncertain",
      },
      unknownStage: "ECONOMY",
    },
    evidence: {
      ...probe().evidence,
      confirmedCoupling: false,
      unknownHold: "ECONOMY",
    },
  });
  const result = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({ coupledExecution: unknown }),
  );

  assert.equal(result.evidence.probe.noUnknownHold, false);
  assert.equal(result.outcome, "FAIL");
});

test("coupled execution live verifier rejects missing restoration or mutation limits", () => {
  const restoreFailure = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({
      cleanup: {
        equipmentBaselineRestored: true,
        runtimeStateRestored: false,
      },
    }),
  );
  const limitFailure = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({
      scope: {
        maxValueMutations: 2,
      },
    }),
  );

  assert.equal(restoreFailure.outcome, "FAIL");
  assert.equal(limitFailure.outcome, "FAIL");
});

test("coupled execution live wiring uses dedicated IPC and no retry loop", () => {
  const launcher = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "scripts",
      "run_economy_prebuff_execution_live_e2e.js",
    ),
    "utf8",
  );
  const gearLauncher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_gear_scoring_live_e2e.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
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

  assert.match(launcher, /economyPrebuffExecutionLiveTest: true/);
  assert.match(gearLauncher, /economyPrebuffExecutionLiveTest/);
  assert.match(thread, /economy_prebuff_execution_live_test/);
  assert.match(thread, /runEconomyPrebuffExecutionLiveTest/);
  assert.match(coordinator, /economy_prebuff_execution_live_test_requests/);
  assert.match(coordinator, /maxValueMutations: coupled_execution_requested \? 1 : 0/);
  assert.match(kernel, /runEconomyPrebuffExecutionLiveTest/);
  assert.match(kernel, /maxValueMutations: 1/);
  assert.match(kernel, /blindRetryAllowed: false/);
  assert.doesNotMatch(launcher, /while\s*\(/);
  assert.doesNotMatch(launcher, /executeNext/);
});

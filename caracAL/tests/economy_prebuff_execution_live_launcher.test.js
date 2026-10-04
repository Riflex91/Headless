"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineEconomyPrebuffExecutionSupervisorResult,
  coupledExecutionEvidence,
  evidenceComplete,
  parseExpectedSlots,
} = require("../scripts/run_economy_prebuff_execution_live_e2e");

function child(overrides = {}) {
  return {
    requestId: "economy-prebuff-execution-live-1-runtime",
    outcome: "PASS",
    reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    execution: {
      state: "CONFIRMED",
      reason: "ECONOMY_PREBUFF_COUPLED_EXECUTION_CONFIRMED",
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
        maxValueMutations: 1,
        blindRetryAllowed: false,
      },
    },
    evidence: {
      explicitExpectationValid: true,
      riskPolicyReady: true,
      riskPolicyUnknownClear: true,
      expectedCandidateMatched: true,
      prebuffReady: true,
      prebuffDemandMatched: true,
      selectedSkillPresent: true,
      arbiterEnforcementObserved: true,
      prebuffActionConfirmed: true,
      economyActionConfirmed: true,
      exactKindExecuted: true,
      exactNameExecuted: true,
      inventoryMutationObserved: true,
      oneValueMutationMaximum: true,
      blindRetryAvoided: true,
    },
    scope: {
      irreversibleMutation: true,
      prebuffMutationAllowed: true,
      upgradeMutationAllowed: true,
      compoundMutationAllowed: false,
      exchangeMutationAllowed: false,
      craftMutationAllowed: false,
      offeringMutationAllowed: false,
      maxValueMutations: 1,
      blindRetryAllowed: false,
      mutationScope: "single-coupled-prebuff-economy-attempt-only",
    },
    cleanup: {
      arbiterConfigOverrideCleared: true,
      arbiterEnforcementRestored: true,
    },
    ...overrides,
  };
}

function supervisor(overrides = {}) {
  const coupledExecution = overrides.coupledExecution || child();
  return {
    request_id: "economy-prebuff-execution-live-1",
    outcome: "PASS",
    reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    character: "My_Merchant",
    expected: {
      kind: "UPGRADE",
      name: "helmet",
      slots: [2],
    },
    coupledExecution,
    scope: {
      readOnly: false,
      irreversibleMutationAllowed: true,
      prebuffMutationForced: true,
      valueMutationForced: true,
      movementMutationForced: false,
      combatMutationForced: false,
      equipmentMutationForced: false,
      upgradeMutationForced: true,
      compoundMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
      logisticsMutationForced: false,
      maxValueMutations: 1,
      blindRetryAllowed: false,
      runtimeOverrideApplied: true,
      ...(overrides.scope || {}),
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
      ...(overrides.cleanup || {}),
    },
  };
}

test("coupled execution verifier accepts one confirmed expected mutation", () => {
  const evidence = coupledExecutionEvidence(supervisor());
  const result = combineEconomyPrebuffExecutionSupervisorResult(supervisor());

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.expectedCandidateMatched, true);
  assert.equal(evidence.prebuffActionConfirmed, true);
  assert.equal(evidence.economyActionConfirmed, true);
  assert.equal(evidence.inventoryMutationObserved, true);
  assert.equal(evidence.oneValueMutationMaximum, true);
  assert.equal(evidence.blindRetryAvoided, true);
  assert.equal(result.outcome, "PASS");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
  );
});

test("coupled execution verifier rejects UNKNOWN and restoration drift", () => {
  const unknownChild = child({
    outcome: "UNKNOWN",
    reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY",
    execution: {
      ...child().execution,
      state: "UNKNOWN_HOLD",
      unknownStage: "ECONOMY",
      economyAction: {
        ...child().execution.economyAction,
        status: "UNKNOWN",
      },
    },
    evidence: {
      ...child().evidence,
      economyActionConfirmed: false,
      inventoryMutationObserved: false,
    },
  });

  const unknown = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({
      outcome: "UNKNOWN",
      reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY",
      coupledExecution: unknownChild,
    }),
  );
  const restoreFailure = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({
      cleanup: {
        equipmentBaselineRestored: true,
        runtimeStateRestored: false,
      },
    }),
  );

  assert.equal(unknown.outcome, "FAIL");
  assert.equal(unknown.evidence.unknownHoldClear, false);
  assert.equal(restoreFailure.outcome, "FAIL");
  assert.equal(restoreFailure.evidence.runtimeStateRestored, false);
});

test("expected slot parsing is exact and never broadens mutation scope", () => {
  assert.deepEqual(parseExpectedSlots("UPGRADE", "2"), [2]);
  assert.deepEqual(parseExpectedSlots("COMPOUND", "5,3,4"), [3, 4, 5]);
  assert.equal(parseExpectedSlots("UPGRADE", "2,3"), null);
  assert.equal(parseExpectedSlots("COMPOUND", "3,3,4"), null);
  assert.equal(parseExpectedSlots("COMPOUND", "3,4"), null);
});

test("live wiring requires explicit target data and contains no retry loop", () => {
  const launcher = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "scripts",
      "run_economy_prebuff_execution_live_e2e.js",
    ),
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
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const executor = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-prebuff-execution-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(launcher, /<UPGRADE\|COMPOUND> <itemName>/);
  assert.match(launcher, /expectedKind: expected\.kind/);
  assert.match(launcher, /maxValueMutations/);
  assert.doesNotMatch(launcher, /while\s*\(/);
  assert.doesNotMatch(launcher, /executeNext/);

  assert.match(thread, /economy_prebuff_execution_live_test/);
  assert.match(thread, /expectedKind:/);
  assert.match(thread, /expectedName:/);
  assert.match(thread, /expectedSlots:/);

  assert.match(coordinator, /economy_prebuff_execution_live_test_requests/);
  assert.match(coordinator, /expected_kind/);
  assert.match(coordinator, /expected_name/);
  assert.match(coordinator, /expected_slots/);
  assert.match(coordinator, /maxValueMutations: 1/);
  assert.match(coordinator, /blindRetryAllowed: false/);

  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/economy-prebuff-execution/,
  );
  assert.match(dashboard, /expectedKind: req\.body\?\.expectedKind/);

  const prebuffPublish = executor.indexOf(
    'activeLane: "ECONOMY_PREBUFF"',
  );
  const prebuffTick = executor.indexOf("this.arbiter.tick()", prebuffPublish);
  const prebuffAuthorize = executor.indexOf(
    'this.arbiter.authorize("ECONOMY_PREBUFF")',
    prebuffPublish,
  );
  const economyPublish = executor.indexOf('activeLane: "ECONOMY"', prebuffAuthorize);
  const economyTick = executor.indexOf("this.arbiter.tick()", economyPublish);
  const economyAuthorize = executor.indexOf(
    'this.arbiter.authorize("ECONOMY")',
    economyPublish,
  );

  assert.ok(prebuffPublish >= 0);
  assert.ok(prebuffTick > prebuffPublish);
  assert.ok(prebuffAuthorize > prebuffTick);
  assert.ok(economyPublish > prebuffAuthorize);
  assert.ok(economyTick > economyPublish);
  assert.ok(economyAuthorize > economyTick);
});

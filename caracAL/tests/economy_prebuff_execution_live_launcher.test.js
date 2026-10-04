"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CONFIRMATION_TOKEN,
  combineEconomyPrebuffExecutionSupervisorResult,
  coupledExecutionEvidence,
  parseExplicitExpectation,
  passEvidenceComplete,
} = require("../scripts/run_economy_prebuff_execution_live_e2e");

function probe(overrides = {}) {
  return {
    requestId: "gear-scoring-live-1-coupled-execution",
    outcome: "PASS",
    reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    character: "My_Merchant",
    expected: {
      kind: "UPGRADE",
      name: "helmet",
      slots: [2],
    },
    before: {
      riskPolicy: {
        state: "READY",
        selected: {
          kind: "UPGRADE",
          name: "helmet",
          itemSlots: [2],
          decision: "ALLOW",
        },
        summary: { unknown: 0 },
      },
      economyPrebuff: {},
      arbiter: {},
      inventorySignature: "before",
    },
    after: {
      riskPolicy: {},
      economyPrebuff: {},
      arbiter: {},
      inventorySignature: "after",
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
  const coupledExecution = overrides.coupledExecution || probe();
  return {
    request_id: "gear-scoring-live-1",
    outcome: coupledExecution.outcome,
    reason: coupledExecution.reason,
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
      upgradeMutationForced: true,
      compoundMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
      logisticsMutationForced: false,
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

const expected = {
  character: "My_Merchant",
  kind: "UPGRADE",
  name: "helmet",
  slots: [2],
  confirmationToken: CONFIRMATION_TOKEN,
};

test("coupled live CLI requires exact irreversible-mutation confirmation", () => {
  assert.deepEqual(
    parseExplicitExpectation([
      "My_Merchant",
      "UPGRADE",
      "helmet",
      "2",
      CONFIRMATION_TOKEN,
    ]),
    expected,
  );
  assert.throws(
    () =>
      parseExplicitExpectation([
        "My_Merchant",
        "UPGRADE",
        "helmet",
        "2",
        "yes",
      ]),
    /CONFIRM_ONE_MUTATION/,
  );
  assert.throws(
    () =>
      parseExplicitExpectation([
        "My_Merchant",
        "COMPOUND",
        "ringsj",
        "3,4",
        CONFIRMATION_TOKEN,
      ]),
    /Usage:/,
  );
});

test("coupled live verifier accepts only complete one-mutation PASS evidence", () => {
  const evidence = coupledExecutionEvidence(probe(), expected);
  const result = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor(),
    expected,
  );

  assert.equal(passEvidenceComplete(evidence), true);
  assert.equal(result.outcome, "PASS");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
  );
  assert.equal(result.evidence.supervisorReadOnly, false);
  assert.equal(result.evidence.supervisorMaxValueMutations, 1);
  assert.equal(result.evidence.supervisorMutationKindOnly, true);
});

test("coupled live verifier preserves UNKNOWN and no-retry semantics", () => {
  const unknownProbe = probe({
    outcome: "UNKNOWN",
    reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY",
    after: null,
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
      economyActionConfirmed: false,
      inventoryMutationObserved: false,
    },
  });
  const result = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({ coupledExecution: unknownProbe }),
    expected,
  );

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY",
  );
  assert.equal(result.evidence.probe.blindRetryAvoided, true);
});

test("coupled live verifier rejects target drift and broadened mutation scope", () => {
  const targetFailure = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({
      coupledExecution: probe({
        expected: { kind: "UPGRADE", name: "gloves", slots: [2] },
      }),
    }),
    expected,
  );
  const scopeFailure = combineEconomyPrebuffExecutionSupervisorResult(
    supervisor({
      scope: {
        maxValueMutations: 2,
        exchangeMutationForced: true,
      },
    }),
    expected,
  );

  assert.equal(targetFailure.evidence.probe.expectationEchoMatches, false);
  assert.equal(targetFailure.outcome, "FAIL");
  assert.equal(scopeFailure.outcome, "FAIL");
});

test("coupled live wiring carries explicit target and has no retry loop", () => {
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
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(launcher, /CONFIRM_ONE_MUTATION/);
  assert.match(launcher, /expectedKind: expected\.kind/);
  assert.match(launcher, /expectedName: expected\.name/);
  assert.match(launcher, /expectedSlots: expected\.slots/);
  assert.match(gearLauncher, /confirmationToken: options\.confirmationToken/);
  assert.match(thread, /expected_kind/);
  assert.match(thread, /expected_name/);
  assert.match(thread, /expected_slots/);
  assert.match(coordinator, /ECONOMY_PREBUFF_EXECUTION_CONFIRMATION/);
  assert.match(coordinator, /expected_slots: \[\.\.\.expected_slots\]/);
  const supervisorStart = coordinator.indexOf(
    "async function run_gear_scoring_live_test",
  );
  const confirmationGate = coordinator.indexOf(
    "options.confirmationToken !== ECONOMY_PREBUFF_EXECUTION_CONFIRMATION",
    supervisorStart,
  );
  const runtimeRestart = coordinator.indexOf(
    "await restart_character_for_movement_runtime",
    supervisorStart,
  );
  assert.ok(supervisorStart >= 0);
  assert.ok(confirmationGate > supervisorStart);
  assert.ok(runtimeRestart > confirmationGate);
  assert.match(dashboard, /confirmationToken: req\.body\?\.confirmationToken/);
  assert.doesNotMatch(launcher, /while\s*\(/);
  assert.doesNotMatch(launcher, /executeNext/);
});

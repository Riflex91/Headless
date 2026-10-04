"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const {
  readState,
  runGearScoringSupervisorLiveTest,
  waitForGearScoringCharacter,
} = require("./run_gear_scoring_live_e2e");

const CONFIRMATION_TOKEN = "CONFIRM_ONE_MUTATION";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeSlots(kind, value) {
  const expectedCount = kind === "UPGRADE" ? 1 : kind === "COMPOUND" ? 3 : 0;
  const slots = Array.isArray(value)
    ? value.map((slot) => Number(slot))
    : String(value || "")
        .split(",")
        .filter(Boolean)
        .map((slot) => Number(slot));

  const normalized = slots
    .filter(
      (slot) => Number.isInteger(slot) && Number.isFinite(slot) && slot >= 0,
    )
    .sort((left, right) => left - right);

  if (
    expectedCount === 0 ||
    normalized.length !== expectedCount ||
    new Set(normalized).size !== expectedCount
  ) {
    return null;
  }
  return normalized;
}

function sameSlots(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    [...left]
      .sort((a, b) => a - b)
      .every(
        (value, index) => value === [...right].sort((a, b) => a - b)[index],
      )
  );
}

function parseExplicitExpectation(argv) {
  const character = typeof argv[0] === "string" ? argv[0].trim() : "";
  const kind = typeof argv[1] === "string" ? argv[1].trim().toUpperCase() : "";
  const name = typeof argv[2] === "string" ? argv[2].trim() : "";
  const slots = normalizeSlots(kind, argv[3]);
  const confirmationToken = typeof argv[4] === "string" ? argv[4].trim() : "";

  if (
    !character ||
    !["UPGRADE", "COMPOUND"].includes(kind) ||
    !name ||
    !slots ||
    confirmationToken !== CONFIRMATION_TOKEN
  ) {
    throw new Error(
      "Usage: npm run test:live:economy-prebuff-execution -- <character> <UPGRADE|COMPOUND> <itemName> <slot|slot,slot,slot> CONFIRM_ONE_MUTATION",
    );
  }

  return {
    character,
    kind,
    name,
    slots,
    confirmationToken,
  };
}

function coupledExecutionEvidence(value, expected) {
  const probe = record(value);
  const probeExpected = record(probe.expected);
  const execution = record(probe.execution);
  const policy = record(execution.policy);
  const prebuffAction = record(execution.prebuffAction);
  const economyAction = record(execution.economyAction);
  const evidence = record(probe.evidence);
  const scope = record(probe.scope);
  const cleanup = record(probe.cleanup);
  const before = record(probe.before);
  const after = record(probe.after);
  const beforeRisk = record(before.riskPolicy);
  const beforeSelected = record(beforeRisk.selected);

  return {
    probePassed: probe.outcome === "PASS",
    probeUnknown: probe.outcome === "UNKNOWN",
    probeReasonMatches:
      probe.reason === "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    unknownReasonMatches:
      probe.reason === "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY",
    characterMatches:
      typeof probe.character === "string" &&
      probe.character === expected.character,
    expectationEchoMatches:
      probeExpected.kind === expected.kind &&
      probeExpected.name === expected.name &&
      sameSlots(probeExpected.slots, expected.slots),
    riskSelectionMatchesExpectation:
      beforeRisk.state === "READY" &&
      Number(record(beforeRisk.summary).unknown || 0) === 0 &&
      beforeSelected.kind === expected.kind &&
      beforeSelected.name === expected.name &&
      sameSlots(beforeSelected.itemSlots, expected.slots),
    executionConfirmed: execution.state === "CONFIRMED",
    executionKindMatches: execution.kind === expected.kind,
    executionNameMatches: execution.name === expected.name,
    selectedSkillPresent:
      typeof execution.selectedSkill === "string" &&
      execution.selectedSkill.length > 0,
    prebuffConfirmed: prebuffAction.status === "CONFIRMED",
    economyConfirmed: economyAction.status === "CONFIRMED",
    distinctActionIds:
      typeof prebuffAction.id === "string" &&
      typeof economyAction.id === "string" &&
      prebuffAction.id !== economyAction.id,
    noUnknownHold: execution.unknownStage == null,
    explicitOneShot: policy.explicitOneShot === true,
    arbiterEnforcementRequired: policy.arbiterEnforcementRequired === true,
    prebuffMustConfirmBeforeEconomy:
      policy.prebuffMustConfirmBeforeEconomy === true,
    revalidateAfterPrebuff: policy.revalidateAfterPrebuff === true,
    maxValueMutations: Number(policy.maxValueMutations),
    blindRetryAllowed: policy.blindRetryAllowed === true,
    exchangeSupported: policy.exchangeSupported === true,
    explicitExpectationValid: evidence.explicitExpectationValid === true,
    riskPolicyReady: evidence.riskPolicyReady === true,
    riskPolicyUnknownClear: evidence.riskPolicyUnknownClear === true,
    expectedCandidateMatched: evidence.expectedCandidateMatched === true,
    prebuffReady: evidence.prebuffReady === true,
    prebuffDemandMatched: evidence.prebuffDemandMatched === true,
    evidenceSelectedSkillPresent: evidence.selectedSkillPresent === true,
    enforcementObserved: evidence.arbiterEnforcementObserved === true,
    evidencePrebuffConfirmed: evidence.prebuffActionConfirmed === true,
    evidenceEconomyConfirmed: evidence.economyActionConfirmed === true,
    evidenceExactKindExecuted: evidence.exactKindExecuted === true,
    evidenceExactNameExecuted: evidence.exactNameExecuted === true,
    inventoryMutationObserved: evidence.inventoryMutationObserved === true,
    oneValueMutationMaximum: evidence.oneValueMutationMaximum === true,
    blindRetryAvoided: evidence.blindRetryAvoided === true,
    inventorySignatureChanged:
      typeof before.inventorySignature === "string" &&
      typeof after.inventorySignature === "string" &&
      before.inventorySignature !== after.inventorySignature,
    irreversibleMutation: scope.irreversibleMutation === true,
    prebuffMutationAllowed: scope.prebuffMutationAllowed === true,
    expectedMutationKindOnly:
      (expected.kind === "UPGRADE" &&
        scope.upgradeMutationAllowed === true &&
        scope.compoundMutationAllowed === false) ||
      (expected.kind === "COMPOUND" &&
        scope.compoundMutationAllowed === true &&
        scope.upgradeMutationAllowed === false),
    exchangeMutationAllowed: scope.exchangeMutationAllowed === true,
    craftMutationAllowed: scope.craftMutationAllowed === true,
    offeringMutationAllowed: scope.offeringMutationAllowed === true,
    scopeMaxValueMutations: Number(scope.maxValueMutations),
    scopeBlindRetryAllowed: scope.blindRetryAllowed === true,
    arbiterConfigOverrideCleared: cleanup.arbiterConfigOverrideCleared === true,
    arbiterEnforcementRestored: cleanup.arbiterEnforcementRestored === true,
  };
}

function passEvidenceComplete(evidence) {
  return (
    evidence.probePassed === true &&
    evidence.probeReasonMatches === true &&
    evidence.characterMatches === true &&
    evidence.expectationEchoMatches === true &&
    evidence.riskSelectionMatchesExpectation === true &&
    evidence.executionConfirmed === true &&
    evidence.executionKindMatches === true &&
    evidence.executionNameMatches === true &&
    evidence.selectedSkillPresent === true &&
    evidence.prebuffConfirmed === true &&
    evidence.economyConfirmed === true &&
    evidence.distinctActionIds === true &&
    evidence.noUnknownHold === true &&
    evidence.explicitOneShot === true &&
    evidence.arbiterEnforcementRequired === true &&
    evidence.prebuffMustConfirmBeforeEconomy === true &&
    evidence.revalidateAfterPrebuff === true &&
    evidence.maxValueMutations === 1 &&
    evidence.blindRetryAllowed === false &&
    evidence.exchangeSupported === false &&
    evidence.explicitExpectationValid === true &&
    evidence.riskPolicyReady === true &&
    evidence.riskPolicyUnknownClear === true &&
    evidence.expectedCandidateMatched === true &&
    evidence.prebuffReady === true &&
    evidence.prebuffDemandMatched === true &&
    evidence.evidenceSelectedSkillPresent === true &&
    evidence.enforcementObserved === true &&
    evidence.evidencePrebuffConfirmed === true &&
    evidence.evidenceEconomyConfirmed === true &&
    evidence.evidenceExactKindExecuted === true &&
    evidence.evidenceExactNameExecuted === true &&
    evidence.inventoryMutationObserved === true &&
    evidence.oneValueMutationMaximum === true &&
    evidence.blindRetryAvoided === true &&
    evidence.inventorySignatureChanged === true &&
    evidence.irreversibleMutation === true &&
    evidence.prebuffMutationAllowed === true &&
    evidence.expectedMutationKindOnly === true &&
    evidence.exchangeMutationAllowed === false &&
    evidence.craftMutationAllowed === false &&
    evidence.offeringMutationAllowed === false &&
    evidence.scopeMaxValueMutations === 1 &&
    evidence.scopeBlindRetryAllowed === false &&
    evidence.arbiterConfigOverrideCleared === true &&
    evidence.arbiterEnforcementRestored === true
  );
}

function combineEconomyPrebuffExecutionSupervisorResult(result, expected) {
  const source = record(result);
  const probe = record(source.coupledExecution);
  const probeEvidence = coupledExecutionEvidence(probe, expected);
  const runtimeStateRestored = source.cleanup?.runtimeStateRestored === true;
  const equipmentBaselineRestored =
    source.cleanup?.equipmentBaselineRestored === true;
  const supervisorReadOnly = source.scope?.readOnly === true;
  const supervisorMaxValueMutations = Number(
    source.scope?.maxValueMutations || 0,
  );
  const supervisorBlindRetryAllowed = source.scope?.blindRetryAllowed === true;
  const supervisorMutationKindOnly =
    (expected.kind === "UPGRADE" &&
      source.scope?.upgradeMutationForced === true &&
      source.scope?.compoundMutationForced === false) ||
    (expected.kind === "COMPOUND" &&
      source.scope?.compoundMutationForced === true &&
      source.scope?.upgradeMutationForced === false);

  const passed =
    source.outcome === "PASS" &&
    passEvidenceComplete(probeEvidence) &&
    runtimeStateRestored &&
    equipmentBaselineRestored &&
    supervisorReadOnly === false &&
    supervisorMaxValueMutations === 1 &&
    supervisorBlindRetryAllowed === false &&
    source.scope?.prebuffMutationForced === true &&
    source.scope?.valueMutationForced === true &&
    supervisorMutationKindOnly &&
    source.scope?.exchangeMutationForced === false &&
    source.scope?.craftMutationForced === false &&
    source.scope?.logisticsMutationForced === false;

  const unknown =
    probe.outcome === "UNKNOWN" &&
    probeEvidence.probeUnknown === true &&
    probeEvidence.unknownReasonMatches === true &&
    probeEvidence.blindRetryAvoided === true &&
    probeEvidence.scopeBlindRetryAllowed === false &&
    runtimeStateRestored &&
    equipmentBaselineRestored;

  return {
    ...source,
    outcome: passed ? "PASS" : unknown ? "UNKNOWN" : "FAIL",
    reason: passed
      ? "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED"
      : unknown
      ? "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY"
      : "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_EVIDENCE_INCOMPLETE",
    coupledExecution: probe,
    economyPrebuffExecution:
      probe.execution || source.after?.economyPrebuffExecution || null,
    evidence: {
      probe: probeEvidence,
      runtimeStateRestored,
      equipmentBaselineRestored,
      supervisorReadOnly,
      supervisorMaxValueMutations,
      supervisorBlindRetryAllowed,
      supervisorMutationKindOnly,
    },
    scope: {
      ...record(source.scope),
      readOnly: false,
      irreversibleMutationAllowed: true,
      maxValueMutations: 1,
      blindRetryAllowed: false,
    },
    cleanup: {
      ...record(source.cleanup),
      runtimeStateRestored,
      equipmentBaselineRestored,
      arbiterConfigOverrideCleared: probeEvidence.arbiterConfigOverrideCleared,
      arbiterEnforcementRestored: probeEvidence.arbiterEnforcementRestored,
    },
  };
}

async function main() {
  const expected = parseExplicitExpectation(process.argv.slice(2));
  process.stdout.write(
    "WARNING: this test is value-changing and may consume one Mass Production buff plus exactly one " +
      expected.kind +
      " mutation. UNKNOWN is terminal; do not rerun until reconciled.\n",
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "Temporary caracAL runtime is ready at http://127.0.0.1:924\n"
        : "Using existing caracAL runtime at http://127.0.0.1:924\n",
    );
    const selected = await waitForGearScoringCharacter(expected.character, {
      initialState: dashboard.state,
    });
    const sampleMs = Number(
      process.env.CARACAL_ECONOMY_PREBUFF_EXECUTION_LIVE_SETTLE_MS || 1750,
    );
    process.stdout.write(
      "Running guarded coupled Economy Prebuff execution E2E with " +
        selected.name +
        " for " +
        expected.kind +
        " " +
        expected.name +
        " slots=" +
        expected.slots.join(",") +
        "\n",
    );

    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
      {
        economyPrebuffExecutionLiveTest: true,
        expectedKind: expected.kind,
        expectedName: expected.name,
        expectedSlots: expected.slots,
        confirmationToken: expected.confirmationToken,
      },
    );
    const result = combineEconomyPrebuffExecutionSupervisorResult(
      payload.result,
      expected,
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");

    if (result.outcome === "UNKNOWN") {
      process.stderr.write(
        "UNKNOWN outcome: do not rerun this command until the affected action has been reconciled.\n",
      );
      process.exitCode = 1;
    } else if (result.outcome !== "PASS") {
      process.exitCode = 1;
    }
  } finally {
    if (managedRuntime) {
      process.stdout.write("Stopping temporary caracAL runtime\n");
      await stopManagedRuntime(managedRuntime);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRMATION_TOKEN,
  combineEconomyPrebuffExecutionSupervisorResult,
  coupledExecutionEvidence,
  normalizeSlots,
  parseExplicitExpectation,
  passEvidenceComplete,
};

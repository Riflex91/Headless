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

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value) {
  const normalized = finite(value);
  return normalized !== null && Number.isInteger(normalized)
    ? normalized
    : null;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function sameMoney(left, right) {
  const normalizedLeft = finite(left);
  const normalizedRight = finite(right);
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    Math.abs(normalizedLeft - normalizedRight) <= 0.01
  );
}

function expectedDecision(delta) {
  const normalized = finite(delta);
  if (normalized === null) return "UNKNOWN";
  if (Math.abs(normalized) < 0.5) return "BREAK_EVEN";
  return normalized > 0 ? "POSITIVE_EV" : "NEGATIVE_EV";
}

function estimateEvidence(estimate) {
  const value = record(estimate);
  const kindKnown = value.kind === "UPGRADE" || value.kind === "COMPOUND";
  const identityValid =
    typeof value.name === "string" &&
    value.name.length > 0 &&
    integer(value.currentLevel) !== null &&
    integer(value.targetLevel) === integer(value.currentLevel) + 1 &&
    Array.isArray(value.itemSlots) &&
    value.itemSlots.length > 0 &&
    value.itemSlots.every(
      (slot) => integer(slot) !== null && integer(slot) >= 0,
    ) &&
    typeof value.scrollName === "string" &&
    value.scrollName.length > 0 &&
    integer(value.scrollSlot) !== null &&
    integer(value.scrollSlot) >= 0;

  if (value.decision === "UNKNOWN") {
    return {
      kindKnown,
      identityValid,
      probabilityValid: value.successProbability === null,
      arithmeticValid:
        value.expectedOutcomeValueGold === null &&
        value.expectedDeltaGold === null,
      decisionValid: true,
      breakEvenValid: value.breakEvenProbability === null,
      complete:
        kindKnown &&
        identityValid &&
        value.successProbability === null &&
        value.expectedOutcomeValueGold === null &&
        value.expectedDeltaGold === null,
    };
  }

  const probability = finite(value.successProbability);
  const currentValue = finite(value.currentItemValueGold);
  const successValue = finite(value.successItemValueGold);
  const failureValue = finite(value.failureOutcomeValueGold);
  const scrollCost = finite(value.scrollReplacementCostGold);
  const inputValue = finite(value.inputValueGold);
  const expectedOutcome = finite(value.expectedOutcomeValueGold);
  const delta = finite(value.expectedDeltaGold);
  const probabilityValid =
    probability !== null && probability >= 0 && probability <= 1;

  const arithmeticValid =
    probabilityValid &&
    currentValue !== null &&
    successValue !== null &&
    failureValue !== null &&
    scrollCost !== null &&
    inputValue !== null &&
    expectedOutcome !== null &&
    delta !== null &&
    sameMoney(
      expectedOutcome,
      probability * successValue + (1 - probability) * failureValue,
    ) &&
    sameMoney(delta, expectedOutcome - inputValue);

  const denominator =
    successValue !== null && failureValue !== null
      ? successValue - failureValue
      : null;
  const expectedBreakEven =
    denominator !== null && denominator > 0 && inputValue !== null
      ? Math.round(((inputValue - failureValue) / denominator) * 1e9) / 1e9
      : null;
  const actualBreakEven =
    value.breakEvenProbability === null
      ? null
      : finite(value.breakEvenProbability);
  const breakEvenValid =
    expectedBreakEven === null
      ? actualBreakEven === null
      : actualBreakEven !== null &&
        Math.abs(actualBreakEven - expectedBreakEven) <= 1e-9;
  const decisionValid = value.decision === expectedDecision(delta);

  return {
    kindKnown,
    identityValid,
    probabilityValid,
    arithmeticValid,
    decisionValid,
    breakEvenValid,
    complete:
      kindKnown &&
      identityValid &&
      probabilityValid &&
      arithmeticValid &&
      decisionValid &&
      breakEvenValid,
  };
}

function expectedValueEvidence(snapshot) {
  const status = record(snapshot?.expectedValue);
  const model = record(status.model);
  const summary = record(status.summary);
  const estimates = Array.isArray(status.estimates) ? status.estimates : [];
  const estimateChecks = estimates.map(estimateEvidence);

  const modelPinned =
    model.valueModel === "ADVENTURE_LAND_INTRINSIC_GOLD_VALUE" &&
    model.probabilityModel ===
      "OFFICIAL_BASE_NO_DYNAMIC_GRACE_NO_OFFERING" &&
    model.sourceRepository === "kaansoral/adventureland" &&
    model.sourceCommit === "f927df37da777eb7f048fd9209c039653a3406bd" &&
    model.marketPricesIncluded === false &&
    model.dynamicGraceIncluded === false &&
    model.offeringsIncluded === false;

  const upgradeCandidates = integer(summary.upgradeCandidates);
  const compoundCandidates = integer(summary.compoundCandidates);
  const evaluated = integer(summary.evaluated);
  const positive = integer(summary.positive);
  const negative = integer(summary.negative);
  const breakEven = integer(summary.breakEven);
  const unknown = integer(summary.unknown);

  const summaryNumbersValid = [
    upgradeCandidates,
    compoundCandidates,
    evaluated,
    positive,
    negative,
    breakEven,
    unknown,
  ].every((value) => value !== null && value >= 0);

  const expectedUnknown = estimates.filter(
    (estimate) => estimate?.decision === "UNKNOWN",
  ).length;
  const expectedPositive = estimates.filter(
    (estimate) => estimate?.decision === "POSITIVE_EV",
  ).length;
  const expectedNegative = estimates.filter(
    (estimate) => estimate?.decision === "NEGATIVE_EV",
  ).length;
  const expectedBreakEven = estimates.filter(
    (estimate) => estimate?.decision === "BREAK_EVEN",
  ).length;
  const expectedEvaluated = estimates.length - expectedUnknown;

  const summaryMatches =
    summaryNumbersValid &&
    estimates.length === upgradeCandidates + compoundCandidates &&
    evaluated === expectedEvaluated &&
    positive === expectedPositive &&
    negative === expectedNegative &&
    breakEven === expectedBreakEven &&
    unknown === expectedUnknown &&
    positive + negative + breakEven + unknown === estimates.length;

  const expectedState =
    estimates.length === 0
      ? "EMPTY"
      : expectedUnknown > 0
      ? expectedEvaluated > 0
        ? "PARTIAL"
        : "EMPTY"
      : "READY";
  const stateMatches = status.state === expectedState;
  const reasonMatches =
    (expectedState === "READY" && status.reason === "EXPECTED_VALUE_READY") ||
    (expectedState === "PARTIAL" &&
      status.reason === "EXPECTED_VALUE_PARTIAL") ||
    (expectedState === "EMPTY" &&
      [
        "EXPECTED_VALUE_NO_CANDIDATES",
        "EXPECTED_VALUE_MODEL_INPUT_UNKNOWN",
      ].includes(status.reason));

  return {
    projectionVisible:
      status.enabled === true &&
      ["EMPTY", "READY", "PARTIAL"].includes(status.state),
    modelPinned,
    estimateCount: estimates.length,
    allEstimatesRecomputed: estimateChecks.every((entry) => entry.complete),
    summaryMatches,
    stateMatches,
    reasonMatches,
    upgradeCandidates: upgradeCandidates ?? 0,
    compoundCandidates: compoundCandidates ?? 0,
    evaluated: evaluated ?? 0,
    unknown: unknown ?? 0,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.projectionVisible === true &&
    evidence.modelPinned === true &&
    evidence.allEstimatesRecomputed === true &&
    evidence.summaryMatches === true &&
    evidence.stateMatches === true &&
    evidence.reasonMatches === true
  );
}

function combineExpectedValueSupervisorResult(result) {
  const source = record(result);
  const beforeEvidence = expectedValueEvidence(source.before);
  const afterEvidence = expectedValueEvidence(source.after);
  const runtimeStateRestored = source.cleanup?.runtimeStateRestored === true;
  const equipmentBaselineRestored =
    source.cleanup?.equipmentBaselineRestored === true;
  const evidence = {
    ...afterEvidence,
    projectionWasVisibleBeforeSettle: beforeEvidence.projectionVisible === true,
    runtimeStateRestored,
    equipmentBaselineRestored,
    supervisorReadOnly: source.scope?.readOnly === true,
    supervisorValueMutationForced: source.scope?.valueMutationForced === true,
  };

  const passed =
    source.outcome === "PASS" &&
    evidenceComplete(afterEvidence) &&
    runtimeStateRestored &&
    equipmentBaselineRestored &&
    evidence.supervisorReadOnly &&
    !evidence.supervisorValueMutationForced;

  return {
    ...source,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "EXPECTED_VALUE_LIVE_E2E_CONFIRMED"
      : "EXPECTED_VALUE_LIVE_E2E_EVIDENCE_INCOMPLETE",
    expectedValue: source.after?.expectedValue || null,
    evidence,
    scope: {
      ...record(source.scope),
      readOnly: true,
      expectedValueMutationForced: false,
      upgradeMutationForced: false,
      compoundMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
    },
    cleanup: {
      ...record(source.cleanup),
      runtimeStateRestored,
      equipmentBaselineRestored,
    },
  };
}

async function main() {
  const requestedCharacter = process.argv[2] || null;
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "Temporary caracAL runtime is ready at http://127.0.0.1:924\n"
        : "Using existing caracAL runtime at http://127.0.0.1:924\n",
    );

    const selected = await waitForGearScoringCharacter(requestedCharacter, {
      initialState: dashboard.state,
    });
    const sampleMs = Number(
      process.env.CARACAL_EXPECTED_VALUE_LIVE_SETTLE_MS || 1500,
    );

    process.stdout.write(
      "Running read-only Expected Value E2E with " + selected.name + "\n",
    );
    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
    );
    const result = combineExpectedValueSupervisorResult(payload.result);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");

    if (result.outcome !== "PASS") process.exitCode = 1;
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
  combineExpectedValueSupervisorResult,
  estimateEvidence,
  evidenceComplete,
  expectedDecision,
  expectedValueEvidence,
};

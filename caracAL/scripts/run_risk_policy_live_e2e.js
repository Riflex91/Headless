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

function nonNegative(value) {
  const normalized = finite(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function probability(value) {
  const normalized = finite(value);
  return normalized !== null && normalized >= 0 && normalized <= 1
    ? normalized
    : null;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function sameNumber(left, right, tolerance = 0.01) {
  if (left === null && right === null) return true;
  const normalizedLeft = finite(left);
  const normalizedRight = finite(right);
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    Math.abs(normalizedLeft - normalizedRight) <= tolerance
  );
}

function sameSlots(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizedPolicy(status) {
  const policy = record(status?.policy);
  const allowedKinds = Array.isArray(policy.allowedKinds)
    ? policy.allowedKinds.filter(
        (entry) => entry === "UPGRADE" || entry === "COMPOUND",
      )
    : [];
  return {
    minExpectedDeltaGold: finite(policy.minExpectedDeltaGold),
    minSuccessProbability: probability(policy.minSuccessProbability),
    maxInputValueGold:
      policy.maxInputValueGold === null
        ? null
        : nonNegative(policy.maxInputValueGold),
    maxFailureLossGold:
      policy.maxFailureLossGold === null
        ? null
        : nonNegative(policy.maxFailureLossGold),
    allowedKinds,
    unknownAlwaysBlocked: policy.unknownAlwaysBlocked === true,
  };
}

function policyValid(policy) {
  return (
    policy.minExpectedDeltaGold !== null &&
    policy.minSuccessProbability !== null &&
    policy.unknownAlwaysBlocked === true &&
    Array.isArray(policy.allowedKinds) &&
    policy.allowedKinds.every(
      (kind) => kind === "UPGRADE" || kind === "COMPOUND",
    )
  );
}

function expectedRiskDecision(estimate, policy) {
  const source = record(estimate);
  const inputValue = nonNegative(source.inputValueGold);
  const failureValue = finite(source.failureOutcomeValueGold);
  const failureLoss =
    inputValue !== null && failureValue !== null
      ? roundMoney(Math.max(0, inputValue - failureValue))
      : null;
  const base = {
    kind: source.kind,
    name: source.name,
    currentLevel: source.currentLevel,
    targetLevel: source.targetLevel,
    itemSlots: Array.isArray(source.itemSlots) ? [...source.itemSlots] : [],
    expectedDeltaGold:
      source.expectedDeltaGold === null
        ? null
        : finite(source.expectedDeltaGold),
    successProbability:
      source.successProbability === null
        ? null
        : probability(source.successProbability),
    inputValueGold: source.inputValueGold === null ? null : inputValue,
    failureOutcomeValueGold:
      source.failureOutcomeValueGold === null ? null : failureValue,
    failureLossGold: failureLoss,
  };

  if (!policy.allowedKinds.includes(source.kind)) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_KIND_NOT_ALLOWED",
    };
  }

  const expectedDelta = finite(source.expectedDeltaGold);
  const successProbability = probability(source.successProbability);
  if (
    source.decision === "UNKNOWN" ||
    expectedDelta === null ||
    successProbability === null ||
    inputValue === null ||
    failureLoss === null
  ) {
    return {
      ...base,
      decision: "UNKNOWN",
      reason: "RISK_POLICY_EXPECTED_VALUE_UNKNOWN",
    };
  }

  if (expectedDelta < policy.minExpectedDeltaGold) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_EXPECTED_DELTA_BELOW_MINIMUM",
    };
  }

  if (successProbability < policy.minSuccessProbability) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_SUCCESS_PROBABILITY_BELOW_MINIMUM",
    };
  }

  if (
    policy.maxInputValueGold !== null &&
    inputValue > policy.maxInputValueGold
  ) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_INPUT_VALUE_LIMIT_EXCEEDED",
    };
  }

  if (
    policy.maxFailureLossGold !== null &&
    failureLoss > policy.maxFailureLossGold
  ) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_FAILURE_LOSS_LIMIT_EXCEEDED",
    };
  }

  return {
    ...base,
    decision: "ALLOW",
    reason: "RISK_POLICY_ALLOWED",
  };
}

function decisionMatches(actual, expected) {
  const value = record(actual);
  return (
    value.kind === expected.kind &&
    value.name === expected.name &&
    value.currentLevel === expected.currentLevel &&
    value.targetLevel === expected.targetLevel &&
    sameSlots(value.itemSlots, expected.itemSlots) &&
    sameNumber(value.expectedDeltaGold, expected.expectedDeltaGold) &&
    sameNumber(value.successProbability, expected.successProbability, 1e-9) &&
    sameNumber(value.inputValueGold, expected.inputValueGold) &&
    sameNumber(
      value.failureOutcomeValueGold,
      expected.failureOutcomeValueGold,
    ) &&
    sameNumber(value.failureLossGold, expected.failureLossGold) &&
    value.decision === expected.decision &&
    value.reason === expected.reason
  );
}

function bestAllowed(decisions) {
  return (
    decisions
      .filter((decision) => decision.decision === "ALLOW")
      .slice()
      .sort(
        (left, right) =>
          (right.expectedDeltaGold ?? Number.NEGATIVE_INFINITY) -
            (left.expectedDeltaGold ?? Number.NEGATIVE_INFINITY) ||
          (right.successProbability ?? Number.NEGATIVE_INFINITY) -
            (left.successProbability ?? Number.NEGATIVE_INFINITY) ||
          String(left.kind).localeCompare(String(right.kind)) ||
          String(left.name).localeCompare(String(right.name)),
      )[0] || null
  );
}

function riskPolicyEvidence(snapshot) {
  const expectedValue = record(snapshot?.expectedValue);
  const riskPolicy = record(snapshot?.riskPolicy);
  const policy = normalizedPolicy(riskPolicy);
  const estimates = Array.isArray(expectedValue.estimates)
    ? expectedValue.estimates
    : [];
  const actualDecisions = Array.isArray(riskPolicy.decisions)
    ? riskPolicy.decisions
    : [];
  const recomputed = estimates.map((estimate) =>
    expectedRiskDecision(estimate, policy),
  );

  const decisionsMatch =
    actualDecisions.length === recomputed.length &&
    actualDecisions.every((decision, index) =>
      decisionMatches(decision, recomputed[index]),
    );

  const allowed = recomputed.filter(
    (decision) => decision.decision === "ALLOW",
  );
  const blocked = recomputed.filter(
    (decision) => decision.decision === "BLOCK",
  );
  const unknown = recomputed.filter(
    (decision) => decision.decision === "UNKNOWN",
  );
  const selected = bestAllowed(recomputed);
  const summary = record(riskPolicy.summary);

  const summaryMatches =
    integer(summary.estimates) === recomputed.length &&
    integer(summary.allowed) === allowed.length &&
    integer(summary.blocked) === blocked.length &&
    integer(summary.unknown) === unknown.length &&
    integer(summary.upgradeAllowed) ===
      allowed.filter((decision) => decision.kind === "UPGRADE").length &&
    integer(summary.compoundAllowed) ===
      allowed.filter((decision) => decision.kind === "COMPOUND").length &&
    summary.selectedKind === (selected?.kind ?? null) &&
    summary.selectedName === (selected?.name ?? null) &&
    sameNumber(
      summary.selectedExpectedDeltaGold ?? null,
      selected?.expectedDeltaGold ?? null,
    );

  const selectedMatches =
    selected === null
      ? riskPolicy.selected === null
      : decisionMatches(riskPolicy.selected, selected);

  const expectedState =
    recomputed.length === 0
      ? "EMPTY"
      : unknown.length > 0
        ? "PARTIAL"
        : selected
          ? "READY"
          : "BLOCKED";
  const expectedReason =
    expectedState === "EMPTY"
      ? "RISK_POLICY_NO_ESTIMATES"
      : expectedState === "PARTIAL"
        ? "RISK_POLICY_PARTIAL_UNKNOWN"
        : expectedState === "READY"
          ? "RISK_POLICY_CANDIDATE_ALLOWED"
          : "RISK_POLICY_ALL_CANDIDATES_BLOCKED";

  return {
    projectionVisible:
      riskPolicy.enabled === true &&
      ["EMPTY", "READY", "BLOCKED", "PARTIAL"].includes(riskPolicy.state),
    expectedValueProjectionVisible:
      expectedValue.enabled === true &&
      ["EMPTY", "READY", "PARTIAL"].includes(expectedValue.state),
    policyValid: policyValid(policy),
    unknownAlwaysBlocked: policy.unknownAlwaysBlocked === true,
    estimateCount: estimates.length,
    decisionCount: actualDecisions.length,
    decisionsRecomputed: decisionsMatch,
    summaryMatches,
    selectedMatches,
    stateMatches: riskPolicy.state === expectedState,
    reasonMatches: riskPolicy.reason === expectedReason,
    allowed: allowed.length,
    blocked: blocked.length,
    unknown: unknown.length,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.projectionVisible === true &&
    evidence.expectedValueProjectionVisible === true &&
    evidence.policyValid === true &&
    evidence.unknownAlwaysBlocked === true &&
    evidence.decisionsRecomputed === true &&
    evidence.summaryMatches === true &&
    evidence.selectedMatches === true &&
    evidence.stateMatches === true &&
    evidence.reasonMatches === true
  );
}

function combineRiskPolicySupervisorResult(result) {
  const source = record(result);
  const beforeEvidence = riskPolicyEvidence(source.before);
  const afterEvidence = riskPolicyEvidence(source.after);
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
      ? "RISK_POLICY_LIVE_E2E_CONFIRMED"
      : "RISK_POLICY_LIVE_E2E_EVIDENCE_INCOMPLETE",
    expectedValue: source.after?.expectedValue || null,
    riskPolicy: source.after?.riskPolicy || null,
    evidence,
    scope: {
      ...record(source.scope),
      readOnly: true,
      riskPolicyMutationForced: false,
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
      process.env.CARACAL_RISK_POLICY_LIVE_SETTLE_MS || 1750,
    );

    process.stdout.write(
      "Running read-only Risk Policy E2E with " + selected.name + "\n",
    );
    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
    );
    const result = combineRiskPolicySupervisorResult(payload.result);
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
  combineRiskPolicySupervisorResult,
  decisionMatches,
  evidenceComplete,
  expectedRiskDecision,
  normalizedPolicy,
  policyValid,
  riskPolicyEvidence,
};

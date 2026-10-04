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

const LANE_ORDER = [
  "SAFETY",
  "MERRIT",
  "CRITICAL_FARMER_LOGISTICS",
  "ECONOMY_PREBUFF",
  "ECONOMY",
  "MERCHANT_STAND",
  "BACKGROUND",
];

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeLane(value) {
  const lane = record(value);
  return {
    lane: typeof lane.lane === "string" ? lane.lane : null,
    rank: integer(lane.rank),
    active: lane.active === true,
    blocked: lane.blocked === true,
    unknown: lane.unknown === true,
    reason: typeof lane.reason === "string" ? lane.reason : null,
    data: record(lane.data),
  };
}

function selectedMatches(actual, expected) {
  if (expected === null) return actual === null;
  const normalized = normalizeLane(actual);
  return (
    normalized.lane === expected.lane &&
    normalized.rank === expected.rank &&
    normalized.active === expected.active &&
    normalized.blocked === expected.blocked &&
    normalized.unknown === expected.unknown &&
    normalized.reason === expected.reason
  );
}

function riskPolicyEconomyEvidence(snapshot, lanes) {
  const riskPolicy = record(snapshot?.riskPolicy);
  const summary = record(riskPolicy.summary);
  const economy = lanes.find((lane) => lane.lane === "ECONOMY") || null;
  const unknown =
    riskPolicy.state === "PARTIAL" || Number(summary.unknown || 0) > 0;
  const expectedActive = unknown || riskPolicy.selected != null;
  const expectedBlocked = riskPolicy.state === "BLOCKED";

  if (!economy) {
    return {
      economyLanePresent: false,
      economyActiveMatchesRiskPolicy: false,
      economyBlockedMatchesRiskPolicy: false,
      economyUnknownMatchesRiskPolicy: false,
      economyReasonMatchesRiskPolicy: false,
      economySelectionMatchesRiskPolicy: false,
    };
  }

  const data = record(economy.data);
  const selected = record(riskPolicy.selected);
  return {
    economyLanePresent: true,
    economyActiveMatchesRiskPolicy: economy.active === expectedActive,
    economyBlockedMatchesRiskPolicy: economy.blocked === expectedBlocked,
    economyUnknownMatchesRiskPolicy: economy.unknown === unknown,
    economyReasonMatchesRiskPolicy: economy.reason === riskPolicy.reason,
    economySelectionMatchesRiskPolicy:
      (data.selectedKind ?? null) === (selected.kind ?? null) &&
      (data.selectedName ?? null) === (selected.name ?? null) &&
      Number(data.unknown || 0) === Number(summary.unknown || 0),
  };
}

function economyArbiterEvidence(snapshot) {
  const arbiter = record(snapshot?.economyArbiter);
  const policy = record(arbiter.policy);
  const summary = record(arbiter.summary);
  const rawLanes = Array.isArray(arbiter.lanes) ? arbiter.lanes : [];
  const lanes = rawLanes.map(normalizeLane);
  const laneOrderMatches =
    lanes.length === LANE_ORDER.length &&
    lanes.every(
      (lane, index) =>
        lane.lane === LANE_ORDER[index] && lane.rank === index,
    );
  const policyOrderMatches = sameArray(policy.laneOrder, LANE_ORDER);
  const selected = lanes.find((lane) => lane.active) || null;
  const active = lanes.filter((lane) => lane.active).length;
  const blocked = lanes.filter(
    (lane) => lane.active && lane.blocked,
  ).length;
  const unknown = lanes.filter(
    (lane) => lane.active && lane.unknown,
  ).length;
  const summaryMatches =
    integer(summary.active) === active &&
    integer(summary.blocked) === blocked &&
    integer(summary.unknown) === unknown;
  const selectionMatches = selectedMatches(arbiter.selected, selected);

  let expectedState = "IDLE";
  let expectedReason = "ECONOMY_ARBITER_IDLE";
  if (selected?.unknown) {
    expectedState = "UNKNOWN";
    expectedReason = "ECONOMY_ARBITER_SELECTED_UNKNOWN";
  } else if (selected?.lane === "SAFETY") {
    expectedState = "BLOCKED";
    expectedReason = "ECONOMY_ARBITER_SAFETY_BLOCK";
  } else if (selected?.blocked) {
    expectedState = "BLOCKED";
    expectedReason = "ECONOMY_ARBITER_SELECTED_BLOCKED";
  } else if (selected) {
    expectedState = "READY";
    expectedReason = "ECONOMY_ARBITER_SELECTED";
  }

  return {
    projectionVisible:
      arbiter.enabled === true &&
      ["IDLE", "READY", "BLOCKED", "UNKNOWN"].includes(arbiter.state),
    laneOrderMatches,
    policyOrderMatches,
    unknownBlocksLowerPriority: policy.unknownBlocksLowerPriority === true,
    safetyBlocksLowerPriority: policy.safetyBlocksLowerPriority === true,
    backgroundDynamicScoringDeferred:
      policy.backgroundDynamicScoring === false,
    executionDisabled: policy.executionEnabled === false,
    valueMutationForced: policy.valueMutationForced === true,
    summaryMatches,
    selectionMatches,
    stateMatches: arbiter.state === expectedState,
    reasonMatches: arbiter.reason === expectedReason,
    selectedLane: selected?.lane ?? null,
    active,
    blocked,
    unknown,
    ...riskPolicyEconomyEvidence(snapshot, lanes),
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.projectionVisible === true &&
    evidence.laneOrderMatches === true &&
    evidence.policyOrderMatches === true &&
    evidence.unknownBlocksLowerPriority === true &&
    evidence.safetyBlocksLowerPriority === true &&
    evidence.backgroundDynamicScoringDeferred === true &&
    evidence.executionDisabled === true &&
    evidence.valueMutationForced === false &&
    evidence.summaryMatches === true &&
    evidence.selectionMatches === true &&
    evidence.stateMatches === true &&
    evidence.reasonMatches === true &&
    evidence.economyLanePresent === true &&
    evidence.economyActiveMatchesRiskPolicy === true &&
    evidence.economyBlockedMatchesRiskPolicy === true &&
    evidence.economyUnknownMatchesRiskPolicy === true &&
    evidence.economyReasonMatchesRiskPolicy === true &&
    evidence.economySelectionMatchesRiskPolicy === true
  );
}

function combineEconomyArbiterSupervisorResult(result) {
  const source = record(result);
  const beforeEvidence = economyArbiterEvidence(source.before);
  const afterEvidence = economyArbiterEvidence(source.after);
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
      ? "ECONOMY_ARBITER_LIVE_E2E_CONFIRMED"
      : "ECONOMY_ARBITER_LIVE_E2E_EVIDENCE_INCOMPLETE",
    riskPolicy: source.after?.riskPolicy || null,
    economyArbiter: source.after?.economyArbiter || null,
    evidence,
    scope: {
      ...record(source.scope),
      readOnly: true,
      economyArbiterMutationForced: false,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: false,
      equipmentMutationForced: false,
      upgradeMutationForced: false,
      compoundMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
      logisticsMutationForced: false,
      merchantMutationForced: false,
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
      process.env.CARACAL_ECONOMY_ARBITER_LIVE_SETTLE_MS || 1750,
    );
    process.stdout.write(
      "Running read-only Economy Arbiter E2E with " + selected.name + "\n",
    );
    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
    );
    const result = combineEconomyArbiterSupervisorResult(payload.result);
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
  LANE_ORDER,
  combineEconomyArbiterSupervisorResult,
  economyArbiterEvidence,
  evidenceComplete,
  normalizeLane,
  riskPolicyEconomyEvidence,
  selectedMatches,
};

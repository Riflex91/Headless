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

const UPGRADE_COMPOUND_SKILLS = ["massproductionpp", "massproduction"];
const EXCHANGE_SKILLS = ["massexchangepp", "massexchange"];
const SOURCE_REPOSITORY = "kaansoral/adventureland_mongodb";
const SOURCE_COMMIT = "c0f405fd356d99d762ad44644ebfdbab8b4d12e4";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeCandidate(value) {
  const candidate = record(value);
  return {
    skill: typeof candidate.skill === "string" ? candidate.skill : null,
    family: typeof candidate.family === "string" ? candidate.family : null,
    tier: typeof candidate.tier === "string" ? candidate.tier : null,
    reductionPercent: Number(candidate.reductionPercent),
    configured: candidate.configured === true,
    available: candidate.available === true,
    ready: candidate.ready === true,
    reason: typeof candidate.reason === "string" ? candidate.reason : null,
    levelRequired: Number.isFinite(Number(candidate.levelRequired))
      ? Number(candidate.levelRequired)
      : null,
    mpCost: Number.isFinite(Number(candidate.mpCost))
      ? Number(candidate.mpCost)
      : null,
    cooldownRemainingMs: Number(candidate.cooldownRemainingMs || 0),
  };
}

function expectedSkills(kind, preferEnhanced) {
  const family =
    kind === "EXCHANGE" ? EXCHANGE_SKILLS : UPGRADE_COMPOUND_SKILLS;
  return preferEnhanced === false ? [...family].reverse() : [...family];
}

function candidateShapeMatches(candidate, kind) {
  const isExchange = kind === "EXCHANGE";
  const enhanced = candidate.skill?.endsWith("pp") === true;
  return (
    candidate.family === (isExchange ? "EXCHANGE" : "UPGRADE_COMPOUND") &&
    candidate.tier === (enhanced ? "ENHANCED" : "BASE") &&
    candidate.reductionPercent === (enhanced ? 90 : 50) &&
    Number.isFinite(candidate.cooldownRemainingMs) &&
    candidate.cooldownRemainingMs >= 0
  );
}

function economyPrebuffEvidence(snapshot) {
  const prebuff = record(snapshot?.economyPrebuff);
  const policy = record(prebuff.policy);
  const demand = record(prebuff.demand);
  const risk = record(snapshot?.riskPolicy);
  const riskSummary = record(risk.summary);
  const riskSelected = record(risk.selected);
  const arbiter = record(snapshot?.economyArbiter);
  const lanes = Array.isArray(arbiter.lanes) ? arbiter.lanes : [];
  const prebuffLane =
    lanes.find((entry) => record(entry).lane === "ECONOMY_PREBUFF") || null;
  const lane = record(prebuffLane);
  const laneData = record(lane.data);
  const candidates = Array.isArray(prebuff.candidates)
    ? prebuff.candidates.map(normalizeCandidate)
    : [];

  const riskUnknown =
    risk.state === "PARTIAL" || Number(riskSummary.unknown || 0) > 0;
  const expectedDemandKind = riskSelected.kind ?? null;
  const expectedDemandName = riskSelected.name ?? null;
  const demandMatchesRiskPolicy =
    (demand.kind ?? null) === expectedDemandKind &&
    (demand.name ?? null) === expectedDemandName &&
    demand.riskPolicyState === risk.state &&
    Number(demand.unknown || 0) === Number(riskSummary.unknown || 0);

  let stateReasonMatchesRiskPolicy = false;
  if (riskUnknown) {
    stateReasonMatchesRiskPolicy =
      prebuff.state === "BLOCKED" &&
      prebuff.reason === "ECONOMY_PREBUFF_RISK_POLICY_UNKNOWN";
  } else if (!risk.selected) {
    stateReasonMatchesRiskPolicy =
      prebuff.state === "IDLE" &&
      prebuff.reason === "ECONOMY_PREBUFF_NO_ECONOMY_SELECTION" &&
      prebuff.selectedSkill == null &&
      candidates.length === 0;
  } else {
    stateReasonMatchesRiskPolicy =
      (prebuff.state === "READY" &&
        prebuff.reason === "ECONOMY_PREBUFF_READY") ||
      (prebuff.state === "BLOCKED" &&
        [
          "ECONOMY_PREBUFF_NO_CONFIGURED_SKILL",
          "ECONOMY_PREBUFF_SKILL_NOT_READY",
        ].includes(prebuff.reason));
  }

  const selectedKind = typeof demand.kind === "string" ? demand.kind : null;
  const expectedCandidateSkills = selectedKind
    ? expectedSkills(selectedKind, policy.preferEnhanced)
    : [];
  const candidateOrderMatches =
    !selectedKind ||
    sameArray(
      candidates.map((candidate) => candidate.skill),
      expectedCandidateSkills,
    );
  const candidateShapesMatch =
    !selectedKind ||
    candidates.every((candidate) =>
      candidateShapeMatches(candidate, selectedKind),
    );
  const firstReady = candidates.find((candidate) => candidate.ready) || null;
  const selectedSkillMatches =
    prebuff.state === "READY"
      ? prebuff.selectedSkill === firstReady?.skill
      : prebuff.selectedSkill == null;

  const laneReasonExpected =
    prebuff.state === "READY"
      ? "ECONOMY_PREBUFF_READY_EXECUTION_DEFERRED"
      : prebuff.reason;
  const arbiterLaneDataMatches =
    (laneData.state ?? null) === (prebuff.state ?? null) &&
    (laneData.demandKind ?? null) === (demand.kind ?? null) &&
    (laneData.demandName ?? null) === (demand.name ?? null) &&
    (laneData.selectedSkill ?? null) === (prebuff.selectedSkill ?? null) &&
    (laneData.riskPolicyState ?? null) === (demand.riskPolicyState ?? null) &&
    Number(laneData.unknown || 0) === Number(demand.unknown || 0) &&
    laneData.executionEnabled === false &&
    laneData.arbiterLaneActivationEnabled === false;

  return {
    projectionVisible:
      prebuff.enabled === true &&
      ["IDLE", "READY", "BLOCKED"].includes(prebuff.state),
    merchantProjection: prebuff.characterClass === "merchant",
    sourceRepositoryMatches: policy.sourceRepository === SOURCE_REPOSITORY,
    sourceCommitMatches: policy.sourceCommit === SOURCE_COMMIT,
    buffLifetimeMatches: policy.buffLifetimeMs === 10000,
    upgradeCompoundMappingMatches: sameArray(
      policy.upgradeCompoundSkills,
      UPGRADE_COMPOUND_SKILLS,
    ),
    exchangeMappingMatches: sameArray(policy.exchangeSkills, EXCHANGE_SKILLS),
    exchangeDemandDeferred: policy.exchangeDemandSupported === false,
    arbiterLaneActivationDeferred:
      policy.arbiterLaneActivationEnabled === false,
    executionDisabled: policy.executionEnabled === false,
    valueMutationForced: policy.valueMutationForced === true,
    demandMatchesRiskPolicy,
    stateReasonMatchesRiskPolicy,
    candidateOrderMatches,
    candidateShapesMatch,
    selectedSkillMatches,
    selectedSkill: prebuff.selectedSkill ?? null,
    state: prebuff.state ?? null,
    reason: prebuff.reason ?? null,
    demandKind: demand.kind ?? null,
    demandName: demand.name ?? null,
    riskPolicyState: demand.riskPolicyState ?? null,
    riskUnknown: Number(demand.unknown || 0),
    candidateCount: candidates.length,
    arbiterLanePresent: !!prebuffLane,
    arbiterLaneInactive:
      lane.active === false && lane.blocked === false && lane.unknown === false,
    arbiterLaneReasonMatches: lane.reason === laneReasonExpected,
    arbiterLaneDataMatches,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.projectionVisible === true &&
    evidence.merchantProjection === true &&
    evidence.sourceRepositoryMatches === true &&
    evidence.sourceCommitMatches === true &&
    evidence.buffLifetimeMatches === true &&
    evidence.upgradeCompoundMappingMatches === true &&
    evidence.exchangeMappingMatches === true &&
    evidence.exchangeDemandDeferred === true &&
    evidence.arbiterLaneActivationDeferred === true &&
    evidence.executionDisabled === true &&
    evidence.valueMutationForced === false &&
    evidence.demandMatchesRiskPolicy === true &&
    evidence.stateReasonMatchesRiskPolicy === true &&
    evidence.candidateOrderMatches === true &&
    evidence.candidateShapesMatch === true &&
    evidence.selectedSkillMatches === true &&
    evidence.arbiterLanePresent === true &&
    evidence.arbiterLaneInactive === true &&
    evidence.arbiterLaneReasonMatches === true &&
    evidence.arbiterLaneDataMatches === true
  );
}

function combineEconomyPrebuffSupervisorResult(result) {
  const source = record(result);
  const beforeEvidence = economyPrebuffEvidence(source.before);
  const afterEvidence = economyPrebuffEvidence(source.after);
  const runtimeStateRestored = source.cleanup?.runtimeStateRestored === true;
  const equipmentBaselineRestored =
    source.cleanup?.equipmentBaselineRestored === true;
  const supervisorReadOnly = source.scope?.readOnly === true;
  const supervisorValueMutationForced =
    source.scope?.valueMutationForced === true;
  const evidence = {
    ...afterEvidence,
    projectionWasVisibleBeforeSettle: beforeEvidence.projectionVisible === true,
    runtimeStateRestored,
    equipmentBaselineRestored,
    supervisorReadOnly,
    supervisorValueMutationForced,
  };
  const passed =
    source.outcome === "PASS" &&
    evidenceComplete(afterEvidence) &&
    runtimeStateRestored &&
    equipmentBaselineRestored &&
    supervisorReadOnly &&
    !supervisorValueMutationForced;

  return {
    ...source,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "ECONOMY_PREBUFF_LIVE_E2E_CONFIRMED"
      : "ECONOMY_PREBUFF_LIVE_E2E_EVIDENCE_INCOMPLETE",
    riskPolicy: source.after?.riskPolicy || null,
    economyPrebuff: source.after?.economyPrebuff || null,
    economyArbiter: source.after?.economyArbiter || null,
    evidence,
    scope: {
      ...record(source.scope),
      readOnly: true,
      economyPrebuffMutationForced: false,
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
      process.env.CARACAL_ECONOMY_PREBUFF_LIVE_SETTLE_MS || 1750,
    );
    process.stdout.write(
      "Running read-only Economy Prebuff E2E with " + selected.name + "\n",
    );
    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
    );
    const result = combineEconomyPrebuffSupervisorResult(payload.result);
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
  EXCHANGE_SKILLS,
  SOURCE_COMMIT,
  SOURCE_REPOSITORY,
  UPGRADE_COMPOUND_SKILLS,
  combineEconomyPrebuffSupervisorResult,
  economyPrebuffEvidence,
  evidenceComplete,
  normalizeCandidate,
};

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  EXCHANGE_SKILLS,
  SOURCE_COMMIT,
  SOURCE_REPOSITORY,
  UPGRADE_COMPOUND_SKILLS,
  combineEconomyPrebuffSupervisorResult,
  economyPrebuffEvidence,
  evidenceComplete,
} = require("../scripts/run_economy_prebuff_live_e2e");

const LANE_ORDER = [
  "SAFETY",
  "MERRIT",
  "CRITICAL_FARMER_LOGISTICS",
  "ECONOMY_PREBUFF",
  "ECONOMY",
  "MERCHANT_STAND",
  "BACKGROUND",
];

function riskPolicy(overrides = {}) {
  return {
    timestamp: 1000,
    enabled: true,
    state: "EMPTY",
    reason: "RISK_POLICY_NO_ESTIMATES",
    policy: {
      minExpectedDeltaGold: 0,
      minSuccessProbability: 0,
      maxInputValueGold: null,
      maxFailureLossGold: null,
      allowedKinds: ["UPGRADE", "COMPOUND"],
      unknownAlwaysBlocked: true,
    },
    selected: null,
    decisions: [],
    summary: {
      estimates: 0,
      allowed: 0,
      blocked: 0,
      unknown: 0,
      upgradeAllowed: 0,
      compoundAllowed: 0,
      selectedKind: null,
      selectedName: null,
      selectedExpectedDeltaGold: null,
    },
    ...overrides,
  };
}

function prebuffPolicy(overrides = {}) {
  return {
    preferEnhanced: true,
    buffLifetimeMs: 10000,
    upgradeCompoundSkills: [...UPGRADE_COMPOUND_SKILLS],
    exchangeSkills: [...EXCHANGE_SKILLS],
    exchangeDemandSupported: false,
    arbiterLaneActivationEnabled: false,
    executionEnabled: false,
    valueMutationForced: false,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: SOURCE_COMMIT,
    ...overrides,
  };
}

function prebuff(overrides = {}) {
  return {
    timestamp: 1000,
    enabled: true,
    state: "IDLE",
    reason: "ECONOMY_PREBUFF_NO_ECONOMY_SELECTION",
    characterClass: "merchant",
    demand: {
      kind: null,
      name: null,
      riskPolicyState: "EMPTY",
      unknown: 0,
    },
    selectedSkill: null,
    candidates: [],
    policy: prebuffPolicy(),
    ...overrides,
  };
}

function candidate(skill, overrides = {}) {
  const enhanced = skill.endsWith("pp");
  return {
    skill,
    family: "UPGRADE_COMPOUND",
    tier: enhanced ? "ENHANCED" : "BASE",
    reductionPercent: enhanced ? 90 : 50,
    configured: true,
    available: true,
    ready: true,
    reason: "ECONOMY_PREBUFF_SKILL_READY",
    levelRequired: enhanced ? 60 : 30,
    mpCost: enhanced ? 200 : 20,
    cooldownRemainingMs: 0,
    ...overrides,
  };
}

function arbiterLaneForPrebuff(status, overrides = {}) {
  return {
    lane: "ECONOMY_PREBUFF",
    rank: 3,
    active: false,
    blocked: false,
    unknown: false,
    reason:
      status.state === "READY"
        ? "ECONOMY_PREBUFF_READY_EXECUTION_DEFERRED"
        : status.reason,
    data: {
      state: status.state,
      demandKind: status.demand.kind,
      demandName: status.demand.name,
      selectedSkill: status.selectedSkill,
      riskPolicyState: status.demand.riskPolicyState,
      unknown: status.demand.unknown,
      executionEnabled: false,
      arbiterLaneActivationEnabled: false,
    },
    ...overrides,
  };
}

function arbiter(status, laneOverrides = {}) {
  const lanes = LANE_ORDER.map((name, rank) => ({
    lane: name,
    rank,
    active: false,
    blocked: false,
    unknown: false,
    reason: name + "_INACTIVE",
    data: null,
  }));
  lanes[3] = arbiterLaneForPrebuff(status, laneOverrides);
  return {
    timestamp: 1000,
    enabled: true,
    state: "IDLE",
    reason: "ECONOMY_ARBITER_IDLE",
    selected: null,
    lanes,
    summary: { active: 0, blocked: 0, unknown: 0 },
    policy: {
      laneOrder: [...LANE_ORDER],
      unknownBlocksLowerPriority: true,
      safetyBlocksLowerPriority: true,
      backgroundDynamicScoring: false,
      enforcementEnabled: false,
      executionEnabled: false,
      valueMutationForced: false,
    },
  };
}

function snapshot({
  risk = riskPolicy(),
  economyPrebuff = prebuff(),
  laneOverrides = {},
} = {}) {
  return {
    riskPolicy: risk,
    economyPrebuff,
    economyArbiter: arbiter(economyPrebuff, laneOverrides),
  };
}

function supervisorResult(options = {}) {
  const current = snapshot(options);
  return {
    request_id: "gear-scoring-live-1",
    outcome: "PASS",
    reason: "GEAR_SCORING_LIVE_RUNTIME_E2E_CONFIRMED",
    character: "My_Merchant",
    before: JSON.parse(JSON.stringify(current)),
    after: JSON.parse(JSON.stringify(current)),
    scope: {
      readOnly: true,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: false,
      equipmentMutationForced: false,
      runtimeOverrideApplied: true,
      ...(options.scope || {}),
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
      ...(options.cleanup || {}),
    },
  };
}

test("Economy Prebuff live verifier accepts the real IDLE planning shape", () => {
  const current = snapshot();
  const evidence = economyPrebuffEvidence(current);
  const result = combineEconomyPrebuffSupervisorResult(supervisorResult());

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.state, "IDLE");
  assert.equal(evidence.demandKind, null);
  assert.equal(evidence.candidateCount, 0);
  assert.equal(evidence.arbiterLaneInactive, true);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "ECONOMY_PREBUFF_LIVE_E2E_CONFIRMED");
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.economyPrebuffMutationForced, false);
});

test("Economy Prebuff live verifier accepts READY upgrade planning while lane stays inactive", () => {
  const risk = riskPolicy({
    state: "READY",
    reason: "RISK_POLICY_CANDIDATE_ALLOWED",
    selected: {
      kind: "UPGRADE",
      name: "helmet",
      currentLevel: 1,
      targetLevel: 2,
      itemSlots: [2],
      expectedDeltaGold: 100,
      successProbability: 1,
      inputValueGold: 100,
      failureOutcomeValueGold: 100,
      failureLossGold: 0,
      decision: "ALLOW",
      reason: "RISK_POLICY_ALLOWED",
    },
    summary: {
      ...riskPolicy().summary,
      estimates: 1,
      allowed: 1,
      upgradeAllowed: 1,
      selectedKind: "UPGRADE",
      selectedName: "helmet",
      selectedExpectedDeltaGold: 100,
    },
  });
  const economyPrebuff = prebuff({
    state: "READY",
    reason: "ECONOMY_PREBUFF_READY",
    demand: {
      kind: "UPGRADE",
      name: "helmet",
      riskPolicyState: "READY",
      unknown: 0,
    },
    selectedSkill: "massproductionpp",
    candidates: [candidate("massproductionpp"), candidate("massproduction")],
  });
  const evidence = economyPrebuffEvidence(snapshot({ risk, economyPrebuff }));

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.selectedSkill, "massproductionpp");
  assert.equal(evidence.candidateOrderMatches, true);
  assert.equal(evidence.arbiterLaneInactive, true);
  assert.equal(evidence.arbiterLaneReasonMatches, true);
});

test("Economy Prebuff live verifier accepts fail-closed Risk Policy UNKNOWN", () => {
  const risk = riskPolicy({
    state: "PARTIAL",
    reason: "RISK_POLICY_PARTIAL_UNKNOWN",
    summary: {
      ...riskPolicy().summary,
      estimates: 1,
      unknown: 1,
    },
  });
  const economyPrebuff = prebuff({
    state: "BLOCKED",
    reason: "ECONOMY_PREBUFF_RISK_POLICY_UNKNOWN",
    demand: {
      kind: null,
      name: null,
      riskPolicyState: "PARTIAL",
      unknown: 1,
    },
  });
  const evidence = economyPrebuffEvidence(snapshot({ risk, economyPrebuff }));

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.stateReasonMatchesRiskPolicy, true);
  assert.equal(evidence.riskUnknown, 1);
  assert.equal(evidence.selectedSkill, null);
});

test("Economy Prebuff live verifier rejects premature Arbiter lane activation", () => {
  const current = snapshot({
    laneOverrides: {
      active: true,
      reason: "ECONOMY_PREBUFF_ACTIVE",
    },
  });
  const result = combineEconomyPrebuffSupervisorResult({
    ...supervisorResult(),
    before: current,
    after: current,
  });

  assert.equal(result.evidence.arbiterLaneInactive, false);
  assert.equal(result.outcome, "FAIL");
});

test("Economy Prebuff live verifier rejects source-policy or restoration drift", () => {
  const badPrebuff = prebuff({
    policy: prebuffPolicy({
      sourceCommit: "wrong",
    }),
  });
  const sourceFailure = combineEconomyPrebuffSupervisorResult(
    supervisorResult({ economyPrebuff: badPrebuff }),
  );
  const restoreFailure = combineEconomyPrebuffSupervisorResult(
    supervisorResult({
      cleanup: {
        equipmentBaselineRestored: true,
        runtimeStateRestored: false,
      },
    }),
  );

  assert.equal(sourceFailure.evidence.sourceCommitMatches, false);
  assert.equal(sourceFailure.outcome, "FAIL");
  assert.equal(restoreFailure.evidence.runtimeStateRestored, false);
  assert.equal(restoreFailure.outcome, "FAIL");
});

test("Economy Prebuff live launcher stays on the read-only Gear Scoring supervisor", () => {
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_economy_prebuff_live_e2e.js"),
    "utf8",
  );

  assert.match(launcher, /runGearScoringSupervisorLiveTest/);
  assert.match(launcher, /ECONOMY_PREBUFF_LIVE_E2E_CONFIRMED/);
  assert.match(launcher, /arbiterLaneActivationDeferred/);
  assert.match(launcher, /executionDisabled/);
  assert.doesNotMatch(launcher, /useSkill/);
  assert.doesNotMatch(launcher, /executeNext/);
});

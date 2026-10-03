"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineRiskPolicySupervisorResult,
  decisionMatches,
  evidenceComplete,
  expectedRiskDecision,
  normalizedPolicy,
  riskPolicyEvidence,
} = require("../scripts/run_risk_policy_live_e2e");

function policy(overrides = {}) {
  return {
    minExpectedDeltaGold: 0,
    minSuccessProbability: 0,
    maxInputValueGold: null,
    maxFailureLossGold: null,
    allowedKinds: ["UPGRADE", "COMPOUND"],
    unknownAlwaysBlocked: true,
    ...overrides,
  };
}

function estimate(overrides = {}) {
  return {
    kind: "UPGRADE",
    name: "sword",
    currentLevel: 0,
    targetLevel: 1,
    itemSlots: [3],
    scrollName: "scroll0",
    scrollSlot: 4,
    probabilityGrade: 0,
    itemGrade: 0,
    scrollGrade: 0,
    successProbability: 0.8,
    currentItemValueGold: 1000,
    successItemValueGold: 2000,
    failureOutcomeValueGold: 0,
    scrollReplacementCostGold: 100,
    inputValueGold: 1100,
    expectedOutcomeValueGold: 1600,
    expectedDeltaGold: 500,
    breakEvenProbability: 0.55,
    decision: "POSITIVE_EV",
    reason: "EXPECTED_VALUE_UPGRADE_BASE_MODEL_READY",
    ...overrides,
  };
}

function expectedValue(estimates = []) {
  return {
    timestamp: 1000,
    enabled: true,
    state: estimates.length ? "READY" : "EMPTY",
    reason: estimates.length
      ? "EXPECTED_VALUE_READY"
      : "EXPECTED_VALUE_NO_CANDIDATES",
    estimates,
  };
}

function emptyRiskPolicy(overrides = {}) {
  return {
    timestamp: 1000,
    enabled: true,
    state: "EMPTY",
    reason: "RISK_POLICY_NO_ESTIMATES",
    policy: policy(),
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

function readyRiskPolicy(overrides = {}) {
  const decision = {
    kind: "UPGRADE",
    name: "sword",
    currentLevel: 0,
    targetLevel: 1,
    itemSlots: [3],
    expectedDeltaGold: 500,
    successProbability: 0.8,
    inputValueGold: 1100,
    failureOutcomeValueGold: 0,
    failureLossGold: 1100,
    decision: "ALLOW",
    reason: "RISK_POLICY_ALLOWED",
  };
  return {
    timestamp: 1000,
    enabled: true,
    state: "READY",
    reason: "RISK_POLICY_CANDIDATE_ALLOWED",
    policy: policy(),
    selected: decision,
    decisions: [decision],
    summary: {
      estimates: 1,
      allowed: 1,
      blocked: 0,
      unknown: 0,
      upgradeAllowed: 1,
      compoundAllowed: 0,
      selectedKind: "UPGRADE",
      selectedName: "sword",
      selectedExpectedDeltaGold: 500,
    },
    ...overrides,
  };
}

function supervisorResult({
  expected = expectedValue(),
  risk = emptyRiskPolicy(),
  cleanup = {},
  scope = {},
} = {}) {
  return {
    request_id: "gear-scoring-live-1",
    outcome: "PASS",
    reason: "GEAR_SCORING_LIVE_RUNTIME_E2E_CONFIRMED",
    character: "My_Merchant",
    before: {
      expectedValue: JSON.parse(JSON.stringify(expected)),
      riskPolicy: JSON.parse(JSON.stringify(risk)),
    },
    after: {
      expectedValue: JSON.parse(JSON.stringify(expected)),
      riskPolicy: JSON.parse(JSON.stringify(risk)),
    },
    scope: {
      readOnly: true,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: false,
      equipmentMutationForced: false,
      runtimeOverrideApplied: true,
      ...scope,
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
      ...cleanup,
    },
  };
}

test("Risk Policy live verifier accepts a consistent EMPTY projection", () => {
  const result = combineRiskPolicySupervisorResult(supervisorResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "RISK_POLICY_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.projectionVisible, true);
  assert.equal(result.evidence.expectedValueProjectionVisible, true);
  assert.equal(result.evidence.policyValid, true);
  assert.equal(result.evidence.unknownAlwaysBlocked, true);
  assert.equal(result.evidence.decisionsRecomputed, true);
  assert.equal(result.evidence.summaryMatches, true);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.riskPolicyMutationForced, false);
});

test("Risk Policy live verifier independently recomputes an allowed decision", () => {
  const ev = expectedValue([estimate()]);
  const risk = readyRiskPolicy();
  const snapshot = {
    expectedValue: ev,
    riskPolicy: risk,
  };
  const normalized = normalizedPolicy(risk);
  const expected = expectedRiskDecision(ev.estimates[0], normalized);
  const evidence = riskPolicyEvidence(snapshot);
  const result = combineRiskPolicySupervisorResult(
    supervisorResult({
      expected: ev,
      risk,
    }),
  );

  assert.equal(expected.decision, "ALLOW");
  assert.equal(decisionMatches(risk.decisions[0], expected), true);
  assert.equal(evidenceComplete(evidence), true);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidence.allowed, 1);
  assert.equal(result.evidence.blocked, 0);
});

test("Risk Policy live verifier rejects an invented ALLOW for negative EV", () => {
  const negative = estimate({
    expectedOutcomeValueGold: 900,
    expectedDeltaGold: -200,
    decision: "NEGATIVE_EV",
  });
  const ev = expectedValue([negative]);
  const invalid = readyRiskPolicy({
    summary: {
      ...readyRiskPolicy().summary,
      selectedExpectedDeltaGold: -200,
    },
    selected: {
      ...readyRiskPolicy().selected,
      expectedDeltaGold: -200,
    },
    decisions: [
      {
        ...readyRiskPolicy().decisions[0],
        expectedDeltaGold: -200,
      },
    ],
  });

  const evidence = riskPolicyEvidence({
    expectedValue: ev,
    riskPolicy: invalid,
  });
  const result = combineRiskPolicySupervisorResult(
    supervisorResult({
      expected: ev,
      risk: invalid,
    }),
  );

  assert.equal(evidence.decisionsRecomputed, false);
  assert.equal(result.outcome, "FAIL");
});

test("Risk Policy live verifier rejects policy drift that permits UNKNOWN", () => {
  const risk = emptyRiskPolicy({
    policy: policy({
      unknownAlwaysBlocked: false,
    }),
  });
  const result = combineRiskPolicySupervisorResult(
    supervisorResult({
      risk,
    }),
  );

  assert.equal(result.evidence.policyValid, false);
  assert.equal(result.evidence.unknownAlwaysBlocked, false);
  assert.equal(result.outcome, "FAIL");
});

test("Risk Policy live verifier requires runtime and equipment restoration", () => {
  const result = combineRiskPolicySupervisorResult(
    supervisorResult({
      cleanup: {
        runtimeStateRestored: false,
      },
    }),
  );

  assert.equal(result.evidence.runtimeStateRestored, false);
  assert.equal(result.outcome, "FAIL");
});

test("Risk Policy live verifier rejects any supervisor value mutation", () => {
  const result = combineRiskPolicySupervisorResult(
    supervisorResult({
      scope: {
        valueMutationForced: true,
      },
    }),
  );

  assert.equal(result.evidence.supervisorValueMutationForced, true);
  assert.equal(result.outcome, "FAIL");
});

test("Risk Policy live launcher stays on the read-only Gear Scoring probe", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_risk_policy_live_e2e.js"),
    "utf8",
  );

  assert.match(coordinator, /risk_policy_runtime/);
  assert.match(coordinator, /riskPolicy:/);
  assert.match(launcher, /runGearScoringSupervisorLiveTest/);
  assert.match(launcher, /RISK_POLICY_LIVE_E2E_CONFIRMED/);
  assert.match(launcher, /riskPolicyMutationForced: false/);
  assert.doesNotMatch(launcher, /executeNext/);
});


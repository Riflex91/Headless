"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineExpectedValueSupervisorResult,
  estimateEvidence,
  evidenceComplete,
  expectedValueEvidence,
} = require("../scripts/run_expected_value_live_e2e");

function model(overrides = {}) {
  return {
    valueModel: "ADVENTURE_LAND_INTRINSIC_GOLD_VALUE",
    probabilityModel: "OFFICIAL_BASE_NO_DYNAMIC_GRACE_NO_OFFERING",
    sourceRepository: "kaansoral/adventureland",
    sourceCommit: "f927df37da777eb7f048fd9209c039653a3406bd",
    marketPricesIncluded: false,
    dynamicGraceIncluded: false,
    offeringsIncluded: false,
    ...overrides,
  };
}

function emptyExpectedValue(overrides = {}) {
  return {
    timestamp: 1000,
    enabled: true,
    state: "EMPTY",
    reason: "EXPECTED_VALUE_NO_CANDIDATES",
    model: model(),
    estimates: [],
    summary: {
      upgradeCandidates: 0,
      compoundCandidates: 0,
      evaluated: 0,
      positive: 0,
      negative: 0,
      breakEven: 0,
      unknown: 0,
      bestKind: null,
      bestName: null,
      bestExpectedDeltaGold: null,
    },
    ...overrides,
  };
}

function upgradeEstimate(overrides = {}) {
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
    successProbability: 0.5,
    currentItemValueGold: 1000,
    successItemValueGold: 3000,
    failureOutcomeValueGold: 0,
    scrollReplacementCostGold: 100,
    inputValueGold: 1100,
    expectedOutcomeValueGold: 1500,
    expectedDeltaGold: 400,
    breakEvenProbability: 0.366666667,
    decision: "POSITIVE_EV",
    reason: "EXPECTED_VALUE_UPGRADE_BASE_MODEL_READY",
    ...overrides,
  };
}

function readyExpectedValue(overrides = {}) {
  return {
    timestamp: 1000,
    enabled: true,
    state: "READY",
    reason: "EXPECTED_VALUE_READY",
    model: model(),
    estimates: [upgradeEstimate()],
    summary: {
      upgradeCandidates: 1,
      compoundCandidates: 0,
      evaluated: 1,
      positive: 1,
      negative: 0,
      breakEven: 0,
      unknown: 0,
      bestKind: "UPGRADE",
      bestName: "sword",
      bestExpectedDeltaGold: 400,
    },
    ...overrides,
  };
}

function supervisorResult(
  expectedValue = emptyExpectedValue(),
  overrides = {},
) {
  return {
    request_id: "gear-scoring-live-1",
    outcome: "PASS",
    reason: "GEAR_SCORING_LIVE_RUNTIME_E2E_CONFIRMED",
    character: "My_Merchant",
    before: {
      expectedValue: JSON.parse(JSON.stringify(expectedValue)),
    },
    after: {
      expectedValue: JSON.parse(JSON.stringify(expectedValue)),
    },
    scope: {
      readOnly: true,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: false,
      equipmentMutationForced: false,
      runtimeOverrideApplied: true,
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
    },
    ...overrides,
  };
}

test("Expected Value live verifier accepts a consistent real EMPTY projection", () => {
  const result = combineExpectedValueSupervisorResult(supervisorResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "EXPECTED_VALUE_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.projectionVisible, true);
  assert.equal(result.evidence.modelPinned, true);
  assert.equal(result.evidence.estimateCount, 0);
  assert.equal(result.evidence.summaryMatches, true);
  assert.equal(result.evidence.stateMatches, true);
  assert.equal(result.evidence.reasonMatches, true);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.expectedValueMutationForced, false);
});

test("Expected Value live verifier independently recomputes estimate arithmetic", () => {
  const status = readyExpectedValue();
  const evidence = expectedValueEvidence({ expectedValue: status });
  const result = combineExpectedValueSupervisorResult(supervisorResult(status));

  assert.equal(estimateEvidence(status.estimates[0]).complete, true);
  assert.equal(evidenceComplete(evidence), true);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidence.allEstimatesRecomputed, true);
  assert.equal(result.evidence.evaluated, 1);
  assert.equal(result.evidence.unknown, 0);
});

test("Expected Value live verifier rejects incorrect expected-value arithmetic", () => {
  const invalid = readyExpectedValue({
    estimates: [
      upgradeEstimate({
        expectedOutcomeValueGold: 1600,
        expectedDeltaGold: 500,
      }),
    ],
    summary: {
      ...readyExpectedValue().summary,
      bestExpectedDeltaGold: 500,
    },
  });

  const evidence = expectedValueEvidence({ expectedValue: invalid });
  const result = combineExpectedValueSupervisorResult(
    supervisorResult(invalid),
  );

  assert.equal(evidence.allEstimatesRecomputed, false);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "EXPECTED_VALUE_LIVE_E2E_EVIDENCE_INCOMPLETE");
});

test("Expected Value live verifier rejects model drift that enables dynamic grace", () => {
  const invalid = emptyExpectedValue({
    model: model({
      dynamicGraceIncluded: true,
    }),
  });
  const result = combineExpectedValueSupervisorResult(
    supervisorResult(invalid),
  );

  assert.equal(result.evidence.modelPinned, false);
  assert.equal(result.outcome, "FAIL");
});

test("Expected Value live verifier requires runtime and equipment restoration", () => {
  const result = combineExpectedValueSupervisorResult(
    supervisorResult(emptyExpectedValue(), {
      cleanup: {
        equipmentBaselineRestored: true,
        runtimeStateRestored: false,
      },
    }),
  );

  assert.equal(result.evidence.runtimeStateRestored, false);
  assert.equal(result.outcome, "FAIL");
});

test("Expected Value live verifier rejects any supervisor value mutation", () => {
  const base = supervisorResult();
  const result = combineExpectedValueSupervisorResult({
    ...base,
    scope: {
      ...base.scope,
      valueMutationForced: true,
    },
  });

  assert.equal(result.evidence.supervisorValueMutationForced, true);
  assert.equal(result.outcome, "FAIL");
});

test("Expected Value live launcher is wired through the read-only Gear Scoring probe", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_expected_value_live_e2e.js"),
    "utf8",
  );

  assert.match(coordinator, /expected_value_runtime/);
  assert.match(coordinator, /expectedValue:/);
  assert.match(launcher, /runGearScoringSupervisorLiveTest/);
  assert.match(launcher, /EXPECTED_VALUE_LIVE_E2E_CONFIRMED/);
  assert.match(launcher, /expectedValueMutationForced: false/);
  assert.doesNotMatch(launcher, /executeNext/);
});

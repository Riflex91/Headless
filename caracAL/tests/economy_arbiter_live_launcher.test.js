"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LANE_ORDER,
  combineEconomyArbiterSupervisorResult,
  economyArbiterEvidence,
  evidenceComplete,
} = require("../scripts/run_economy_arbiter_live_e2e");

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

function lane(name, rank, overrides = {}) {
  const defaultReason =
    name === "ECONOMY" ? "RISK_POLICY_NO_ESTIMATES" : name + "_INACTIVE";
  return {
    lane: name,
    rank,
    active: false,
    blocked: false,
    unknown: false,
    reason: defaultReason,
    data:
      name === "ECONOMY"
        ? {
            state: "EMPTY",
            selectedKind: null,
            selectedName: null,
            unknown: 0,
          }
        : null,
    ...overrides,
  };
}

function arbiter(
  { activeLane = null, activeOverrides = {}, lanes = null } = {},
) {
  const values =
    lanes ||
    LANE_ORDER.map((name, rank) =>
      lane(
        name,
        rank,
        name === activeLane
          ? {
              active: true,
              reason: name + "_ACTIVE",
              ...activeOverrides,
            }
          : {},
      ),
    );
  const selected = values.find((entry) => entry.active) || null;
  let state = "IDLE";
  let reason = "ECONOMY_ARBITER_IDLE";
  if (selected?.unknown) {
    state = "UNKNOWN";
    reason = "ECONOMY_ARBITER_SELECTED_UNKNOWN";
  } else if (selected?.lane === "SAFETY") {
    state = "BLOCKED";
    reason = "ECONOMY_ARBITER_SAFETY_BLOCK";
  } else if (selected?.blocked) {
    state = "BLOCKED";
    reason = "ECONOMY_ARBITER_SELECTED_BLOCKED";
  } else if (selected) {
    state = "READY";
    reason = "ECONOMY_ARBITER_SELECTED";
  }

  return {
    timestamp: 1000,
    enabled: true,
    state,
    reason,
    selected,
    lanes: values,
    summary: {
      active: values.filter((entry) => entry.active).length,
      blocked: values.filter((entry) => entry.active && entry.blocked).length,
      unknown: values.filter((entry) => entry.active && entry.unknown).length,
    },
    policy: {
      laneOrder: [...LANE_ORDER],
      unknownBlocksLowerPriority: true,
      safetyBlocksLowerPriority: true,
      backgroundDynamicScoring: false,
      executionEnabled: false,
      valueMutationForced: false,
    },
  };
}

function snapshot({ risk = riskPolicy(), economy = arbiter() } = {}) {
  return {
    riskPolicy: risk,
    economyArbiter: economy,
  };
}

function supervisorResult({
  risk = riskPolicy(),
  economy = arbiter(),
  cleanup = {},
  scope = {},
} = {}) {
  const current = snapshot({ risk, economy });
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
      ...scope,
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
      ...cleanup,
    },
  };
}

test("Economy Arbiter live verifier accepts a consistent IDLE projection", () => {
  const evidence = economyArbiterEvidence(snapshot());
  const result = combineEconomyArbiterSupervisorResult(supervisorResult());

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.laneOrderMatches, true);
  assert.equal(evidence.summaryMatches, true);
  assert.equal(evidence.selectionMatches, true);
  assert.equal(evidence.economyActiveMatchesRiskPolicy, true);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "ECONOMY_ARBITER_LIVE_E2E_CONFIRMED");
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.economyArbiterMutationForced, false);
});

test("Economy Arbiter live verifier accepts deterministic Merrit priority", () => {
  const values = LANE_ORDER.map((name, rank) => lane(name, rank));
  values[1] = lane("MERRIT", 1, {
    active: true,
    reason: "MERRIT_TRAVEL",
  });
  values[4] = lane("ECONOMY", 4, {
    active: true,
    reason: "RISK_POLICY_CANDIDATE_ALLOWED",
    data: {
      state: "READY",
      selectedKind: "UPGRADE",
      selectedName: "sword",
      unknown: 0,
    },
  });
  const risk = riskPolicy({
    state: "READY",
    reason: "RISK_POLICY_CANDIDATE_ALLOWED",
    selected: {
      kind: "UPGRADE",
      name: "sword",
    },
    summary: {
      ...riskPolicy().summary,
      estimates: 1,
      allowed: 1,
      upgradeAllowed: 1,
      selectedKind: "UPGRADE",
      selectedName: "sword",
      selectedExpectedDeltaGold: 500,
    },
  });
  const economy = arbiter({ lanes: values });
  const evidence = economyArbiterEvidence(snapshot({ risk, economy }));

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.selectedLane, "MERRIT");
  assert.equal(evidence.stateMatches, true);
  assert.equal(evidence.economySelectionMatchesRiskPolicy, true);
});

test("Economy Arbiter live verifier accepts terminal UNKNOWN without falling through", () => {
  const values = LANE_ORDER.map((name, rank) => lane(name, rank));
  values[2] = lane("CRITICAL_FARMER_LOGISTICS", 2, {
    active: true,
    unknown: true,
    reason: "LOGISTICS_OUTCOME_UNCERTAIN",
  });
  values[6] = lane("BACKGROUND", 6, {
    active: true,
    reason: "MERCHANT_BACKGROUND_AVAILABLE",
  });
  const economy = arbiter({ lanes: values });
  const evidence = economyArbiterEvidence(snapshot({ economy }));

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.selectedLane, "CRITICAL_FARMER_LOGISTICS");
  assert.equal(economy.state, "UNKNOWN");
  assert.equal(economy.selected.unknown, true);
});

test("Economy Arbiter live verifier accepts SAFETY as the absolute top block", () => {
  const values = LANE_ORDER.map((name, rank) => lane(name, rank));
  values[0] = lane("SAFETY", 0, {
    active: true,
    blocked: true,
    reason: "EMERGENCY_STOP_ACTIVE",
  });
  values[1] = lane("MERRIT", 1, {
    active: true,
    reason: "MERRIT_READY",
  });
  const economy = arbiter({ lanes: values });
  const evidence = economyArbiterEvidence(snapshot({ economy }));

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.selectedLane, "SAFETY");
  assert.equal(economy.state, "BLOCKED");
  assert.equal(economy.reason, "ECONOMY_ARBITER_SAFETY_BLOCK");
});

test("Economy Arbiter live verifier rejects Economy lane drift from Risk Policy", () => {
  const values = LANE_ORDER.map((name, rank) => lane(name, rank));
  values[4] = lane("ECONOMY", 4, {
    active: true,
    reason: "RISK_POLICY_NO_ESTIMATES",
  });
  const economy = arbiter({ lanes: values });
  const evidence = economyArbiterEvidence(snapshot({ economy }));
  const result = combineEconomyArbiterSupervisorResult(
    supervisorResult({ economy }),
  );

  assert.equal(evidence.economyActiveMatchesRiskPolicy, false);
  assert.equal(evidenceComplete(evidence), false);
  assert.equal(result.outcome, "FAIL");
});

test("Economy Arbiter live verifier requires restoration and read-only scope", () => {
  const restoreFailure = combineEconomyArbiterSupervisorResult(
    supervisorResult({
      cleanup: {
        runtimeStateRestored: false,
      },
    }),
  );
  const mutationFailure = combineEconomyArbiterSupervisorResult(
    supervisorResult({
      scope: {
        valueMutationForced: true,
      },
    }),
  );

  assert.equal(restoreFailure.evidence.runtimeStateRestored, false);
  assert.equal(restoreFailure.outcome, "FAIL");
  assert.equal(mutationFailure.evidence.supervisorValueMutationForced, true);
  assert.equal(mutationFailure.outcome, "FAIL");
});

test("Economy Arbiter live launcher stays on the read-only Gear Scoring probe", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_economy_arbiter_live_e2e.js"),
    "utf8",
  );

  assert.match(coordinator, /economy_arbiter_runtime/);
  assert.match(coordinator, /economyArbiter:/);
  assert.match(launcher, /runGearScoringSupervisorLiveTest/);
  assert.match(launcher, /ECONOMY_ARBITER_LIVE_E2E_CONFIRMED/);
  assert.match(launcher, /economyArbiterMutationForced: false/);
  assert.match(launcher, /backgroundDynamicScoringDeferred/);
  assert.doesNotMatch(launcher, /executeNext/);
});

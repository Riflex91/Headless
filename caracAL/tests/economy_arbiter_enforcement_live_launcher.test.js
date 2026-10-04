"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  LANE_ORDER,
} = require("../scripts/run_economy_arbiter_live_e2e");
const {
  combineEconomyArbiterEnforcementSupervisorResult,
  enforcementProbeEvidence,
  probeEvidenceComplete,
} = require("../scripts/run_economy_arbiter_enforcement_live_e2e");

function riskPolicy() {
  return {
    enabled: true,
    state: "EMPTY",
    reason: "RISK_POLICY_NO_ESTIMATES",
    selected: null,
    decisions: [],
    summary: {
      estimates: 0,
      allowed: 0,
      blocked: 0,
      unknown: 0,
      selectedKind: null,
      selectedName: null,
    },
  };
}

function arbiter() {
  const lanes = LANE_ORDER.map((name, rank) => ({
    lane: name,
    rank,
    active: false,
    blocked: false,
    unknown: false,
    reason:
      name === "ECONOMY"
        ? "RISK_POLICY_NO_ESTIMATES"
        : name === "ECONOMY_PREBUFF"
          ? "ECONOMY_PREBUFF_NOT_IMPLEMENTED"
          : name + "_INACTIVE",
    data:
      name === "ECONOMY"
        ? {
            state: "EMPTY",
            selectedKind: null,
            selectedName: null,
            unknown: 0,
          }
        : null,
  }));
  return {
    enabled: true,
    state: "IDLE",
    reason: "ECONOMY_ARBITER_IDLE",
    selected: null,
    lanes,
    summary: {
      active: 0,
      blocked: 0,
      unknown: 0,
    },
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

function probe(overrides = {}) {
  return {
    requestId: "gear-scoring-live-1-enforcement-probe",
    outcome: "PASS",
    reason: "ECONOMY_ARBITER_ENFORCEMENT_PROBE_CONFIRMED",
    before: {
      policy: {
        enforcementEnabled: false,
      },
    },
    enforced: {
      policy: {
        enforcementEnabled: true,
      },
    },
    restored: {
      policy: {
        enforcementEnabled: false,
      },
    },
    action: {
      id: "A-probe",
      status: "BLOCKED",
      metadata: {
        policyBlock: {
          reason: "ECONOMY_ARBITER_LANE_NOT_SELECTED",
          lane: "ECONOMY_PREBUFF",
          selectedLane: null,
          arbiterState: "IDLE",
        },
      },
    },
    evidence: {
      enforcementEnabledObserved: true,
      requestedLane: "ECONOMY_PREBUFF",
      blockedByArbiter: true,
      policyBlock: {
        reason: "ECONOMY_ARBITER_LANE_NOT_SELECTED",
        lane: "ECONOMY_PREBUFF",
        selectedLane: null,
        arbiterState: "IDLE",
      },
      actionBlocked: true,
      actionDispatched: false,
      secondaryPreflightGuardPresent: true,
    },
    scope: {
      readOnly: true,
      adventureLandMutationDispatched: false,
      valueMutationForced: false,
    },
    cleanup: {
      configRestored: true,
    },
    ...overrides,
  };
}

function supervisorResult(overrides = {}) {
  const snapshot = {
    riskPolicy: riskPolicy(),
    economyArbiter: arbiter(),
  };
  return {
    request_id: "gear-scoring-live-1",
    outcome: "PASS",
    reason: "GEAR_SCORING_LIVE_RUNTIME_E2E_CONFIRMED",
    character: "My_Merchant",
    before: JSON.parse(JSON.stringify(snapshot)),
    after: JSON.parse(JSON.stringify(snapshot)),
    enforcementProbe: probe(),
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

test("enforcement live verifier accepts a blocked non-dispatched probe", () => {
  const evidence = enforcementProbeEvidence(probe());
  const result = combineEconomyArbiterEnforcementSupervisorResult(
    supervisorResult(),
  );

  assert.equal(probeEvidenceComplete(evidence), true);
  assert.equal(evidence.blockedByArbiter, true);
  assert.equal(evidence.actionNeverDispatched, true);
  assert.equal(evidence.configRestored, true);
  assert.equal(result.outcome, "PASS");
  assert.equal(
    result.reason,
    "ECONOMY_ARBITER_ENFORCEMENT_LIVE_E2E_CONFIRMED",
  );
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.adventureLandMutationDispatched, false);
});

test("enforcement live verifier rejects any dispatched probe mutation", () => {
  const unsafeProbe = probe({
    action: {
      id: "A-probe",
      status: "DISPATCHED",
      dispatchedAt: 1200,
      metadata: {
        policyBlock: null,
      },
    },
    evidence: {
      ...probe().evidence,
      blockedByArbiter: false,
      policyBlock: {},
      actionBlocked: false,
      actionDispatched: true,
    },
    scope: {
      readOnly: false,
      adventureLandMutationDispatched: true,
    },
  });
  const result = combineEconomyArbiterEnforcementSupervisorResult(
    supervisorResult({ enforcementProbe: unsafeProbe }),
  );

  assert.equal(result.evidence.probe.actionNeverDispatched, false);
  assert.equal(result.evidence.probe.adventureLandMutationDispatched, true);
  assert.equal(result.outcome, "FAIL");
});

test("enforcement live verifier requires probe config and supervisor restoration", () => {
  const badProbe = probe({
    restored: {
      policy: {
        enforcementEnabled: true,
      },
    },
    cleanup: {
      configRestored: false,
    },
  });
  const probeFailure = combineEconomyArbiterEnforcementSupervisorResult(
    supervisorResult({ enforcementProbe: badProbe }),
  );
  const runtimeFailure = combineEconomyArbiterEnforcementSupervisorResult(
    supervisorResult({
      cleanup: {
        equipmentBaselineRestored: true,
        runtimeStateRestored: false,
      },
    }),
  );

  assert.equal(probeFailure.evidence.probe.configRestored, false);
  assert.equal(probeFailure.outcome, "FAIL");
  assert.equal(runtimeFailure.evidence.runtimeStateRestored, false);
  assert.equal(runtimeFailure.outcome, "FAIL");
});

test("enforcement live probe is double-guarded and uses the real runtime boundary", () => {
  const runtime = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
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
  const launcher = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "scripts",
      "run_economy_arbiter_enforcement_live_e2e.js",
    ),
    "utf8",
  );

  assert.match(runtime, /runEconomyArbiterEnforcementProbe/);
  assert.match(runtime, /skill: "massproduction"/);
  assert.match(runtime, /targetId: "__economy_arbiter_probe__"/);
  assert.match(runtime, /targetIds: \["__economy_arbiter_probe__"\]/);
  assert.match(runtime, /secondaryPreflightGuardPresent: true/);
  assert.match(runtime, /clearConfigOverride/);
  assert.match(thread, /economy_arbiter_enforcement_probe_result/);
  assert.match(coordinator, /economyArbiterEnforcementProbe/);
  assert.match(launcher, /economyArbiterEnforcementProbe: true/);
  assert.match(
    launcher,
    /ECONOMY_ARBITER_ENFORCEMENT_LIVE_E2E_CONFIRMED/,
  );
  assert.doesNotMatch(launcher, /executeNext/);
});

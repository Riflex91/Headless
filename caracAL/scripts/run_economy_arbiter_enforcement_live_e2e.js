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
const {
  economyArbiterEvidence,
  evidenceComplete: arbiterEvidenceComplete,
} = require("./run_economy_arbiter_live_e2e");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function enforcementProbeEvidence(value) {
  const probe = record(value);
  const action = record(probe.action);
  const evidence = record(probe.evidence);
  const policyBlock = record(evidence.policyBlock);
  const scope = record(probe.scope);
  const cleanup = record(probe.cleanup);
  const beforePolicy = record(record(probe.before).policy);
  const restoredPolicy = record(record(probe.restored).policy);
  const blockReason =
    typeof policyBlock.reason === "string" ? policyBlock.reason : null;

  return {
    probePassed: probe.outcome === "PASS",
    probeReasonMatches:
      probe.reason === "ECONOMY_ARBITER_ENFORCEMENT_PROBE_CONFIRMED",
    enforcementEnabledObserved: evidence.enforcementEnabledObserved === true,
    requestedLaneMatches: evidence.requestedLane === "ECONOMY_PREBUFF",
    blockedByArbiter: evidence.blockedByArbiter === true,
    policyBlockLaneMatches: policyBlock.lane === "ECONOMY_PREBUFF",
    policyBlockReasonMatches:
      blockReason !== null && blockReason.startsWith("ECONOMY_ARBITER_"),
    actionBlocked:
      action.status === "BLOCKED" && evidence.actionBlocked === true,
    actionNeverDispatched:
      action.dispatchedAt == null && evidence.actionDispatched === false,
    secondaryPreflightGuardPresent:
      evidence.secondaryPreflightGuardPresent === true,
    readOnly: scope.readOnly === true,
    adventureLandMutationDispatched:
      scope.adventureLandMutationDispatched === true,
    configRestored: cleanup.configRestored === true,
    originalEnforcementRestored:
      restoredPolicy.enforcementEnabled === beforePolicy.enforcementEnabled,
  };
}

function probeEvidenceComplete(evidence) {
  return (
    evidence.probePassed === true &&
    evidence.probeReasonMatches === true &&
    evidence.enforcementEnabledObserved === true &&
    evidence.requestedLaneMatches === true &&
    evidence.blockedByArbiter === true &&
    evidence.policyBlockLaneMatches === true &&
    evidence.policyBlockReasonMatches === true &&
    evidence.actionBlocked === true &&
    evidence.actionNeverDispatched === true &&
    evidence.secondaryPreflightGuardPresent === true &&
    evidence.readOnly === true &&
    evidence.adventureLandMutationDispatched === false &&
    evidence.configRestored === true &&
    evidence.originalEnforcementRestored === true
  );
}

function combineEconomyArbiterEnforcementSupervisorResult(result) {
  const source = record(result);
  const arbiterEvidence = economyArbiterEvidence(source.after);
  const probeEvidence = enforcementProbeEvidence(source.enforcementProbe);
  const runtimeStateRestored = source.cleanup?.runtimeStateRestored === true;
  const equipmentBaselineRestored =
    source.cleanup?.equipmentBaselineRestored === true;
  const supervisorReadOnly = source.scope?.readOnly === true;
  const supervisorValueMutationForced =
    source.scope?.valueMutationForced === true;
  const passed =
    source.outcome === "PASS" &&
    arbiterEvidenceComplete(arbiterEvidence) &&
    probeEvidenceComplete(probeEvidence) &&
    runtimeStateRestored &&
    equipmentBaselineRestored &&
    supervisorReadOnly &&
    !supervisorValueMutationForced;

  return {
    ...source,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "ECONOMY_ARBITER_ENFORCEMENT_LIVE_E2E_CONFIRMED"
      : "ECONOMY_ARBITER_ENFORCEMENT_LIVE_E2E_EVIDENCE_INCOMPLETE",
    economyArbiter: source.after?.economyArbiter || null,
    enforcementProbe: source.enforcementProbe || null,
    evidence: {
      arbiter: arbiterEvidence,
      probe: probeEvidence,
      runtimeStateRestored,
      equipmentBaselineRestored,
      supervisorReadOnly,
      supervisorValueMutationForced,
    },
    scope: {
      ...record(source.scope),
      readOnly: true,
      adventureLandMutationDispatched: false,
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
      configRestored: probeEvidence.configRestored,
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
      process.env.CARACAL_ECONOMY_ARBITER_ENFORCEMENT_SETTLE_MS || 1750,
    );
    process.stdout.write(
      "Running mutation-safe Economy Arbiter enforcement E2E with " +
        selected.name +
        "\n",
    );
    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
      {
        economyArbiterEnforcementProbe: true,
      },
    );
    const result = combineEconomyArbiterEnforcementSupervisorResult(
      payload.result,
    );
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
  combineEconomyArbiterEnforcementSupervisorResult,
  enforcementProbeEvidence,
  probeEvidenceComplete,
};

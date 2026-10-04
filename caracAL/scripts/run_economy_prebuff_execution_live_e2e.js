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

function coupledExecutionEvidence(value) {
  const probe = record(value);
  const execution = record(probe.execution);
  const policy = record(execution.policy);
  const prebuffAction = record(execution.prebuffAction);
  const economyAction = record(execution.economyAction);
  const evidence = record(probe.evidence);
  const scope = record(probe.scope);
  const cleanup = record(probe.cleanup);
  const beforeArbiter = record(probe.beforeArbiter);
  const beforePolicy = record(beforeArbiter.policy);
  const restored = record(probe.restored);
  const restoredPolicy = record(restored.policy);

  return {
    probePassed: probe.outcome === "PASS",
    probeReasonMatches:
      probe.reason === "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    executionConfirmed: execution.state === "CONFIRMED",
    executionReasonMatches:
      execution.reason === "ECONOMY_PREBUFF_COUPLED_EXECUTION_CONFIRMED",
    supportedKind:
      execution.kind === "UPGRADE" || execution.kind === "COMPOUND",
    selectedSkillPresent:
      typeof execution.selectedSkill === "string" &&
      execution.selectedSkill.length > 0,
    prebuffConfirmed: prebuffAction.status === "CONFIRMED",
    economyConfirmed: economyAction.status === "CONFIRMED",
    distinctActionIds:
      typeof prebuffAction.id === "string" &&
      typeof economyAction.id === "string" &&
      prebuffAction.id !== economyAction.id,
    noUnknownHold: execution.unknownStage == null,
    explicitOneShot: policy.explicitOneShot === true,
    arbiterEnforcementRequired: policy.arbiterEnforcementRequired === true,
    prebuffMustConfirmBeforeEconomy:
      policy.prebuffMustConfirmBeforeEconomy === true,
    revalidateAfterPrebuff: policy.revalidateAfterPrebuff === true,
    maxValueMutations: Number(policy.maxValueMutations),
    blindRetryAllowed: policy.blindRetryAllowed === true,
    exchangeSupported: policy.exchangeSupported === true,
    enforcementEnabledObserved: evidence.enforcementEnabledObserved === true,
    exactlyOnePrebuffAttempt: evidence.exactlyOnePrebuffAttempt === true,
    valueMutationAttempted: evidence.valueMutationAttempted === true,
    maxValueMutationsRespected:
      evidence.maxValueMutationsRespected === true,
    evidenceBlindRetryAllowed: evidence.blindRetryAllowed === true,
    confirmedCoupling: evidence.confirmedCoupling === true,
    scopeReadOnly: scope.readOnly === true,
    irreversibleMutationAllowed:
      scope.irreversibleMutationAllowed === true,
    prebuffMutationForced: scope.prebuffMutationForced === true,
    valueMutationForced: scope.valueMutationForced === true,
    scopeMaxValueMutations: Number(scope.maxValueMutations),
    upgradeOrCompoundOnly:
      (execution.kind === "UPGRADE" &&
        scope.upgradeMutationForced === true &&
        scope.compoundMutationForced === false) ||
      (execution.kind === "COMPOUND" &&
        scope.compoundMutationForced === true &&
        scope.upgradeMutationForced === false),
    exchangeMutationForced: scope.exchangeMutationForced === true,
    craftMutationForced: scope.craftMutationForced === true,
    logisticsMutationForced: scope.logisticsMutationForced === true,
    configRestored: cleanup.configRestored === true,
    schedulerRestored: cleanup.schedulerRestored === true,
    originalEnforcementRestored:
      restoredPolicy.enforcementEnabled === beforePolicy.enforcementEnabled,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.probePassed === true &&
    evidence.probeReasonMatches === true &&
    evidence.executionConfirmed === true &&
    evidence.executionReasonMatches === true &&
    evidence.supportedKind === true &&
    evidence.selectedSkillPresent === true &&
    evidence.prebuffConfirmed === true &&
    evidence.economyConfirmed === true &&
    evidence.distinctActionIds === true &&
    evidence.noUnknownHold === true &&
    evidence.explicitOneShot === true &&
    evidence.arbiterEnforcementRequired === true &&
    evidence.prebuffMustConfirmBeforeEconomy === true &&
    evidence.revalidateAfterPrebuff === true &&
    evidence.maxValueMutations === 1 &&
    evidence.blindRetryAllowed === false &&
    evidence.exchangeSupported === false &&
    evidence.enforcementEnabledObserved === true &&
    evidence.exactlyOnePrebuffAttempt === true &&
    evidence.valueMutationAttempted === true &&
    evidence.maxValueMutationsRespected === true &&
    evidence.evidenceBlindRetryAllowed === false &&
    evidence.confirmedCoupling === true &&
    evidence.scopeReadOnly === false &&
    evidence.irreversibleMutationAllowed === true &&
    evidence.prebuffMutationForced === true &&
    evidence.valueMutationForced === true &&
    evidence.scopeMaxValueMutations === 1 &&
    evidence.upgradeOrCompoundOnly === true &&
    evidence.exchangeMutationForced === false &&
    evidence.craftMutationForced === false &&
    evidence.logisticsMutationForced === false &&
    evidence.configRestored === true &&
    evidence.schedulerRestored === true &&
    evidence.originalEnforcementRestored === true
  );
}

function combineEconomyPrebuffExecutionSupervisorResult(result) {
  const source = record(result);
  const probe = record(source.coupledExecution);
  const probeEvidence = coupledExecutionEvidence(probe);
  const runtimeStateRestored = source.cleanup?.runtimeStateRestored === true;
  const equipmentBaselineRestored =
    source.cleanup?.equipmentBaselineRestored === true;
  const supervisorReadOnly = source.scope?.readOnly === true;
  const supervisorMaxValueMutations = Number(
    source.scope?.maxValueMutations || 0,
  );
  const supervisorBlindRetryAllowed =
    source.scope?.blindRetryAllowed === true;

  const passed =
    source.outcome === "PASS" &&
    evidenceComplete(probeEvidence) &&
    runtimeStateRestored &&
    equipmentBaselineRestored &&
    supervisorReadOnly === false &&
    supervisorMaxValueMutations === 1 &&
    supervisorBlindRetryAllowed === false;

  return {
    ...source,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED"
      : "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_EVIDENCE_INCOMPLETE",
    coupledExecution: probe,
    economyPrebuffExecution: probe.execution || source.after?.economyPrebuffExecution || null,
    evidence: {
      probe: probeEvidence,
      runtimeStateRestored,
      equipmentBaselineRestored,
      supervisorReadOnly,
      supervisorMaxValueMutations,
      supervisorBlindRetryAllowed,
    },
    scope: {
      ...record(source.scope),
      readOnly: false,
      irreversibleMutationAllowed: true,
      maxValueMutations: 1,
      blindRetryAllowed: false,
      prebuffMutationForced: probe.scope?.prebuffMutationForced === true,
      valueMutationForced: probe.scope?.valueMutationForced === true,
      movementMutationForced: false,
      combatMutationForced: false,
      equipmentMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
      logisticsMutationForced: false,
    },
    cleanup: {
      ...record(source.cleanup),
      runtimeStateRestored,
      equipmentBaselineRestored,
      configRestored: probeEvidence.configRestored,
      schedulerRestored: probeEvidence.schedulerRestored,
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
      process.env.CARACAL_ECONOMY_PREBUFF_EXECUTION_LIVE_SETTLE_MS || 1750,
    );
    process.stdout.write(
      "Running guarded value-changing Economy Prebuff execution E2E with " +
        selected.name +
        "\n",
    );
    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
      {
        economyPrebuffExecutionLiveTest: true,
      },
    );
    const result = combineEconomyPrebuffExecutionSupervisorResult(
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
  combineEconomyPrebuffExecutionSupervisorResult,
  coupledExecutionEvidence,
  evidenceComplete,
};

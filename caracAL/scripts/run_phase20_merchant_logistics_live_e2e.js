"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const {
  readState,
  runPhase20IntegrationSupervisorLiveTest,
} = require("./run_phase20_integration_live_e2e");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function evaluatePhase20MerchantLogisticsResult(payload, options = {}) {
  const expectedPhase =
    typeof options.phase === "string" ? options.phase : "20.0c";
  const expectedReason =
    typeof options.reason === "string"
      ? options.reason
      : "PHASE20_INTEGRATION_MERCHANT_LOGISTICS_CONFIRMED";
  const supervisor = record(payload?.result);
  const evidence = record(supervisor.evidence);
  const group = record(evidence.groupCombat);
  const parallelGroup = record(evidence.groupCombatParallel);
  const merchant = record(evidence.merchantParallel);
  const logistics = record(evidence.logistics);
  const logisticsObservation = record(logistics.observation);
  const logisticsResult = record(logisticsObservation.result);
  const scope = record(supervisor.scope);
  const cleanup = record(supervisor.cleanup);
  const farmers = array(evidence.farmers);
  const selected = array(evidence.selectedCharacters);
  const runtimeSources = array(evidence.runtimeSources);
  const parallelAttackCounts = record(parallelGroup.attackCounts);
  const parallelFocusObserved = record(parallelGroup.focusObserved);

  const identityValid =
    typeof evidence.merchant === "string" &&
    evidence.merchant.length > 0 &&
    farmers.length === 3 &&
    new Set(farmers).size === 3 &&
    selected.length === 4 &&
    new Set(selected).size === 4 &&
    selected.includes(evidence.merchant) &&
    farmers.every((name) => selected.includes(name)) &&
    !farmers.includes(evidence.merchant);

  const runtimeValid =
    evidence.allOnline === true &&
    evidence.allRunning === true &&
    evidence.normalRuntimeAll === true &&
    evidence.slotLimitValid === true &&
    Number(evidence.activeCharacters) === 4 &&
    Number(evidence.maxOnlineCharacters) >= 4 &&
    runtimeSources.length === 4 &&
    runtimeSources.every(
      (entry) =>
        entry?.connected === true &&
        entry?.lifecycleState === "ONLINE" &&
        entry?.desiredRuntimeState === "RUNNING" &&
        entry?.typescriptFile === "bot/main.js" &&
        entry?.lifecycleOnlyProbe === false &&
        entry?.normalRuntime === true,
    );

  const groupValid =
    group.apply?.ok === true &&
    group.observed === true &&
    group.partyFormed === true &&
    group.partyEvidenceMode === "LEADER_AUTHORITATIVE" &&
    group.leaderPartyFormed === true &&
    group.resourceRecoveryUnknown === false &&
    group.merchantOnlineDuringCombat === true &&
    group.merchantNotInParty === true &&
    Number(group.unknownAttackCount) === 0 &&
    Number(group.unknownMovementCount) === 0 &&
    group.movementOwnerValid === true &&
    parallelGroup.observed === true &&
    parallelGroup.partyFormed === true &&
    parallelGroup.partyEvidenceMode === "LEADER_AUTHORITATIVE" &&
    parallelGroup.leaderPartyFormed === true &&
    parallelGroup.resourceRecoveryUnknown === false &&
    Number(parallelGroup.confirmedAttackCount) >= 3 &&
    Number(parallelGroup.unknownAttackCount) === 0 &&
    Number(parallelGroup.unknownMovementCount) === 0 &&
    parallelGroup.movementOwnerValid === true &&
    farmers.every((name) => Number(parallelAttackCounts[name]) >= 1) &&
    Object.values(parallelFocusObserved).every((value) => value === true);

  const merchantValid =
    merchant.autonomousBeforeValid === true &&
    merchant.logisticsRendezvousValid === true &&
    merchant.autonomousAfterValid === true &&
    merchant.merchantOnlineAfter === true &&
    merchant.merchantNotInParty === true &&
    Number(merchant.unknownMovementCount) === 0 &&
    Number(merchant.processExitCount) === 0 &&
    Number(merchant.reconnectCount) === 0 &&
    merchant.autonomousBefore?.result?.bankTravel?.state === "READY" &&
    merchant.autonomousBefore?.result?.bankTravel?.lastAction?.status ===
      "CONFIRMED" &&
    merchant.autonomousAfter?.result?.bankTravel?.state === "READY" &&
    merchant.autonomousAfter?.result?.bankTravel?.lastAction?.status ===
      "CONFIRMED" &&
    merchant.autonomousAfter?.result?.bankTravel?.lastAction?.id !==
      merchant.autonomousBefore?.result?.bankTravel?.lastAction?.id;

  const logisticsValid =
    typeof logistics.sourceFarmer === "string" &&
    farmers.includes(logistics.sourceFarmer) &&
    logistics.merchantIndependent === true &&
    logistics.dispatchStarted === true &&
    logistics.settled === true &&
    Number(logistics.dispatchCount) === 1 &&
    logistics.confirmed === true &&
    logistics.claimReasonMatched === true &&
    logistics.completionSuppressed === true &&
    logistics.pingPongValid === true &&
    logistics.noBlindRetry === true &&
    logisticsObservation.completionSuppressed === true &&
    logisticsResult.outcome === "CONFIRMED" &&
    typeof logisticsObservation.claim?.reason === "string" &&
    logisticsResult.reason === logisticsObservation.claim.reason &&
    logisticsResult.fulfilled === true &&
    Number(logisticsResult.amount) === 1 &&
    typeof logisticsResult.actionId === "string" &&
    logisticsResult.actionId.length > 0;

  const scopeValid =
    supervisor.phase === expectedPhase &&
    scope.normalRuntime === true &&
    scope.lifecycleOnlyProbe === false &&
    scope.lifecycleMutationDispatched === true &&
    scope.gameplayMutationForced === true &&
    scope.valueMutationForced === true &&
    scope.automaticLogisticsDispatchSuppressed === true &&
    scope.controlledLogisticsDispatchEnabled === true &&
    scope.combatEvidenceRequired === true &&
    scope.logisticsEvidenceRequired === true &&
    scope.merchantAutonomyEvidenceRequired === true;

  const cleanupValid =
    cleanup.groupProbeCleared === true &&
    cleanup.merchantProbeCleared === true &&
    cleanup.logisticsOverridesRestored === true &&
    cleanup.runtimeStateRestored === true &&
    array(cleanup.restoredRunning).length ===
      array(cleanup.originallyRunning).length;

  const pass =
    supervisor.outcome === "PASS" &&
    supervisor.reason === expectedReason &&
    identityValid &&
    runtimeValid &&
    groupValid &&
    merchantValid &&
    logisticsValid &&
    scopeValid &&
    cleanupValid;

  return {
    ...supervisor,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? expectedReason
      : supervisor.reason ||
        "PHASE20_INTEGRATION_MERCHANT_LOGISTICS_EVIDENCE_INCOMPLETE",
    evidence,
    scope,
    cleanup,
    identityValid,
    runtimeValid,
    groupValid,
    merchantValid,
    logisticsValid,
    scopeValid,
    cleanupValid,
  };
}

function formatCompactResult(result, options = {}) {
  const title =
    typeof options.title === "string"
      ? options.title
      : "Phase 20.0c Merchant Parallel Autonomy + Logistics Live E2E";
  const evidence = record(result?.evidence);
  const group = record(evidence.groupCombatParallel);
  const merchant = record(evidence.merchantParallel);
  const logistics = record(evidence.logistics);
  const cleanup = record(result?.cleanup);
  return (
    [
      title,
      "Outcome: " + (result?.outcome || "UNKNOWN"),
      "Reason: " + (result?.reason || "UNKNOWN"),
      "Merchant: " + (evidence.merchant || "NONE"),
      "Farmers: " + array(evidence.farmers).join(", "),
      "Parallel confirmed attacks: " +
        String(group.confirmedAttackCount ?? "UNKNOWN"),
      "Party evidence mode: " + (group.partyEvidenceMode || "UNKNOWN"),
      "Resource recovery unknown: " +
        (group.resourceRecoveryUnknown === true ? "yes" : "no"),
      "Merchant autonomous before: " +
        (merchant.autonomousBeforeValid === true ? "yes" : "no"),
      "Logistics rendezvous: " +
        (merchant.logisticsRendezvousValid === true ? "yes" : "no"),
      "Logistics source: " + (logistics.sourceFarmer || "NONE"),
      "Logistics dispatch count: " +
        String(logistics.dispatchCount ?? "UNKNOWN"),
      "Logistics confirmed: " + (logistics.confirmed === true ? "yes" : "no"),
      "Completion suppression: " +
        (logistics.completionSuppressed === true ? "yes" : "no"),
      "Ping-pong guard valid: " +
        (logistics.pingPongValid === true ? "yes" : "no"),
      "Merchant autonomous after: " +
        (merchant.autonomousAfterValid === true ? "yes" : "no"),
      "Merchant not in party: " +
        (merchant.merchantNotInParty === true ? "yes" : "no"),
      "Unknown merchant movement: " +
        String(merchant.unknownMovementCount ?? "UNKNOWN"),
      "Runtime exits during parallel window: " +
        String(merchant.processExitCount ?? "UNKNOWN"),
      "Group probe cleared: " +
        (cleanup.groupProbeCleared === true ? "yes" : "no"),
      "Merchant probe cleared: " +
        (cleanup.merchantProbeCleared === true ? "yes" : "no"),
      "Logistics overrides restored: " +
        (cleanup.logisticsOverridesRestored === true ? "yes" : "no"),
      "Runtime state restored: " +
        (cleanup.runtimeStateRestored === true ? "yes" : "no"),
    ].join("\n") + "\n"
  );
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "caracAL dashboard was not running; using temporary normal supervisor\n"
        : "Using existing caracAL runtime\n",
    );

    const payload = await runPhase20IntegrationSupervisorLiveTest({
      stage: "20.0c",
    });
    const result = evaluatePhase20MerchantLogisticsResult(payload);

    if (verbose) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(formatCompactResult(result));
    }

    if (result.outcome !== "PASS") {
      process.exitCode = 1;
    }
  } finally {
    if (managedRuntime) {
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
  evaluatePhase20MerchantLogisticsResult,
  formatCompactResult,
};

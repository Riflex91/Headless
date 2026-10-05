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

function evaluatePhase20GroupCombatResult(payload) {
  const supervisor = record(payload?.result);
  const evidence = record(supervisor.evidence);
  const group = record(evidence.groupCombat);
  const scope = record(supervisor.scope);
  const cleanup = record(supervisor.cleanup);
  const farmers = array(evidence.farmers);
  const selected = array(evidence.selectedCharacters);
  const runtimeSources = array(evidence.runtimeSources);
  const attackCounts = record(group.attackCounts);
  const focusObserved = record(group.focusObserved);

  const identityValid =
    evidence.merchant &&
    farmers.length === 3 &&
    new Set(farmers).size === 3 &&
    selected.length === 4 &&
    new Set(selected).size === 4 &&
    selected.includes(evidence.merchant) &&
    farmers.every((name) => selected.includes(name));

  const runtimeValid =
    evidence.allOnline === true &&
    evidence.allRunning === true &&
    evidence.normalRuntimeAll === true &&
    evidence.slotLimitValid === true &&
    Number(evidence.activeCharacters) === 4 &&
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
    Number(group.confirmedAttackCount) >= 3 &&
    Number(group.unknownAttackCount) === 0 &&
    Number(group.unknownMovementCount) === 0 &&
    group.movementOwnerValid === true &&
    group.merchantOnlineDuringCombat === true &&
    farmers.every((name) => Number(attackCounts[name]) >= 1) &&
    Object.values(focusObserved).every((value) => value === true);

  const scopeValid =
    supervisor.phase === "20.0b" &&
    scope.normalRuntime === true &&
    scope.lifecycleOnlyProbe === false &&
    scope.lifecycleMutationDispatched === true &&
    scope.gameplayMutationForced === true &&
    scope.valueMutationForced === false &&
    scope.automaticLogisticsDispatchSuppressed === true &&
    scope.combatEvidenceRequired === true &&
    scope.logisticsEvidenceRequired === false;

  const cleanupValid =
    cleanup.groupProbeCleared === true &&
    cleanup.runtimeStateRestored === true &&
    array(cleanup.restoredRunning).length ===
      array(cleanup.originallyRunning).length;

  const pass =
    supervisor.outcome === "PASS" &&
    supervisor.reason === "PHASE20_INTEGRATION_GROUP_COMBAT_CONFIRMED" &&
    identityValid &&
    runtimeValid &&
    groupValid &&
    scopeValid &&
    cleanupValid;

  return {
    ...supervisor,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "PHASE20_INTEGRATION_GROUP_COMBAT_CONFIRMED"
      : supervisor.reason ||
        "PHASE20_INTEGRATION_GROUP_COMBAT_EVIDENCE_INCOMPLETE",
    evidence,
    scope,
    cleanup,
    identityValid,
    runtimeValid,
    groupValid,
    scopeValid,
    cleanupValid,
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const group = record(evidence.groupCombat);
  const cleanup = record(result?.cleanup);
  return [
    "Phase 20.0b 3-Farmer Group Combat Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "Merchant: " + (evidence.merchant || "NONE"),
    "Farmers: " + array(evidence.farmers).join(", "),
    "Party formed: " + (group.partyFormed === true ? "yes" : "no"),
    "Confirmed attacks: " + String(group.confirmedAttackCount ?? "UNKNOWN"),
    "Unknown attacks: " + String(group.unknownAttackCount ?? "UNKNOWN"),
    "Unknown movement outcomes: " +
      String(group.unknownMovementCount ?? "UNKNOWN"),
    "Movement ownership valid: " +
      (group.movementOwnerValid === true ? "yes" : "no"),
    "Merchant stayed online: " +
      (group.merchantOnlineDuringCombat === true ? "yes" : "no"),
    "Group probe cleared: " +
      (cleanup.groupProbeCleared === true ? "yes" : "no"),
    "Runtime state restored: " +
      (cleanup.runtimeStateRestored === true ? "yes" : "no"),
  ].join("\n") + "\n";
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
      stage: "20.0b",
    });
    const result = evaluatePhase20GroupCombatResult(payload);

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
  evaluatePhase20GroupCombatResult,
  formatCompactResult,
};

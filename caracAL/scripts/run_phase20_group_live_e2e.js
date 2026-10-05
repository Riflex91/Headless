"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = String(
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924",
).replace(/\/$/, "");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function parseCliArgs(argv = process.argv.slice(2)) {
  return {
    verbose: argv.includes("--verbose"),
  };
}

async function readState({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(baseUrl + "/headless/api/state", {
    method: "GET",
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body?.message ||
        body?.error ||
        `HTTP ${response.status} from caracAL dashboard`,
    );
  }
  return body;
}

async function runPhase20GroupSupervisorLiveTest({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(
    baseUrl + "/headless/api/tests/phase20-integration/group",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const responseText = await response.text();
  const body = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    const error = new Error(
      body?.message ||
        body?.error ||
        `HTTP ${response.status} from caracAL dashboard`,
    );
    error.code = body?.error || "PHASE20_GROUP_TRIO_LIVE_TEST_REQUEST_FAILED";
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function evaluatePhase20GroupSupervisorResult(payload) {
  const supervisor = record(payload?.result);
  const evidence = record(supervisor.evidence);
  const group = record(evidence.group);
  const scope = record(supervisor.scope);
  const cleanup = record(supervisor.cleanup);
  const farmers = array(evidence.farmers);
  const selected = array(evidence.selectedCharacters);
  const runtimeSources = array(evidence.runtimeSources);
  const groupMembers = array(group.members);
  const groupResults = array(group.results);

  const identityValid =
    typeof evidence.merchant === "string" &&
    evidence.merchant.length > 0 &&
    farmers.length === 3 &&
    new Set(farmers).size === 3 &&
    !farmers.includes(evidence.merchant) &&
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

  const groupIdentityValid =
    typeof group.leader === "string" &&
    farmers.includes(group.leader) &&
    array(group.followers).length === 2 &&
    groupMembers.length === 3 &&
    new Set(groupMembers).size === 3 &&
    farmers.every((name) => groupMembers.includes(name));

  const groupEvidenceValid =
    group.leaderRunning === true &&
    group.trioFormed === true &&
    groupResults.length === 3 &&
    groupResults.every(
      (entry) =>
        farmers.includes(entry?.character) &&
        entry?.outcome === "PASS" &&
        array(entry?.configuredMembers).length === 3 &&
        farmers.every((name) => entry.configuredMembers.includes(name)) &&
        array(entry?.observedMembers).length >= 3 &&
        farmers.every((name) => entry.observedMembers.includes(name)) &&
        entry?.roleProjected === true &&
        entry?.leaderProjected === true &&
        entry?.initialPartyRestored === true,
    );

  const scopeValid =
    supervisor.phase === "20.0b1" &&
    scope.normalRuntime === true &&
    scope.lifecycleOnlyProbe === false &&
    scope.lifecycleMutationDispatched === true &&
    scope.gameplayMutationForced === false &&
    scope.valueMutationForced === false &&
    scope.automaticLogisticsDispatchSuppressed === true &&
    scope.groupFormationRequired === true &&
    scope.combatEvidenceRequired === false &&
    scope.logisticsEvidenceRequired === false;

  const cleanupValid =
    cleanup.runtimeStateRestored === true &&
    array(cleanup.restoredRunning).length ===
      array(cleanup.originallyRunning).length;

  const pass =
    supervisor.outcome === "PASS" &&
    supervisor.reason === "PHASE20_GROUP_TRIO_CONFIRMED" &&
    identityValid &&
    runtimeValid &&
    groupIdentityValid &&
    groupEvidenceValid &&
    scopeValid &&
    cleanupValid;

  return {
    ...supervisor,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "PHASE20_GROUP_TRIO_CONFIRMED"
      : supervisor.reason || "PHASE20_GROUP_TRIO_EVIDENCE_INCOMPLETE",
    evidence,
    scope,
    cleanup,
    identityValid,
    runtimeValid,
    groupIdentityValid,
    groupEvidenceValid,
    scopeValid,
    cleanupValid,
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const group = record(evidence.group);
  const scope = record(result?.scope);
  const cleanup = record(result?.cleanup);
  const lines = [
    "Phase 20.0b1 3-Farmer Group Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "Merchant online alongside trio: " +
      (array(evidence.selectedCharacters).includes(evidence.merchant)
        ? "yes"
        : "no"),
    "Farmers: " + array(evidence.farmers).join(", "),
    "Leader: " + (group.leader || "NONE"),
    "Followers: " + array(group.followers).join(", "),
    "All four normal runtimes: " +
      (evidence.normalRuntimeAll === true ? "yes" : "no"),
    "Three-farmer party formed: " +
      (group.trioFormed === true ? "yes" : "no"),
    "Group member results: " +
      array(group.results)
        .map(
          (entry) =>
            String(entry?.character || "UNKNOWN") +
            "=" +
            String(entry?.outcome || "UNKNOWN"),
        )
        .join(", "),
    "Combat evidence required in this slice: " +
      (scope.combatEvidenceRequired === true ? "yes" : "no"),
    "Automatic logistics suppressed: " +
      (scope.automaticLogisticsDispatchSuppressed === true ? "yes" : "no"),
    "Runtime state restored: " +
      (cleanup.runtimeStateRestored === true ? "yes" : "no"),
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  const { verbose } = parseCliArgs();
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "caracAL dashboard was not running; using temporary normal supervisor\n"
        : "Using existing caracAL runtime at " + baseUrl + "\n",
    );

    const payload = await runPhase20GroupSupervisorLiveTest();
    const result = evaluatePhase20GroupSupervisorResult(payload);

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
  evaluatePhase20GroupSupervisorResult,
  formatCompactResult,
  parseCliArgs,
  readState,
  runPhase20GroupSupervisorLiveTest,
};

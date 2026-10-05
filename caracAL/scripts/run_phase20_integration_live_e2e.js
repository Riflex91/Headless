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

async function runPhase20IntegrationSupervisorLiveTest({
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(
    baseUrl + "/headless/api/tests/phase20-integration",
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
    error.code =
      body?.error || "PHASE20_INTEGRATION_LIVE_TEST_REQUEST_FAILED";
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function evaluatePhase20IntegrationSupervisorResult(payload) {
  const supervisor = record(payload?.result);
  const evidence = record(supervisor.evidence);
  const scope = record(supervisor.scope);
  const cleanup = record(supervisor.cleanup);
  const farmers = array(evidence.farmers);
  const selected = array(evidence.selectedCharacters);
  const runtimeSources = array(evidence.runtimeSources);

  const identityValid =
    typeof evidence.merchant === "string" &&
    evidence.merchant.length > 0 &&
    farmers.length === 3 &&
    new Set(farmers).size === 3 &&
    farmers.every((name) => typeof name === "string" && name.length > 0) &&
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

  const scopeValid =
    supervisor.phase === "20.0a" &&
    scope.normalRuntime === true &&
    scope.lifecycleOnlyProbe === false &&
    scope.lifecycleMutationDispatched === true &&
    scope.gameplayMutationForced === false &&
    scope.valueMutationForced === false &&
    scope.automaticLogisticsDispatchSuppressed === true &&
    scope.combatEvidenceRequired === false &&
    scope.logisticsEvidenceRequired === false;

  const cleanupValid =
    cleanup.runtimeStateRestored === true &&
    array(cleanup.restoredRunning).length ===
      array(cleanup.originallyRunning).length;

  const pass =
    supervisor.outcome === "PASS" &&
    supervisor.reason === "PHASE20_INTEGRATION_BOOTSTRAP_CONFIRMED" &&
    identityValid &&
    runtimeValid &&
    scopeValid &&
    cleanupValid;

  return {
    ...supervisor,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "PHASE20_INTEGRATION_BOOTSTRAP_CONFIRMED"
      : supervisor.reason || "PHASE20_INTEGRATION_BOOTSTRAP_EVIDENCE_INCOMPLETE",
    evidence,
    scope,
    cleanup,
    identityValid,
    runtimeValid,
    scopeValid,
    cleanupValid,
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const scope = record(result?.scope);
  const cleanup = record(result?.cleanup);
  const lines = [
    "Phase 20.0a 3+1 Runtime Bootstrap Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "Merchant: " + (evidence.merchant || "NONE"),
    "Farmers: " + array(evidence.farmers).join(", "),
    "Selected characters: " + array(evidence.selectedCharacters).join(", "),
    "All online: " + (evidence.allOnline === true ? "yes" : "no"),
    "All RUNNING: " + (evidence.allRunning === true ? "yes" : "no"),
    "All bot/main.js: " +
      (evidence.normalRuntimeAll === true ? "yes" : "no"),
    "Active characters: " + String(evidence.activeCharacters ?? "UNKNOWN"),
    "Max online characters: " +
      String(evidence.maxOnlineCharacters ?? "UNKNOWN"),
    "Slot limit valid: " +
      (evidence.slotLimitValid === true ? "yes" : "no"),
    "Normal runtime: " + (scope.normalRuntime === true ? "yes" : "no"),
    "Lifecycle-only probe: " +
      (scope.lifecycleOnlyProbe === true ? "yes" : "no"),
    "Lifecycle mutation dispatched: " +
      (scope.lifecycleMutationDispatched === true ? "yes" : "no"),
    "Gameplay mutation forced: " +
      (scope.gameplayMutationForced === true ? "yes" : "no"),
    "Value mutation forced: " +
      (scope.valueMutationForced === true ? "yes" : "no"),
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

    const payload = await runPhase20IntegrationSupervisorLiveTest();
    const result = evaluatePhase20IntegrationSupervisorResult(payload);

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
  evaluatePhase20IntegrationSupervisorResult,
  formatCompactResult,
  parseCliArgs,
  readState,
  runPhase20IntegrationSupervisorLiveTest,
};

"use strict";

const {
  ensureDashboardAvailable,
  startManagedRuntime,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function parseCliArgs(argv = process.argv.slice(2)) {
  return {
    verbose: argv.includes("--verbose"),
  };
}

function observerRuntimeEnv(env = process.env) {
  return {
    ...env,
    CARACAL_OBSERVER_ONLY: "1",
  };
}

function startObserverRuntime() {
  return startManagedRuntime({
    env: observerRuntimeEnv(),
  });
}

async function readState({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(baseUrl + "/headless/api/state", {
    method: "GET",
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

async function runFullAutonomySupervisorLiveTest({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(
    baseUrl + "/headless/api/tests/full-autonomy",
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
    error.code = body?.error || "FULL_AUTONOMY_LIVE_TEST_REQUEST_FAILED";
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function evaluateFullAutonomySupervisorResult(payload) {
  const supervisor = record(payload?.result);
  const evidence = record(supervisor.evidence);
  const scope = record(supervisor.scope);
  const cleanup = record(supervisor.cleanup);
  const action = record(supervisor.action);

  const evidenceValid =
    action.type === "ROTATE" &&
    typeof action.startCharacter === "string" &&
    typeof action.stopCharacter === "string" &&
    evidence.rotationObserved === true &&
    evidence.sourceStopped === true &&
    evidence.targetOnline === true &&
    evidence.sourceAuthority === "FULL_AUTONOMY" &&
    evidence.targetAuthority === "FULL_AUTONOMY" &&
    evidence.lifecycleOnlyConfirmed === true &&
    Number(evidence.maxOnlineCharacters) <= 4;

  const scopeValid =
    scope.observerOnly === true &&
    scope.lifecycleOnlyProbe === true &&
    scope.lifecycleMutationDispatched === true &&
    scope.gameplayMutationDispatched === false &&
    scope.valueMutationDispatched === false &&
    scope.policyOverride === true;

  const cleanupValid = cleanup.runtimeStateRestored === true;
  const pass =
    supervisor.outcome === "PASS" &&
    supervisor.reason === "FULL_AUTONOMY_LIVE_E2E_CONFIRMED" &&
    evidenceValid &&
    scopeValid &&
    cleanupValid;

  return {
    ...supervisor,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "FULL_AUTONOMY_LIVE_E2E_CONFIRMED"
      : supervisor.reason || "FULL_AUTONOMY_LIVE_EVIDENCE_INCOMPLETE",
    evidence,
    scope,
    cleanup,
    evidenceValid,
    scopeValid,
    cleanupValid,
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const scope = record(result?.scope);
  const cleanup = record(result?.cleanup);
  const action = record(result?.action);
  const lines = [
    "Full Autonomy Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "Action: " + (action.type || "NONE"),
    "Source character: " +
      (evidence.sourceCharacter || action.stopCharacter || "NONE"),
    "Target character: " +
      (evidence.targetCharacter || action.startCharacter || "NONE"),
    "Rotation observed: " + (evidence.rotationObserved === true ? "yes" : "no"),
    "Source stopped: " + (evidence.sourceStopped === true ? "yes" : "no"),
    "Target online: " + (evidence.targetOnline === true ? "yes" : "no"),
    "Source authority: " + (evidence.sourceAuthority || "UNKNOWN"),
    "Target authority: " + (evidence.targetAuthority || "UNKNOWN"),
    "Lifecycle-only runtime: " +
      (evidence.lifecycleOnlyConfirmed === true ? "yes" : "no"),
    "Max online characters: " +
      String(evidence.maxOnlineCharacters ?? "UNKNOWN"),
    "Observer-only bootstrap: " + (scope.observerOnly === true ? "yes" : "no"),
    "Lifecycle mutation dispatched: " +
      (scope.lifecycleMutationDispatched === true ? "yes" : "no"),
    "Gameplay mutation dispatched: " +
      (scope.gameplayMutationDispatched === true ? "yes" : "no"),
    "Value mutation dispatched: " +
      (scope.valueMutationDispatched === true ? "yes" : "no"),
    "Runtime state restored: " +
      (cleanup.runtimeStateRestored === true ? "yes" : "no"),
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  const { verbose } = parseCliArgs();
  const dashboard = await ensureDashboardAvailable(readState, {
    startRuntime: startObserverRuntime,
  });
  const managedRuntime = dashboard.runtime;

  try {
    if (dashboard.startedRuntime) {
      process.stdout.write(
        "caracAL dashboard was not running; using temporary observer-only supervisor\n",
      );
    }

    const payload = await runFullAutonomySupervisorLiveTest();
    const result = evaluateFullAutonomySupervisorResult(payload);

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
  evaluateFullAutonomySupervisorResult,
  formatCompactResult,
  observerRuntimeEnv,
  parseCliArgs,
  readState,
  runFullAutonomySupervisorLiveTest,
  startObserverRuntime,
};

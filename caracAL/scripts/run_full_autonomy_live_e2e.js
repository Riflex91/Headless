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
  const characterArg = argv.find((value) => value.startsWith("--character="));
  return {
    requestedCharacter: characterArg
      ? characterArg.slice("--character=".length).trim() || null
      : null,
    verbose: argv.includes("--verbose"),
  };
}

function observerRuntimeEnv(env = process.env) {
  return {
    ...env,
    CARACAL_OBSERVER_ONLY: "1",
  };
}

function startObserverRuntime(options = {}) {
  return startManagedRuntime({
    ...options,
    env: observerRuntimeEnv(options.env || process.env),
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

async function runFullAutonomySupervisorLiveTest(
  requestedCharacter = null,
  settleMs = Number(process.env.CARACAL_FULL_AUTONOMY_LIVE_SETTLE_MS || 750),
  { fetchImpl = fetch } = {},
) {
  const response = await fetchImpl(
    baseUrl + "/headless/api/tests/full-autonomy",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character: requestedCharacter,
        settleMs,
      }),
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
    error.code = body?.error || null;
    throw error;
  }
  return body;
}

function evaluateFullAutonomyLiveResult(payload) {
  const result = record(payload?.result);
  const linkage = record(result.linkage);
  const observed = record(result.observed);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);
  const linkageComplete = [
    "accountStrategy",
    "lifecycle",
    "farming",
    "merchant",
    "economy",
    "encounters",
  ].every((key) => linkage[key] === true);
  const desiredStateReconciled =
    observed.desiredState === "RUNNING" &&
    observed.desiredStateSource === "FULL_AUTONOMY";
  const lifecycleOnly =
    scope.lifecycleOnlyProbe === true && observed.lifecycleOnlyProbe === true;
  const noGameplayMutation =
    scope.gameplayMutationDispatched === false &&
    scope.movementMutationDispatched === false &&
    scope.combatMutationDispatched === false;
  const noValueMutation =
    scope.valueMutationDispatched === false &&
    scope.equipmentMutationDispatched === false;
  const restored =
    cleanup.runtimeStateRestored === true &&
    cleanup.probeProcessStopped === true;
  const pass =
    result.outcome === "PASS" &&
    result.reason === "FULL_AUTONOMY_LIVE_RECONCILIATION_CONFIRMED" &&
    linkageComplete &&
    desiredStateReconciled &&
    lifecycleOnly &&
    noGameplayMutation &&
    noValueMutation &&
    restored;

  return {
    ...result,
    outcome: pass ? "PASS" : result.outcome || "FAIL",
    reason: pass
      ? "FULL_AUTONOMY_LIVE_RECONCILIATION_CONFIRMED"
      : result.reason || "FULL_AUTONOMY_LIVE_EVIDENCE_INCOMPLETE",
    evidence: {
      linkageComplete,
      desiredStateReconciled,
      lifecycleOnly,
      noGameplayMutation,
      noValueMutation,
      restored,
    },
  };
}

function formatCompactResult(result) {
  const linkage = record(result?.linkage);
  const observed = record(result?.observed);
  const scope = record(result?.scope);
  const cleanup = record(result?.cleanup);
  const decision = record(result?.decision);
  const action = record(decision.action);
  const lines = [
    "Full Autonomy Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "Plan state: " + (result?.plan?.state || "MISSING"),
    "Account Strategy linked: " +
      (linkage.accountStrategy === true ? "yes" : "no"),
    "Lifecycle linked: " + (linkage.lifecycle === true ? "yes" : "no"),
    "Farming linked: " + (linkage.farming === true ? "yes" : "no"),
    "Merchant linked: " + (linkage.merchant === true ? "yes" : "no"),
    "Economy linked: " + (linkage.economy === true ? "yes" : "no"),
    "Encounters linked: " + (linkage.encounters === true ? "yes" : "no"),
    "Selected characters: " +
      String(observed.selectedCharacters ?? 0) +
      "/" +
      String(observed.maxOnlineCharacters ?? 4),
    "Probe action: " + (action.type || "NONE"),
    "Probe character: " + (result?.character || "NONE"),
    "Desired State reconciled: " +
      (observed.desiredState === "RUNNING" &&
      observed.desiredStateSource === "FULL_AUTONOMY"
        ? "yes"
        : "no"),
    "Desired State authority: " + (observed.desiredStateSource || "UNKNOWN"),
    "Lifecycle-only probe: " +
      (scope.lifecycleOnlyProbe === true && observed.lifecycleOnlyProbe === true
        ? "yes"
        : "no"),
    "Lifecycle mutation dispatched: " +
      (scope.lifecycleMutationDispatched === true ? "yes" : "no"),
    "Gameplay mutation dispatched: " +
      (scope.gameplayMutationDispatched === true ? "yes" : "no"),
    "Value mutation dispatched: " +
      (scope.valueMutationDispatched === true ? "yes" : "no"),
    "Observer-only supervisor: " + (scope.observerOnly === true ? "yes" : "no"),
    "Runtime state restored: " +
      (cleanup.runtimeStateRestored === true ? "yes" : "no"),
    "Probe process stopped: " +
      (cleanup.probeProcessStopped === true ? "yes" : "no"),
  ];

  return lines.join("\n") + "\n";
}

async function main() {
  const { requestedCharacter, verbose } = parseCliArgs();
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

    let payload;
    try {
      payload = await runFullAutonomySupervisorLiveTest(requestedCharacter);
    } catch (error) {
      if (
        !dashboard.startedRuntime &&
        error?.code === "FULL_AUTONOMY_LIVE_TEST_OBSERVER_ONLY_REQUIRED"
      ) {
        throw new Error(
          "A non-observer caracAL supervisor is already running. Stop it and rerun npm run test:live:full-autonomy so the isolated observer-only probe can start.",
        );
      }
      throw error;
    }

    const result = evaluateFullAutonomyLiveResult(payload);
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
  evaluateFullAutonomyLiveResult,
  formatCompactResult,
  observerRuntimeEnv,
  parseCliArgs,
  readState,
  runFullAutonomySupervisorLiveTest,
  startObserverRuntime,
};

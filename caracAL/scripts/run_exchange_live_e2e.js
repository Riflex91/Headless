"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const { readState } = require("./run_gear_scoring_live_e2e");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function verifyExchangeLiveResult(source, expected = {}) {
  const result = record(source);
  const evidence = record(result.evidence);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);
  const target = record(result.target);
  const exchange = record(result.exchange);
  const lastAction = record(exchange.lastAction);
  const before = record(result.before);
  const after = record(result.after);

  const expectedSlot = Number(expected.itemSlot);
  const observedSlot = Number(target.itemSlot);
  const requiredQuantity = Number(target.requiredQuantity);
  const beforeQuantity = Number(before.totalQuantity);
  const afterQuantity = Number(after.totalQuantity);

  const verified = {
    explicitTargetObserved:
      typeof expected.itemName === "string" &&
      expected.itemName.length > 0 &&
      target.itemName === expected.itemName &&
      Number.isInteger(expectedSlot) &&
      expectedSlot >= 0 &&
      observedSlot === expectedSlot &&
      Number.isInteger(requiredQuantity) &&
      requiredQuantity > 0,
    inventoryIntelligenceReady: evidence.inventoryIntelligenceReady === true,
    itemDefinitionExchangeable: evidence.itemDefinitionExchangeable === true,
    exactItemObserved: evidence.exactItemObserved === true,
    quantitySufficient: evidence.quantitySufficient === true,
    itemUnprotectedBefore: evidence.itemUnprotectedBefore === true,
    exactCandidateSelected: evidence.exactCandidateSelected === true,
    stationReady:
      evidence.stationLocated === true &&
      evidence.stationId === "exchange" &&
      evidence.stationMap === "main" &&
      Number.isFinite(evidence.stationX) &&
      Number.isFinite(evidence.stationY) &&
      evidence.stationTravelConfirmed === true &&
      evidence.stationProximityReady === true &&
      Number.isFinite(evidence.stationDistanceAfter) &&
      evidence.stationDistanceAfter <= 60 &&
      (evidence.stationTravelRequired !== true ||
        (typeof evidence.stationTravelActionId === "string" &&
          evidence.stationTravelActionId.length > 0 &&
          evidence.stationTravelStatus === "CONFIRMED")),
    localPreflightReady:
      evidence.localPreflightReadOnly === true &&
      evidence.movementIdleBeforeDispatch === true &&
      evidence.exchangeOperationIdle === true &&
      evidence.itemLockClear === true &&
      evidence.mapAllowsExchange === true &&
      evidence.itemStillExactBeforeDispatch === true &&
      evidence.quantityStillSufficientBeforeDispatch === true &&
      evidence.exactCandidateStillSelected === true,
    actionDispatchedOnce:
      evidence.actionDispatchedOnce === true &&
      typeof lastAction.id === "string" &&
      lastAction.id.length > 0,
    actionConfirmed:
      evidence.actionConfirmed === true && lastAction.status === "CONFIRMED",
    outcomeNotExplicitFailure: evidence.exchangeSucceeded !== false,
    quantityConsumed:
      evidence.quantityConsumed === true &&
      Number.isFinite(beforeQuantity) &&
      Number.isFinite(afterQuantity) &&
      afterQuantity <= beforeQuantity - requiredQuantity,
    mutationObserved: evidence.mutationObserved === true,
    blindRetryAvoided:
      evidence.blindRetryAvoided === true && scope.blindRetryAllowed === false,
    cleanupComplete:
      cleanup.inventoryConfigOverrideCleared === true &&
      cleanup.exchangeConfigOverrideCleared === true &&
      cleanup.runtimeStateRestored === true &&
      cleanup.dispatcherRestored === true,
    scopeRestricted:
      scope.movementMutationAllowed === true &&
      scope.upgradeMutationAllowed === false &&
      scope.compoundMutationAllowed === false &&
      scope.exchangeMutationAllowed === true &&
      scope.craftMutationAllowed === false &&
      scope.irreversibleMutation === true &&
      scope.blindRetryAllowed === false &&
      scope.mutationScope === "single-exchange-attempt-only",
  };

  const pass =
    result.outcome === "PASS" &&
    result.reason === "EXCHANGE_LIVE_E2E_CONFIRMED" &&
    Object.values(verified).every((value) => value === true);

  if (result.outcome === "UNKNOWN") {
    return {
      ...result,
      reason: result.reason || "EXCHANGE_LIVE_OUTCOME_UNKNOWN_NO_RETRY",
      verifier: verified,
    };
  }

  if (result.outcome === "TIMEOUT") {
    return {
      ...result,
      verifier: verified,
    };
  }

  return {
    ...result,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "EXCHANGE_LIVE_E2E_CONFIRMED"
      : "EXCHANGE_LIVE_E2E_EVIDENCE_INCOMPLETE",
    verifier: verified,
  };
}

async function readJson(responsePromise) {
  const response = await responsePromise;
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  if (!response.ok) {
    throw new Error(
      body?.message ||
        body?.error ||
        `HTTP ${response.status} from caracAL dashboard`,
    );
  }
  return body;
}

async function runSupervisorLiveTest(character, itemName, itemSlot) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character) +
        "/tests/exchange",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName,
          itemSlot,
        }),
      },
    ),
  );
}

async function main() {
  const character = process.argv[2] || "";
  const itemName = process.argv[3] || "";
  const itemSlot = Number(process.argv[4]);

  if (
    !character ||
    !itemName ||
    !Number.isInteger(itemSlot) ||
    itemSlot < 0
  ) {
    console.error(
      "Usage: npm run test:live:exchange -- <character> <itemName> <itemSlot>",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    "WARNING: this test performs exactly one irreversible real Exchange attempt.\n",
  );
  process.stdout.write(
    `Target: ${character} item=${itemName} slot=${itemSlot}\n`,
  );
  process.stdout.write(
    "Station travel may occur. UNKNOWN is terminal for this run: do not repeat the command until state is independently reconciled.\n",
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runSupervisorLiveTest(
      character,
      itemName,
      itemSlot,
    );
    const result = verifyExchangeLiveResult(payload.result, {
      itemName,
      itemSlot,
    });
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
  runSupervisorLiveTest,
  verifyExchangeLiveResult,
};

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

function normalizedSlots(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 9) {
    return null;
  }
  const slots = value.map((slot) => Number(slot));
  if (
    slots.some((slot) => !Number.isInteger(slot) || slot < 0) ||
    new Set(slots).size !== slots.length
  ) {
    return null;
  }
  return slots;
}

function verifyCraftLiveResult(source, expected = {}) {
  const result = record(source);
  const evidence = record(result.evidence);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);
  const target = record(result.target);
  const craft = record(result.craft);
  const lastAction = record(craft.lastAction);
  const before = record(result.before);
  const after = record(result.after);

  const expectedSlots = normalizedSlots(expected.itemSlots);
  const observedSlots = normalizedSlots(target.itemSlots);
  const cost = Number(target.cost);
  const beforeGold = Number(before.gold);
  const afterGold = Number(after.gold);

  const verified = {
    explicitTargetObserved:
      typeof expected.recipe === "string" &&
      expected.recipe.length > 0 &&
      target.recipe === expected.recipe &&
      !!expectedSlots &&
      !!observedSlots &&
      JSON.stringify(expectedSlots) === JSON.stringify(observedSlots),
    inventoryIntelligenceReady: evidence.inventoryIntelligenceReady === true,
    recipeMetadataObserved: evidence.recipeMetadataObserved === true,
    exactIngredientsReady:
      evidence.explicitSlotsValid === true &&
      evidence.exactIngredientsObserved === true &&
      evidence.quantitiesSufficient === true &&
      evidence.ingredientLevelsMatch === true &&
      evidence.ingredientLocksClear === true &&
      evidence.allIngredientsUnprotectedBefore === true &&
      evidence.goldSufficientBefore === true &&
      evidence.exactCandidateSelected === true,
    stationReady:
      evidence.stationLocated === true &&
      evidence.stationId === "craftsman" &&
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
      evidence.craftOperationIdle === true &&
      evidence.mapAllowsCraft === true &&
      evidence.ingredientsStillExactBeforeDispatch === true &&
      evidence.quantitiesStillSufficientBeforeDispatch === true &&
      evidence.ingredientLocksStillClearBeforeDispatch === true &&
      evidence.goldStillSufficientBeforeDispatch === true &&
      evidence.exactCandidateStillSelected === true,
    actionDispatchedOnce:
      evidence.actionDispatchedOnce === true &&
      typeof lastAction.id === "string" &&
      lastAction.id.length > 0,
    actionConfirmed:
      evidence.actionConfirmed === true && lastAction.status === "CONFIRMED",
    ingredientConsumed: evidence.ingredientConsumed === true,
    outputIncreased: evidence.outputIncreased === true,
    goldSpent:
      evidence.goldSpent === true &&
      (!Number.isFinite(cost) ||
        cost <= 0 ||
        (Number.isFinite(beforeGold) &&
          Number.isFinite(afterGold) &&
          afterGold <= beforeGold - cost)),
    mutationObserved: evidence.mutationObserved === true,
    blindRetryAvoided:
      evidence.blindRetryAvoided === true && scope.blindRetryAllowed === false,
    cleanupComplete:
      cleanup.inventoryConfigOverrideCleared === true &&
      cleanup.craftConfigOverrideCleared === true &&
      cleanup.runtimeStateRestored === true &&
      cleanup.dispatcherRestored === true,
    scopeRestricted:
      scope.movementMutationAllowed === true &&
      scope.upgradeMutationAllowed === false &&
      scope.compoundMutationAllowed === false &&
      scope.exchangeMutationAllowed === false &&
      scope.craftMutationAllowed === true &&
      scope.irreversibleMutation === true &&
      scope.blindRetryAllowed === false &&
      scope.mutationScope === "single-craft-attempt-only",
  };

  const pass =
    result.outcome === "PASS" &&
    result.reason === "CRAFT_LIVE_E2E_CONFIRMED" &&
    Object.values(verified).every((value) => value === true);

  if (result.outcome === "UNKNOWN") {
    return {
      ...result,
      reason: result.reason || "CRAFT_LIVE_OUTCOME_UNKNOWN_NO_RETRY",
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
      ? "CRAFT_LIVE_E2E_CONFIRMED"
      : "CRAFT_LIVE_E2E_EVIDENCE_INCOMPLETE",
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

async function runSupervisorLiveTest(character, recipe, itemSlots) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character) +
        "/tests/craft",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe,
          itemSlots,
        }),
      },
    ),
  );
}

async function main() {
  const character = process.argv[2] || "";
  const recipe = process.argv[3] || "";
  const itemSlots = normalizedSlots(process.argv.slice(4));

  if (!character || !recipe || !itemSlots) {
    console.error(
      "Usage: npm run test:live:craft -- <character> <recipe> <slot1> [slot2 ... slot9]",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    "WARNING: this test performs exactly one irreversible real Craft attempt.\n",
  );
  process.stdout.write(
    `Target: ${character} recipe=${recipe} slots=${itemSlots.join(",")}\n`,
  );
  process.stdout.write(
    "Station travel may occur. UNKNOWN is terminal for this run: do not repeat the command until state is independently reconciled.\n",
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runSupervisorLiveTest(
      character,
      recipe,
      itemSlots,
    );
    const result = verifyCraftLiveResult(payload.result, {
      recipe,
      itemSlots,
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
  normalizedSlots,
  runSupervisorLiveTest,
  verifyCraftLiveResult,
};

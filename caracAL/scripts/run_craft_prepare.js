"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const { readState } = require("./run_gear_scoring_live_e2e");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

const DEFAULT_MERCHANT = "My_Merchant";
const DEFAULT_WORKER = "My_Ranger1";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
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

async function runCraftPreparation(merchant, recipe, worker) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(merchant) +
        "/tests/craft-prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(recipe && { recipe }),
          workers: [worker],
        }),
      },
    ),
  );
}

function verifyCraftPreparation(source) {
  const result = record(source);
  const plan = record(result.plan);
  const selected = record(plan.selected);
  const missing = record(selected.missingRequirement);
  const sourceInfo = record(selected.source);
  const workerResult = record(result.workerResult);
  const workerEvidence = record(workerResult.evidence);
  const workerCleanup = record(workerResult.cleanup);
  const evidence = record(result.evidence);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);
  const alreadyReady = result.reason === "CRAFT_MATERIAL_ALREADY_READY";

  const planEvidenceValid = alreadyReady
    ? plan.outcome === "PASS" &&
      plan.reason === "CRAFT_MATERIAL_RECIPE_ALREADY_READY"
    : plan.outcome === "PASS" &&
      plan.reason === "CRAFT_MATERIAL_TARGET_SELECTED" &&
      typeof selected.recipe === "string" &&
      selected.recipe.length > 0 &&
      Array.isArray(selected.existingItemSlots) &&
      selected.existingItemSlots.every(
        (slot) => Number.isInteger(Number(slot)) && Number(slot) >= 0,
      ) &&
      typeof missing.name === "string" &&
      missing.name.length > 0 &&
      Number.isInteger(Number(missing.quantity)) &&
      Number(missing.quantity) > 0 &&
      typeof sourceInfo.monsterType === "string" &&
      sourceInfo.monsterType.length > 0;

  const workerEvidenceValid = alreadyReady
    ? result.workerResult === null &&
      evidence.workerAttemptedOnce === false
    : workerResult.outcome === "PASS" &&
      workerResult.reason === "MATERIAL_GATHER_AND_DELIVERY_CONFIRMED" &&
      workerEvidence.combatControllerUsed === true &&
      workerEvidence.materialObserved === true &&
      workerEvidence.deliveryConfirmed === true &&
      workerEvidence.blindRetryUsed === false &&
      workerCleanup.combatOverrideCleared === true &&
      workerCleanup.preferredTargetCleared === true &&
      evidence.workerAttemptedOnce === true;

  const deliveryObserved = alreadyReady
    ? result.readyForCraftIngredients === true
    : Number(result.finalQuantity) >=
        Number(result.initialQuantity) + Number(result.requiredQuantity) &&
      evidence.deliveryConfirmed === true &&
      result.readyForCraftIngredients === true;

  const noCraftMutation =
    evidence.craftMutationDispatched === false &&
    evidence.blindRetryUsed === false &&
    scope.craftMutationAllowed === false &&
    scope.blindRetryAllowed === false;

  const scopeRestricted = alreadyReady
    ? scope.movementMutationAllowed === false &&
      scope.combatMutationAllowed === false &&
      scope.lootMutationAllowed === false &&
      scope.deliveryMutationAllowed === false &&
      noCraftMutation
    : scope.movementMutationAllowed === true &&
      scope.combatMutationAllowed === true &&
      scope.lootMutationAllowed === true &&
      scope.deliveryMutationAllowed === true &&
      scope.mutationScope === "single-craft-material-preparation-only" &&
      noCraftMutation;

  const cleanupComplete =
    cleanup.runtimeStateRestored === true &&
    cleanup.dispatcherRestored === true;

  const verified = {
    preparationConfirmed:
      result.outcome === "PASS" &&
      [
        "CRAFT_MATERIAL_PREPARATION_CONFIRMED",
        "CRAFT_MATERIAL_ALREADY_READY",
      ].includes(result.reason),
    planEvidenceValid,
    workerEvidenceValid,
    deliveryObserved,
    noCraftMutation,
    scopeRestricted,
    cleanupComplete,
  };
  const passed = Object.values(verified).every((value) => value === true);
  const sourceFailed =
    result.outcome === "FAIL" ||
    result.outcome === "UNKNOWN" ||
    result.outcome === "TIMEOUT";

  return {
    ...result,
    outcome: passed
      ? "PASS"
      : result.outcome === "UNKNOWN"
        ? "UNKNOWN"
        : result.outcome === "TIMEOUT"
          ? "TIMEOUT"
          : "FAIL",
    reason: passed
      ? "CRAFT_MATERIAL_PREPARATION_E2E_CONFIRMED"
      : sourceFailed && typeof result.reason === "string" && result.reason
        ? result.reason
        : "CRAFT_MATERIAL_PREPARATION_EVIDENCE_INCOMPLETE",
    verifier: verified,
  };
}

async function main() {
  const merchant = process.argv[2] || DEFAULT_MERCHANT;
  const recipe =
    typeof process.argv[3] === "string" && process.argv[3].trim()
      ? process.argv[3].trim()
      : null;
  const worker =
    typeof process.argv[4] === "string" && process.argv[4].trim()
      ? process.argv[4].trim()
      : DEFAULT_WORKER;

  process.stdout.write(
    `Preparing Craft materials for ${merchant}${recipe ? ` recipe ${recipe}` : ""} with exactly one worker ${worker}. The worker may move, fight, loot and deliver the planned missing material. No Craft mutation is dispatched by this command.\n`,
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runCraftPreparation(merchant, recipe, worker);
    const result = verifyCraftPreparation(payload.result);
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
  runCraftPreparation,
  verifyCraftPreparation,
};

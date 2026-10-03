"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const { readState } = require("./run_gear_scoring_live_e2e");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";
const DEFAULT_MERCHANT = "My_Merchant";

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

async function runCraftMaterialPlan(merchant, recipe) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(merchant) +
        "/tests/craft-material-plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(recipe && { recipe }),
        }),
      },
    ),
  );
}

function verifyCraftMaterialPlan(source) {
  const result = record(source);
  const plan = record(result.plan);
  const selected = record(plan.selected);
  const sourcePolicy = record(selected.sourcePolicy);
  const observer = record(plan.observerPosition);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);
  const safeTargetSelected =
    plan.outcome === "PASS" &&
    plan.reason === "CRAFT_MATERIAL_TARGET_SELECTED" &&
    typeof selected.recipe === "string" &&
    selected.recipe.length > 0 &&
    sourcePolicy.safe === true &&
    Array.isArray(sourcePolicy.reasons) &&
    sourcePolicy.reasons.length === 0 &&
    Array.isArray(sourcePolicy.spawnMaps) &&
    sourcePolicy.spawnMaps.length > 0 &&
    Number(sourcePolicy.expectedKills) > 0 &&
    Number(sourcePolicy.expectedKills) <= 50 &&
    Number(sourcePolicy.expectedMonsterHp) > 0 &&
    Number(sourcePolicy.expectedMonsterHp) <= 1000000;
  const alreadyReady =
    plan.outcome === "PASS" &&
    plan.reason === "CRAFT_MATERIAL_RECIPE_ALREADY_READY" &&
    plan.selected === null;
  const safeRefusal =
    plan.outcome === "FAIL" &&
    [
      "CRAFT_MATERIAL_SAFE_SOURCE_NOT_FOUND",
      "CRAFT_MATERIAL_TARGET_NOT_FOUND",
    ].includes(plan.reason) &&
    plan.selected === null &&
    Array.isArray(plan.candidates) &&
    plan.candidates.length === 0 &&
    Array.isArray(plan.rejectedSources);
  const planValid = safeTargetSelected || alreadyReady || safeRefusal;
  const observerValid =
    typeof observer.map === "string" &&
    observer.map.length > 0 &&
    Number.isFinite(Number(observer.x)) &&
    Number.isFinite(Number(observer.y));
  const readOnlyScope =
    scope.readOnly === true &&
    scope.movementMutationForced === false &&
    scope.combatMutationForced === false &&
    scope.lootMutationForced === false &&
    scope.deliveryMutationForced === false &&
    scope.craftMutationForced === false &&
    scope.blindRetryUsed === false;
  const cleanupComplete =
    cleanup.runtimeStateRestored === true &&
    cleanup.dispatcherRestored === true;
  const verifier = {
    scanConfirmed:
      result.outcome === "PASS" &&
      result.reason === "CRAFT_MATERIAL_PLAN_E2E_CONFIRMED",
    planValid,
    observerValid,
    safeTargetSelected,
    alreadyReady,
    safeRefusal,
    readOnlyScope,
    cleanupComplete,
  };
  const passed =
    verifier.scanConfirmed &&
    verifier.planValid &&
    verifier.observerValid &&
    verifier.readOnlyScope &&
    verifier.cleanupComplete;

  return {
    ...result,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "CRAFT_MATERIAL_PLAN_READ_ONLY_E2E_CONFIRMED"
      : result.reason || "CRAFT_MATERIAL_PLAN_EVIDENCE_INCOMPLETE",
    verifier,
  };
}

async function main() {
  const merchant = process.argv[2] || DEFAULT_MERCHANT;
  const recipe =
    typeof process.argv[3] === "string" && process.argv[3].trim()
      ? process.argv[3].trim()
      : null;

  process.stdout.write(
    `Scanning Craft material sources read-only for ${merchant}${
      recipe ? ` recipe ${recipe}` : ""
    }. No movement, combat, loot, delivery or Craft mutation is dispatched.\n`,
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runCraftMaterialPlan(merchant, recipe);
    const result = verifyCraftMaterialPlan(payload.result);
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
  runCraftMaterialPlan,
  verifyCraftMaterialPlan,
};

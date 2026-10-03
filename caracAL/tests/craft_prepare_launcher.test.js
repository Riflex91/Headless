"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { verifyCraftPreparation } = require("../scripts/run_craft_prepare");

function sourceResult(overrides = {}) {
  return {
    outcome: "PASS",
    reason: "CRAFT_MATERIAL_PREPARATION_CONFIRMED",
    merchant: "My_Merchant",
    worker: "My_Ranger1",
    startedAt: 1000,
    completedAt: 2000,
    plan: {
      outcome: "PASS",
      reason: "CRAFT_MATERIAL_TARGET_SELECTED",
      requestedRecipe: "rod",
      selected: {
        recipe: "rod",
        cost: 100,
        existingItemSlots: [39],
        missingRequirement: {
          quantity: 1,
          name: "spidersilk",
          level: null,
        },
        source: {
          itemName: "spidersilk",
          monsterType: "spider",
          dropChance: 1,
          monsterHp: 120,
          score: 0.008,
        },
        score: 0.003,
      },
      candidates: [],
    },
    recipe: "rod",
    existingItemSlots: [39],
    itemName: "spidersilk",
    itemLevel: 0,
    monsterType: "spider",
    requiredQuantity: 1,
    initialQuantity: 0,
    finalQuantity: 1,
    readyForCraftIngredients: true,
    workerResult: {
      outcome: "PASS",
      reason: "MATERIAL_GATHER_AND_DELIVERY_CONFIRMED",
      evidence: {
        combatControllerUsed: true,
        materialObserved: true,
        deliveryConfirmed: true,
        blindRetryUsed: false,
      },
      cleanup: {
        combatOverrideCleared: true,
        preferredTargetCleared: true,
      },
    },
    evidence: {
      materialPlanReadOnly: true,
      workerAttemptedOnce: true,
      deliveryConfirmed: true,
      craftMutationDispatched: false,
      blindRetryUsed: false,
    },
    scope: {
      movementMutationAllowed: true,
      combatMutationAllowed: true,
      lootMutationAllowed: true,
      deliveryMutationAllowed: true,
      craftMutationAllowed: false,
      blindRetryAllowed: false,
      mutationScope: "single-craft-material-preparation-only",
    },
    cleanup: {
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
    ...overrides,
  };
}

test("Craft material launcher confirms one-worker preparation evidence", () => {
  const result = verifyCraftPreparation(sourceResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_MATERIAL_PREPARATION_E2E_CONFIRMED");
  assert.deepEqual(result.verifier, {
    preparationConfirmed: true,
    planEvidenceValid: true,
    workerEvidenceValid: true,
    deliveryObserved: true,
    noCraftMutation: true,
    scopeRestricted: true,
    cleanupComplete: true,
  });
});

test("Craft material launcher preserves UNKNOWN and refuses incomplete evidence", () => {
  const source = sourceResult({
    outcome: "UNKNOWN",
    reason: "MATERIAL_ATTACK_OUTCOME_UNKNOWN",
    readyForCraftIngredients: false,
    finalQuantity: 0,
  });
  source.workerResult.outcome = "UNKNOWN";
  source.workerResult.reason = "MATERIAL_ATTACK_OUTCOME_UNKNOWN";
  source.workerResult.evidence.deliveryConfirmed = false;
  source.evidence.deliveryConfirmed = false;

  const result = verifyCraftPreparation(source);

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "MATERIAL_ATTACK_OUTCOME_UNKNOWN");
  assert.equal(result.verifier.preparationConfirmed, false);
  assert.equal(result.verifier.workerEvidenceValid, false);
  assert.equal(result.verifier.deliveryObserved, false);
});

test("Craft material launcher rejects any Craft mutation permission", () => {
  const source = sourceResult();
  source.scope.craftMutationAllowed = true;

  const result = verifyCraftPreparation(source);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.verifier.noCraftMutation, false);
  assert.equal(result.verifier.scopeRestricted, false);
});

test("Craft material launcher accepts an already-ready recipe without a worker", () => {
  const result = verifyCraftPreparation({
    outcome: "PASS",
    reason: "CRAFT_MATERIAL_ALREADY_READY",
    merchant: "My_Merchant",
    worker: "My_Ranger1",
    plan: {
      outcome: "PASS",
      reason: "CRAFT_MATERIAL_RECIPE_ALREADY_READY",
      requestedRecipe: "rod",
      selected: null,
      candidates: [],
    },
    recipe: "rod",
    readyForCraftIngredients: true,
    workerResult: null,
    evidence: {
      materialPlanReadOnly: true,
      workerAttemptedOnce: false,
      deliveryConfirmed: true,
      craftMutationDispatched: false,
      blindRetryUsed: false,
    },
    scope: {
      movementMutationAllowed: false,
      combatMutationAllowed: false,
      lootMutationAllowed: false,
      deliveryMutationAllowed: false,
      craftMutationAllowed: false,
      blindRetryAllowed: false,
    },
    cleanup: {
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.verifier.workerEvidenceValid, true);
  assert.equal(result.verifier.scopeRestricted, true);
});

test("Craft material preparation wiring never dispatches Craft itself", () => {
  const root = path.join(__dirname, "..");
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(root, "src", "CharacterThread.js"),
    "utf8",
  );
  const kernel = fs.readFileSync(
    path.join(root, "TYPECODE", "bot", "core", "runtime-kernel.lib.ts"),
    "utf8",
  );

  assert.match(coordinator, /run_craft_material_preparation/);
  assert.match(coordinator, /purpose: "CRAFT_TEST_MATERIAL"/);
  assert.match(coordinator, /craft_material_preparation_active/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/craft-prepare/,
  );
  assert.match(thread, /case "craft_material_plan"/);
  assert.match(thread, /CRAFT_TEST_MATERIAL/);
  assert.match(kernel, /runCraftMaterialPlan/);

  const start = coordinator.indexOf(
    "async function run_craft_material_preparation",
  );
  const end = coordinator.indexOf(
    "async function run_compound_material_preparation",
    start,
  );
  assert.ok(start >= 0);
  assert.ok(end > start);
  const block = coordinator.slice(start, end);
  assert.doesNotMatch(block, /\.craft\s*\(/);
  assert.doesNotMatch(block, /executeCraftNext/);
  assert.match(block, /blindRetryUsed: false/);
});

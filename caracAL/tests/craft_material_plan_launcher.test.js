"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  verifyCraftMaterialPlan,
} = require("../scripts/run_craft_material_plan");

function baseResult(plan) {
  return {
    outcome: "PASS",
    reason: "CRAFT_MATERIAL_PLAN_E2E_CONFIRMED",
    merchant: "My_Merchant",
    requestedRecipe: null,
    plan,
    scope: {
      readOnly: true,
      movementMutationForced: false,
      combatMutationForced: false,
      lootMutationForced: false,
      deliveryMutationForced: false,
      craftMutationForced: false,
      blindRetryUsed: false,
    },
    cleanup: {
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
  };
}

test("Craft material plan launcher accepts one safe selected target", () => {
  const result = verifyCraftMaterialPlan(
    baseResult({
      outcome: "PASS",
      reason: "CRAFT_MATERIAL_TARGET_SELECTED",
      requestedRecipe: null,
      observerPosition: { map: "main", x: -25, y: -478 },
      selected: {
        recipe: "testrecipe",
        sourcePolicy: {
          safe: true,
          reasons: [],
          spawnMaps: ["main"],
          expectedKills: 5,
          expectedMonsterHp: 500000,
        },
      },
      candidates: [],
      rejectedSources: [],
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.verifier.safeTargetSelected, true);
  assert.equal(result.verifier.safeRefusal, false);
  assert.equal(result.verifier.readOnlyScope, true);
  assert.equal(result.verifier.cleanupComplete, true);
});

test("Craft material plan launcher accepts a controlled no-safe-source scan", () => {
  const result = verifyCraftMaterialPlan(
    baseResult({
      outcome: "FAIL",
      reason: "CRAFT_MATERIAL_SAFE_SOURCE_NOT_FOUND",
      requestedRecipe: "rod",
      observerPosition: { map: "main", x: -25, y: -478 },
      selected: null,
      candidates: [],
      rejectedSources: [
        {
          recipe: "rod",
          source: { monsterType: "spider" },
          sourcePolicy: {
            safe: false,
            reasons: ["EXPECTED_KILLS_OUT_OF_POLICY"],
          },
        },
      ],
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(
    result.reason,
    "CRAFT_MATERIAL_PLAN_READ_ONLY_E2E_CONFIRMED",
  );
  assert.equal(result.verifier.planValid, true);
  assert.equal(result.verifier.safeTargetSelected, false);
  assert.equal(result.verifier.safeRefusal, true);
});

test("Craft material plan launcher rejects mutable scope evidence", () => {
  const source = baseResult({
    outcome: "FAIL",
    reason: "CRAFT_MATERIAL_TARGET_NOT_FOUND",
    requestedRecipe: null,
    observerPosition: { map: "main", x: 1, y: 2 },
    selected: null,
    candidates: [],
    rejectedSources: [],
  });
  source.scope.combatMutationForced = true;

  const result = verifyCraftMaterialPlan(source);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.verifier.readOnlyScope, false);
});

test("Craft material plan wiring is read-only and separate from preparation", () => {
  const root = path.join(__dirname, "..");
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(coordinator, /run_craft_material_plan_readonly/);
  assert.match(coordinator, /type: "craft_material_plan"/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/craft-material-plan/,
  );

  const start = coordinator.indexOf(
    "async function run_craft_material_plan_readonly",
  );
  const end = coordinator.indexOf(
    "async function run_craft_material_preparation",
    start,
  );
  assert.ok(start >= 0);
  assert.ok(end > start);
  const block = coordinator.slice(start, end);
  assert.doesNotMatch(block, /run_material_worker_task/);
  assert.doesNotMatch(block, /CRAFT_TEST_MATERIAL/);
  assert.doesNotMatch(block, /\.craft\s*\(/);
  assert.match(block, /readOnly: true/);
});

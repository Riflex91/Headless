"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  normalizedSlots,
  verifyCraftLiveResult,
} = require("../scripts/run_craft_live_e2e");

function passingResult() {
  return {
    outcome: "PASS",
    reason: "CRAFT_LIVE_E2E_CONFIRMED",
    target: {
      recipe: "cake",
      itemSlots: [7],
      cost: 5,
      outputName: "cake",
    },
    before: {
      gold: 100,
      outputQuantity: 0,
    },
    after: {
      gold: 95,
      outputQuantity: 1,
    },
    craft: {
      lastAction: {
        id: "A-craft-1",
        status: "CONFIRMED",
      },
    },
    evidence: {
      inventoryIntelligenceReady: true,
      recipeMetadataObserved: true,
      explicitSlotsValid: true,
      exactIngredientsObserved: true,
      quantitiesSufficient: true,
      ingredientLevelsMatch: true,
      ingredientLocksClear: true,
      allIngredientsUnprotectedBefore: true,
      goldSufficientBefore: true,
      exactCandidateSelected: true,
      stationLocated: true,
      stationId: "craftsman",
      stationMap: "main",
      stationX: 92,
      stationY: 670,
      stationTravelRequired: false,
      stationTravelConfirmed: true,
      stationTravelActionId: null,
      stationTravelStatus: null,
      stationDistanceAfter: 0,
      stationProximityReady: true,
      localPreflightReadOnly: true,
      movementIdleBeforeDispatch: true,
      craftOperationIdle: true,
      mapAllowsCraft: true,
      ingredientsStillExactBeforeDispatch: true,
      quantitiesStillSufficientBeforeDispatch: true,
      ingredientLocksStillClearBeforeDispatch: true,
      goldStillSufficientBeforeDispatch: true,
      exactCandidateStillSelected: true,
      actionDispatchedOnce: true,
      actionConfirmed: true,
      ingredientConsumed: true,
      outputIncreased: true,
      goldSpent: true,
      mutationObserved: true,
      blindRetryAvoided: true,
    },
    scope: {
      movementMutationAllowed: true,
      upgradeMutationAllowed: false,
      compoundMutationAllowed: false,
      exchangeMutationAllowed: false,
      craftMutationAllowed: true,
      irreversibleMutation: true,
      blindRetryAllowed: false,
      mutationScope: "single-craft-attempt-only",
    },
    cleanup: {
      inventoryConfigOverrideCleared: true,
      craftConfigOverrideCleared: true,
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
  };
}

test("Craft live launcher accepts complete one-shot mutation evidence", () => {
  const result = verifyCraftLiveResult(passingResult(), {
    recipe: "cake",
    itemSlots: [7],
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_LIVE_E2E_CONFIRMED");
  assert.equal(result.verifier.actionDispatchedOnce, true);
  assert.equal(result.verifier.ingredientConsumed, true);
  assert.equal(result.verifier.outputIncreased, true);
  assert.equal(result.verifier.goldSpent, true);
  assert.equal(result.verifier.cleanupComplete, true);
  assert.equal(result.verifier.scopeRestricted, true);
});

test("Craft live launcher preserves UNKNOWN as terminal", () => {
  const source = passingResult();
  source.outcome = "UNKNOWN";
  source.reason = "CRAFT_LIVE_OUTCOME_UNKNOWN_NO_RETRY";
  source.craft.lastAction.status = "UNKNOWN";
  source.evidence.actionConfirmed = false;
  source.evidence.ingredientConsumed = false;
  source.evidence.outputIncreased = false;
  source.evidence.goldSpent = false;
  source.evidence.mutationObserved = false;

  const result = verifyCraftLiveResult(source, {
    recipe: "cake",
    itemSlots: [7],
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CRAFT_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(result.verifier.blindRetryAvoided, true);
});

test("Craft live slot parser rejects duplicates and accepts exact ordering", () => {
  assert.deepEqual(normalizedSlots(["7"]), [7]);
  assert.deepEqual(normalizedSlots(["7", "9"]), [7, 9]);
  assert.equal(normalizedSlots(["7", "7"]), null);
  assert.equal(normalizedSlots([]), null);
});

test("Craft live wiring exposes runtime, IPC and dashboard boundaries", () => {
  const root = path.join(__dirname, "..");
  const runtimeKernel = fs.readFileSync(
    path.join(root, "TYPECODE", "bot", "core", "runtime-kernel.lib.ts"),
    "utf8",
  );
  const characterThread = fs.readFileSync(
    path.join(root, "src", "CharacterThread.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(runtimeKernel, /runCraftLiveTest/);
  assert.match(runtimeKernel, /CraftLiveTestRunner/);
  assert.match(characterThread, /case "craft_live_test"/);
  assert.match(characterThread, /craft_live_test_result/);
  assert.match(coordinator, /run_craft_live_test/);
  assert.match(coordinator, /type: "craft_live_test"/);
  assert.match(dashboard, /\/headless\/api\/characters\/:name\/tests\/craft/);
});

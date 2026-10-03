"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  verifyCraftPreflightResult,
} = require("../scripts/run_craft_preflight");

function sourceResult(overrides = {}) {
  return {
    outcome: "PASS",
    reason: "CRAFT_PREFLIGHT_COMPLETED",
    timestamp: 1000,
    character: "My_Merchant",
    inventoryState: "READY",
    recipeCount: 1,
    craft: {
      state: "READY",
      reason: "CRAFT_CANDIDATE_READY",
      executionMode: "EXPLICIT_ONE_SHOT",
      selected: {
        recipe: "swordx",
        cost: 500,
        requirements: [
          { quantity: 2, name: "iron", level: null },
          { quantity: 1, name: "wood", level: null },
        ],
        itemSlots: [2, 7],
        reason: "CRAFT_POLICY_ELIGIBLE",
      },
      candidates: [
        {
          recipe: "swordx",
          cost: 500,
          requirements: [
            { quantity: 2, name: "iron", level: null },
            { quantity: 1, name: "wood", level: null },
          ],
          itemSlots: [2, 7],
          reason: "CRAFT_POLICY_ELIGIBLE",
        },
      ],
      decisions: [],
    },
    selected: {
      recipe: "swordx",
      cost: 500,
      requirements: [
        { quantity: 2, name: "iron", level: null },
        { quantity: 1, name: "wood", level: null },
      ],
      itemSlots: [2, 7],
      reason: "CRAFT_POLICY_ELIGIBLE",
    },
    station: {
      located: true,
      id: "craftsman",
      name: "Leo",
      map: "main",
      x: 92,
      y: 670,
      runtimeMap: "main",
      runtimeX: -25,
      runtimeY: -478,
      distance: 1160,
      travelRequired: true,
    },
    readyForCraft: true,
    evidence: {
      inventoryIntelligenceReady: true,
      recipeMetadataObserved: true,
      craftPlanReadOnly: true,
      stationLocated: true,
      stationIdentityVerified: true,
      selectedCandidateConsistent: true,
      noMutationDispatched: true,
    },
    scope: {
      readOnly: true,
      movementMutationForced: false,
      upgradeMutationForced: false,
      compoundMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
    },
    cleanup: {
      craftConfigOverrideCleared: true,
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
    ...overrides,
  };
}

test("Craft preflight launcher confirms complete read-only evidence", () => {
  const result = verifyCraftPreflightResult(sourceResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_PREFLIGHT_E2E_CONFIRMED");
  assert.deepEqual(result.verifier, {
    scanCompleted: true,
    recipeMetadataValid: true,
    candidateEvidenceValid: true,
    selectedEvidenceValid: true,
    stationVerified: true,
    preflightEvidenceValid: true,
    readyForCraftConsistent: true,
    scopeReadOnly: true,
    cleanupComplete: true,
  });
});

test("Craft preflight launcher accepts a valid zero-candidate scan", () => {
  const result = verifyCraftPreflightResult(
    sourceResult({
      craft: {
        state: "EMPTY",
        reason: "CRAFT_NO_ELIGIBLE_CANDIDATE",
        executionMode: "EXPLICIT_ONE_SHOT",
        selected: null,
        candidates: [],
        decisions: [],
      },
      selected: null,
      readyForCraft: false,
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_PREFLIGHT_E2E_CONFIRMED");
  assert.equal(result.verifier.readyForCraftConsistent, true);
});

test("Craft preflight launcher rejects bad station and mutable scope evidence", () => {
  const badStation = sourceResult();
  badStation.station.id = "exchange";
  const badStationResult = verifyCraftPreflightResult(badStation);
  assert.equal(badStationResult.outcome, "FAIL");
  assert.equal(badStationResult.verifier.stationVerified, false);

  const mutable = sourceResult();
  mutable.scope.craftMutationForced = true;
  const mutableResult = verifyCraftPreflightResult(mutable);
  assert.equal(mutableResult.outcome, "FAIL");
  assert.equal(mutableResult.verifier.scopeReadOnly, false);
});

test("Craft preflight launcher requires cleanup and recipe metadata evidence", () => {
  const source = sourceResult();
  source.cleanup.craftConfigOverrideCleared = false;
  source.evidence.recipeMetadataObserved = false;

  const result = verifyCraftPreflightResult(source);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.verifier.recipeMetadataValid, false);
  assert.equal(result.verifier.cleanupComplete, false);
});

test("Craft preflight wiring stays read-only and runner-context scoped", () => {
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
  const preflight = fs.readFileSync(
    path.join(root, "TYPECODE", "bot", "core", "craft-preflight.lib.ts"),
    "utf8",
  );

  assert.match(coordinator, /run_craft_preflight/);
  assert.match(coordinator, /craft_preflight_active/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/craft-preflight/,
  );
  assert.match(thread, /case "craft_preflight"/);
  assert.match(thread, /craft_preflight_result/);
  assert.match(kernel, /runCraftPreflight/);
  assert.match(preflight, /noMutationDispatched: true/);
  assert.doesNotMatch(preflight, /executeNext\(/);

  const runnerReturn = thread.indexOf("return runner_context;");
  const preflightCase = thread.indexOf('case "craft_preflight"');
  assert.ok(preflightCase >= 0);
  assert.ok(runnerReturn > preflightCase);
  assert.equal(thread.indexOf('case "craft_preflight"', runnerReturn), -1);
});

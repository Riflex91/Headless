"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  verifyCompoundPreparation,
} = require("../scripts/run_compound_prepare");

function passResult(overrides = {}) {
  return {
    outcome: "PASS",
    reason: "COMPOUND_MATERIAL_PREPARATION_CONFIRMED",
    merchant: "My_Merchant",
    workers: ["My_Ranger1", "My_Ranger2", "My_Ranger3"],
    plan: {
      outcome: "PASS",
      reason: "COMPOUND_GATHER_TARGET_SELECTED",
      selected: {
        itemName: "ring",
        monsterType: "goo",
        itemGrade: 0,
        scrollName: "cscroll0",
      },
    },
    itemName: "ring",
    itemLevel: 0,
    monsterType: "goo",
    itemGrade: 0,
    scrollName: "cscroll0",
    initialQuantity: 0,
    finalQuantity: 3,
    targetQuantity: 3,
    scrollQuantity: 2,
    matchingItemSlots: [2, 7, 9],
    matchingScrollSlots: [12],
    readyForCompound: true,
    workerResults: ["My_Ranger1", "My_Ranger2", "My_Ranger3"].map((worker) => ({
      outcome: "PASS",
      reason: "MATERIAL_GATHER_AND_DELIVERY_CONFIRMED",
      worker,
      itemName: "ring",
      itemLevel: 0,
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
    })),
    evidence: {
      gatherPlanReadOnly: true,
      threeMatchingItemsObserved: true,
      allDeliveredItemsLevelMatched: true,
      blindRetryUsed: false,
    },
    ...overrides,
  };
}

test("Compound preparation launcher confirms Ranger farm and Merchant readiness", () => {
  const result = verifyCompoundPreparation(passResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "COMPOUND_PREPARATION_E2E_CONFIRMED");
  assert.equal(result.verifier.gatherTargetSelected, true);
  assert.equal(result.verifier.matchingTripleObserved, true);
  assert.equal(result.verifier.workerEvidenceValid, true);
  assert.equal(result.verifier.matchingItemSlotsObserved, true);
  assert.equal(result.verifier.matchingScrollSlotsObserved, true);
  assert.equal(result.verifier.scrollPresent, true);
});

test("Compound preparation launcher preserves planner failure reason", () => {
  const result = verifyCompoundPreparation({
    outcome: "FAIL",
    reason: "COMPOUND_GATHER_TARGET_NOT_FOUND",
    merchant: "My_Merchant",
    workers: ["My_Ranger1", "My_Ranger2", "My_Ranger3"],
    plan: {
      outcome: "FAIL",
      reason: "COMPOUND_GATHER_TARGET_NOT_FOUND",
      selected: null,
      candidates: [],
    },
    workerResults: [],
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_GATHER_TARGET_NOT_FOUND");
  assert.equal(result.verifier.gatherTargetSelected, false);
});

test("Compound preparation launcher refuses PASS when compound scroll is missing", () => {
  const result = verifyCompoundPreparation(
    passResult({
      scrollQuantity: 0,
      readyForCompound: false,
    }),
  );

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_PREPARATION_SCROLL_MISSING");
  assert.equal(result.verifier.scrollPresent, false);
});

test("Compound preparation wiring uses the three Ranger workers and no Compound mutation", () => {
  const root = path.join(__dirname, "..");
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(root, "scripts", "run_compound_prepare.js"),
    "utf8",
  );

  for (const name of ["My_Ranger1", "My_Ranger2", "My_Ranger3"]) {
    assert.match(coordinator, new RegExp(name));
    assert.match(launcher, new RegExp(name));
  }
  assert.match(coordinator, /COMPOUND_TEST_MATERIAL/);
  assert.match(coordinator, /compound_gather_plan/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/compound-prepare/,
  );
  assert.match(launcher, /No Compound mutation is dispatched/);
  assert.doesNotMatch(launcher, /executeCompoundNext/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  normalizedSlots,
  verifyCompoundLiveResult,
} = require("../scripts/run_compound_live_e2e");

function passResult() {
  return {
    outcome: "PASS",
    reason: "COMPOUND_LIVE_E2E_CONFIRMED",
    target: {
      itemName: "ring",
      itemSlots: [2, 7, 9],
      fromLevel: 0,
      itemGrade: 0,
      scrollName: "cscroll0",
      scrollSlot: 12,
    },
    compound: {
      lastAction: {
        id: "A-1",
        status: "CONFIRMED",
        compoundSucceeded: true,
      },
    },
    evidence: {
      inventoryIntelligenceReady: true,
      itemDefinitionCompoundable: true,
      exactTripleObserved: true,
      sameName: true,
      sameLevel: true,
      itemGradesKnown: true,
      itemGradesMatch: true,
      scrollGradeCompatible: true,
      allItemsUnprotectedBefore: true,
      scrollUnprotectedBefore: true,
      exactCandidateSelected: true,
      stationLocated: true,
      stationId: "newupgrade",
      stationMap: "main",
      stationX: -207,
      stationY: -220,
      stationDistanceBefore: 0,
      stationTravelRequired: false,
      stationTravelConfirmed: true,
      stationTravelActionId: null,
      stationTravelStatus: null,
      stationDistanceAfter: 0,
      stationProximityReady: true,
      localPreflightReadOnly: true,
      compoundOperationIdle: true,
      itemLocksClear: true,
      scrollLocksClear: true,
      mapAllowsCompound: true,
      runtimeMap: "main",
      actionDispatchedOnce: true,
      actionConfirmed: true,
      mutationObserved: true,
      blindRetryAvoided: true,
      offeringOmitted: true,
    },
    scope: {
      movementMutationAllowed: true,
      upgradeMutationAllowed: false,
      compoundMutationAllowed: true,
      irreversibleMutation: true,
      offeringMutationAllowed: false,
      exchangeMutationAllowed: false,
      craftMutationAllowed: false,
      blindRetryAllowed: false,
      mutationScope: "single-compound-attempt-only",
    },
    cleanup: {
      inventoryConfigOverrideCleared: true,
      compoundConfigOverrideCleared: true,
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
  };
}

test("Compound live launcher independently confirms complete PASS evidence", () => {
  const result = verifyCompoundLiveResult(passResult(), {
    itemName: "ring",
    itemSlots: [9, 2, 7],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "COMPOUND_LIVE_E2E_CONFIRMED");
  assert.equal(result.verifier.explicitTargetObserved, true);
  assert.equal(result.verifier.stationReady, true);
  assert.equal(result.verifier.localPreflightReady, true);
  assert.equal(result.verifier.actionDispatchedOnce, true);
  assert.equal(result.verifier.cleanupComplete, true);
  assert.equal(result.verifier.scopeRestricted, true);
});

test("Compound live launcher rejects missing station readiness evidence", () => {
  const source = passResult();
  source.evidence.stationProximityReady = false;

  const result = verifyCompoundLiveResult(source, {
    itemName: "ring",
    itemSlots: [2, 7, 9],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_LIVE_E2E_EVIDENCE_INCOMPLETE");
  assert.equal(result.verifier.stationReady, false);
});

test("Compound live launcher accepts confirmed station travel evidence", () => {
  const source = passResult();
  source.evidence.stationDistanceBefore = 900;
  source.evidence.stationTravelRequired = true;
  source.evidence.stationTravelActionId = "M-1";
  source.evidence.stationTravelStatus = "CONFIRMED";

  const result = verifyCompoundLiveResult(source, {
    itemName: "ring",
    itemSlots: [2, 7, 9],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.verifier.stationReady, true);
});

test("Compound live launcher rejects missing local preflight evidence", () => {
  const source = passResult();
  source.evidence.compoundOperationIdle = false;

  const result = verifyCompoundLiveResult(source, {
    itemName: "ring",
    itemSlots: [2, 7, 9],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_LIVE_E2E_EVIDENCE_INCOMPLETE");
  assert.equal(result.verifier.localPreflightReady, false);
});

test("Compound live launcher rejects incomplete cleanup", () => {
  const source = passResult();
  source.cleanup.runtimeStateRestored = false;

  const result = verifyCompoundLiveResult(source, {
    itemName: "ring",
    itemSlots: [2, 7, 9],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_LIVE_E2E_EVIDENCE_INCOMPLETE");
  assert.equal(result.verifier.cleanupComplete, false);
});

test("Compound live launcher preserves UNKNOWN no-retry evidence", () => {
  const source = passResult();
  source.outcome = "UNKNOWN";
  source.reason = "COMPOUND_LIVE_OUTCOME_UNKNOWN_NO_RETRY";
  source.compound.lastAction.status = "UNKNOWN";
  source.evidence.actionConfirmed = false;
  source.evidence.mutationObserved = false;

  const result = verifyCompoundLiveResult(source, {
    itemName: "ring",
    itemSlots: [2, 7, 9],
    scrollName: "cscroll0",
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "COMPOUND_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(result.verifier.blindRetryAvoided, true);
});

test("Compound live launcher requires three unique non-negative slots", () => {
  assert.deepEqual(normalizedSlots([9, 2, 7]), [2, 7, 9]);
  assert.equal(normalizedSlots([2, 2, 7]), null);
  assert.equal(normalizedSlots([2, -1, 7]), null);
  assert.equal(normalizedSlots([2, 7]), null);
});

test("Compound live wiring stays explicit and single-attempt only", () => {
  const root = path.join(__dirname, "..");
  const thread = fs.readFileSync(
    path.join(root, "src", "CharacterThread.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const runtime = fs.readFileSync(
    path.join(root, "TYPECODE", "bot", "core", "runtime-kernel.lib.ts"),
    "utf8",
  );

  assert.match(thread, /case "compound_live_test"/);
  assert.match(thread, /runCompoundLiveTest/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/compound/,
  );
  assert.match(coordinator, /run_compound_live_test/);
  assert.match(coordinator, /single-compound-attempt-only/);
  assert.match(runtime, /COMPOUND_LIVE_TEST_STARTED/);
  assert.match(runtime, /runCompoundLiveTest/);
  assert.match(runtime, /movement: this\.movement/);
  assert.match(runtime, /MERCHANT_AUTONOMY_JOB_ID/);
});

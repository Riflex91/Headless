"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineFishingLiveTestResult,
  fishingLiveTestDiagnostics,
  fishingLiveTestEvidence,
} = require("../src/FishingLiveTest");

function completedResult(events) {
  return events.find(
    (event) =>
      event.module === "FishingLiveTest" &&
      event.type === "FISHING_LIVE_TEST_COMPLETED",
  ).data.result;
}

function runtimeEvents({ foreignIntent = false } = {}) {
  const result = {
    character: {
      name: "My_Merchant",
      map: "main",
    },
    finalStatus: {
      state: "COMPLETE",
      reason: "FISHING_ROADMAP_COMPLETE",
      restore: {
        required: true,
        restored: true,
      },
      result: {
        attempted: true,
        found: false,
        response: "fishing_none",
      },
    },
    evidence: {
      skillChecked: true,
      toolSatisfied: true,
      toolAcquisitionRequired: false,
      toolAcquisitionObserved: false,
      zoneLocated: true,
      travelSatisfied: true,
      rodEquipped: true,
      skillAttempted: true,
      resultObserved: true,
      resultFound: false,
      mainhandRestoreRequired: true,
      mainhandRestored: true,
      unknownOutcomeAvoided: true,
      roadmapComplete: true,
    },
    scope: {
      movementMutationAllowed: true,
      combatMutationAllowed: false,
      lootMutationAllowed: false,
      prerequisitePurchaseAllowed: true,
      craftMutationAllowed: true,
      equipmentMutationAllowed: true,
      fishingSkillMutationAllowed: true,
      blindRetryAllowed: false,
      standMutationAllowed: false,
      wishlistMutationAllowed: false,
      pontyPurchaseAllowed: false,
      giveawayMutationAllowed: false,
      miningMutationAllowed: false,
      mutationScope: "fishing-only",
    },
    cleanup: {
      mainhandRestored: true,
      autonomyOverrideCleared: true,
    },
  };

  const events = [
    {
      source: "bot_runtime",
      module: "FishingLiveTest",
      type: "FISHING_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "MerchantFishingController",
      type: "ACTION_INTENT",
      actionId: "move-1",
      data: {
        action: "SMART_MOVE",
      },
    },
    {
      source: "bot_runtime",
      module: "MerchantFishingController",
      type: "ACTION_INTENT",
      actionId: "skill-1",
      data: {
        action: "SKILL",
      },
    },
    {
      source: "bot_runtime",
      module: "FishingLiveTest",
      type: "FISHING_LIVE_TEST_COMPLETED",
      data: {
        result,
      },
    },
  ];

  if (foreignIntent) {
    events.splice(events.length - 1, 0, {
      source: "bot_runtime",
      module: "MerchantMerritController",
      type: "ACTION_INTENT",
      actionId: "foreign-1",
      data: {
        action: "OPEN_STAND",
      },
    });
  }
  return events;
}

test("Fishing supervisor confirms result, weapon restore and mutation isolation", () => {
  const evidence = fishingLiveTestEvidence(
    runtimeEvents(),
    {
      account_owned: true,
      account_character_type: "merchant",
    },
    {
      dispatcherSuppressedDuringTest: true,
    },
  );

  const combined = combineFishingLiveTestResult(
    {
      outcome: "PASS",
      reason: "FISHING_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );

  assert.equal(evidence.resultObserved, true);
  assert.equal(evidence.resultFound, false);
  assert.equal(evidence.mainhandRestored, true);
  assert.equal(evidence.actionIsolationConfirmed, true);
  assert.equal(evidence.dispatcherSuppressedDuringTest, true);
  assert.equal(combined.outcome, "PASS");
  assert.equal(combined.reason, "FISHING_LIVE_E2E_CONFIRMED");
});

test("Fishing supervisor requires confirmed ranger delivery when tool material was missing", () => {
  const events = runtimeEvents();
  const completed = completedResult(events);
  completed.evidence.toolAcquisitionRequired = true;
  completed.evidence.toolAcquisitionObserved = true;

  const evidence = fishingLiveTestEvidence(
    events,
    {
      account_owned: true,
      account_character_type: "merchant",
      fishing_material_request: {
        outcome: "PASS",
        activeWorker: "My_Ranger1",
      },
    },
    {
      dispatcherSuppressedDuringTest: true,
    },
  );

  const combined = combineFishingLiveTestResult(
    {
      outcome: "PASS",
      reason: "FISHING_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );

  assert.equal(evidence.materialWorkerDeliveryConfirmed, true);
  assert.equal(evidence.materialWorker, "My_Ranger1");
  assert.equal(combined.outcome, "PASS");
  assert.equal(combined.reason, "FISHING_LIVE_E2E_CONFIRMED");
});

test("Fishing supervisor rejects tool acquisition without ranger delivery evidence", () => {
  const events = runtimeEvents();
  const completed = completedResult(events);
  completed.evidence.toolAcquisitionRequired = true;
  completed.evidence.toolAcquisitionObserved = true;

  const evidence = fishingLiveTestEvidence(
    events,
    {
      account_owned: true,
      account_character_type: "merchant",
      fishing_material_request: {
        outcome: "FAIL",
        activeWorker: "My_Ranger2",
      },
    },
    {
      dispatcherSuppressedDuringTest: true,
    },
  );

  const combined = combineFishingLiveTestResult(
    {
      outcome: "PASS",
      reason: "FISHING_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );

  assert.equal(evidence.materialWorkerDeliveryConfirmed, false);
  assert.equal(combined.outcome, "FAIL");
  assert.equal(combined.reason, "SUPERVISOR_FISHING_EVIDENCE_INCOMPLETE");
});

test("Fishing supervisor rejects a runtime PASS with a foreign action intent", () => {
  const evidence = fishingLiveTestEvidence(
    runtimeEvents({ foreignIntent: true }),
    {
      account_owned: true,
      account_character_type: "merchant",
    },
    {
      dispatcherSuppressedDuringTest: true,
    },
  );

  const combined = combineFishingLiveTestResult(
    {
      outcome: "PASS",
      reason: "FISHING_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );

  assert.equal(evidence.actionIsolationConfirmed, false);
  assert.deepEqual(evidence.foreignActionIntents, [
    {
      module: "MerchantMerritController",
      action: "OPEN_STAND",
      actionId: "foreign-1",
    },
  ]);
  assert.equal(combined.outcome, "FAIL");
  assert.equal(combined.reason, "SUPERVISOR_FISHING_EVIDENCE_INCOMPLETE");
});

test("Fishing diagnostics preserve roadmap and cleanup guarantees", () => {
  const evidence = fishingLiveTestEvidence(
    runtimeEvents(),
    {
      account_owned: true,
      account_character_type: "merchant",
    },
    {
      dispatcherSuppressedDuringTest: true,
    },
  );
  const diagnostics = fishingLiveTestDiagnostics(
    {
      requestId: "fishing-1",
      outcome: "PASS",
      reason: "FISHING_LIVE_E2E_CONFIRMED",
      durationMs: 125000,
      character: {
        name: "My_Merchant",
        map: "main",
      },
      finalStatus: {
        state: "COMPLETE",
        restore: {
          required: true,
          restored: true,
        },
        result: {
          attempted: true,
          found: false,
        },
      },
      evidence: completedResult(runtimeEvents()).evidence,
      scope: completedResult(runtimeEvents()).scope,
      cleanup: completedResult(runtimeEvents()).cleanup,
    },
    {
      evidence,
      originalDesiredState: "STOPPED",
    },
  );

  assert.equal(diagnostics.roadmap[0], "Skill");
  assert.equal(
    diagnostics.roadmap[diagnostics.roadmap.length - 1],
    "alte Waffe restaurieren",
  );
  assert.equal(diagnostics.expected.original_mainhand_restored, true);
  assert.equal(diagnostics.expected.blind_retry_allowed, false);
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
  assert.equal(diagnostics.observed.result_found, false);
});

test("coordinator, runtime, thread, dashboard and launcher expose Fishing live path", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const runtime = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_fishing_live_e2e.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(coordinator));
  assert.doesNotThrow(() => new Function(dashboard));
  assert.doesNotThrow(() => new Function(thread));
  assert.doesNotThrow(() => new Function(launcher));

  assert.match(coordinator, /run_fishing_live_test/);
  assert.match(coordinator, /FISHING_LIVE_TEST_RESULT_RECEIVED/);
  assert.match(coordinator, /fishing_live_test_active/);
  assert.match(coordinator, /My_Ranger1/);
  assert.match(coordinator, /My_Ranger2/);
  assert.match(coordinator, /My_Ranger3/);
  assert.match(coordinator, /FISHING_MATERIAL_REQUEST_COMPLETED/);
  assert.match(runtime, /FISHING_AUTONOMY_JOB_ID/);
  assert.match(runtime, /runFishingLiveTest/);
  assert.match(runtime, /runMaterialGatherTask/);
  assert.match(dashboard, /\/headless\/api\/characters\/:name\/tests\/fishing/);
  assert.match(thread, /case "fishing_live_test"/);
  assert.match(thread, /runFishingLiveTest/);
  assert.match(thread, /case "material_gather_task"/);
  assert.match(thread, /material_gather_task_result/);
  assert.match(launcher, /selectMerchantLiveTestCharacter/);
  assert.match(launcher, /Stopping temporary caracAL runtime/);
});

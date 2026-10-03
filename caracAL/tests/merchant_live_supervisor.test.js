"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineMerchantLiveTestResult,
  merchantLiveTestDiagnostics,
  merchantLiveTestEvidence,
} = require("../src/MerchantLiveTest");

function runtimeEvents() {
  return [
    {
      source: "bot_runtime",
      module: "MerchantLiveTest",
      type: "MERCHANT_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "MerchantLiveTest",
      type: "MERCHANT_LIVE_TEST_COMPLETED",
      data: {
        result: {
          character: {
            name: "My_Merchant",
            ctype: "merchant",
            map: "main",
          },
          autonomy: {
            state: "READY",
            mutationPolicy: {
              executionEnabled: false,
              valueMutationForced: false,
              giveawayCreationSupported: false,
            },
          },
          evidence: {
            featureCoverageComplete: true,
            realGameDataVisible: true,
            merritDataVisible: true,
            fishingDataVisible: true,
            miningDataVisible: true,
            wishlistBoundaryVisible: true,
            pontyBoundaryVisible: true,
            giveawaysReadOnly: true,
          },
          scope: {
            valueMutationForced: false,
            movementMutationForced: false,
            standMutationForced: false,
            wishlistMutationForced: false,
            pontyPurchaseForced: false,
            giveawayJoinForced: false,
            gatheringSkillForced: false,
            equipmentMutationForced: false,
          },
        },
      },
    },
  ];
}

test("merchant supervisor confirms complete Phase 12 read-only evidence", () => {
  const evidence = merchantLiveTestEvidence(runtimeEvents(), {
    account_owned: true,
    account_character_type: "merchant",
  });

  const combined = combineMerchantLiveTestResult(
    {
      outcome: "PASS",
      reason: "MERCHANT_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );

  assert.equal(evidence.merchantAccountOwned, true);
  assert.equal(evidence.valueMutationNotForced, true);
  assert.equal(evidence.giveawayJoinNotForced, true);
  assert.equal(combined.outcome, "PASS");
  assert.equal(combined.reason, "MERCHANT_LIVE_E2E_CONFIRMED");
});

test("merchant diagnostics preserve explicit non-forcing Phase 12 scope", () => {
  const evidence = merchantLiveTestEvidence(runtimeEvents(), {
    account_owned: true,
    account_character_type: "merchant",
  });
  const diagnostics = merchantLiveTestDiagnostics(
    {
      requestId: "merchant-1",
      outcome: "PASS",
      reason: "MERCHANT_LIVE_E2E_CONFIRMED",
      durationMs: 20,
      character: { name: "My_Merchant", ctype: "merchant", map: "main" },
      scope: {
        readOnly: true,
        valueMutationForced: false,
        mutationScope: "not forced",
      },
    },
    {
      evidence,
      originalDesiredState: "STOPPED",
    },
  );

  assert.equal(diagnostics.navigation.required, false);
  assert.equal(diagnostics.expected.giveaway_creation_supported, false);
  assert.equal(diagnostics.expected.value_mutation_forced, false);
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
});

test("coordinator, thread, dashboard and launcher expose Merchant Autonomy live path", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
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
    path.join(__dirname, "..", "scripts", "run_merchant_live_e2e.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(coordinator));
  assert.doesNotThrow(() => new Function(dashboard));
  assert.doesNotThrow(() => new Function(thread));
  assert.doesNotThrow(() => new Function(launcher));

  assert.match(coordinator, /run_merchant_live_test/);
  assert.match(coordinator, /MERCHANT_LIVE_TEST_RESULT_RECEIVED/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/merchant/,
  );
  assert.match(thread, /case "merchant_live_test"/);
  assert.match(thread, /runMerchantLiveTest/);
  assert.match(launcher, /selectMerchantLiveTestCharacter/);
  assert.match(launcher, /Stopping temporary caracAL runtime/);
});

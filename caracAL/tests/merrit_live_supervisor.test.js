"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineMerritLiveTestResult,
  merritLiveTestDiagnostics,
  merritLiveTestEvidence,
} = require("../src/MerritLiveTest");

function runtimeEvents() {
  return [
    {
      source: "bot_runtime",
      module: "MerritLiveTest",
      type: "MERRIT_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "MerritLiveTest",
      type: "MERRIT_LIVE_TEST_COMPLETED",
      data: {
        result: {
          character: {
            name: "My_Merchant",
            map: "main",
          },
          finalStatus: {
            parcel: {
              confirmedAt: 1000,
              readyAt: 3601000,
            },
          },
          evidence: {
            cooldownChecked: true,
            zoneSatisfied: true,
            travelObserved: true,
            positionConfirmed: true,
            standConfirmed: true,
            listingConfirmed: true,
            settleObserved: true,
            handoffSatisfied: true,
            parcelConfirmed: true,
            cooldownReadyAtPresent: true,
            unknownOutcomeAvoided: true,
          },
          scope: {
            movementMutationAllowed: true,
            standMutationAllowed: true,
            listingMutationAllowed: true,
            prerequisitePurchaseAllowed: true,
            blindRetryAllowed: false,
            wishlistMutationAllowed: false,
            pontyPurchaseAllowed: false,
            giveawayMutationAllowed: false,
            gatheringMutationAllowed: false,
            equipmentMutationAllowed: false,
            mutationScope: "merrit-only",
          },
          cleanup: {
            autonomyOverrideCleared: true,
            temporaryListingRestored: true,
            standRestored: true,
          },
        },
      },
    },
  ];
}

test("Merrit supervisor requires Parcel plus persisted account cooldown", () => {
  const persisted = {
    ready_at: 3601000,
    state: {
      character: "My_Merchant",
    },
  };
  const evidence = merritLiveTestEvidence(
    runtimeEvents(),
    {
      account_owned: true,
      account_character_type: "merchant",
    },
    persisted,
  );

  const combined = combineMerritLiveTestResult(
    {
      outcome: "PASS",
      reason: "MERRIT_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );

  assert.equal(evidence.parcelConfirmed, true);
  assert.equal(evidence.cooldownPersisted, true);
  assert.equal(evidence.blindRetryDisabled, true);
  assert.equal(evidence.pontyMutationIsolated, true);
  assert.equal(combined.outcome, "PASS");
  assert.equal(combined.reason, "MERRIT_LIVE_E2E_CONFIRMED");
});

test("Merrit supervisor downgrades runtime PASS without persisted cooldown", () => {
  const evidence = merritLiveTestEvidence(
    runtimeEvents(),
    {
      account_owned: true,
      account_character_type: "merchant",
    },
    null,
  );
  const combined = combineMerritLiveTestResult(
    {
      outcome: "PASS",
      reason: "MERRIT_LIVE_RUNTIME_CONFIRMED",
    },
    evidence,
  );

  assert.equal(evidence.cooldownPersisted, false);
  assert.equal(combined.outcome, "FAIL");
  assert.equal(combined.reason, "SUPERVISOR_MERRIT_EVIDENCE_INCOMPLETE");
});

test("Merrit diagnostics retain roadmap, mutation isolation and cooldown evidence", () => {
  const persisted = { ready_at: 3601000, state: {} };
  const evidence = merritLiveTestEvidence(
    runtimeEvents(),
    {
      account_owned: true,
      account_character_type: "merchant",
    },
    persisted,
  );
  const diagnostics = merritLiveTestDiagnostics(
    {
      requestId: "merrit-1",
      outcome: "PASS",
      reason: "MERRIT_LIVE_E2E_CONFIRMED",
      durationMs: 125000,
      character: { name: "My_Merchant", map: "main" },
      finalStatus: {
        parcel: {
          confirmedAt: 1000,
          readyAt: 3601000,
        },
      },
      evidence: runtimeEvents()[1].data.result.evidence,
      scope: runtimeEvents()[1].data.result.scope,
      cleanup: runtimeEvents()[1].data.result.cleanup,
    },
    {
      evidence,
      persistedCooldown: persisted,
      originalDesiredState: "STOPPED",
    },
  );

  assert.equal(diagnostics.roadmap[0], "Cooldown");
  assert.equal(
    diagnostics.roadmap[diagnostics.roadmap.length - 1],
    "Cooldown persistieren",
  );
  assert.equal(diagnostics.expected.account_cooldown_persisted, true);
  assert.equal(diagnostics.expected.blind_retry_allowed, false);
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
});

test("coordinator, thread, dashboard and launcher expose Merrit live path", () => {
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
    path.join(__dirname, "..", "scripts", "run_merrit_live_e2e.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(coordinator));
  assert.doesNotThrow(() => new Function(dashboard));
  assert.doesNotThrow(() => new Function(thread));
  assert.doesNotThrow(() => new Function(launcher));

  assert.match(coordinator, /run_merrit_live_test/);
  assert.match(coordinator, /MERRIT_LIVE_TEST_RESULT_RECEIVED/);
  assert.match(coordinator, /saveCooldown\("account", "merrit"/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/merrit/,
  );
  assert.match(thread, /case "merrit_live_test"/);
  assert.match(thread, /runMerritLiveTest/);
  assert.match(launcher, /selectMerchantLiveTestCharacter/);
  assert.match(launcher, /120s settle window/);
});

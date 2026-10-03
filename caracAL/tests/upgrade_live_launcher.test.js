"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineUpgradeSupervisorResult,
  itemStateSignature,
} = require("../scripts/run_upgrade_live_e2e");

function passResult(overrides = {}) {
  return {
    requestId: "upgrade-live-1",
    outcome: "PASS",
    reason: "UPGRADE_LIVE_E2E_CONFIRMED",
    character: "My_Ranger1",
    target: {
      itemName: "sword",
      itemSlot: 0,
      fromLevel: 0,
      scrollName: "scroll0",
      scrollSlot: 1,
    },
    before: {
      item: {
        slot: 0,
        name: "sword",
        level: 0,
        quantity: 1,
        property: null,
        present: true,
      },
      scroll: {
        slot: 1,
        name: "scroll0",
        level: 0,
        quantity: 2,
        property: null,
        present: true,
      },
    },
    after: {
      item: {
        slot: 0,
        name: "sword",
        level: 1,
        quantity: 1,
        property: null,
        present: true,
      },
      scroll: {
        slot: 1,
        name: "scroll0",
        level: 0,
        quantity: 1,
        property: null,
        present: true,
      },
    },
    upgrade: {
      lastAction: {
        id: "A-1",
        status: "CONFIRMED",
        why: "UPGRADE_POLICY_SELECTED",
        upgradeSucceeded: true,
      },
    },
    evidence: {
      inventoryIntelligenceReady: true,
      itemDefinitionUpgradable: true,
      itemUnprotectedBefore: true,
      scrollUnprotectedBefore: true,
      exactCandidateSelected: true,
      actionDispatchedOnce: true,
      actionConfirmed: true,
      upgradeSucceeded: true,
      itemStateChanged: true,
      scrollStateChanged: true,
      mutationObserved: true,
      blindRetryAvoided: true,
      offeringOmitted: true,
    },
    scope: {
      upgradeMutationAllowed: true,
      irreversibleMutation: true,
      offeringMutationAllowed: false,
      compoundMutationAllowed: false,
      exchangeMutationAllowed: false,
      craftMutationAllowed: false,
      blindRetryAllowed: false,
      mutationScope: "single-upgrade-attempt-only",
    },
    cleanup: {
      inventoryConfigOverrideCleared: true,
      upgradeConfigOverrideCleared: true,
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
    ...overrides,
  };
}

test("Upgrade live launcher independently confirms complete PASS evidence", () => {
  const result = combineUpgradeSupervisorResult(passResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "UPGRADE_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.verifier.explicitTargetObserved, true);
  assert.equal(result.evidence.verifier.actionConfirmed, true);
  assert.equal(result.evidence.verifier.mutationObserved, true);
  assert.equal(result.evidence.verifier.cleanupComplete, true);
  assert.equal(result.evidence.verifier.scopeRestricted, true);
});

test("Upgrade live launcher rejects PASS without an observed state change", () => {
  const source = passResult();
  source.after = JSON.parse(JSON.stringify(source.before));

  const result = combineUpgradeSupervisorResult(source);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "UPGRADE_LIVE_E2E_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.verifier.mutationObserved, false);
});

test("Upgrade live launcher preserves UNKNOWN and no-retry reason", () => {
  const source = passResult({
    outcome: "UNKNOWN",
    reason: "UPGRADE_LIVE_OUTCOME_UNKNOWN_NO_RETRY",
  });
  source.upgrade.lastAction.status = "UNKNOWN";
  source.evidence.actionConfirmed = false;
  source.evidence.mutationObserved = false;
  source.after = JSON.parse(JSON.stringify(source.before));

  const result = combineUpgradeSupervisorResult(source);

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "UPGRADE_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(result.evidence.verifier.blindRetryAvoided, true);
});

test("Upgrade live launcher rejects incomplete cleanup or broadened mutation scope", () => {
  const cleanupFailure = combineUpgradeSupervisorResult(
    passResult({
      cleanup: {
        inventoryConfigOverrideCleared: true,
        upgradeConfigOverrideCleared: true,
        runtimeStateRestored: false,
        dispatcherRestored: true,
      },
    }),
  );
  assert.equal(cleanupFailure.outcome, "FAIL");
  assert.equal(cleanupFailure.evidence.verifier.cleanupComplete, false);

  const scopeFailure = passResult();
  scopeFailure.scope.compoundMutationAllowed = true;
  const broadened = combineUpgradeSupervisorResult(scopeFailure);
  assert.equal(broadened.outcome, "FAIL");
  assert.equal(broadened.evidence.verifier.scopeRestricted, false);
});

test("Upgrade live item-state signature detects level and quantity changes", () => {
  const base = {
    slot: 0,
    name: "sword",
    level: 0,
    quantity: 1,
    property: null,
    present: true,
  };
  assert.notEqual(
    itemStateSignature(base),
    itemStateSignature({ ...base, level: 1 }),
  );
  assert.notEqual(
    itemStateSignature(base),
    itemStateSignature({ ...base, quantity: 2 }),
  );
});

test("Upgrade live wiring stays explicit and single-attempt only", () => {
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
    path.join(__dirname, "..", "scripts", "run_upgrade_live_e2e.js"),
    "utf8",
  );

  assert.match(coordinator, /run_upgrade_live_test/);
  assert.match(coordinator, /wait_for_upgrade_live_test_result/);
  assert.match(coordinator, /upgrade_live_test_active/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/upgrade/,
  );
  assert.match(
    dashboard,
    /tests\/upgrade"[\s\S]*express\.json\(\{ limit: "8kb" \}\)/,
  );
  assert.match(thread, /case "upgrade_live_test"/);
  assert.match(thread, /runUpgradeLiveTest/);
  assert.match(launcher, /single-upgrade-attempt-only/);
  assert.match(launcher, /irreversible real Upgrade attempt/);
  assert.match(launcher, /UPGRADE_LIVE_E2E_CONFIRMED/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  verifyUpgradePreflightResult,
} = require("../scripts/run_upgrade_preflight");

function sourceResult(overrides = {}) {
  return {
    outcome: "PASS",
    reason: "UPGRADE_PREFLIGHT_COMPLETED",
    timestamp: 1000,
    character: "My_Ranger1",
    inventoryState: "READY",
    candidates: [
      {
        itemSlot: 7,
        itemName: "wcap",
        level: 0,
        itemGrade: 0,
        expectedScrollName: "scroll0",
        protected: false,
        protections: [],
        matchingScrollSlots: [12],
        eligible: true,
        reason: "UPGRADE_PREFLIGHT_READY",
      },
    ],
    summary: {
      upgradableItems: 1,
      eligibleCandidates: 1,
      protectedItems: 0,
      unknownGradeItems: 0,
      missingScrollItems: 0,
    },
    scope: {
      readOnly: true,
      upgradeMutationForced: false,
      offeringMutationForced: false,
      compoundMutationForced: false,
      exchangeMutationForced: false,
      craftMutationForced: false,
    },
    cleanup: {
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
    ...overrides,
  };
}

test("Upgrade preflight launcher confirms complete read-only evidence", () => {
  const result = verifyUpgradePreflightResult(sourceResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "UPGRADE_PREFLIGHT_E2E_CONFIRMED");
  assert.deepEqual(result.verifier, {
    scanCompleted: true,
    candidateEvidenceValid: true,
    summaryMatches: true,
    scopeReadOnly: true,
    cleanupComplete: true,
  });
});

test("Upgrade preflight launcher accepts a valid zero-candidate scan", () => {
  const result = verifyUpgradePreflightResult(
    sourceResult({
      candidates: [],
      summary: {
        upgradableItems: 0,
        eligibleCandidates: 0,
        protectedItems: 0,
        unknownGradeItems: 0,
        missingScrollItems: 0,
      },
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "UPGRADE_PREFLIGHT_E2E_CONFIRMED");
});

test("Upgrade preflight launcher rejects inconsistent candidate or cleanup evidence", () => {
  const inconsistent = sourceResult();
  inconsistent.candidates[0].expectedScrollName = "scroll1";
  const invalidCandidate = verifyUpgradePreflightResult(inconsistent);
  assert.equal(invalidCandidate.outcome, "FAIL");
  assert.equal(invalidCandidate.verifier.candidateEvidenceValid, false);

  const cleanupFailure = verifyUpgradePreflightResult(
    sourceResult({
      cleanup: {
        runtimeStateRestored: false,
        dispatcherRestored: true,
      },
    }),
  );
  assert.equal(cleanupFailure.outcome, "FAIL");
  assert.equal(cleanupFailure.verifier.cleanupComplete, false);
});

test("Upgrade preflight wiring is read-only and runner-context scoped", () => {
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
  const kernel = fs.readFileSync(
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
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_upgrade_preflight.js"),
    "utf8",
  );

  assert.match(coordinator, /run_upgrade_live_preflight/);
  assert.match(coordinator, /upgrade_live_preflight_active/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/upgrade-preflight/,
  );
  assert.match(thread, /case "upgrade_live_preflight"/);
  assert.match(thread, /upgrade_live_preflight_result/);
  assert.match(kernel, /runUpgradePreflight/);
  assert.match(launcher, /no mutation will be dispatched/);

  const runnerReturn = thread.indexOf("return runner_context;");
  const preflightCase = thread.indexOf('case "upgrade_live_preflight"');
  assert.ok(preflightCase >= 0);
  assert.ok(runnerReturn > preflightCase);
  assert.equal(
    thread.indexOf('case "upgrade_live_preflight"', runnerReturn),
    -1,
  );
});

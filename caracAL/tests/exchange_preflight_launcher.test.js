"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  verifyExchangePreflightResult,
} = require("../scripts/run_exchange_preflight");

function sourceResult(overrides = {}) {
  return {
    outcome: "PASS",
    reason: "EXCHANGE_PREFLIGHT_COMPLETED",
    timestamp: 1000,
    character: "My_Merchant",
    inventoryState: "READY",
    exchange: {
      state: "READY",
      reason: "EXCHANGE_CANDIDATE_READY",
    },
    selected: {
      itemSlot: 7,
      name: "seashell",
      quantity: 20,
      requiredQuantity: 20,
      reason: "EXCHANGE_POLICY_ELIGIBLE",
    },
    candidates: [
      {
        itemSlot: 7,
        itemName: "seashell",
        quantity: 20,
        requiredQuantity: 20,
        protected: false,
        protections: [],
        eligible: true,
        reason: "EXCHANGE_POLICY_ELIGIBLE",
      },
    ],
    station: {
      located: true,
      id: "exchange",
      name: "Xyn",
      map: "main",
      x: -25,
      y: -478,
      runtimeMap: "main",
      runtimeX: -1102,
      runtimeY: 0,
      distance: 1180,
      travelRequired: true,
    },
    readyForExchange: true,
    summary: {
      exchangeDispositionItems: 1,
      eligibleCandidates: 1,
      protectedItems: 0,
      insufficientQuantityItems: 0,
    },
    evidence: {
      inventoryIntelligenceReady: true,
      exchangePlanReadOnly: true,
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
      runtimeStateRestored: true,
      dispatcherRestored: true,
    },
    ...overrides,
  };
}

test("Exchange preflight launcher confirms complete read-only evidence", () => {
  const result = verifyExchangePreflightResult(sourceResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "EXCHANGE_PREFLIGHT_E2E_CONFIRMED");
  assert.deepEqual(result.verifier, {
    scanCompleted: true,
    candidateEvidenceValid: true,
    selectedEvidenceValid: true,
    stationVerified: true,
    summaryMatches: true,
    preflightEvidenceValid: true,
    readyForExchangeConsistent: true,
    scopeReadOnly: true,
    cleanupComplete: true,
  });
});

test("Exchange preflight launcher accepts a valid zero-candidate scan", () => {
  const result = verifyExchangePreflightResult(
    sourceResult({
      exchange: {
        state: "EMPTY",
        reason: "EXCHANGE_NO_ELIGIBLE_CANDIDATE",
      },
      selected: null,
      candidates: [],
      readyForExchange: false,
      summary: {
        exchangeDispositionItems: 0,
        eligibleCandidates: 0,
        protectedItems: 0,
        insufficientQuantityItems: 0,
      },
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "EXCHANGE_PREFLIGHT_E2E_CONFIRMED");
  assert.equal(result.verifier.readyForExchangeConsistent, true);
});

test("Exchange preflight launcher rejects bad station or mutable scope evidence", () => {
  const wrongStation = verifyExchangePreflightResult(
    sourceResult({
      station: {
        ...sourceResult().station,
        id: "newupgrade",
      },
    }),
  );
  assert.equal(wrongStation.outcome, "FAIL");
  assert.equal(wrongStation.verifier.stationVerified, false);

  const mutable = sourceResult();
  mutable.scope.exchangeMutationForced = true;
  const mutableResult = verifyExchangePreflightResult(mutable);
  assert.equal(mutableResult.outcome, "FAIL");
  assert.equal(mutableResult.verifier.scopeReadOnly, false);
});

test("Exchange preflight wiring stays read-only and runner-context scoped", () => {
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
    path.join(__dirname, "..", "scripts", "run_exchange_preflight.js"),
    "utf8",
  );

  assert.match(coordinator, /run_exchange_preflight/);
  assert.match(coordinator, /exchange_preflight_active/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/exchange-preflight/,
  );
  assert.match(thread, /case "exchange_preflight"/);
  assert.match(thread, /exchange_preflight_result/);
  assert.match(kernel, /runExchangePreflight/);
  assert.match(launcher, /no movement or Exchange mutation will be dispatched/);

  const runnerReturn = thread.indexOf("return runner_context;");
  const preflightCase = thread.indexOf('case "exchange_preflight"');
  assert.ok(preflightCase >= 0);
  assert.ok(runnerReturn > preflightCase);
  assert.equal(thread.indexOf('case "exchange_preflight"', runnerReturn), -1);
});

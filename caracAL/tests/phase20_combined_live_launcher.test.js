"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  EXPECTED_PHASE,
  EXPECTED_REASON,
  evaluatePhase20CombinedResult,
  formatPhase20CombinedResult,
} = require("../scripts/run_phase20_combined_live_e2e");

test("Phase 20.0d launcher exposes the final combined acceptance contract", () => {
  assert.equal(EXPECTED_PHASE, "20.0d");
  assert.equal(EXPECTED_REASON, "PHASE20_INTEGRATION_COMBINED_CONFIRMED");

  const result = evaluatePhase20CombinedResult({
    result: {
      phase: "20.0c",
      outcome: "PASS",
      reason: "PHASE20_INTEGRATION_MERCHANT_LOGISTICS_CONFIRMED",
    },
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.scopeValid, false);
});

test("Phase 20.0d compact output has a distinct final-gate title", () => {
  const output = formatPhase20CombinedResult({
    outcome: "PASS",
    reason: EXPECTED_REASON,
    evidence: {
      groupCombatParallel: {
        confirmedAttackCount: 3,
        partyEvidenceMode: "LEADER_AUTHORITATIVE",
        resourceRecoveryUnknown: false,
      },
      merchantParallel: {},
      logistics: {},
    },
    cleanup: {},
  });

  assert.match(output, /Phase 20\.0d Complete Combined One-Click Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /PHASE20_INTEGRATION_COMBINED_CONFIRMED/);
});

test("Phase 20.0d source reuses the existing Phase 20 supervisor and evaluator", () => {
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_phase20_combined_live_e2e.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(launcher, /runPhase20IntegrationSupervisorLiveTest/);
  assert.match(launcher, /evaluatePhase20MerchantLogisticsResult/);
  assert.match(launcher, /stage: EXPECTED_PHASE/);
  assert.match(
    coordinator,
    /\["20\.0b", "20\.0c", "20\.0d"\]\.includes\(options\.stage\)/,
  );
  assert.match(
    coordinator,
    /const merchant_logistics_stage = \["20\.0c", "20\.0d"\]\.includes\(stage\)/,
  );
  assert.match(coordinator, /PHASE20_INTEGRATION_COMBINED_CONFIRMED/);
  assert.match(coordinator, /PHASE20_INTEGRATION_MERCHANT_LOGISTICS_CONFIRMED/);

  assert.doesNotMatch(launcher, /send_gold\s*\(/);
  assert.doesNotMatch(launcher, /send_item\s*\(/);
  assert.doesNotMatch(launcher, /smart_move\s*\(/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineFutureGearSupervisorResult,
  decisionMatches,
  decisionEvidenceComplete,
  evidenceComplete,
  futureGearEvidence,
} = require("../scripts/run_future_gear_live_e2e");

function snapshot({
  inventoryScore = 30,
  candidate = true,
  protectedCandidate = true,
  decision = candidate ? "CANDIDATE" : "NOT_BETTER",
  reason = candidate
    ? "FUTURE_GEAR_SCORE_IMPROVEMENT"
    : "FUTURE_GEAR_NOT_BETTER",
  scoreDelta = inventoryScore - 20,
} = {}) {
  return {
    scoring: {
      state: "READY",
      entries: [
        {
          location: "INVENTORY",
          slot: 3,
          name: "candidate_bow",
          level: 2,
          definitionKnown: true,
          itemType: "weapon",
          slotGroup: "weapon",
          score: inventoryScore,
          stats: { attack: inventoryScore },
          contributions: { attack: inventoryScore },
          why: "GEAR_SCORE_WEIGHTED_ADVENTURE_LAND_STATS",
        },
        {
          location: "EQUIPMENT",
          slot: "mainhand",
          name: "bow",
          level: 2,
          definitionKnown: true,
          itemType: "weapon",
          slotGroup: "mainhand",
          score: 20,
          stats: { attack: 20 },
          contributions: { attack: 20 },
          why: "GEAR_SCORE_WEIGHTED_ADVENTURE_LAND_STATS",
        },
      ],
    },
    futureGear: {
      state: "READY",
      minScoreDelta: 0,
      entries: [
        {
          inventorySlot: 3,
          name: "candidate_bow",
          level: 2,
          slotGroup: "weapon",
          score: inventoryScore,
          targetSlots: ["mainhand"],
          baselineSlot: "mainhand",
          baselineScore: 20,
          scoreDelta,
          candidate,
          decision,
          reason,
        },
      ],
      summary: {
        inventoryGear: 1,
        candidates: candidate ? 1 : 0,
        notBetter: decision === "NOT_BETTER" ? 1 : 0,
        scoreUnknown: 0,
        slotUnresolved: 0,
        baselineUnknown: 0,
      },
    },
    inventoryIntelligence: {
      state: "READY",
      entries: [
        {
          slot: 3,
          name: "candidate_bow",
          disposition: "GEAR",
          protected: candidate ? protectedCandidate : false,
          protections: candidate && protectedCandidate ? ["FUTURE_GEAR"] : [],
        },
      ],
    },
    slots: {
      mainhand: { name: "bow", level: 2 },
      offhand: null,
      ring1: null,
      ring2: null,
    },
  };
}

function supervisorResult(overrides = {}) {
  return {
    request_id: "gear-scoring-live-1",
    outcome: "PASS",
    reason: "GEAR_SCORING_LIVE_RUNTIME_E2E_CONFIRMED",
    character: "My_Ranger1",
    before: snapshot(),
    after: snapshot(),
    scope: {
      readOnly: true,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: false,
      equipmentMutationForced: false,
      runtimeOverrideApplied: true,
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
    },
    ...overrides,
  };
}

test("Future Gear live evidence independently recomputes a real candidate", () => {
  const evidence = futureGearEvidence(snapshot());

  assert.equal(evidence.gearScoringReady, true);
  assert.equal(evidence.futureGearProjectionVisible, true);
  assert.equal(evidence.inventoryIntelligenceReady, true);
  assert.equal(evidence.decisionEntriesObserved, true);
  assert.equal(evidence.candidateCount, 1);
  assert.equal(evidence.inventoryGearCountMatches, true);
  assert.equal(evidence.allDecisionsRecomputed, true);
  assert.equal(evidence.candidateProtectionComplete, true);
  assert.equal(evidence.summaryMatches, true);
  assert.equal(evidenceComplete(evidence), true);
});

test("Future Gear live result confirms only complete supervisor evidence", () => {
  const result = combineFutureGearSupervisorResult(supervisorResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "FUTURE_GEAR_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.allDecisionsRecomputed, true);
  assert.equal(result.evidence.candidateProtectionComplete, true);
  assert.equal(result.evidence.runtimeStateRestored, true);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.futureGearMutationForced, false);
  assert.equal(result.scope.reservationMutationForced, false);
});

test("Future Gear live verification does not require an artificial positive candidate", () => {
  const noUpgrade = snapshot({
    inventoryScore: 15,
    candidate: false,
    decision: "NOT_BETTER",
    reason: "FUTURE_GEAR_NOT_BETTER",
    scoreDelta: -5,
  });
  const result = combineFutureGearSupervisorResult(
    supervisorResult({
      before: noUpgrade,
      after: noUpgrade,
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidence.candidateCount, 0);
  assert.equal(result.evidence.decisionEntriesObserved, true);
  assert.equal(result.evidence.allDecisionsRecomputed, true);
});

test("Future Gear live verification tolerates Inventory Intelligence startup lag before settle", () => {
  const before = snapshot();
  before.inventoryIntelligence = null;
  const beforeEvidence = futureGearEvidence(before);

  assert.equal(beforeEvidence.gearScoringReady, true);
  assert.equal(beforeEvidence.futureGearProjectionVisible, true);
  assert.equal(beforeEvidence.inventoryIntelligenceReady, false);
  assert.equal(decisionEvidenceComplete(beforeEvidence), true);
  assert.equal(evidenceComplete(beforeEvidence), false);

  const result = combineFutureGearSupervisorResult(
    supervisorResult({
      before,
      after: snapshot(),
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "FUTURE_GEAR_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.projectionWasReadyBeforeSettle, true);
  assert.equal(result.evidence.inventoryIntelligenceReady, true);
  assert.equal(result.evidence.candidateProtectionComplete, true);
});

test("Future Gear live verification rejects an invented candidate decision", () => {
  const invalid = snapshot({
    candidate: false,
    decision: "NOT_BETTER",
    reason: "FUTURE_GEAR_NOT_BETTER",
    scoreDelta: 10,
  });
  const evidence = futureGearEvidence(invalid);
  const entry = invalid.futureGear.entries[0];
  const scoringEntry = invalid.scoring.entries[0];

  assert.equal(decisionMatches(entry, scoringEntry, invalid), false);
  assert.equal(evidence.allDecisionsRecomputed, false);
  assert.equal(evidenceComplete(evidence), false);
});

test("Future Gear live verification requires protection for every detected candidate", () => {
  const unprotected = snapshot({ protectedCandidate: false });
  const result = combineFutureGearSupervisorResult(
    supervisorResult({
      before: unprotected,
      after: unprotected,
    }),
  );

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.evidence.candidateProtectionComplete, false);
});

test("Future Gear live verification requires original runtime restoration", () => {
  const result = combineFutureGearSupervisorResult(
    supervisorResult({
      cleanup: {
        equipmentBaselineRestored: true,
        runtimeStateRestored: false,
      },
    }),
  );

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.evidence.runtimeStateRestored, false);
});

test("Future Gear live launcher reuses the TYPECODE Gear Scoring supervisor probe", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_future_gear_live_e2e.js"),
    "utf8",
  );

  assert.match(coordinator, /futureGear:/);
  assert.match(coordinator, /inventoryIntelligence:/);
  assert.match(launcher, /runGearScoringSupervisorLiveTest/);
  assert.match(launcher, /FUTURE_GEAR_LIVE_E2E_CONFIRMED/);
  assert.match(launcher, /candidateProtectionComplete/);
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  combineFarmIntelligenceLiveTestResult,
  evidenceComplete,
  farmIntelligenceLiveTestDiagnostics,
  farmIntelligenceLiveTestEvidence,
} = require("../src/FarmIntelligenceLiveTest");

function farmStatus() {
  return {
    state: "READY",
    candidates: [{ monster: "goo" }],
    selected: {
      monster: "goo",
      whyMonster: "goo: Score 88 · XP 100",
      whySpot: "main @ 0, 0 · same map · travel 0 · spawn 5",
    },
  };
}

test("farm intelligence supervisor evidence survives runtime cleanup", () => {
  const events = [
    {
      source: "bot_runtime",
      module: "FarmIntelligenceLiveTest",
      type: "FARM_INTELLIGENCE_LIVE_TEST_STARTED",
      data: { farmIntelligence: { state: "DISABLED", candidates: [] } },
    },
    {
      source: "bot_runtime",
      module: "FarmIntelligenceController",
      type: "FARM_INTELLIGENCE_SAMPLE",
      data: { farmIntelligence: farmStatus(), sample: { farmKey: "goo@main:0" } },
    },
    {
      source: "bot_runtime",
      module: "FarmIntelligenceLiveTest",
      type: "FARM_INTELLIGENCE_LIVE_TEST_COMPLETED",
      data: { farmIntelligence: { state: "DISABLED", candidates: [] } },
    },
  ];

  const evidence = farmIntelligenceLiveTestEvidence(events, {
    farm_intelligence_runtime: { state: "DISABLED", candidates: [] },
  });

  assert.equal(evidence.farmTestStarted, true);
  assert.equal(evidence.farmTestCompleted, true);
  assert.equal(evidence.farmProjectionVisible, true);
  assert.equal(evidence.selectionProjected, true);
  assert.equal(evidence.sampleEvents, 1);
  assert.equal(evidenceComplete(evidence), true);
});

test("farm intelligence supervisor downgrades incomplete PASS evidence", () => {
  const combined = combineFarmIntelligenceLiveTestResult(
    {
      outcome: "PASS",
      reason: "FARM_INTELLIGENCE_LIVE_CONFIRMED",
    },
    {
      farmTestStarted: true,
      farmTestCompleted: true,
      farmProjectionVisible: true,
      selectionProjected: false,
      sampleEvents: 0,
    },
  );

  assert.equal(combined.outcome, "FAIL");
  assert.equal(
    combined.reason,
    "SUPERVISOR_FARM_INTELLIGENCE_EVIDENCE_INCOMPLETE",
  );
});

test("farm intelligence diagnostics preserve passive scope evidence", () => {
  const diagnostics = farmIntelligenceLiveTestDiagnostics(
    {
      requestId: "farm-live-1",
      character: "Farmer",
      outcome: "PASS",
      reason: "FARM_INTELLIGENCE_LIVE_CONFIRMED",
      durationMs: 1200,
      intelligence: {
        selectedMonster: "goo",
        whyMonster: "why monster",
        whySpot: "why spot",
        observedSample: true,
      },
      scope: {
        movementMutationForced: false,
        combatMutationForced: false,
        valueMutationForced: false,
      },
      cleanup: { farmOverrideCleared: true },
    },
    {
      originalDesiredState: "STOPPED",
      evidence: {
        farmTestStarted: true,
        farmTestCompleted: true,
        farmProjectionVisible: true,
        selectionProjected: true,
        sampleEvents: 1,
      },
    },
  );

  assert.equal(diagnostics.navigation.required, false);
  assert.equal(diagnostics.actions.movement_mutation_forced, false);
  assert.equal(diagnostics.actions.combat_mutation_forced, false);
  assert.equal(diagnostics.actions.value_mutation_forced, false);
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
});

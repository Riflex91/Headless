"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineFarmLiveTestResult,
  farmLiveTestDiagnostics,
  farmLiveTestEvidence,
} = require("../src/FarmLiveTest");

function events() {
  return [
    {
      source: "bot_runtime",
      module: "FarmLiveTest",
      type: "FARM_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "FarmIntelligenceController",
      type: "FARM_INTELLIGENCE_UPDATED",
      data: {
        farmIntelligence: {
          state: "READY",
          selected: {
            monster: "goo",
            map: "main",
            whyMonster: "goo: Score 90",
            whySpot: "main @ 0, 0",
            observed: {
              xpPerHour: 0,
              goldPerHour: 0,
              dropsPerHour: 0,
            },
          },
        },
      },
    },
    {
      source: "bot_runtime",
      module: "FarmIntelligenceController",
      type: "FARM_INTELLIGENCE_SAMPLE",
    },
    {
      source: "bot_runtime",
      module: "FarmLiveTest",
      type: "FARM_LIVE_TEST_COMPLETED",
    },
  ];
}

test("farm supervisor evidence proves projection, WHY and observed sample", () => {
  const evidence = farmLiveTestEvidence(events(), {
    farm_intelligence_runtime: null,
  });

  assert.equal(evidence.farmTestStarted, true);
  assert.equal(evidence.farmTestCompleted, true);
  assert.equal(evidence.farmProjectionVisible, true);
  assert.equal(evidence.whyMonsterProjected, true);
  assert.equal(evidence.whySpotProjected, true);
  assert.equal(evidence.observationSampleObserved, true);
  assert.equal(evidence.selectedMonster, "goo");
  assert.equal(evidence.selectedMap, "main");
});

test("farm supervisor downgrades runtime pass when supervisor evidence is incomplete", () => {
  const combined = combineFarmLiveTestResult(
    {
      outcome: "PASS",
      reason: "FARM_LIVE_E2E_CONFIRMED",
    },
    {
      farmTestStarted: true,
      farmTestCompleted: true,
      farmProjectionVisible: true,
      whyMonsterProjected: true,
      whySpotProjected: true,
      observationSampleObserved: false,
    },
  );

  assert.equal(combined.outcome, "FAIL");
  assert.equal(combined.reason, "SUPERVISOR_FARM_EVIDENCE_INCOMPLETE");
});

test("farm diagnostics explicitly preserve read-only scope", () => {
  const diagnostics = farmLiveTestDiagnostics(
    {
      requestId: "farm-1",
      outcome: "PASS",
      reason: "FARM_LIVE_E2E_CONFIRMED",
      durationMs: 1700,
      selection: {
        sampled: { monster: "goo", map: "main" },
        whyMonsterProjected: true,
        whySpotProjected: true,
        observedPerformanceProjected: true,
      },
      scope: {
        readOnly: true,
        movementMutationForced: false,
        combatMutationForced: false,
        valueMutationForced: false,
      },
      cleanup: { farmOverrideCleared: true },
    },
    {
      evidence: {
        farmTestStarted: true,
        farmTestCompleted: true,
        farmProjectionVisible: true,
        whyMonsterProjected: true,
        whySpotProjected: true,
        observationSampleObserved: true,
      },
    },
  );

  assert.equal(diagnostics.navigation.required, false);
  assert.equal(diagnostics.scope.readOnly, true);
  assert.equal(diagnostics.expected.value_mutation_forced, false);
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
});

test("coordinator and dashboard expose autonomous farm live test path", () => {
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
    path.join(__dirname, "..", "scripts", "run_farm_live_e2e.js"),
    "utf8",
  );

  assert.match(coordinator, /run_farm_live_test/);
  assert.match(coordinator, /wait_for_farm_live_test_runtime/);
  assert.match(coordinator, /farm_live_test_result/);
  assert.match(dashboard, /\/headless\/api\/characters\/:name\/tests\/farm/);
  assert.match(thread, /runFarmIntelligenceLiveTest/);
  assert.match(launcher, /ensureDashboardAvailable/);
  assert.match(launcher, /Stopping temporary caracAL runtime/);
});

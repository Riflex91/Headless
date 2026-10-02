"use strict";

function farmIntelligenceLiveTestEvidence(events = [], charBlock = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const types = runtimeEvents.map((event) => event.type);
  const projectedFarmStates = runtimeEvents
    .map((event) => event?.data?.farmIntelligence)
    .filter((farm) => farm && typeof farm === "object");
  if (charBlock.farm_intelligence_runtime) {
    projectedFarmStates.push(charBlock.farm_intelligence_runtime);
  }
  const selectedState = projectedFarmStates.find(
    (farm) =>
      farm?.selected &&
      typeof farm.selected.monster === "string" &&
      typeof farm.selected.whyMonster === "string" &&
      typeof farm.selected.whySpot === "string",
  );

  return {
    farmTestStarted: types.includes("FARM_INTELLIGENCE_LIVE_TEST_STARTED"),
    farmTestCompleted: types.includes("FARM_INTELLIGENCE_LIVE_TEST_COMPLETED"),
    farmProjectionVisible: projectedFarmStates.some(
      (farm) =>
        typeof farm.state === "string" && Array.isArray(farm.candidates),
    ),
    selectionProjected: !!selectedState,
    sampleEvents: runtimeEvents.filter(
      (event) =>
        event?.module === "FarmIntelligenceController" &&
        event?.type === "FARM_INTELLIGENCE_SAMPLE",
    ).length,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence?.farmTestStarted === true &&
    evidence?.farmTestCompleted === true &&
    evidence?.farmProjectionVisible === true &&
    evidence?.selectionProjected === true &&
    Number(evidence?.sampleEvents) >= 1
  );
}

function combineFarmIntelligenceLiveTestResult(runtimeResult, evidence) {
  const result = {
    ...(runtimeResult || {}),
    supervisor: { ...(evidence || {}) },
  };

  if (result.outcome === "PASS" && !evidenceComplete(evidence)) {
    result.outcome = "FAIL";
    result.reason = "SUPERVISOR_FARM_INTELLIGENCE_EVIDENCE_INCOMPLETE";
  }
  return result;
}

function farmIntelligenceLiveTestDiagnostics(
  result,
  {
    character = null,
    originalDesiredState = null,
    startState = null,
    evidence = null,
    incidentId = null,
  } = {},
) {
  const runtime = result || {};
  const supervisor = evidence || runtime.supervisor || {};

  return {
    test_id: runtime.requestId || runtime.request_id || null,
    character: character || runtime.character || null,
    start_state:
      startState || {
        desired_runtime_state: originalDesiredState,
      },
    preparation: {
      original_desired_state: originalDesiredState,
      passive_runtime_override: true,
    },
    navigation: {
      required: false,
      reason: "PASSIVE_FARM_INTELLIGENCE_SCOPE",
    },
    actions: {
      movement_mutation_forced: false,
      combat_mutation_forced: false,
      value_mutation_forced: false,
    },
    live_evidence: {
      runtime: runtime.intelligence || null,
      supervisor,
    },
    expected: {
      candidate_selected: true,
      why_monster_visible: true,
      why_spot_visible: true,
      observed_sample_visible: true,
      destructive_mutation_forced: false,
    },
    observed: {
      candidate_selected: !!runtime.intelligence?.selectedMonster,
      why_monster_visible: !!runtime.intelligence?.whyMonster,
      why_spot_visible: !!runtime.intelligence?.whySpot,
      observed_sample_visible: runtime.intelligence?.observedSample === true,
      supervisor_evidence_complete: evidenceComplete(supervisor),
    },
    result: {
      outcome: runtime.outcome || "UNKNOWN",
      reason: runtime.reason || null,
    },
    duration: runtime.durationMs ?? null,
    incident_id: incidentId,
    scope: runtime.scope || null,
    cleanup: runtime.cleanup || null,
  };
}

module.exports = {
  combineFarmIntelligenceLiveTestResult,
  evidenceComplete,
  farmIntelligenceLiveTestDiagnostics,
  farmIntelligenceLiveTestEvidence,
};

"use strict";

function farmLiveTestEvidence(events = [], charBlock = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const types = runtimeEvents.map((event) => event.type);
  const farmEvents = runtimeEvents.filter(
    (event) => event?.module === "FarmIntelligenceController",
  );
  const historicalProjection = farmEvents
    .map((event) => event.data?.farmIntelligence)
    .find(
      (projection) =>
        projection?.state === "READY" &&
        projection?.selected &&
        typeof projection.selected.monster === "string" &&
        typeof projection.selected.map === "string",
    );
  const liveProjection = charBlock.farm_intelligence_runtime || null;
  const projection =
    liveProjection?.state === "READY" && liveProjection?.selected
      ? liveProjection
      : historicalProjection || liveProjection || null;

  return {
    farmTestStarted: types.includes("FARM_LIVE_TEST_STARTED"),
    farmTestCompleted: types.includes("FARM_LIVE_TEST_COMPLETED"),
    farmProjectionVisible:
      projection?.state === "READY" &&
      typeof projection?.selected?.monster === "string" &&
      typeof projection?.selected?.map === "string",
    whyMonsterProjected:
      typeof projection?.selected?.whyMonster === "string" &&
      projection.selected.whyMonster.length > 0,
    whySpotProjected:
      typeof projection?.selected?.whySpot === "string" &&
      projection.selected.whySpot.length > 0,
    observationSampleObserved:
      types.includes("FARM_INTELLIGENCE_SAMPLE") ||
      !!projection?.selected?.observed,
    selectedMonster: projection?.selected?.monster || null,
    selectedMap: projection?.selected?.map || null,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence?.farmTestStarted === true &&
    evidence?.farmTestCompleted === true &&
    evidence?.farmProjectionVisible === true &&
    evidence?.whyMonsterProjected === true &&
    evidence?.whySpotProjected === true &&
    evidence?.observationSampleObserved === true
  );
}

function combineFarmLiveTestResult(runtimeResult, evidence) {
  const result = {
    ...(runtimeResult || {}),
    supervisor: { ...(evidence || {}) },
  };

  if (result.outcome === "PASS" && !evidenceComplete(evidence)) {
    result.outcome = "FAIL";
    result.reason = "SUPERVISOR_FARM_EVIDENCE_INCOMPLETE";
  }

  return result;
}

function farmLiveTestDiagnostics(
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
    start_state: startState || {
      desired_runtime_state: originalDesiredState,
      map: runtime.start?.map || null,
      x: runtime.start?.x ?? null,
      y: runtime.start?.y ?? null,
    },
    navigation: {
      required: false,
      reason: "FARM_INTELLIGENCE_READ_ONLY_LIVE_SCOPE",
    },
    live_evidence: {
      runtime: runtime.selection || null,
      supervisor,
    },
    expected: {
      candidate_selected: true,
      why_monster_projected: true,
      why_spot_projected: true,
      observed_performance_projected: true,
      movement_mutation_forced: false,
      combat_mutation_forced: false,
      value_mutation_forced: false,
      original_runtime_state_restored: true,
    },
    observed: {
      candidate_selected: !!runtime.selection?.sampled,
      why_monster_projected:
        runtime.selection?.whyMonsterProjected === true,
      why_spot_projected: runtime.selection?.whySpotProjected === true,
      observed_performance_projected:
        runtime.selection?.observedPerformanceProjected === true,
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
  combineFarmLiveTestResult,
  farmLiveTestDiagnostics,
  farmLiveTestEvidence,
};

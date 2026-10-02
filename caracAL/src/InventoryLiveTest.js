"use strict";

function inventoryLiveTestEvidence(events = [], charBlock = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const types = runtimeEvents.map((event) => event.type);
  const historicalProjection = runtimeEvents
    .filter(
      (event) =>
        event?.module === "InventoryIntelligenceController" &&
        event?.data?.inventoryIntelligence,
    )
    .map((event) => event.data.inventoryIntelligence)
    .find(
      (projection) =>
        projection?.state === "READY" || projection?.state === "EMPTY",
    );
  const liveProjection = charBlock.inventory_intelligence_runtime || null;
  const projection =
    liveProjection?.state === "READY" || liveProjection?.state === "EMPTY"
      ? liveProjection
      : historicalProjection || liveProjection || null;
  const entries = Array.isArray(projection?.entries) ? projection.entries : [];

  return {
    inventoryTestStarted: types.includes("INVENTORY_LIVE_TEST_STARTED"),
    inventoryTestCompleted: types.includes("INVENTORY_LIVE_TEST_COMPLETED"),
    inventoryProjectionVisible:
      projection?.state === "READY" || projection?.state === "EMPTY",
    classifiedEntries: entries.length,
    allEntriesExplained: entries.every(
      (entry) =>
        typeof entry?.disposition === "string" &&
        typeof entry?.why === "string" &&
        entry.why.length > 0,
    ),
    unknownItemsProtected: entries
      .filter((entry) => entry?.disposition === "UNKNOWN")
      .every(
        (entry) =>
          entry?.protected === true &&
          Array.isArray(entry?.protections) &&
          entry.protections.includes("UNKNOWN"),
      ),
  };
}

function evidenceComplete(evidence) {
  return (
    evidence?.inventoryTestStarted === true &&
    evidence?.inventoryTestCompleted === true &&
    evidence?.inventoryProjectionVisible === true &&
    evidence?.allEntriesExplained === true &&
    evidence?.unknownItemsProtected === true
  );
}

function combineInventoryLiveTestResult(runtimeResult, evidence) {
  const result = {
    ...(runtimeResult || {}),
    supervisor: { ...(evidence || {}) },
  };

  if (result.outcome === "PASS" && !evidenceComplete(evidence)) {
    result.outcome = "FAIL";
    result.reason = "SUPERVISOR_INVENTORY_EVIDENCE_INCOMPLETE";
  }

  return result;
}

function inventoryLiveTestDiagnostics(
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
    character,
    start_state: startState || {
      desired_runtime_state: originalDesiredState,
    },
    navigation: {
      required: false,
      reason: "INVENTORY_INTELLIGENCE_READ_ONLY_LIVE_SCOPE",
    },
    live_evidence: {
      runtime: runtime.inventory || null,
      supervisor,
    },
    expected: {
      every_live_item_classified: true,
      unknown_items_protected: true,
      protected_items_explained: true,
      movement_mutation_forced: false,
      combat_mutation_forced: false,
      value_mutation_forced: false,
      original_runtime_state_restored: true,
    },
    observed: {
      classified_entries: runtime.inventory?.classifiedEntries ?? null,
      non_empty_slots: runtime.inventory?.nonEmptySlots ?? null,
      all_entries_valid: runtime.inventory?.allEntriesValid === true,
      unknown_items_protected:
        runtime.inventory?.unknownItemsProtected === true,
      protected_entries_explained:
        runtime.inventory?.protectedEntriesExplained === true,
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
  combineInventoryLiveTestResult,
  inventoryLiveTestDiagnostics,
  inventoryLiveTestEvidence,
};

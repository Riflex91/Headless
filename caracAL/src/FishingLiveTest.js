"use strict";

const ALLOWED_FISHING_ACTIONS = new Set([
  "SMART_MOVE",
  "ATTACK",
  "LOOT",
  "BUY",
  "CRAFT",
  "EQUIP",
  "UNEQUIP",
  "SKILL",
]);

function fishingActionIntents(runtimeEvents) {
  return runtimeEvents.filter((event) => event?.type === "ACTION_INTENT");
}

function fishingLiveTestEvidence(
  events = [],
  characterBlock = {},
  { dispatcherSuppressedDuringTest = false } = {},
) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const types = runtimeEvents.map((event) => event.type);
  const completed = runtimeEvents
    .slice()
    .reverse()
    .find(
      (event) =>
        event?.module === "FishingLiveTest" &&
        event?.type === "FISHING_LIVE_TEST_COMPLETED",
    );
  const runtimeResult = completed?.data?.result || null;
  const runtimeEvidence = runtimeResult?.evidence || {};
  const scope = runtimeResult?.scope || {};
  const cleanup = runtimeResult?.cleanup || {};
  const intents = fishingActionIntents(runtimeEvents);
  const foreignIntents = intents.filter(
    (event) =>
      event?.module !== "MerchantFishingController" ||
      !ALLOWED_FISHING_ACTIONS.has(event?.data?.action),
  );

  return {
    runtimeTestStarted: types.includes("FISHING_LIVE_TEST_STARTED"),
    runtimeTestCompleted: types.includes("FISHING_LIVE_TEST_COMPLETED"),
    merchantAccountOwned: characterBlock.account_owned === true,
    merchantClassDetected:
      (characterBlock.account_character_type ||
        characterBlock.live_state?.ctype ||
        runtimeResult?.character?.ctype) === "merchant",
    skillChecked: runtimeEvidence.skillChecked === true,
    toolSatisfied: runtimeEvidence.toolSatisfied === true,
    toolAcquisitionSatisfied:
      runtimeEvidence.toolAcquisitionRequired !== true ||
      runtimeEvidence.toolAcquisitionObserved === true,
    zoneLocated: runtimeEvidence.zoneLocated === true,
    travelSatisfied: runtimeEvidence.travelSatisfied === true,
    rodEquipped: runtimeEvidence.rodEquipped === true,
    skillAttempted: runtimeEvidence.skillAttempted === true,
    resultObserved: runtimeEvidence.resultObserved === true,
    resultFound:
      typeof runtimeEvidence.resultFound === "boolean"
        ? runtimeEvidence.resultFound
        : null,
    mainhandRestored: runtimeEvidence.mainhandRestored === true,
    unknownOutcomeAvoided: runtimeEvidence.unknownOutcomeAvoided === true,
    roadmapComplete: runtimeEvidence.roadmapComplete === true,
    blindRetryDisabled: scope.blindRetryAllowed === false,
    standMutationIsolated: scope.standMutationAllowed === false,
    wishlistMutationIsolated: scope.wishlistMutationAllowed === false,
    pontyMutationIsolated: scope.pontyPurchaseAllowed === false,
    giveawayMutationIsolated: scope.giveawayMutationAllowed === false,
    miningMutationIsolated: scope.miningMutationAllowed === false,
    actionIsolationConfirmed: foreignIntents.length === 0,
    foreignActionIntents: foreignIntents.map((event) => ({
      module: event.module || null,
      action: event.data?.action || null,
      actionId: event.actionId || null,
    })),
    dispatcherSuppressedDuringTest: dispatcherSuppressedDuringTest === true,
    overrideCleared: cleanup.autonomyOverrideCleared === true,
    cleanupMainhandSafe: cleanup.mainhandRestored !== false,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.runtimeTestStarted === true &&
    evidence.runtimeTestCompleted === true &&
    evidence.merchantAccountOwned === true &&
    evidence.merchantClassDetected === true &&
    evidence.skillChecked === true &&
    evidence.toolSatisfied === true &&
    evidence.toolAcquisitionSatisfied === true &&
    evidence.zoneLocated === true &&
    evidence.travelSatisfied === true &&
    evidence.rodEquipped === true &&
    evidence.skillAttempted === true &&
    evidence.resultObserved === true &&
    evidence.mainhandRestored === true &&
    evidence.unknownOutcomeAvoided === true &&
    evidence.roadmapComplete === true &&
    evidence.blindRetryDisabled === true &&
    evidence.standMutationIsolated === true &&
    evidence.wishlistMutationIsolated === true &&
    evidence.pontyMutationIsolated === true &&
    evidence.giveawayMutationIsolated === true &&
    evidence.miningMutationIsolated === true &&
    evidence.actionIsolationConfirmed === true &&
    evidence.dispatcherSuppressedDuringTest === true &&
    evidence.overrideCleared === true &&
    evidence.cleanupMainhandSafe === true
  );
}

function combineFishingLiveTestResult(runtimeResult, evidence) {
  if (runtimeResult?.outcome !== "PASS") return runtimeResult;
  if (evidenceComplete(evidence)) {
    return {
      ...runtimeResult,
      outcome: "PASS",
      reason: "FISHING_LIVE_E2E_CONFIRMED",
    };
  }
  return {
    ...runtimeResult,
    outcome: "FAIL",
    reason: "SUPERVISOR_FISHING_EVIDENCE_INCOMPLETE",
  };
}

function fishingLiveTestDiagnostics(
  runtimeResult,
  {
    character = null,
    originalDesiredState = null,
    startState = null,
    evidence = null,
    incidentId = null,
  } = {},
) {
  const runtime = runtimeResult || {};
  const supervisor = evidence || {};
  return {
    test_id: runtime.requestId || runtime.request_id || null,
    character: character || runtime.character?.name || null,
    start_state: startState || {
      desired_runtime_state: originalDesiredState,
    },
    roadmap: [
      "Skill",
      "Tool",
      "Tool beschaffen",
      "Zone",
      "Travel",
      "Equip",
      "Skill",
      "Ergebnis",
      "alte Waffe restaurieren",
    ],
    live_evidence: {
      runtime: {
        final_status: runtime.finalStatus || null,
        stages_seen: runtime.stagesSeen || [],
        evidence: runtime.evidence || null,
        scope: runtime.scope || null,
      },
      supervisor,
    },
    expected: {
      merchant_account_owned: true,
      fishing_result_observed: true,
      found_true_or_false_both_valid: true,
      original_mainhand_restored: true,
      blind_retry_allowed: false,
      foreign_action_intents: 0,
      logistics_dispatcher_suppressed: true,
      original_runtime_state_restored: true,
    },
    observed: {
      supervisor_evidence_complete: evidenceComplete(supervisor),
      result_found: supervisor.resultFound ?? null,
      action_isolation_confirmed: supervisor.actionIsolationConfirmed === true,
      logistics_dispatcher_suppressed:
        supervisor.dispatcherSuppressedDuringTest === true,
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
  ALLOWED_FISHING_ACTIONS,
  combineFishingLiveTestResult,
  fishingLiveTestDiagnostics,
  fishingLiveTestEvidence,
};

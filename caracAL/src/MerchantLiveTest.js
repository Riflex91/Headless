"use strict";

function merchantLiveTestEvidence(events = [], characterBlock = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const types = runtimeEvents.map((event) => event.type);
  const completed = runtimeEvents
    .slice()
    .reverse()
    .find(
      (event) =>
        event?.module === "MerchantLiveTest" &&
        event?.type === "MERCHANT_LIVE_TEST_COMPLETED",
    );
  const runtimeResult = completed?.data?.result || null;
  const runtimeEvidence = runtimeResult?.evidence || {};
  const scope = runtimeResult?.scope || {};
  const autonomy = runtimeResult?.autonomy || {};

  return {
    runtimeTestStarted: types.includes("MERCHANT_LIVE_TEST_STARTED"),
    runtimeTestCompleted: types.includes("MERCHANT_LIVE_TEST_COMPLETED"),
    merchantAccountOwned: characterBlock.account_owned === true,
    merchantClassDetected:
      (characterBlock.account_character_type ||
        characterBlock.live_state?.ctype ||
        runtimeResult?.character?.ctype) === "merchant",
    featureCoverageComplete: runtimeEvidence.featureCoverageComplete === true,
    realGameDataVisible: runtimeEvidence.realGameDataVisible === true,
    merritDataVisible: runtimeEvidence.merritDataVisible === true,
    fishingDataVisible: runtimeEvidence.fishingDataVisible === true,
    miningDataVisible: runtimeEvidence.miningDataVisible === true,
    wishlistBoundaryVisible: runtimeEvidence.wishlistBoundaryVisible === true,
    pontyBoundaryVisible: runtimeEvidence.pontyBoundaryVisible === true,
    giveawaysReadOnly: runtimeEvidence.giveawaysReadOnly === true,
    autonomyReady: autonomy.state === "READY",
    mutationExecutionDisabled:
      autonomy.mutationPolicy?.executionEnabled === false,
    valueMutationNotForced: scope.valueMutationForced === false,
    movementMutationNotForced: scope.movementMutationForced === false,
    standMutationNotForced: scope.standMutationForced === false,
    wishlistMutationNotForced: scope.wishlistMutationForced === false,
    pontyPurchaseNotForced: scope.pontyPurchaseForced === false,
    giveawayJoinNotForced: scope.giveawayJoinForced === false,
    gatheringSkillNotForced: scope.gatheringSkillForced === false,
    equipmentMutationNotForced: scope.equipmentMutationForced === false,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.runtimeTestStarted === true &&
    evidence.runtimeTestCompleted === true &&
    evidence.merchantAccountOwned === true &&
    evidence.merchantClassDetected === true &&
    evidence.featureCoverageComplete === true &&
    evidence.realGameDataVisible === true &&
    evidence.merritDataVisible === true &&
    evidence.fishingDataVisible === true &&
    evidence.miningDataVisible === true &&
    evidence.wishlistBoundaryVisible === true &&
    evidence.pontyBoundaryVisible === true &&
    evidence.giveawaysReadOnly === true &&
    evidence.autonomyReady === true &&
    evidence.mutationExecutionDisabled === true &&
    evidence.valueMutationNotForced === true &&
    evidence.movementMutationNotForced === true &&
    evidence.standMutationNotForced === true &&
    evidence.wishlistMutationNotForced === true &&
    evidence.pontyPurchaseNotForced === true &&
    evidence.giveawayJoinNotForced === true &&
    evidence.gatheringSkillNotForced === true &&
    evidence.equipmentMutationNotForced === true
  );
}

function combineMerchantLiveTestResult(runtimeResult, evidence) {
  if (runtimeResult?.outcome !== "PASS") return runtimeResult;
  if (evidenceComplete(evidence)) {
    return {
      ...runtimeResult,
      outcome: "PASS",
      reason: "MERCHANT_LIVE_E2E_CONFIRMED",
    };
  }
  return {
    ...runtimeResult,
    outcome: "FAIL",
    reason: "SUPERVISOR_MERCHANT_EVIDENCE_INCOMPLETE",
  };
}

function merchantLiveTestDiagnostics(
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
    navigation: {
      required: false,
      reason: "MERCHANT_PHASE12_READ_ONLY_CORE_SCOPE",
    },
    live_evidence: {
      runtime: {
        character: runtime.character || null,
        autonomy: runtime.autonomy || null,
        evidence: runtime.evidence || null,
      },
      supervisor,
    },
    expected: {
      phase12_feature_coverage: true,
      current_game_data_visible: true,
      merchant_account_owned: true,
      giveaway_creation_supported: false,
      autonomous_value_mutations_enabled: false,
      value_mutation_forced: false,
      movement_mutation_forced: false,
      original_runtime_state_restored: true,
    },
    observed: {
      supervisor_evidence_complete: evidenceComplete(supervisor),
      mutation_execution_disabled:
        supervisor.mutationExecutionDisabled === true,
      giveaways_read_only: supervisor.giveawaysReadOnly === true,
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
  combineMerchantLiveTestResult,
  merchantLiveTestDiagnostics,
  merchantLiveTestEvidence,
};

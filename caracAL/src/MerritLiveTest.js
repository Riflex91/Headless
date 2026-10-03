"use strict";

function merritLiveTestEvidence(
  events = [],
  characterBlock = {},
  persistedCooldown = null,
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
        event?.module === "MerritLiveTest" &&
        event?.type === "MERRIT_LIVE_TEST_COMPLETED",
    );
  const runtimeResult = completed?.data?.result || null;
  const runtimeEvidence = runtimeResult?.evidence || {};
  const scope = runtimeResult?.scope || {};
  const cleanup = runtimeResult?.cleanup || {};
  const parcelReadyAt = Number(runtimeResult?.finalStatus?.parcel?.readyAt);
  const persistedReadyAt = Number(persistedCooldown?.ready_at);

  return {
    runtimeTestStarted: types.includes("MERRIT_LIVE_TEST_STARTED"),
    runtimeTestCompleted: types.includes("MERRIT_LIVE_TEST_COMPLETED"),
    merchantAccountOwned: characterBlock.account_owned === true,
    merchantClassDetected:
      (characterBlock.account_character_type ||
        characterBlock.live_state?.ctype ||
        runtimeResult?.character?.ctype) === "merchant",
    cooldownChecked: runtimeEvidence.cooldownChecked === true,
    zoneSatisfied: runtimeEvidence.zoneSatisfied === true,
    positionConfirmed: runtimeEvidence.positionConfirmed === true,
    standConfirmed: runtimeEvidence.standConfirmed === true,
    listingConfirmed: runtimeEvidence.listingConfirmed === true,
    settleObserved: runtimeEvidence.settleObserved === true,
    handoffSatisfied: runtimeEvidence.handoffSatisfied === true,
    parcelConfirmed: runtimeEvidence.parcelConfirmed === true,
    cooldownReadyAtPresent:
      runtimeEvidence.cooldownReadyAtPresent === true &&
      Number.isFinite(parcelReadyAt),
    cooldownPersisted:
      Number.isFinite(parcelReadyAt) &&
      Number.isFinite(persistedReadyAt) &&
      persistedReadyAt === parcelReadyAt,
    blindRetryDisabled: scope.blindRetryAllowed === false,
    wishlistMutationIsolated: scope.wishlistMutationAllowed === false,
    pontyMutationIsolated: scope.pontyPurchaseAllowed === false,
    giveawayMutationIsolated: scope.giveawayMutationAllowed === false,
    gatheringMutationIsolated: scope.gatheringMutationAllowed === false,
    equipmentMutationIsolated: scope.equipmentMutationAllowed === false,
    overrideCleared: cleanup.autonomyOverrideCleared === true,
    temporaryListingRestored: cleanup.temporaryListingRestored !== false,
    standRestored: cleanup.standRestored !== false,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.runtimeTestStarted === true &&
    evidence.runtimeTestCompleted === true &&
    evidence.merchantAccountOwned === true &&
    evidence.merchantClassDetected === true &&
    evidence.cooldownChecked === true &&
    evidence.zoneSatisfied === true &&
    evidence.positionConfirmed === true &&
    evidence.standConfirmed === true &&
    evidence.listingConfirmed === true &&
    evidence.settleObserved === true &&
    evidence.handoffSatisfied === true &&
    evidence.parcelConfirmed === true &&
    evidence.cooldownReadyAtPresent === true &&
    evidence.cooldownPersisted === true &&
    evidence.blindRetryDisabled === true &&
    evidence.wishlistMutationIsolated === true &&
    evidence.pontyMutationIsolated === true &&
    evidence.giveawayMutationIsolated === true &&
    evidence.gatheringMutationIsolated === true &&
    evidence.equipmentMutationIsolated === true &&
    evidence.overrideCleared === true &&
    evidence.temporaryListingRestored === true &&
    evidence.standRestored === true
  );
}

function combineMerritLiveTestResult(runtimeResult, evidence) {
  if (runtimeResult?.outcome !== "PASS") return runtimeResult;
  if (evidenceComplete(evidence)) {
    return {
      ...runtimeResult,
      outcome: "PASS",
      reason: "MERRIT_LIVE_E2E_CONFIRMED",
    };
  }
  return {
    ...runtimeResult,
    outcome: "FAIL",
    reason: "SUPERVISOR_MERRIT_EVIDENCE_INCOMPLETE",
  };
}

function merritLiveTestDiagnostics(
  runtimeResult,
  {
    character = null,
    originalDesiredState = null,
    startState = null,
    evidence = null,
    persistedCooldown = null,
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
      "Cooldown",
      "Zone",
      "Travel",
      "Position",
      "Stand",
      "Listing",
      "120 s settle",
      "Handoff",
      "Parcel",
      "Cooldown persistieren",
    ],
    live_evidence: {
      runtime: {
        final_status: runtime.finalStatus || null,
        stages_seen: runtime.stagesSeen || [],
        evidence: runtime.evidence || null,
        scope: runtime.scope || null,
      },
      supervisor,
      persisted_cooldown: persistedCooldown,
    },
    expected: {
      merchant_account_owned: true,
      parcel_confirmed: true,
      account_cooldown_persisted: true,
      blind_retry_allowed: false,
      foreign_phase12_mutations_allowed: false,
      original_runtime_state_restored: true,
    },
    observed: {
      supervisor_evidence_complete: evidenceComplete(supervisor),
      cooldown_persisted: supervisor.cooldownPersisted === true,
      parcel_confirmed: supervisor.parcelConfirmed === true,
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
  combineMerritLiveTestResult,
  merritLiveTestDiagnostics,
  merritLiveTestEvidence,
};

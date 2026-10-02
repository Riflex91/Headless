"use strict";

function groupLiveTestEvidence(events = [], charBlock = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const groupEvents = runtimeEvents.filter(
    (event) => event?.module === "GroupCombatController",
  );
  const types = runtimeEvents.map((event) => event.type);
  const partyActions = groupEvents.filter(
    (event) =>
      event.type === "GROUP_COMBAT_ACTION" &&
      String(event.why || "").startsWith("PARTY_"),
  );
  const historicalProjection = groupEvents
    .map((event) => event.data?.groupCombat)
    .find(
      (projection) =>
        projection &&
        ["LEADER", "FOLLOWER"].includes(projection.role) &&
        typeof projection.leader === "string",
    );
  const liveProjection = charBlock.group_combat_runtime || null;
  const projection =
    liveProjection &&
    ["LEADER", "FOLLOWER"].includes(liveProjection.role) &&
    typeof liveProjection.leader === "string"
      ? liveProjection
      : historicalProjection || liveProjection || null;

  return {
    groupTestStarted: types.includes("GROUP_LIVE_TEST_STARTED"),
    groupTestCompleted: types.includes("GROUP_LIVE_TEST_COMPLETED"),
    partyActions: partyActions.length,
    groupProjectionVisible:
      !!projection &&
      typeof projection.role === "string" &&
      Array.isArray(projection.partyMembers),
    roleProjected:
      projection?.role === "LEADER" || projection?.role === "FOLLOWER",
    leaderProjected:
      typeof projection?.leader === "string" && projection.leader.length > 0,
  };
}

function evidenceComplete(evidence, runtimeResult) {
  return (
    evidence?.groupTestStarted === true &&
    evidence?.groupTestCompleted === true &&
    evidence?.groupProjectionVisible === true &&
    evidence?.roleProjected === true &&
    evidence?.leaderProjected === true &&
    (Number(evidence?.partyActions) >= 1 ||
      runtimeResult?.preparation?.initialPairFormed === true)
  );
}

function combineGroupLiveTestResult(runtimeResult, evidence) {
  const result = {
    ...(runtimeResult || {}),
    supervisor: { ...(evidence || {}) },
  };

  if (
    result.outcome === "PASS" &&
    !evidenceComplete(evidence, runtimeResult)
  ) {
    result.outcome = "FAIL";
    result.reason = "SUPERVISOR_GROUP_EVIDENCE_INCOMPLETE";
  }

  return result;
}

function groupLiveTestDiagnostics(
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
        party_members: runtime.start?.partyMembers || [],
      },
    preparation: {
      original_desired_state: originalDesiredState,
      role: runtime.role || null,
      leader: runtime.leader || null,
      peer: runtime.peer || null,
      initial_pair_formed:
        runtime.preparation?.initialPairFormed === true,
      dissolved_initial_pair:
        runtime.preparation?.dissolvedInitialPair === true,
      existing_party_conflict:
        runtime.preparation?.existingPartyConflict === true,
    },
    navigation: {
      required: false,
      reason: "PARTY_FORMATION_ONLY_SAFE_LIVE_SCOPE",
    },
    actions: {
      party_action_observed:
        runtime.party?.partyActionObserved === true,
      last_action_id: runtime.party?.lastActionId || null,
      last_action_status: runtime.party?.lastActionStatus || null,
      last_action_kind: runtime.party?.lastActionKind || null,
    },
    live_evidence: {
      runtime: runtime.party || null,
      supervisor,
    },
    expected: {
      pair_formed: true,
      role_projected: true,
      leader_projected: true,
      combat_mutation_forced: false,
      aoe_mutation_forced: false,
      healing_mutation_forced: false,
      initial_party_restored: true,
    },
    observed: {
      pair_formed: runtime.party?.formed === true,
      role_projected: runtime.party?.roleProjected === true,
      leader_projected: runtime.party?.leaderProjected === true,
      initial_party_restored:
        runtime.cleanup?.initialPartyRestored === true,
      supervisor_evidence_complete: evidenceComplete(
        supervisor,
        runtime,
      ),
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
  combineGroupLiveTestResult,
  groupLiveTestDiagnostics,
  groupLiveTestEvidence,
};

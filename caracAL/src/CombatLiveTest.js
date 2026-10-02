"use strict";

function combatLiveTestEvidence(events = [], charBlock = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const combatEvents = runtimeEvents.filter(
    (event) => event?.module === "CombatController",
  );
  const types = runtimeEvents.map((event) => event.type);
  const attackEvents = combatEvents.filter(
    (event) => event.type === "COMBAT_ACTION" && event.why === "ATTACK",
  );
  const combat = charBlock.combat_runtime || null;

  return {
    combatTestStarted: types.includes("COMBAT_LIVE_TEST_STARTED"),
    targetChanged: combatEvents.some(
      (event) => event.type === "COMBAT_TARGET_CHANGED",
    ),
    attackActions: attackEvents.length,
    confirmedAttack: attackEvents.some(
      (event) => event.data?.actionStatus === "CONFIRMED",
    ),
    combatTestCompleted: types.includes("COMBAT_LIVE_TEST_COMPLETED"),
    combatProjectionVisible:
      !!combat &&
      typeof combat.state === "string" &&
      combat.resources &&
      typeof combat.resources === "object",
    resourceProjectionVisible:
      !!combat?.resources &&
      Number.isFinite(combat.resources.hp) &&
      Number.isFinite(combat.resources.maxHp) &&
      Number.isFinite(combat.resources.mp) &&
      Number.isFinite(combat.resources.maxMp),
  };
}

function evidenceComplete(evidence) {
  return (
    evidence?.combatTestStarted === true &&
    evidence?.targetChanged === true &&
    Number(evidence?.attackActions) >= 1 &&
    evidence?.confirmedAttack === true &&
    evidence?.combatTestCompleted === true &&
    evidence?.combatProjectionVisible === true &&
    evidence?.resourceProjectionVisible === true
  );
}

function combineCombatLiveTestResult(runtimeResult, evidence) {
  const result = {
    ...(runtimeResult || {}),
    supervisor: { ...(evidence || {}) },
  };

  if (result.outcome === "PASS" && !evidenceComplete(evidence)) {
    result.outcome = "FAIL";
    result.reason = "SUPERVISOR_COMBAT_EVIDENCE_INCOMPLETE";
  }

  return result;
}

function combatLiveTestDiagnostics(
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
      startState ||
      (runtime.start
        ? {
            map: runtime.start.map || null,
            x: runtime.start.x ?? null,
            y: runtime.start.y ?? null,
            hp: runtime.start.hp ?? null,
            mp: runtime.start.mp ?? null,
            desired_runtime_state: originalDesiredState,
          }
        : {
            desired_runtime_state: originalDesiredState,
          }),
    preparation: {
      original_desired_state: originalDesiredState,
      initial_movement_cancel_status:
        runtime.preparation?.initialMovementCancelStatus ?? null,
      respawned_at_start: runtime.preparation?.respawnedAtStart === true,
      destination_candidates: runtime.preparation?.destinationCandidates || [],
      selected_monster_type: runtime.preparation?.selectedMonsterType || null,
    },
    navigation: {
      outbound_status: runtime.navigation?.outboundStatus ?? null,
      return_status: runtime.navigation?.returnStatus ?? null,
      final_distance_to_start: runtime.navigation?.finalDistanceToStart ?? null,
      returned_to_start: runtime.navigation?.returnedToStart === true,
    },
    actions: {
      target_id: runtime.combat?.targetId || null,
      target_type: runtime.combat?.targetType || null,
      attack_action_id: runtime.combat?.attackActionId || null,
      attack_action_status: runtime.combat?.attackActionStatus || null,
    },
    live_evidence: {
      runtime: runtime.combat || null,
      supervisor,
    },
    expected: {
      target_selected: true,
      in_range_observed: true,
      attack_confirmed: true,
      cooldown_observed: true,
      resource_telemetry_visible: true,
      returned_to_start: true,
      destructive_death_forced: false,
    },
    observed: {
      target_selected: !!runtime.combat?.targetId,
      in_range_observed: runtime.combat?.inRangeObserved === true,
      attack_confirmed: runtime.combat?.attackActionStatus === "CONFIRMED",
      cooldown_observed: runtime.combat?.cooldownObserved === true,
      resource_telemetry_visible: runtime.combat?.resourcesVisible === true,
      returned_to_start: runtime.navigation?.returnedToStart === true,
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
  combatLiveTestDiagnostics,
  combatLiveTestEvidence,
  combineCombatLiveTestResult,
  evidenceComplete,
};

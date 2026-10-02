"use strict";

function classSkillLiveTestEvidence(events = [], charBlock = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const classSkillEvents = runtimeEvents.filter(
    (event) => event?.module === "RangerSkillController",
  );
  const types = runtimeEvents.map((event) => event.type);
  const actionEvents = classSkillEvents.filter(
    (event) =>
      event.type === "CLASS_SKILL_ACTION" &&
      event.data?.skill === "track",
  );
  const projection = charBlock.class_skill_runtime || null;

  return {
    classSkillTestStarted: types.includes("CLASS_SKILL_LIVE_TEST_STARTED"),
    actionEvents: actionEvents.length,
    confirmedTrack: actionEvents.some(
      (event) => event.data?.actionStatus === "CONFIRMED",
    ),
    classSkillTestCompleted: types.includes("CLASS_SKILL_LIVE_TEST_COMPLETED"),
    classSkillProjectionVisible:
      !!projection &&
      projection.className === "ranger" &&
      projection.module === "RangerSkillController",
    confirmedActionProjection:
      projection?.lastAction?.skill === "track" &&
      projection?.lastAction?.status === "CONFIRMED",
  };
}

function evidenceComplete(evidence) {
  return (
    evidence?.classSkillTestStarted === true &&
    Number(evidence?.actionEvents) >= 1 &&
    evidence?.confirmedTrack === true &&
    evidence?.classSkillTestCompleted === true &&
    evidence?.classSkillProjectionVisible === true &&
    evidence?.confirmedActionProjection === true
  );
}

function combineClassSkillLiveTestResult(runtimeResult, evidence) {
  const result = {
    ...(runtimeResult || {}),
    supervisor: { ...(evidence || {}) },
  };

  if (result.outcome === "PASS" && !evidenceComplete(evidence)) {
    result.outcome = "FAIL";
    result.reason = "SUPERVISOR_CLASS_SKILL_EVIDENCE_INCOMPLETE";
  }

  return result;
}

function classSkillLiveTestDiagnostics(
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
            ctype: runtime.start.ctype || null,
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
      respawned_at_start: runtime.preparation?.respawnedAtStart === true,
      selected_skill: runtime.preparation?.selectedSkill || null,
      skill_mp: runtime.preparation?.skillMp ?? null,
      initial_cooldown_ms:
        runtime.preparation?.initialCooldownMs ?? null,
    },
    navigation: {
      required: false,
      reason: "SAFE_NON_TARGET_RANGER_SKILL",
    },
    actions: {
      skill: runtime.classSkill?.selectedSkill || null,
      action_id: runtime.classSkill?.actionId || null,
      action_status: runtime.classSkill?.actionStatus || null,
    },
    live_evidence: {
      runtime: runtime.classSkill || null,
      supervisor,
    },
    expected: {
      class: "ranger",
      skill: "track",
      action_confirmed: true,
      cooldown_observed: true,
      mp_cost_observed: true,
      resource_telemetry_visible: true,
      consumable_mutation_forced: false,
      combat_mutation_forced: false,
    },
    observed: {
      class: runtime.scope?.testedClass || runtime.start?.ctype || null,
      skill: runtime.classSkill?.selectedSkill || null,
      action_confirmed:
        runtime.classSkill?.actionStatus === "CONFIRMED",
      cooldown_observed:
        runtime.classSkill?.cooldownObserved === true,
      mp_cost_observed: runtime.classSkill?.mpCostObserved === true,
      resource_telemetry_visible:
        runtime.classSkill?.resourceTelemetryVisible === true,
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
  classSkillLiveTestDiagnostics,
  classSkillLiveTestEvidence,
  combineClassSkillLiveTestResult,
  evidenceComplete,
};

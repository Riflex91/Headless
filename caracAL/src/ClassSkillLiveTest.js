"use strict";

function liveProfile(charBlock = {}) {
  const projection = charBlock.class_skill_runtime || null;
  const ctype =
    charBlock.account_character_type ||
    charBlock.live_state?.ctype ||
    projection?.className ||
    null;

  if (ctype === "merchant") {
    return {
      className: "merchant",
      module: "MerchantSkillController",
      skill: "massproduction",
      navigationReason: "SAFE_NON_TARGET_MERCHANT_SKILL",
    };
  }

  return {
    className: "ranger",
    module: "RangerSkillController",
    skill: "track",
    navigationReason: "SAFE_NON_TARGET_RANGER_SKILL",
  };
}

function classSkillLiveTestEvidence(events = [], charBlock = {}) {
  const profile = liveProfile(charBlock);
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const classSkillEvents = runtimeEvents.filter(
    (event) => event?.module === profile.module,
  );
  const types = runtimeEvents.map((event) => event.type);
  const actionEvents = classSkillEvents.filter(
    (event) =>
      event.type === "CLASS_SKILL_ACTION" &&
      event.data?.skill === profile.skill,
  );
  const projection = charBlock.class_skill_runtime || null;
  const confirmedSkill = actionEvents.some(
    (event) => event.data?.actionStatus === "CONFIRMED",
  );

  return {
    testedClass: profile.className,
    safeSkill: profile.skill,
    classSkillTestStarted: types.includes("CLASS_SKILL_LIVE_TEST_STARTED"),
    actionEvents: actionEvents.length,
    confirmedSkill,
    confirmedTrack: profile.skill === "track" && confirmedSkill,
    classSkillTestCompleted: types.includes("CLASS_SKILL_LIVE_TEST_COMPLETED"),
    classSkillProjectionVisible:
      !!projection &&
      projection.className === profile.className &&
      projection.module === profile.module,
    confirmedActionProjection:
      projection?.lastAction?.skill === profile.skill &&
      projection?.lastAction?.status === "CONFIRMED",
  };
}

function evidenceComplete(evidence) {
  return (
    evidence?.classSkillTestStarted === true &&
    Number(evidence?.actionEvents) >= 1 &&
    evidence?.confirmedSkill === true &&
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
  const expectedClass =
    runtime.scope?.testedClass || supervisor.testedClass || "ranger";
  const expectedSkill =
    runtime.scope?.safeSkill || supervisor.safeSkill || "track";
  const navigationReason =
    expectedClass === "merchant"
      ? "SAFE_NON_TARGET_MERCHANT_SKILL"
      : "SAFE_NON_TARGET_RANGER_SKILL";

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
      initial_cooldown_ms: runtime.preparation?.initialCooldownMs ?? null,
    },
    navigation: {
      required: false,
      reason: navigationReason,
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
      class: expectedClass,
      skill: expectedSkill,
      action_confirmed: true,
      cooldown_required: runtime.scope?.cooldownEvidenceRequired !== false,
      cooldown_observed:
        runtime.scope?.cooldownEvidenceRequired === false ? null : true,
      mp_cost_observed: true,
      resource_telemetry_visible: true,
      consumable_mutation_forced: false,
      combat_mutation_forced: false,
    },
    observed: {
      class: runtime.scope?.testedClass || runtime.start?.ctype || null,
      skill: runtime.classSkill?.selectedSkill || null,
      action_confirmed: runtime.classSkill?.actionStatus === "CONFIRMED",
      cooldown_observed: runtime.classSkill?.cooldownObserved === true,
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

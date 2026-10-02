"use strict";

function movementLiveTestEvidence(
  events = [],
  charBlock = {},
  { startedAt } = {},
) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const types = runtimeEvents.map((event) => event.type);
  const waypointSettlements = types.filter(
    (type) => type === "MOVEMENT_WAYPOINT_SETTLED",
  ).length;
  const game = charBlock.live_state || null;
  const trail = Array.isArray(charBlock.movement_trail)
    ? charBlock.movement_trail
    : [];
  const testTrail = Number.isFinite(startedAt)
    ? trail.filter(
        (point) =>
          Number.isFinite(point?.timestamp) && point.timestamp >= startedAt,
      )
    : trail;

  return {
    safePointSet: types.includes("MOVEMENT_SAFE_POINT_SET"),
    pathStarted: types.includes("MOVEMENT_PATH_STARTED"),
    waypointSettlements,
    pathCompleted: types.includes("MOVEMENT_PATH_COMPLETED"),
    returnStarted: types.includes("MOVEMENT_RETURN_STARTED"),
    movementTestCompleted: types.includes("MOVEMENT_LIVE_TEST_COMPLETED"),
    movementProjectionVisible:
      !!game &&
      typeof game.movement_mode === "string" &&
      game.movement_stuck &&
      typeof game.movement_stuck.stuck === "boolean",
    finalIdle:
      !!game &&
      game.movement_mode === "IDLE" &&
      game.movement_owner === null &&
      game.movement_command === null,
    trailPoints: testTrail.length,
    trailVisible: testTrail.length >= 2,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence?.safePointSet === true &&
    evidence?.pathStarted === true &&
    Number(evidence?.waypointSettlements) >= 2 &&
    evidence?.pathCompleted === true &&
    evidence?.returnStarted === true &&
    evidence?.movementTestCompleted === true &&
    evidence?.movementProjectionVisible === true &&
    evidence?.finalIdle === true
  );
}

function combineMovementLiveTestResult(runtimeResult, evidence) {
  const result = {
    ...(runtimeResult || {}),
    supervisor: { ...evidence },
  };

  if (result.outcome === "PASS" && !evidenceComplete(evidence)) {
    result.outcome = "FAIL";
    result.reason = "SUPERVISOR_MOVEMENT_EVIDENCE_INCOMPLETE";
  }

  return result;
}

function movementLiveTestDiagnostics(
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
            desired_runtime_state: originalDesiredState,
          }
        : {
            desired_runtime_state: originalDesiredState,
          }),
    preparation: {
      original_desired_state: originalDesiredState,
      safe_point_captured: runtime.evidence?.safePointCaptured === true,
      autonomous_character_start:
        originalDesiredState !== null && originalDesiredState !== "RUNNING",
    },
    navigation: {
      attempt: runtime.path?.attempt ?? null,
      waypoints: Array.isArray(runtime.path?.waypoints)
        ? runtime.path.waypoints
        : [],
      path_completed: runtime.path?.completed === true,
    },
    actions: {
      path_first_action_status: runtime.path?.firstActionStatus || null,
      return_action_status: runtime.returned?.actionStatus || null,
      cleanup_cancel_status: runtime.cleanup?.cancelStatus || null,
      safe_point_cleared: runtime.cleanup?.safePointCleared === true,
    },
    live_evidence: {
      ...supervisor,
      runtime: runtime.evidence || null,
    },
    expected: {
      path_completed: true,
      waypoint_settlements_at_least: 2,
      return_confirmed: true,
      final_idle: true,
      movement_projection_visible: true,
    },
    observed: {
      path_completed: runtime.path?.completed === true,
      waypoint_settlements: Number(supervisor.waypointSettlements) || 0,
      return_confirmed: runtime.returned?.confirmed === true,
      final_idle:
        runtime.evidence?.finalIdle === true && supervisor.finalIdle === true,
      movement_projection_visible:
        supervisor.movementProjectionVisible === true,
      trail_points: Number(supervisor.trailPoints) || 0,
    },
    result: runtime.outcome || null,
    reason: runtime.reason || null,
    duration_ms: Number.isFinite(runtime.durationMs)
      ? runtime.durationMs
      : null,
    incident_id: incidentId,
  };
}

module.exports = {
  combineMovementLiveTestResult,
  evidenceComplete,
  movementLiveTestDiagnostics,
  movementLiveTestEvidence,
};

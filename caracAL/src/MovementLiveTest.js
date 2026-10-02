"use strict";

function movementLiveTestEvidence(events = [], charBlock = {}) {
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
    trailPoints: trail.length,
    trailVisible: trail.length >= 2,
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
    evidence?.finalIdle === true &&
    evidence?.trailVisible === true
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

module.exports = {
  combineMovementLiveTestResult,
  evidenceComplete,
  movementLiveTestEvidence,
};

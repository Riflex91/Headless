"use strict";

const TRAIL_RETENTION_MS = 5 * 60 * 1000;
const TRAIL_MAX_POINTS = 800;
const MOVEMENT_PATH_MAX_POINTS = 200;

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function publicWaypoint(point, fallbackMap = null) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  const map =
    typeof point.map === "string" && point.map.trim()
      ? point.map.trim()
      : fallbackMap;

  return {
    map: map || null,
    x: point.x,
    y: point.y,
    ...(Number.isFinite(point.tolerance) && {
      tolerance: point.tolerance,
    }),
  };
}

function publicMovementCommand(active) {
  if (!active || typeof active !== "object") return null;

  const command = {
    id: Number.isInteger(active.id) ? active.id : null,
    type: typeof active.type === "string" ? active.type : null,
    owner: typeof active.owner === "string" ? active.owner : null,
    module: typeof active.module === "string" ? active.module : null,
    reason: typeof active.reason === "string" ? active.reason : null,
    correlationId:
      typeof active.correlationId === "string" ? active.correlationId : null,
    startedAt: finiteNumber(active.startedAt),
    actionId: typeof active.actionId === "string" ? active.actionId : null,
    target: null,
  };

  if (active.target && typeof active.target === "object") {
    if (
      Number.isFinite(active.target.x) &&
      Number.isFinite(active.target.y)
    ) {
      command.target = {
        x: active.target.x,
        y: active.target.y,
      };
    } else if (active.target.destination !== undefined) {
      const destination = active.target.destination;
      if (typeof destination === "string") {
        command.target = { destination };
      } else {
        const waypoint = publicWaypoint(destination);
        if (waypoint) {
          command.target = { destination: waypoint };
        }
      }
    }
  }

  return command;
}

function normalizeMovementRuntimeState(
  movement,
  { timestamp = Date.now(), eventType = null, eventReason = null } = {},
) {
  if (!movement || typeof movement !== "object") return null;

  const path =
    movement.path && typeof movement.path === "object"
      ? {
          id: Number.isInteger(movement.path.id) ? movement.path.id : null,
          owner:
            typeof movement.path.owner === "string"
              ? movement.path.owner
              : null,
          startedAt: finiteNumber(movement.path.startedAt),
          index: Number.isInteger(movement.path.index)
            ? movement.path.index
            : null,
          total: Number.isInteger(movement.path.total)
            ? movement.path.total
            : null,
          current: publicWaypoint(movement.path.current),
          destination: publicWaypoint(movement.path.destination),
          remaining: Array.isArray(movement.path.remaining)
            ? movement.path.remaining
                .slice(0, MOVEMENT_PATH_MAX_POINTS)
                .map((point) => publicWaypoint(point))
                .filter(Boolean)
            : [],
        }
      : null;

  const safePoint = publicWaypoint(movement.safePoint);
  if (safePoint && movement.safePoint) {
    safePoint.source =
      typeof movement.safePoint.source === "string"
        ? movement.safePoint.source
        : null;
    safePoint.capturedAt = finiteNumber(movement.safePoint.capturedAt);
  }

  const stuck =
    movement.stuck && typeof movement.stuck === "object"
      ? {
          commandKey:
            typeof movement.stuck.commandKey === "string"
              ? movement.stuck.commandKey
              : null,
          stuck: movement.stuck.stuck === true,
          stuckSince: finiteNumber(movement.stuck.stuckSince),
          lastProgressAt: finiteNumber(movement.stuck.lastProgressAt),
          lastPosition: publicWaypoint(movement.stuck.lastPosition),
        }
      : {
          commandKey: null,
          stuck: false,
          stuckSince: null,
          lastProgressAt: null,
          lastPosition: null,
        };

  const active = publicMovementCommand(movement.active);

  return {
    timestamp: finiteNumber(timestamp) ?? Date.now(),
    eventType: typeof eventType === "string" ? eventType : null,
    eventReason: typeof eventReason === "string" ? eventReason : null,
    owner: typeof movement.owner === "string" ? movement.owner : null,
    mode: typeof movement.mode === "string" ? movement.mode : "IDLE",
    active,
    path,
    safePoint,
    stuck,
  };
}

function runtimeDestination(runtime, currentMap = null) {
  if (!runtime) return null;
  if (runtime.path?.destination) {
    return { ...runtime.path.destination };
  }

  const target = runtime.active?.target;
  if (!target) return null;

  if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
    return {
      map: currentMap || null,
      x: target.x,
      y: target.y,
    };
  }

  if (target.destination && typeof target.destination === "object") {
    return publicWaypoint(target.destination, currentMap);
  }

  return null;
}

function applyMovementRuntimeProjection(liveState, runtime) {
  if (!liveState || !runtime) return liveState;

  liveState.movement_runtime = runtime;
  liveState.movement_owner = runtime.owner;
  liveState.movement_mode = runtime.mode;
  liveState.movement_reason =
    runtime.active?.reason || runtime.eventReason || null;
  liveState.movement_command = runtime.active;
  liveState.movement_stuck = runtime.stuck;
  liveState.safe_point = runtime.safePoint;
  liveState.runtime_planned_path = runtime.path
    ? runtime.path.remaining.map((point) => ({ ...point }))
    : [];
  liveState.runtime_planned_destination = runtimeDestination(
    runtime,
    liveState.map || null,
  );
  return liveState;
}

function updateCharacterMovementRuntime(
  charBlock,
  movement,
  metadata = {},
  now = Date.now(),
) {
  const runtime = normalizeMovementRuntimeState(movement, {
    timestamp: metadata.timestamp ?? now,
    eventType: metadata.eventType || null,
    eventReason: metadata.eventReason || null,
  });
  if (!runtime) return null;

  charBlock.movement_runtime = runtime;
  if (charBlock.live_state) {
    applyMovementRuntimeProjection(charBlock.live_state, runtime);
  }
  return runtime;
}

function deriveHeading(previous, next) {
  const previousX = finiteNumber(previous?.x);
  const previousY = finiteNumber(previous?.y);
  const nextX = finiteNumber(next?.x);
  const nextY = finiteNumber(next?.y);

  if (
    previousX !== null &&
    previousY !== null &&
    nextX !== null &&
    nextY !== null
  ) {
    const dx = nextX - previousX;
    const dy = nextY - previousY;
    if (Math.hypot(dx, dy) >= 0.25) {
      const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
      return (degrees + 360) % 360;
    }
  }

  return finiteNumber(next?.angle);
}

function shouldAppendTrailPoint(lastPoint, nextPoint) {
  if (!lastPoint) return true;
  if (lastPoint.map !== nextPoint.map) return true;

  const distance = Math.hypot(
    nextPoint.x - lastPoint.x,
    nextPoint.y - lastPoint.y,
  );
  return distance >= 1 || nextPoint.timestamp - lastPoint.timestamp >= 2000;
}

function updateCharacterLiveState(charBlock, statBeat, now = Date.now()) {
  const previous = charBlock.live_state || null;
  const x = finiteNumber(statBeat.x);
  const y = finiteNumber(statBeat.y);
  const heading = deriveHeading(previous, statBeat);

  const liveState = {
    ...statBeat,
    timestamp: now,
    x,
    y,
    heading,
    movement_destination:
      statBeat.moving &&
      finiteNumber(statBeat.going_x) !== null &&
      finiteNumber(statBeat.going_y) !== null
        ? {
            map: statBeat.map || null,
            x: statBeat.going_x,
            y: statBeat.going_y,
          }
        : null,
  };
  delete liveState.type;
  delete liveState.mmap;

  applyMovementRuntimeProjection(liveState, charBlock.movement_runtime);
  charBlock.live_state = liveState;
  charBlock.movement_trail = Array.isArray(charBlock.movement_trail)
    ? charBlock.movement_trail
    : [];

  if (x !== null && y !== null) {
    const point = {
      timestamp: now,
      map: statBeat.map || null,
      x,
      y,
      heading,
    };
    const lastPoint =
      charBlock.movement_trail[charBlock.movement_trail.length - 1];

    if (shouldAppendTrailPoint(lastPoint, point)) {
      charBlock.movement_trail.push(point);
    }
  }

  const cutoff = now - TRAIL_RETENTION_MS;
  charBlock.movement_trail = charBlock.movement_trail
    .filter((point) => point.timestamp >= cutoff)
    .slice(-TRAIL_MAX_POINTS);

  return liveState;
}

module.exports = {
  MOVEMENT_PATH_MAX_POINTS,
  TRAIL_MAX_POINTS,
  TRAIL_RETENTION_MS,
  applyMovementRuntimeProjection,
  deriveHeading,
  normalizeMovementRuntimeState,
  shouldAppendTrailPoint,
  updateCharacterLiveState,
  updateCharacterMovementRuntime,
};

"use strict";

const TRAIL_RETENTION_MS = 5 * 60 * 1000;
const TRAIL_MAX_POINTS = 800;

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
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
  TRAIL_MAX_POINTS,
  TRAIL_RETENTION_MS,
  deriveHeading,
  shouldAppendTrailPoint,
  updateCharacterLiveState,
};

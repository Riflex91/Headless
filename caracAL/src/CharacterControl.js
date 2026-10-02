"use strict";

const DESIRED_RUNTIME_STATES = Object.freeze({
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  STOPPED: "STOPPED",
});

const CONTROL_ACTIONS = Object.freeze({
  START: "start",
  PAUSE: "pause",
  STOP: "stop",
  RESTART: "restart",
});

function normalizeControlAction(action) {
  const normalized = String(action || "")
    .trim()
    .toLowerCase();

  if (!Object.values(CONTROL_ACTIONS).includes(normalized)) {
    return null;
  }
  return normalized;
}

function desiredStateForAction(action) {
  switch (normalizeControlAction(action)) {
    case CONTROL_ACTIONS.START:
      return DESIRED_RUNTIME_STATES.RUNNING;
    case CONTROL_ACTIONS.PAUSE:
      return DESIRED_RUNTIME_STATES.PAUSED;
    case CONTROL_ACTIONS.STOP:
      return DESIRED_RUNTIME_STATES.STOPPED;
    default:
      return null;
  }
}

module.exports = {
  CONTROL_ACTIONS,
  DESIRED_RUNTIME_STATES,
  desiredStateForAction,
  normalizeControlAction,
};

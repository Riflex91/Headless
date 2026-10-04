"use strict";

const { DESIRED_RUNTIME_STATES } = require("./CharacterControl");

const DEFAULT_FULL_AUTONOMY_EXECUTION_POLICY = Object.freeze({
  enabled: false,
  reconcileIntervalMs: 5000,
  maxActionsPerCycle: 1,
});

const EXECUTION_STATES = Object.freeze({
  DISABLED: "DISABLED",
  BLOCKED: "BLOCKED",
  READY: "READY",
  STABLE: "STABLE",
});

const TRANSITION_LIFECYCLE_STATES = new Set([
  "STARTING",
  "CONNECTING",
  "STOPPING",
  "BACKOFF",
]);

const ACTIVE_LIFECYCLE_STATES = new Set([
  "STARTING",
  "CONNECTING",
  "ONLINE",
  "PAUSED",
  "STOPPING",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function readFullAutonomyExecutionPolicy(cfg = {}) {
  const source = record(cfg.full_autonomy);
  return {
    enabled: source.enabled === true,
    reconcileIntervalMs: boundedInteger(
      source.reconcile_interval_ms,
      DEFAULT_FULL_AUTONOMY_EXECUTION_POLICY.reconcileIntervalMs,
      1000,
      60000,
    ),
    maxActionsPerCycle: 1,
  };
}

function lifecycleState(recommendation) {
  const state = recommendation?.signals?.lifecycle?.state;
  return typeof state === "string" && state ? state : "STOPPED";
}

function hasLifecycleTransition(recommendation) {
  return TRANSITION_LIFECYCLE_STATES.has(lifecycleState(recommendation));
}

function isLifecycleActive(recommendation) {
  if (recommendation?.signals?.lifecycle?.connected === true) return true;
  return ACTIVE_LIFECYCLE_STATES.has(lifecycleState(recommendation));
}

function isManualPause(recommendation) {
  return (
    recommendation?.currentDesiredState === DESIRED_RUNTIME_STATES.PAUSED &&
    recommendation?.desiredStateSource === "MANUAL_PAUSE"
  );
}

function needsStart(recommendation) {
  return (
    recommendation?.selected === true &&
    recommendation?.manualStopProtected !== true &&
    recommendation?.recommendedDesiredState ===
      DESIRED_RUNTIME_STATES.RUNNING &&
    recommendation?.currentDesiredState === DESIRED_RUNTIME_STATES.STOPPED
  );
}

function needsResume(recommendation) {
  return (
    recommendation?.selected === true &&
    recommendation?.manualStopProtected !== true &&
    !isManualPause(recommendation) &&
    recommendation?.recommendedDesiredState ===
      DESIRED_RUNTIME_STATES.RUNNING &&
    recommendation?.currentDesiredState === DESIRED_RUNTIME_STATES.PAUSED
  );
}

function needsStop(recommendation) {
  return (
    recommendation?.selected !== true &&
    recommendation?.currentDesiredState !== DESIRED_RUNTIME_STATES.STOPPED &&
    !isManualPause(recommendation)
  );
}

function stableNameSort(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

function buildFullAutonomyExecutionDecision(
  plan,
  {
    policy = DEFAULT_FULL_AUTONOMY_EXECUTION_POLICY,
    observerOnly = false,
    emergencyStopActive = false,
    coordinatorShuttingDown = false,
    executionInFlight = false,
  } = {},
) {
  const normalizedPolicy = {
    ...DEFAULT_FULL_AUTONOMY_EXECUTION_POLICY,
    ...record(policy),
  };
  const recommendations = array(plan?.recommendations);

  const base = {
    enabled: normalizedPolicy.enabled === true,
    state: EXECUTION_STATES.BLOCKED,
    reason: null,
    action: null,
    maxActionsPerCycle: 1,
    reconcileIntervalMs: boundedInteger(
      normalizedPolicy.reconcileIntervalMs,
      DEFAULT_FULL_AUTONOMY_EXECUTION_POLICY.reconcileIntervalMs,
      1000,
      60000,
    ),
  };

  if (!base.enabled) {
    return {
      ...base,
      state: EXECUTION_STATES.DISABLED,
      reason: "FULL_AUTONOMY_EXECUTION_DISABLED",
    };
  }
  if (observerOnly) {
    return { ...base, reason: "FULL_AUTONOMY_OBSERVER_ONLY" };
  }
  if (coordinatorShuttingDown) {
    return { ...base, reason: "FULL_AUTONOMY_COORDINATOR_SHUTTING_DOWN" };
  }
  if (emergencyStopActive) {
    return { ...base, reason: "FULL_AUTONOMY_EMERGENCY_STOP_ACTIVE" };
  }
  if (executionInFlight) {
    return { ...base, reason: "FULL_AUTONOMY_EXECUTION_IN_FLIGHT" };
  }
  if (plan?.state !== "READY") {
    return { ...base, reason: "FULL_AUTONOMY_PLAN_NOT_READY" };
  }

  const transition = recommendations.find(hasLifecycleTransition);
  if (transition) {
    return {
      ...base,
      reason: "FULL_AUTONOMY_LIFECYCLE_TRANSITION_ACTIVE",
      blockedCharacter: transition.name || null,
      blockedLifecycleState: lifecycleState(transition),
    };
  }

  const starts = recommendations.filter(needsStart).sort(stableNameSort);
  const resumes = recommendations.filter(needsResume).sort(stableNameSort);
  const stops = recommendations.filter(needsStop).sort(stableNameSort);
  const rotationSources = stops.filter(isLifecycleActive);
  const activeCount = recommendations.filter(isLifecycleActive).length;
  const maxOnlineCharacters = boundedInteger(
    plan?.maxOnlineCharacters,
    4,
    1,
    4,
  );

  if (starts.length > 0 && rotationSources.length > 0) {
    return {
      ...base,
      state: EXECUTION_STATES.READY,
      reason: "FULL_AUTONOMY_ROTATION_REQUIRED",
      action: {
        type: "ROTATE",
        startCharacter: starts[0].name,
        stopCharacter: rotationSources[0].name,
      },
    };
  }

  if (starts.length > 0 && activeCount < maxOnlineCharacters) {
    return {
      ...base,
      state: EXECUTION_STATES.READY,
      reason: "FULL_AUTONOMY_START_REQUIRED",
      action: {
        type: "START",
        character: starts[0].name,
      },
    };
  }

  if (resumes.length > 0) {
    return {
      ...base,
      state: EXECUTION_STATES.READY,
      reason: "FULL_AUTONOMY_RESUME_REQUIRED",
      action: {
        type: "RESUME",
        character: resumes[0].name,
      },
    };
  }

  if (stops.length > 0) {
    return {
      ...base,
      state: EXECUTION_STATES.READY,
      reason: "FULL_AUTONOMY_STOP_REQUIRED",
      action: {
        type: "STOP",
        character: stops[0].name,
      },
    };
  }

  if (starts.length > 0) {
    return {
      ...base,
      reason: "FULL_AUTONOMY_NO_SAFE_SLOT_AVAILABLE",
    };
  }

  return {
    ...base,
    state: EXECUTION_STATES.STABLE,
    reason: "FULL_AUTONOMY_RECONCILED",
  };
}

module.exports = {
  ACTIVE_LIFECYCLE_STATES,
  DEFAULT_FULL_AUTONOMY_EXECUTION_POLICY,
  EXECUTION_STATES,
  TRANSITION_LIFECYCLE_STATES,
  buildFullAutonomyExecutionDecision,
  hasLifecycleTransition,
  isLifecycleActive,
  isManualPause,
  needsResume,
  needsStart,
  needsStop,
  readFullAutonomyExecutionPolicy,
};

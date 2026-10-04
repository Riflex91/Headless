"use strict";

const DEFAULT_GOAL_EXECUTION_POLICY = Object.freeze({
  enabled: false,
  reconcileIntervalMs: 5000,
  maxActionsPerCycle: 1,
});

const GOAL_EXECUTION_STATES = Object.freeze({
  DISABLED: "DISABLED",
  BLOCKED: "BLOCKED",
  READY: "READY",
  STABLE: "STABLE",
});

const SUPPORTED_GOAL_EXECUTION_KINDS = new Set([
  "FARM_ITEM",
  "TRAIN_CHARACTER",
  "ACQUIRE_GEAR",
  "ACCUMULATE_GOLD",
  "PLAN_CRAFT",
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function readGoalExecutionPolicy(cfg = {}) {
  const source = record(cfg.goal_execution);
  return {
    enabled: source.enabled === true,
    reconcileIntervalMs: boundedInteger(
      source.reconcile_interval_ms,
      DEFAULT_GOAL_EXECUTION_POLICY.reconcileIntervalMs,
      1000,
      60000,
    ),
    maxActionsPerCycle: 1,
  };
}

function handoffSafetyEvidence(goalHandoff) {
  const source = record(goalHandoff);
  const safety = record(source.safety);
  const handoff = record(source.handoff);

  const rootSafe =
    source.readOnly === true &&
    source.executionEnabled === false &&
    source.handoffDispatched === false &&
    source.gameplayMutationDispatched === false &&
    source.valueMutationDispatched === false &&
    source.lifecycleMutationDispatched === false;

  const upstreamSafe =
    safety.valid === true &&
    safety.readOnly === true &&
    safety.executionDisabled === true &&
    safety.noMutationDispatched === true &&
    safety.policyValid === true &&
    safety.tasksSafe === true;

  const handoffSafe =
    handoff.dispatchAllowed === false &&
    handoff.executionEnabled === false &&
    handoff.mutationDispatched === false &&
    handoff.goalExecutorRequired === true &&
    text(handoff.mode) === "EXECUTION_INTENT";

  return {
    valid: rootSafe && upstreamSafe && handoffSafe,
    rootSafe,
    upstreamSafe,
    handoffSafe,
  };
}

function fullAutonomySatisfied(handoff) {
  const guard = record(handoff?.fullAutonomy);
  return guard.required !== true || guard.satisfied === true;
}

function actionFromHandoff(goalHandoff) {
  const source = record(goalHandoff);
  const selectedGoal = record(source.selectedGoal);
  const handoff = record(source.handoff);
  const kind = text(handoff.kind);

  if (!kind || !SUPPORTED_GOAL_EXECUTION_KINDS.has(kind)) return null;

  return {
    type: "GOAL_HANDOFF",
    goalId: text(selectedGoal.goalId),
    taskId: text(handoff.taskId),
    kind,
    adapter: text(handoff.adapter),
    subsystem: text(handoff.subsystem),
    mutationDomain: text(handoff.mutationDomain),
    characterName: text(handoff.characterName),
    target: record(handoff.target),
    metadata: record(selectedGoal.metadata),
    requiresAdapterDispatcher: true,
  };
}

function buildGoalExecutionDecision(
  goalHandoff,
  {
    policy = DEFAULT_GOAL_EXECUTION_POLICY,
    observerOnly = false,
    emergencyStopActive = false,
    coordinatorShuttingDown = false,
    executionInFlight = false,
    safetyBlockReason = null,
  } = {},
) {
  const normalizedPolicy = {
    ...DEFAULT_GOAL_EXECUTION_POLICY,
    ...record(policy),
  };
  const base = {
    enabled: normalizedPolicy.enabled === true,
    state: GOAL_EXECUTION_STATES.BLOCKED,
    reason: null,
    action: null,
    dispatchAllowed: false,
    dispatchImplemented: false,
    mutationDispatched: false,
    maxActionsPerCycle: 1,
    reconcileIntervalMs: boundedInteger(
      normalizedPolicy.reconcileIntervalMs,
      DEFAULT_GOAL_EXECUTION_POLICY.reconcileIntervalMs,
      1000,
      60000,
    ),
  };

  if (!base.enabled) {
    return {
      ...base,
      state: GOAL_EXECUTION_STATES.DISABLED,
      reason: "GOAL_EXECUTION_DISABLED",
    };
  }
  if (observerOnly) {
    return { ...base, reason: "GOAL_EXECUTION_OBSERVER_ONLY" };
  }
  if (coordinatorShuttingDown) {
    return { ...base, reason: "GOAL_EXECUTION_COORDINATOR_SHUTTING_DOWN" };
  }
  if (emergencyStopActive) {
    return { ...base, reason: "GOAL_EXECUTION_EMERGENCY_STOP_ACTIVE" };
  }
  if (executionInFlight) {
    return { ...base, reason: "GOAL_EXECUTION_IN_FLIGHT" };
  }
  if (text(safetyBlockReason)) {
    return {
      ...base,
      reason: "GOAL_EXECUTION_SAFETY_BLOCK_ACTIVE",
      safetyBlockReason: text(safetyBlockReason),
    };
  }

  const handoffState = text(goalHandoff?.state);
  if (handoffState === "EMPTY") {
    return {
      ...base,
      state: GOAL_EXECUTION_STATES.STABLE,
      reason: "GOAL_EXECUTION_NO_READY_HANDOFF",
    };
  }
  if (handoffState !== "READY") {
    return {
      ...base,
      reason: "GOAL_EXECUTION_HANDOFF_NOT_READY",
      handoffState,
      handoffReason: text(goalHandoff?.reason),
    };
  }

  const safety = handoffSafetyEvidence(goalHandoff);
  if (!safety.valid) {
    return {
      ...base,
      reason: "GOAL_EXECUTION_HANDOFF_SAFETY_INVALID",
      safety,
    };
  }

  const handoff = record(goalHandoff?.handoff);
  if (!fullAutonomySatisfied(handoff)) {
    return {
      ...base,
      reason: "GOAL_EXECUTION_FULL_AUTONOMY_NOT_READY",
      fullAutonomy: record(handoff.fullAutonomy),
    };
  }

  const action = actionFromHandoff(goalHandoff);
  if (!action) {
    return {
      ...base,
      reason: "GOAL_EXECUTION_HANDOFF_UNSUPPORTED",
    };
  }

  return {
    ...base,
    state: GOAL_EXECUTION_STATES.READY,
    reason: "GOAL_EXECUTION_ADAPTER_DISPATCH_READY",
    action,
    dispatchAllowed: true,
    safety,
  };
}

module.exports = {
  DEFAULT_GOAL_EXECUTION_POLICY,
  GOAL_EXECUTION_STATES,
  SUPPORTED_GOAL_EXECUTION_KINDS,
  actionFromHandoff,
  buildGoalExecutionDecision,
  fullAutonomySatisfied,
  handoffSafetyEvidence,
  readGoalExecutionPolicy,
};

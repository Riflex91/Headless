"use strict";

const GOAL_HANDOFF_STATES = Object.freeze({
  EMPTY: "EMPTY",
  BLOCKED: "BLOCKED",
  READY: "READY",
});

const GOAL_HANDOFF_MODES = Object.freeze({
  EXECUTION_INTENT: "EXECUTION_INTENT",
});

const GOAL_HANDOFF_ROUTES = Object.freeze({
  FARM_ITEM: Object.freeze({
    adapter: "FarmIntelligence",
    subsystem: "FullAutonomy/FarmIntelligence",
    mutationDomain: "GAMEPLAY",
    requiresFullAutonomy: true,
  }),
  TRAIN_CHARACTER: Object.freeze({
    adapter: "FarmIntelligence",
    subsystem: "FullAutonomy/FarmIntelligence",
    mutationDomain: "GAMEPLAY",
    requiresFullAutonomy: true,
  }),
  ACQUIRE_GEAR: Object.freeze({
    adapter: "InventoryIntelligence/FarmIntelligence",
    subsystem: "FarmIntelligence/InventoryIntelligence",
    mutationDomain: "GAMEPLAY_VALUE",
    requiresFullAutonomy: false,
  }),
  ACCUMULATE_GOLD: Object.freeze({
    adapter: "FarmIntelligence/EconomyArbiter",
    subsystem: "FarmIntelligence/EconomyArbiter",
    mutationDomain: "GAMEPLAY_VALUE",
    requiresFullAutonomy: false,
  }),
  PLAN_CRAFT: Object.freeze({
    adapter: "CraftController/EconomyArbiter",
    subsystem: "CraftController/EconomyArbiter",
    mutationDomain: "VALUE",
    requiresFullAutonomy: false,
  }),
  PREPARE_ENCOUNTER: Object.freeze({
    adapter: "Phase20/Encounter",
    subsystem: "Phase20/Encounter",
    mutationDomain: "GAMEPLAY_LIFECYCLE",
    requiresFullAutonomy: true,
    deferredReason: "PHASE20_ENCOUNTER_PLANNING_DEFERRED",
  }),
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedPriority(goal) {
  const priority = finite(goal?.priority);
  if (priority === null) return 0;
  return Math.max(0, Math.min(100, Math.trunc(priority)));
}

function compareGoals(left, right) {
  return (
    normalizedPriority(right) - normalizedPriority(left) ||
    String(left?.goalId || "").localeCompare(String(right?.goalId || ""))
  );
}

function activePlannedGoals(goalPlan) {
  return array(goalPlan?.goals)
    .filter((goal) => goal?.status === "ACTIVE" && goal?.state === "PLANNED")
    .sort(compareGoals);
}

function activeBlockedGoals(goalPlan) {
  return array(goalPlan?.goals)
    .filter((goal) => goal?.status === "ACTIVE" && goal?.state === "BLOCKED")
    .sort(compareGoals);
}

function executionTaskForGoal(goal) {
  return (
    array(goal?.tasks).find((task) => {
      const kind = text(task?.kind);
      return (
        kind && Object.prototype.hasOwnProperty.call(GOAL_HANDOFF_ROUTES, kind)
      );
    }) || null
  );
}

function goalPlanGuard(goalPlan) {
  const plan = record(goalPlan);
  const policy = record(plan.policy);
  const tasksSafe = array(plan.goals).every((goal) =>
    array(goal?.tasks).every(
      (task) =>
        task?.executionAllowed === false && task?.mutationDispatched === false,
    ),
  );

  const valid =
    plan.readOnly === true &&
    plan.executionEnabled === false &&
    plan.gameplayMutationDispatched === false &&
    plan.valueMutationDispatched === false &&
    plan.lifecycleMutationDispatched === false &&
    policy.intentExecutionSeparated === true &&
    policy.manualStopRespected === true &&
    policy.fullAutonomyHandoffOnly === true &&
    policy.directGameplayMutationAllowed === false &&
    policy.directValueMutationAllowed === false &&
    policy.directLifecycleMutationAllowed === false &&
    tasksSafe;

  return {
    valid,
    readOnly: plan.readOnly === true,
    executionDisabled: plan.executionEnabled === false,
    noMutationDispatched:
      plan.gameplayMutationDispatched === false &&
      plan.valueMutationDispatched === false &&
      plan.lifecycleMutationDispatched === false,
    policyValid:
      policy.intentExecutionSeparated === true &&
      policy.manualStopRespected === true &&
      policy.fullAutonomyHandoffOnly === true &&
      policy.directGameplayMutationAllowed === false &&
      policy.directValueMutationAllowed === false &&
      policy.directLifecycleMutationAllowed === false,
    tasksSafe,
  };
}

function selectedGoalProjection(goal) {
  if (!goal) return null;
  return {
    goalId: text(goal.goalId),
    type: text(goal.type),
    priority: normalizedPriority(goal),
    characterName: text(goal.characterName || goal?.target?.characterName),
    state: text(goal.state),
    reason: text(goal.reason),
    target: record(goal.target),
    metadata: record(goal.metadata),
  };
}

function fullAutonomyGuard(fullAutonomy, route) {
  const source = record(fullAutonomy);
  const execution = record(source.execution);
  const required = route?.requiresFullAutonomy === true;
  const executionState = text(execution.state);

  return {
    required,
    executionEnabled: source.executionEnabled === true,
    state: executionState,
    reason: text(execution.reason),
    satisfied:
      required !== true ||
      (source.executionEnabled === true &&
        ["READY", "STABLE"].includes(executionState)),
  };
}

function buildGoalHandoff(
  goalPlan,
  { fullAutonomy = null, now = Date.now } = {},
) {
  const plan = record(goalPlan);
  const safety = goalPlanGuard(plan);
  const planned = activePlannedGoals(plan);
  const blocked = activeBlockedGoals(plan);
  const totalActive = array(plan.goals).filter(
    (goal) => goal?.status === "ACTIVE",
  ).length;

  const base = {
    timestamp: finite(now()) ?? Date.now(),
    state: GOAL_HANDOFF_STATES.EMPTY,
    reason: "GOAL_HANDOFF_NO_READY_GOAL",
    readOnly: true,
    executionEnabled: false,
    handoffDispatched: false,
    gameplayMutationDispatched: false,
    valueMutationDispatched: false,
    lifecycleMutationDispatched: false,
    selectedGoal: null,
    handoff: null,
    blockedGoals: blocked.map((goal) => ({
      goalId: text(goal.goalId),
      type: text(goal.type),
      priority: normalizedPriority(goal),
      reason: text(goal.reason),
      characterName: text(goal.characterName || goal?.target?.characterName),
    })),
    summary: {
      totalGoals: array(plan.goals).length,
      activeGoals: totalActive,
      readyGoals: planned.length,
      blockedGoals: blocked.length,
    },
    safety,
    policy: {
      singleGoalSelection: true,
      highestPriorityReadyFirst: true,
      blockedGoalsSkipped: true,
      manualStopRespected: true,
      existingSubsystemsOnly: true,
      goalExecutorRequiredForDispatch: true,
      goalPlanSafetyRequired: true,
      directGameplayMutationAllowed: false,
      directValueMutationAllowed: false,
      directLifecycleMutationAllowed: false,
      phase20EncounterDeferred: true,
    },
  };

  if (!safety.valid) {
    return {
      ...base,
      state: GOAL_HANDOFF_STATES.BLOCKED,
      reason: "GOAL_HANDOFF_GOAL_PLAN_SAFETY_INVALID",
    };
  }

  if (planned.length === 0) {
    if (blocked.length > 0) {
      return {
        ...base,
        state: GOAL_HANDOFF_STATES.BLOCKED,
        reason: "GOAL_HANDOFF_ALL_ACTIVE_GOALS_BLOCKED",
      };
    }
    return base;
  }

  const selected = planned[0];
  const task = executionTaskForGoal(selected);
  if (!task) {
    return {
      ...base,
      state: GOAL_HANDOFF_STATES.BLOCKED,
      reason: "GOAL_HANDOFF_TASK_UNSUPPORTED",
      selectedGoal: selectedGoalProjection(selected),
    };
  }

  const kind = text(task.kind);
  const route = GOAL_HANDOFF_ROUTES[kind];
  if (!route || route.deferredReason) {
    return {
      ...base,
      state: GOAL_HANDOFF_STATES.BLOCKED,
      reason: route?.deferredReason || "GOAL_HANDOFF_TASK_UNSUPPORTED",
      selectedGoal: selectedGoalProjection(selected),
    };
  }

  return {
    ...base,
    state: GOAL_HANDOFF_STATES.READY,
    reason: "GOAL_HANDOFF_READY",
    selectedGoal: selectedGoalProjection(selected),
    handoff: {
      taskId: text(task.taskId),
      kind,
      mode: GOAL_HANDOFF_MODES.EXECUTION_INTENT,
      adapter: route.adapter,
      subsystem: route.subsystem,
      mutationDomain: route.mutationDomain,
      characterName: text(
        task.characterName || selected?.target?.characterName,
      ),
      target: record(selected.target),
      dispatchAllowed: false,
      executionEnabled: false,
      mutationDispatched: false,
      goalExecutorRequired: true,
      fullAutonomy: fullAutonomyGuard(fullAutonomy, route),
    },
  };
}

module.exports = {
  GOAL_HANDOFF_MODES,
  GOAL_HANDOFF_ROUTES,
  GOAL_HANDOFF_STATES,
  activeBlockedGoals,
  activePlannedGoals,
  buildGoalHandoff,
  compareGoals,
  executionTaskForGoal,
  fullAutonomyGuard,
  goalPlanGuard,
  normalizedPriority,
  selectedGoalProjection,
};

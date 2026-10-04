"use strict";

const GOAL_HANDOFF_STATES = Object.freeze({
  READY: "READY",
  WAITING: "WAITING",
  IDLE: "IDLE",
  BLOCKED: "BLOCKED",
});

const TASK_LANES = Object.freeze({
  FARM_ITEM: "FULL_AUTONOMY_FARM",
  TRAIN_CHARACTER: "FULL_AUTONOMY_FARM",
  ACQUIRE_GEAR: "FARM_INVENTORY",
  ACCUMULATE_GOLD: "FARM_ECONOMY",
  PLAN_CRAFT: "CRAFT_ECONOMY",
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

function taskSafe(task) {
  const source = record(task);
  return (
    source.executionAllowed === false &&
    source.mutationDispatched === false
  );
}

function goalSafe(goal) {
  const source = record(goal);
  return (
    source.readOnly === true &&
    source.executionEnabled === false &&
    array(source.tasks).every(taskSafe)
  );
}

function goalPlanSafety(goalPlan) {
  const plan = record(goalPlan);
  const policy = record(plan.policy);
  const goals = array(plan.goals);

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
    goals.every(goalSafe);

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
    goalsSafe: goals.every(goalSafe),
  };
}

function candidateForGoal(goal) {
  const source = record(goal);
  if (source.status !== "ACTIVE" || source.state !== "PLANNED") {
    return null;
  }

  const tasks = array(source.tasks);
  const task = [...tasks]
    .reverse()
    .find((entry) => record(entry).status === "PLANNED");

  if (!task || !taskSafe(task)) {
    return {
      malformed: true,
      goalId: text(source.goalId),
    };
  }

  const selectedTask = record(task);
  const subsystem = text(selectedTask.subsystem);
  const owners = subsystem
    ? subsystem
        .split("/")
        .map((owner) => owner.trim())
        .filter(Boolean)
    : [];

  return {
    malformed: false,
    goalId: text(source.goalId),
    type: text(source.type),
    priority: finite(source.priority) ?? 0,
    characterName: text(source.characterName),
    target: record(source.target),
    task: {
      taskId: text(selectedTask.taskId),
      kind: text(selectedTask.kind),
      subsystem,
      owners,
      description: text(selectedTask.description),
      lane: TASK_LANES[selectedTask.kind] || "PLANNING_ONLY",
      status: selectedTask.status,
      executionAllowed: false,
      mutationDispatched: false,
    },
  };
}

function compareCandidates(left, right) {
  const priorityDelta = right.priority - left.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return String(left.goalId || "").localeCompare(String(right.goalId || ""));
}

function buildGoalHandoff(goalPlan = {}, { now = Date.now } = {}) {
  const plan = record(goalPlan);
  const goals = array(plan.goals);
  const safety = goalPlanSafety(plan);
  const candidates = goals
    .map(candidateForGoal)
    .filter(Boolean);
  const malformed = candidates.filter((candidate) => candidate.malformed);
  const actionable = candidates
    .filter((candidate) => !candidate.malformed)
    .sort(compareCandidates);
  const selected = actionable[0] || null;

  const activeWaiting = goals.filter(
    (goal) =>
      record(goal).status === "ACTIVE" &&
      ["BLOCKED", "INVALID"].includes(record(goal).state),
  );

  let state = GOAL_HANDOFF_STATES.IDLE;
  let reason = "GOAL_HANDOFF_NO_ACTIONABLE_GOALS";

  if (!safety.valid || malformed.length > 0) {
    state = GOAL_HANDOFF_STATES.BLOCKED;
    reason = !safety.valid
      ? "GOAL_HANDOFF_SAFETY_BOUNDARY_INVALID"
      : "GOAL_HANDOFF_PLANNED_TASK_INVALID";
  } else if (selected) {
    state = GOAL_HANDOFF_STATES.READY;
    reason = "GOAL_HANDOFF_READY";
  } else if (activeWaiting.length > 0) {
    state = GOAL_HANDOFF_STATES.WAITING;
    reason = "GOAL_HANDOFF_WAITING_ON_GOALS";
  }

  return {
    timestamp: finite(now()) ?? Date.now(),
    state,
    reason,
    readOnly: true,
    executionEnabled: false,
    dispatchAllowed: false,
    lifecycleMutationDispatched: false,
    gameplayMutationDispatched: false,
    valueMutationDispatched: false,
    selectedGoal: selected
      ? {
          goalId: selected.goalId,
          type: selected.type,
          priority: selected.priority,
          characterName: selected.characterName,
          target: selected.target,
        }
      : null,
    selectedTask: selected ? selected.task : null,
    candidates: actionable.map((candidate) => ({
      goalId: candidate.goalId,
      type: candidate.type,
      priority: candidate.priority,
      characterName: candidate.characterName,
      taskId: candidate.task.taskId,
      kind: candidate.task.kind,
      subsystem: candidate.task.subsystem,
      lane: candidate.task.lane,
    })),
    summary: {
      goals: goals.length,
      active: goals.filter((goal) => record(goal).status === "ACTIVE").length,
      actionable: actionable.length,
      waiting: activeWaiting.length,
      malformed: malformed.length,
    },
    safety,
    policy: {
      goalIntentExecutionSeparated: true,
      manualStopInheritedFromGoalPlanner: true,
      fullAutonomyHandoffOnly: true,
      oneSelectedTask: true,
      directMutationAllowed: false,
    },
  };
}

module.exports = {
  GOAL_HANDOFF_STATES,
  TASK_LANES,
  buildGoalHandoff,
  candidateForGoal,
  compareCandidates,
  goalPlanSafety,
  goalSafe,
  taskSafe,
};

"use strict";

const {
  ensureDashboardAvailable,
  startManagedRuntime,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

const GOAL_TYPES = Object.freeze([
  "FARM_ITEM",
  "LEVEL_CHARACTER",
  "ACQUIRE_GEAR",
  "ACCUMULATE_GOLD",
  "CRAFT_ITEM",
  "PREPARE_BOSS",
]);

const GOAL_STATUSES = Object.freeze([
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
]);

const PLAN_STATES = Object.freeze([
  "PLANNED",
  "BLOCKED",
  "COMPLETE",
  "PAUSED",
  "CANCELLED",
  "INVALID",
]);

const CRITERION_STATUSES = Object.freeze(["MET", "UNMET", "UNKNOWN"]);

function observerRuntimeEnv(env = process.env) {
  return {
    ...env,
    CARACAL_OBSERVER_ONLY: "1",
  };
}

function startObserverRuntime() {
  return startManagedRuntime({
    env: observerRuntimeEnv(),
  });
}

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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  const normalized = finite(value);
  return normalized !== null && Number.isInteger(normalized) && normalized >= 0
    ? normalized
    : null;
}

function nullableFiniteValid(value) {
  return value === null || value === undefined || finite(value) !== null;
}

function criterionEvidence(criterion) {
  const source = record(criterion);
  return {
    valid:
      text(source.id) !== null &&
      text(source.description) !== null &&
      CRITERION_STATUSES.includes(source.status),
    status: source.status || null,
  };
}

function taskEvidence(task, expectedState) {
  const source = record(task);
  const expectedTaskStatus =
    expectedState === "BLOCKED" ? "BLOCKED" : "PLANNED";
  return {
    valid:
      text(source.taskId) !== null &&
      text(source.kind) !== null &&
      text(source.subsystem) !== null &&
      text(source.description) !== null &&
      source.status === expectedTaskStatus &&
      source.executionAllowed === false &&
      source.mutationDispatched === false,
    executionAllowed: source.executionAllowed,
    mutationDispatched: source.mutationDispatched,
  };
}

function goalEvidence(goal) {
  const source = record(goal);
  const progress = record(source.progress);
  const completion = record(source.completion);
  const criteria = array(completion.criteria);
  const tasks = array(source.tasks);
  const errors = array(source.errors);
  const priority = nonNegativeInteger(source.priority);
  const state = text(source.state);
  const status = text(source.status);
  const type = text(source.type);

  const progressValid =
    ["UNKNOWN", "IN_PROGRESS", "COMPLETE"].includes(progress.state) &&
    nullableFiniteValid(progress.current) &&
    nullableFiniteValid(progress.target) &&
    nullableFiniteValid(progress.ratio);

  const criteriaChecks = criteria.map(criterionEvidence);
  const completionValid =
    typeof completion.met === "boolean" &&
    (completion.source === null ||
      completion.source === "PERSISTED_STATUS" ||
      completion.source === "OBSERVED_EVIDENCE") &&
    criteria.length > 0 &&
    criteriaChecks.every((entry) => entry.valid);

  const tasksExpected =
    state === "PLANNED" || state === "BLOCKED";
  const taskChecks = tasks.map((task) => taskEvidence(task, state));
  const tasksValid =
    (tasksExpected ? tasks.length > 0 : tasks.length === 0) &&
    taskChecks.every((entry) => entry.valid);

  const errorsValid =
    state === "INVALID" ? errors.length > 0 : errors.length === 0;

  return {
    goalId: text(source.goalId),
    type,
    status,
    state,
    valid:
      text(source.goalId) !== null &&
      GOAL_TYPES.includes(type) &&
      GOAL_STATUSES.includes(status) &&
      priority !== null &&
      priority <= 100 &&
      PLAN_STATES.includes(state) &&
      text(source.reason) !== null &&
      source.readOnly === true &&
      source.executionEnabled === false &&
      progressValid &&
      completionValid &&
      tasksValid &&
      errorsValid,
    progressValid,
    completionValid,
    tasksValid,
    errorsValid,
    directExecutionBlocked:
      source.readOnly === true &&
      source.executionEnabled === false &&
      taskChecks.every(
        (entry) =>
          entry.executionAllowed === false &&
          entry.mutationDispatched === false,
      ),
  };
}

function expectedByType(goalChecks) {
  return Object.fromEntries(
    GOAL_TYPES.map((type) => [
      type,
      goalChecks.filter((goal) => goal.type === type).length,
    ]),
  );
}

function goalsEvidence(snapshot) {
  const projection = record(snapshot?.goals);
  const goals = array(projection.goals);
  const goalChecks = goals.map(goalEvidence);
  const summary = record(projection.summary);
  const policy = record(projection.policy);
  const expectedTypeCounts = expectedByType(goalChecks);
  const expectedState =
    goals.length === 0
      ? "EMPTY"
      : goalChecks.some((goal) => goal.state === "INVALID")
        ? "PARTIAL"
        : "READY";
  const expectedReason =
    expectedState === "EMPTY"
      ? "GOALS_EMPTY"
      : expectedState === "PARTIAL"
        ? "GOALS_PARTIAL_INVALID"
        : "GOAL_PLANS_READY";

  const byType = record(summary.byType);
  const byTypeValid = GOAL_TYPES.every(
    (type) => nonNegativeInteger(byType[type]) === expectedTypeCounts[type],
  );

  const summaryValid =
    nonNegativeInteger(summary.total) === goals.length &&
    nonNegativeInteger(summary.active) ===
      goalChecks.filter((goal) => goal.status === "ACTIVE").length &&
    nonNegativeInteger(summary.planned) ===
      goalChecks.filter((goal) => goal.state === "PLANNED").length &&
    nonNegativeInteger(summary.blocked) ===
      goalChecks.filter((goal) => goal.state === "BLOCKED").length &&
    nonNegativeInteger(summary.complete) ===
      goalChecks.filter((goal) => goal.state === "COMPLETE").length &&
    nonNegativeInteger(summary.paused) ===
      goalChecks.filter((goal) => goal.state === "PAUSED").length &&
    nonNegativeInteger(summary.cancelled) ===
      goalChecks.filter((goal) => goal.state === "CANCELLED").length &&
    nonNegativeInteger(summary.invalid) ===
      goalChecks.filter((goal) => goal.state === "INVALID").length &&
    byTypeValid;

  const safetyValid =
    projection.readOnly === true &&
    projection.executionEnabled === false &&
    projection.gameplayMutationDispatched === false &&
    projection.valueMutationDispatched === false &&
    projection.lifecycleMutationDispatched === false &&
    policy.intentExecutionSeparated === true &&
    policy.manualStopRespected === true &&
    policy.fullAutonomyHandoffOnly === true &&
    policy.directGameplayMutationAllowed === false &&
    policy.directValueMutationAllowed === false &&
    policy.directLifecycleMutationAllowed === false &&
    goalChecks.every((goal) => goal.directExecutionBlocked);

  const structureValid =
    finite(projection.timestamp) !== null &&
    projection.state === expectedState &&
    projection.reason === expectedReason &&
    goalChecks.every((goal) => goal.valid) &&
    summaryValid;

  return {
    state: projection.state || null,
    reason: projection.reason || null,
    goals: goals.length,
    active: nonNegativeInteger(summary.active) ?? 0,
    planned: nonNegativeInteger(summary.planned) ?? 0,
    blocked: nonNegativeInteger(summary.blocked) ?? 0,
    complete: nonNegativeInteger(summary.complete) ?? 0,
    paused: nonNegativeInteger(summary.paused) ?? 0,
    cancelled: nonNegativeInteger(summary.cancelled) ?? 0,
    invalid: nonNegativeInteger(summary.invalid) ?? 0,
    emptyIsValid: goals.length === 0 && expectedState === "EMPTY",
    goalStructureValid: goalChecks.every((goal) => goal.valid),
    summaryValid,
    byTypeValid,
    safetyValid,
    structureValid,
    complete: structureValid && safetyValid,
  };
}

function evaluateGoals(snapshot) {
  const evidence = goalsEvidence(snapshot);
  return {
    outcome: evidence.complete ? "PASS" : "FAIL",
    reason: evidence.complete
      ? "GOALS_LIVE_E2E_CONFIRMED"
      : "GOALS_LIVE_EVIDENCE_INCOMPLETE",
    evidence,
    scope: {
      readOnly: true,
      dashboardGetOnly: true,
      observerOnlyBootstrap: false,
      mutationDispatched: false,
      lifecycleMutationDispatched: false,
      gameplayMutationDispatched: false,
      valueMutationDispatched: false,
    },
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const scope = record(result?.scope);
  return [
    "Goals Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "State: " + (evidence.state || "MISSING"),
    "Goals: " + String(evidence.goals ?? 0),
    "Active: " + String(evidence.active ?? 0),
    "Planned: " + String(evidence.planned ?? 0),
    "Blocked: " + String(evidence.blocked ?? 0),
    "Complete: " + String(evidence.complete ?? 0),
    "Invalid: " + String(evidence.invalid ?? 0),
    "Goal structure valid: " +
      (evidence.goalStructureValid === true ? "yes" : "no"),
    "Summary valid: " + (evidence.summaryValid === true ? "yes" : "no"),
    "Safety policy valid: " + (evidence.safetyValid === true ? "yes" : "no"),
    "Read-only: " + (scope.readOnly === true ? "yes" : "no"),
    "Dashboard GET only: " + (scope.dashboardGetOnly === true ? "yes" : "no"),
    "Lifecycle mutation dispatched: " +
      (scope.lifecycleMutationDispatched === true ? "yes" : "no"),
    "Gameplay mutation dispatched: " +
      (scope.gameplayMutationDispatched === true ? "yes" : "no"),
    "Value mutation dispatched: " +
      (scope.valueMutationDispatched === true ? "yes" : "no"),
    "Observer-only bootstrap: " +
      (scope.observerOnlyBootstrap === true ? "yes" : "no"),
  ].join("\n") + "\n";
}

async function readState({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(baseUrl + "/headless/api/state", {
    method: "GET",
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body?.message ||
        body?.error ||
        `HTTP ${response.status} from caracAL dashboard`,
    );
  }
  return body;
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const dashboard = await ensureDashboardAvailable(readState, {
    startRuntime: startObserverRuntime,
  });
  const managedRuntime = dashboard.runtime;

  try {
    if (dashboard.startedRuntime) {
      process.stdout.write(
        "caracAL dashboard was not running; using temporary observer-only supervisor\n",
      );
    }

    const result = evaluateGoals(dashboard.state);
    result.scope = {
      ...record(result.scope),
      observerOnlyBootstrap: dashboard.startedRuntime === true,
    };

    if (verbose) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(formatCompactResult(result));
    }

    if (result.outcome !== "PASS") {
      process.exitCode = 1;
    }
  } finally {
    if (managedRuntime) {
      await stopManagedRuntime(managedRuntime);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CRITERION_STATUSES,
  GOAL_STATUSES,
  GOAL_TYPES,
  PLAN_STATES,
  criterionEvidence,
  evaluateGoals,
  formatCompactResult,
  goalEvidence,
  goalsEvidence,
  observerRuntimeEnv,
  readState,
  startObserverRuntime,
  taskEvidence,
};

"use strict";

const {
  ensureDashboardAvailable,
  startManagedRuntime,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseCliArgs(argv = process.argv.slice(2), env = process.env) {
  const armedFlag = argv.includes("--armed");
  const envArmed = env.CARACAL_GOAL_DISPATCH_ARMED === "1";
  return {
    verbose: argv.includes("--verbose"),
    armedFlag,
    envArmed,
    armed: armedFlag && envArmed,
  };
}

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

async function readResponse(response) {
  const raw = await response.text();
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function readState({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(baseUrl + "/headless/api/state", {
    method: "GET",
  });
  const parsed = await readResponse(response);
  if (!parsed.ok) {
    const error = new Error(
      parsed.body?.message ||
        parsed.body?.error ||
        `HTTP ${parsed.status} from caracAL dashboard`,
    );
    error.code = parsed.body?.error || "GOAL_DISPATCH_LIVE_STATE_FAILED";
    error.statusCode = parsed.status;
    throw error;
  }
  return parsed.body;
}

function projectionEvidence(snapshot) {
  const execution = record(snapshot?.goal_execution);
  const adapter = record(snapshot?.goal_adapter);
  const dispatch = record(snapshot?.goal_dispatch);
  const action = record(execution.action);
  const request = record(adapter.request);
  const unknownHold = record(dispatch.unknownHold);
  const targetCharacter = text(request.characterName);

  const dispatchContractValid =
    dispatch.implemented === true &&
    dispatch.explicitOneShotOnly === true &&
    dispatch.automaticReconcileEnabled === false &&
    dispatch.retryEnabled === false &&
    dispatch.preflightRequired === true &&
    dispatch.currentServerPlanOnly === true &&
    dispatch.staleIdentityGuardRequired === true &&
    Number.isInteger(dispatch.pending) &&
    dispatch.pending >= 0;

  const defaultOffOrReady =
    execution.enabled === false ||
    (execution.enabled === true &&
      ["READY", "BLOCKED", "STABLE"].includes(text(execution.state)));

  const requestSafe =
    !request.type ||
    (request.dispatchAllowed === false &&
      request.dispatchImplemented === false &&
      adapter.requestDispatched === false &&
      adapter.mutationDispatched === false);

  return {
    dispatchContractValid,
    defaultOffOrReady,
    requestSafe,
    executionEnabled: execution.enabled === true,
    executionState: text(execution.state),
    executionReason: text(execution.reason),
    dispatchAllowed: execution.dispatchAllowed === true,
    goalId: text(action.goalId) || text(request.goalId),
    taskId: text(action.taskId) || text(request.taskId),
    kind: text(action.kind) || text(request.kind),
    adapterState: text(adapter.state),
    adapterReason: text(adapter.reason),
    targetCharacter,
    dispatchPending: Number(dispatch.pending) || 0,
    unknownHoldActive: unknownHold.active === true,
    unknownHoldReason: text(unknownHold.reason),
    complete: dispatchContractValid && defaultOffOrReady && requestSafe,
  };
}

function evaluateReadOnly(snapshot) {
  const evidence = projectionEvidence(snapshot);
  return {
    outcome: evidence.complete ? "PASS" : "FAIL",
    reason: evidence.complete
      ? "GOAL_DISPATCH_LIVE_READ_ONLY_CONFIRMED"
      : "GOAL_DISPATCH_LIVE_READ_ONLY_INCOMPLETE",
    evidence,
    scope: {
      armed: false,
      dashboardGetOnly: true,
      dispatchRequested: false,
      gameplayMutationDispatched: false,
      valueMutationDispatched: false,
      lifecycleMutationDispatched: false,
    },
  };
}

function armedPrerequisites(snapshot) {
  const evidence = projectionEvidence(snapshot);
  const errors = [];

  if (!evidence.complete) errors.push("GOAL_DISPATCH_PROJECTION_INVALID");
  if (!evidence.executionEnabled) errors.push("GOAL_EXECUTION_DISABLED");
  if (evidence.executionState !== "READY") {
    errors.push("GOAL_EXECUTION_NOT_READY");
  }
  if (!evidence.dispatchAllowed)
    errors.push("GOAL_EXECUTION_DISPATCH_NOT_ALLOWED");
  if (evidence.adapterState !== "READY") errors.push("GOAL_ADAPTER_NOT_READY");
  if (!evidence.goalId) errors.push("GOAL_ID_MISSING");
  if (!evidence.taskId) errors.push("GOAL_TASK_ID_MISSING");
  if (!evidence.kind) errors.push("GOAL_KIND_MISSING");
  if (!evidence.targetCharacter) errors.push("GOAL_TARGET_RUNTIME_MISSING");
  if (evidence.dispatchPending !== 0)
    errors.push("GOAL_DISPATCH_ALREADY_RUNNING");
  if (evidence.unknownHoldActive)
    errors.push("GOAL_DISPATCH_UNKNOWN_HOLD_ACTIVE");

  return {
    ...evidence,
    errors,
    ready: errors.length === 0,
  };
}

async function requestDispatch(snapshot, { fetchImpl = fetch } = {}) {
  const prerequisites = armedPrerequisites(snapshot);
  if (!prerequisites.ready) {
    const error = new Error(
      "Goal dispatch live prerequisites are not satisfied: " +
        prerequisites.errors.join(", "),
    );
    error.code = "GOAL_DISPATCH_LIVE_PREREQUISITES_FAILED";
    error.details = prerequisites;
    throw error;
  }

  const response = await fetchImpl(
    baseUrl + "/headless/api/goals/adapter-dispatch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedGoalId: prerequisites.goalId,
        expectedTaskId: prerequisites.taskId,
      }),
    },
  );
  const parsed = await readResponse(response);
  return {
    ...parsed,
    prerequisites,
  };
}

function evaluateArmedResult(before, dispatchResponse, after) {
  const prerequisites = armedPrerequisites(before);
  const payload = record(dispatchResponse?.body);
  const supervisor = record(payload.result);
  const runtimeResult = record(supervisor.result);
  const runtimeScope = record(runtimeResult.scope);
  const supervisorScope = record(supervisor.scope);
  const afterEvidence = projectionEvidence(after);
  const runtimeOutcome = text(runtimeResult.outcome);
  const responseError = text(payload.error) || text(supervisor.error);

  const identityValid =
    text(runtimeResult.goalId) === prerequisites.goalId &&
    text(runtimeResult.taskId) === prerequisites.taskId &&
    text(runtimeResult.kind) === prerequisites.kind;

  const oneShotValid =
    supervisorScope.explicitOneShot === true &&
    supervisorScope.preflightVerified === true &&
    supervisorScope.retryUsed === false &&
    runtimeScope.authorized === true &&
    runtimeScope.preflightRequired === true &&
    Number(runtimeScope.maxExecutionInvocations) === 1 &&
    runtimeScope.blindRetryUsed === false;

  const terminalOutcome = [
    "PASS",
    "BLOCKED",
    "FAIL",
    "UNKNOWN",
    "TIMEOUT",
  ].includes(runtimeOutcome);
  const unknownOutcome =
    ["UNKNOWN", "TIMEOUT"].includes(runtimeOutcome) ||
    responseError !== null ||
    (runtimeOutcome === "FAIL" && runtimeScope.mutationPathInvoked === true);
  const holdValid = unknownOutcome
    ? afterEvidence.unknownHoldActive === true
    : true;

  const pass =
    prerequisites.ready &&
    terminalOutcome &&
    identityValid &&
    oneShotValid &&
    afterEvidence.dispatchPending === 0 &&
    holdValid;

  return {
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "GOAL_DISPATCH_LIVE_E2E_CONFIRMED"
      : "GOAL_DISPATCH_LIVE_EVIDENCE_INCOMPLETE",
    evidence: {
      goalId: prerequisites.goalId,
      taskId: prerequisites.taskId,
      kind: prerequisites.kind,
      targetCharacter: prerequisites.targetCharacter,
      runtimeOutcome,
      runtimeReason: text(runtimeResult.reason),
      responseStatus: dispatchResponse?.status ?? null,
      responseOk: dispatchResponse?.ok === true,
      responseError,
      identityValid,
      oneShotValid,
      terminalOutcome,
      unknownOutcome,
      holdValid,
      dispatchPendingAfter: afterEvidence.dispatchPending,
      unknownHoldActiveAfter: afterEvidence.unknownHoldActive,
      unknownHoldReasonAfter: afterEvidence.unknownHoldReason,
    },
    scope: {
      armed: true,
      dispatchRequested: true,
      preflightVerified: supervisorScope.preflightVerified === true,
      retryUsed: supervisorScope.retryUsed === true,
      maxExecutionInvocations: runtimeScope.maxExecutionInvocations ?? null,
      mutationPathInvoked: runtimeScope.mutationPathInvoked === true,
      lifecycleMutationDispatched: false,
    },
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const scope = record(result?.scope);
  const lines = [
    "Goal Dispatch Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "Armed: " + (scope.armed === true ? "yes" : "no"),
    "Goal: " + (evidence.goalId || "NONE"),
    "Task: " + (evidence.taskId || "NONE"),
    "Kind: " + (evidence.kind || "NONE"),
    "Target runtime: " + (evidence.targetCharacter || "NONE"),
    "Runtime outcome: " + (evidence.runtimeOutcome || "NOT_DISPATCHED"),
    "Runtime reason: " + (evidence.runtimeReason || "NONE"),
    "Dispatch requested: " + (scope.dispatchRequested === true ? "yes" : "no"),
    "Preflight verified: " + (scope.preflightVerified === true ? "yes" : "no"),
    "Retry used: " + (scope.retryUsed === true ? "yes" : "no"),
    "Unknown hold active: " +
      (evidence.unknownHoldActiveAfter === true ? "yes" : "no"),
  ];
  return lines.join("\n") + "\n";
}

async function inspectWithObserverBootstrap() {
  return ensureDashboardAvailable(readState, {
    startRuntime: startObserverRuntime,
  });
}

async function main() {
  const args = parseCliArgs();

  if (args.armedFlag !== args.envArmed) {
    console.error(
      "Armed Goal dispatch requires BOTH --armed and CARACAL_GOAL_DISPATCH_ARMED=1.",
    );
    process.exitCode = 2;
    return;
  }

  if (!args.armed) {
    const dashboard = await inspectWithObserverBootstrap();
    const managedRuntime = dashboard.runtime;
    try {
      if (dashboard.startedRuntime) {
        process.stdout.write(
          "caracAL dashboard was not running; using temporary observer-only supervisor\n",
        );
      }
      const result = evaluateReadOnly(dashboard.state);
      if (args.verbose) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        process.stdout.write(formatCompactResult(result));
      }
      if (result.outcome !== "PASS") process.exitCode = 1;
    } finally {
      if (managedRuntime) await stopManagedRuntime(managedRuntime);
    }
    return;
  }

  let before;
  try {
    before = await readState();
  } catch (error) {
    const wrapped = new Error(
      "Armed Goal dispatch requires an already-running caracAL supervisor. " +
        (error instanceof Error ? error.message : String(error)),
    );
    wrapped.code = "GOAL_DISPATCH_LIVE_RUNNING_SUPERVISOR_REQUIRED";
    throw wrapped;
  }

  const prerequisites = armedPrerequisites(before);
  if (!prerequisites.ready) {
    const error = new Error(
      "Goal dispatch live prerequisites are not satisfied: " +
        prerequisites.errors.join(", "),
    );
    error.code = "GOAL_DISPATCH_LIVE_PREREQUISITES_FAILED";
    throw error;
  }

  process.stdout.write(
    "WARNING: armed Goal dispatch may perform real gameplay/value mutation exactly once.\n",
  );
  process.stdout.write(
    `Goal=${prerequisites.goalId} task=${prerequisites.taskId} kind=${prerequisites.kind} target=${prerequisites.targetCharacter}\n`,
  );
  process.stdout.write(
    "UNKNOWN/TIMEOUT is terminal for this exact request; persistent hold blocks blind retry.\n",
  );

  const response = await requestDispatch(before);
  const after = await readState();
  const result = evaluateArmedResult(before, response, after);

  if (args.verbose) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(formatCompactResult(result));
  }
  if (result.outcome !== "PASS") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  armedPrerequisites,
  evaluateArmedResult,
  evaluateReadOnly,
  formatCompactResult,
  inspectWithObserverBootstrap,
  observerRuntimeEnv,
  parseCliArgs,
  projectionEvidence,
  readResponse,
  readState,
  requestDispatch,
  startObserverRuntime,
};

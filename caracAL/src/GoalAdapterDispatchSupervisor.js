"use strict";

const DEFAULT_GOAL_ADAPTER_DISPATCH_TIMEOUT_MS = 7 * 60 * 1000;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function requestFingerprint(request) {
  return JSON.stringify(stableValue(record(request)));
}

function dispatchError(code, message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function runtimeReady(character) {
  return (
    character?.account_owned === true &&
    !!character.instance &&
    character.connected === true &&
    Number.isFinite(character.bot_runtime_started_at)
  );
}

function identityFromRequest(request) {
  const source = record(request);
  return {
    goalId: text(source.goalId),
    taskId: text(source.taskId),
    kind: text(source.kind),
    characterName: text(source.characterName),
  };
}

function resultRequiresUnknownHold(result, error = null) {
  if (text(error)) return true;
  const source = record(result);
  const scope = record(source.scope);
  if (["UNKNOWN", "TIMEOUT"].includes(text(source.outcome))) return true;
  return source.outcome === "FAIL" && scope.mutationPathInvoked === true;
}

class GoalAdapterDispatchSupervisor {
  constructor({
    getExecutionDecision,
    getAdapterPlan,
    runPreflight,
    getCharacter,
    send,
    emit = () => {},
    initialUnknownHold = null,
    persistUnknownHold = async () => {},
    persistLastResult = async () => {},
    timeoutMs = DEFAULT_GOAL_ADAPTER_DISPATCH_TIMEOUT_MS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    for (const [name, dependency] of Object.entries({
      getExecutionDecision,
      getAdapterPlan,
      runPreflight,
      getCharacter,
      send,
    })) {
      if (typeof dependency !== "function") {
        throw new Error(`GoalAdapterDispatchSupervisor requires ${name}`);
      }
    }

    this.getExecutionDecision = getExecutionDecision;
    this.getAdapterPlan = getAdapterPlan;
    this.runPreflight = runPreflight;
    this.getCharacter = getCharacter;
    this.send = send;
    this.emit = typeof emit === "function" ? emit : () => {};
    this.persistUnknownHold =
      typeof persistUnknownHold === "function"
        ? persistUnknownHold
        : async () => {};
    this.persistLastResult =
      typeof persistLastResult === "function"
        ? persistLastResult
        : async () => {};
    this.timeoutMs = Math.max(
      1000,
      Number(timeoutMs) || DEFAULT_GOAL_ADAPTER_DISPATCH_TIMEOUT_MS,
    );
    this.now = typeof now === "function" ? now : Date.now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pending = new Map();
    this.active = false;
    this.sequence = 0;
    this.unknownHold =
      record(initialUnknownHold).active === true
        ? { ...record(initialUnknownHold) }
        : null;
    this.lastResult = null;
  }

  snapshot() {
    return {
      implemented: true,
      active: this.active,
      explicitOneShotOnly: true,
      automaticReconcileEnabled: false,
      retryEnabled: false,
      preflightRequired: true,
      currentServerPlanOnly: true,
      staleIdentityGuardRequired: true,
      pending: this.pending.size,
      timeoutMs: this.timeoutMs,
      unknownHold: this.unknownHold ? { ...this.unknownHold } : null,
      lastResult: this.lastResult,
    };
  }

  validateCurrent(expectedGoalId, expectedTaskId) {
    const goalId = text(expectedGoalId);
    const taskId = text(expectedTaskId);
    if (!goalId || !taskId) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_EXPECTED_IDENTITY_REQUIRED",
        "Goal adapter dispatch requires expectedGoalId and expectedTaskId",
      );
    }

    const decision = record(this.getExecutionDecision());
    if (decision.enabled !== true) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_EXECUTION_DISABLED",
        "Goal execution policy is disabled",
        409,
      );
    }
    if (
      decision.state !== "READY" ||
      decision.dispatchAllowed !== true ||
      decision.dispatchImplemented !== false ||
      decision.mutationDispatched !== false
    ) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_EXECUTION_NOT_READY",
        "Current Goal execution decision is not dispatch-ready",
        409,
        {
          state: text(decision.state),
          reason: text(decision.reason),
        },
      );
    }

    const action = record(decision.action);
    if (text(action.goalId) !== goalId || text(action.taskId) !== taskId) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_STALE_IDENTITY",
        "Current Goal execution identity no longer matches the requested action",
        409,
        {
          expectedGoalId: goalId,
          expectedTaskId: taskId,
          currentGoalId: text(action.goalId),
          currentTaskId: text(action.taskId),
        },
      );
    }

    const adapter = record(this.getAdapterPlan());
    const request = record(adapter.request);
    if (
      adapter.state !== "READY" ||
      adapter.dispatchAllowed !== false ||
      adapter.dispatchImplemented !== false ||
      adapter.requestDispatched !== false ||
      adapter.mutationDispatched !== false ||
      request.dispatchAllowed !== false ||
      request.dispatchImplemented !== false
    ) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_ADAPTER_NOT_READY",
        "Current Goal adapter plan is not dispatch-ready",
        409,
        {
          state: text(adapter.state),
          reason: text(adapter.reason),
        },
      );
    }

    const identity = identityFromRequest(request);
    if (
      identity.goalId !== goalId ||
      identity.taskId !== taskId ||
      identity.kind !== text(action.kind)
    ) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_ADAPTER_IDENTITY_MISMATCH",
        "Goal adapter request does not match the current execution decision",
        409,
      );
    }
    if (!identity.characterName) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_CHARACTER_REQUIRED",
        "Goal adapter request must explicitly name the target runtime character",
        409,
      );
    }

    return {
      decision,
      adapter,
      request,
      identity,
      fingerprint: requestFingerprint(request),
    };
  }

  async persistHold(hold) {
    this.unknownHold = hold?.active === true ? { ...hold } : null;
    await this.persistUnknownHold(hold || { active: false });
  }

  async clearSupersededHold(current) {
    if (!this.unknownHold) return;
    if (this.unknownHold.requestFingerprint === current.fingerprint) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_UNKNOWN_HOLD_ACTIVE",
        "A previous dispatch for this exact Goal task has an unknown outcome",
        409,
        {
          requestId: text(this.unknownHold.requestId),
          reason: text(this.unknownHold.reason),
          goalId: text(this.unknownHold.goalId),
          taskId: text(this.unknownHold.taskId),
        },
      );
    }

    await this.persistHold({
      active: false,
      clearedAt: this.now(),
      reason: "GOAL_ADAPTER_DISPATCH_HOLD_SUPERSEDED",
      previousRequestId: text(this.unknownHold.requestId),
      previousGoalId: text(this.unknownHold.goalId),
      previousTaskId: text(this.unknownHold.taskId),
    });
  }

  async run({ expectedGoalId, expectedTaskId } = {}) {
    if (this.active || this.pending.size > 0) {
      throw dispatchError(
        "GOAL_ADAPTER_DISPATCH_ALREADY_RUNNING",
        "A Goal adapter dispatch is already in flight",
        409,
      );
    }

    this.active = true;
    try {
      const initial = this.validateCurrent(expectedGoalId, expectedTaskId);
      await this.clearSupersededHold(initial);
  
      const preflightResponse = await this.runPreflight({
        characterName: initial.identity.characterName,
        request: initial.request,
      });
      const preflight = record(preflightResponse?.result);
      if (
        text(preflightResponse?.error) ||
        preflight.outcome !== "PASS" ||
        text(preflight.goalId) !== initial.identity.goalId ||
        text(preflight.taskId) !== initial.identity.taskId ||
        text(preflight.kind) !== initial.identity.kind ||
        preflight.scope?.readOnly !== true ||
        preflight.scope?.gameplayMutationDispatched !== false ||
        preflight.scope?.valueMutationDispatched !== false ||
        preflight.scope?.lifecycleMutationDispatched !== false ||
        preflight.scope?.blindRetryAllowed !== false
      ) {
        throw dispatchError(
          "GOAL_ADAPTER_DISPATCH_PREFLIGHT_NOT_CONFIRMED",
          "Supervisor Goal adapter preflight did not confirm the current action",
          409,
          {
            outcome: text(preflight.outcome),
            reason: text(preflight.reason),
            error: text(preflightResponse?.error),
          },
        );
      }
  
      const current = this.validateCurrent(expectedGoalId, expectedTaskId);
      if (current.fingerprint !== initial.fingerprint) {
        throw dispatchError(
          "GOAL_ADAPTER_DISPATCH_REQUEST_DRIFT",
          "Goal adapter request changed during preflight",
          409,
        );
      }
  
      const character = this.getCharacter(current.identity.characterName);
      if (!runtimeReady(character)) {
        throw dispatchError(
          "GOAL_ADAPTER_DISPATCH_RUNTIME_NOT_READY",
          `Goal adapter dispatch requires an already-running runtime: ${current.identity.characterName}`,
          409,
        );
      }
  
      this.sequence += 1;
      const requestId = `goal-adapter-dispatch-${this.now()}-${this.sequence}`;
  
      return await new Promise((resolve, reject) => {
        const timer = this.setTimer(() => {
          const pending = this.pending.get(requestId);
          if (!pending) return;
          this.pending.delete(requestId);
          void (async () => {
            const hold = {
              active: true,
              createdAt: this.now(),
              requestId,
              goalId: current.identity.goalId,
              taskId: current.identity.taskId,
              kind: current.identity.kind,
              characterName: current.identity.characterName,
              requestFingerprint: current.fingerprint,
              reason: "GOAL_ADAPTER_DISPATCH_TIMEOUT_OUTCOME_UNKNOWN",
            };
            try {
              await this.persistHold(hold);
              this.emit(
                "GOAL_ADAPTER_DISPATCH_UNKNOWN_HOLD_SET",
                current.identity.characterName,
                {
                  request_id: requestId,
                  goal_id: current.identity.goalId,
                  task_id: current.identity.taskId,
                  reason: hold.reason,
                },
              );
            } finally {
              reject(
                dispatchError(
                  "GOAL_ADAPTER_DISPATCH_OUTCOME_UNKNOWN",
                  `Goal adapter dispatch timed out for ${current.identity.characterName}; blind retry is blocked`,
                  504,
                  {
                    requestId,
                    goalId: current.identity.goalId,
                    taskId: current.identity.taskId,
                  },
                ),
              );
            }
          })();
        }, this.timeoutMs);
  
        this.pending.set(requestId, {
          characterName: current.identity.characterName,
          identity: current.identity,
          requestFingerprint: current.fingerprint,
          resolve,
          reject,
          timer,
        });
  
        const sent = this.send(character.instance, {
          type: "goal_adapter_dispatch",
          request_id: requestId,
          request: current.request,
          authorization: {
            goal_execution_enabled: true,
            one_shot: true,
            preflight_required: true,
          },
        });
        if (!sent) {
          this.clearTimer(timer);
          this.pending.delete(requestId);
          reject(
            dispatchError(
              "GOAL_ADAPTER_DISPATCH_SEND_FAILED",
              `Goal adapter dispatch IPC send failed for ${current.identity.characterName}`,
              503,
              { requestId },
            ),
          );
          return;
        }
  
        this.emit("GOAL_ADAPTER_DISPATCH_SENT", current.identity.characterName, {
          request_id: requestId,
          goal_id: current.identity.goalId,
          task_id: current.identity.taskId,
          kind: current.identity.kind,
          one_shot: true,
          preflight_confirmed: true,
          retry_allowed: false,
        });
      });
    } finally {
      this.active = false;
    }
  }

  async handleResult(characterName, message) {
    const source = record(message);
    const requestId = text(source.request_id);
    const pending = requestId ? this.pending.get(requestId) : null;
    if (!pending || pending.characterName !== characterName) return false;

    this.clearTimer(pending.timer);
    this.pending.delete(requestId);

    const result = record(source.result);
    const error = text(source.error);
    const resultIdentity = identityFromRequest(result);
    const identityValid =
      !error &&
      resultIdentity.goalId === pending.identity.goalId &&
      resultIdentity.taskId === pending.identity.taskId &&
      resultIdentity.kind === pending.identity.kind;

    const unknown = !identityValid || resultRequiresUnknownHold(result, error);
    if (unknown) {
      const hold = {
        active: true,
        createdAt: this.now(),
        requestId,
        goalId: pending.identity.goalId,
        taskId: pending.identity.taskId,
        kind: pending.identity.kind,
        characterName,
        requestFingerprint: pending.requestFingerprint,
        reason: error
          ? "GOAL_ADAPTER_DISPATCH_RUNTIME_RESULT_ERROR"
          : !identityValid
          ? "GOAL_ADAPTER_DISPATCH_RESULT_IDENTITY_INVALID"
          : `GOAL_ADAPTER_DISPATCH_${text(result.outcome) || "UNKNOWN"}_HOLD`,
      };
      await this.persistHold(hold);
      this.emit("GOAL_ADAPTER_DISPATCH_UNKNOWN_HOLD_SET", characterName, {
        request_id: requestId,
        goal_id: pending.identity.goalId,
        task_id: pending.identity.taskId,
        reason: hold.reason,
      });
    } else if (this.unknownHold) {
      await this.persistHold({
        active: false,
        clearedAt: this.now(),
        requestId,
        reason: "GOAL_ADAPTER_DISPATCH_RESULT_CONFIRMED",
      });
    }

    const response = {
      requestId,
      characterName,
      result: source.result || null,
      error,
      scope: {
        explicitOneShot: true,
        preflightVerified: true,
        retryUsed: false,
        unknownHoldActive: this.unknownHold !== null,
      },
    };
    this.lastResult = response;
    await this.persistLastResult(response);

    this.emit("GOAL_ADAPTER_DISPATCH_RESULT_RECEIVED", characterName, {
      request_id: requestId,
      goal_id: pending.identity.goalId,
      task_id: pending.identity.taskId,
      outcome: text(result.outcome),
      reason: text(result.reason),
      error,
      unknown_hold_active: this.unknownHold !== null,
    });

    if (!identityValid) {
      pending.reject(
        dispatchError(
          "GOAL_ADAPTER_DISPATCH_OUTCOME_UNKNOWN",
          "Goal adapter dispatch result was missing, errored, or identity-mismatched; blind retry is blocked",
          502,
          {
            requestId,
            error,
          },
        ),
      );
    } else {
      pending.resolve(response);
    }
    return true;
  }

  async cancelAll(reason = "GOAL_ADAPTER_DISPATCH_CANCELLED") {
    const pendingEntries = [...this.pending.entries()];
    for (const [requestId, pending] of pendingEntries) {
      this.clearTimer(pending.timer);
      this.pending.delete(requestId);
      const hold = {
        active: true,
        createdAt: this.now(),
        requestId,
        goalId: pending.identity.goalId,
        taskId: pending.identity.taskId,
        kind: pending.identity.kind,
        characterName: pending.characterName,
        requestFingerprint: pending.requestFingerprint,
        reason,
      };
      await this.persistHold(hold);
      pending.reject(
        dispatchError(
          "GOAL_ADAPTER_DISPATCH_OUTCOME_UNKNOWN",
          `Goal adapter dispatch was interrupted for ${pending.characterName}; blind retry is blocked`,
          503,
          { requestId, reason },
        ),
      );
    }
  }
}

module.exports = {
  DEFAULT_GOAL_ADAPTER_DISPATCH_TIMEOUT_MS,
  GoalAdapterDispatchSupervisor,
  dispatchError,
  identityFromRequest,
  requestFingerprint,
  resultRequiresUnknownHold,
  runtimeReady,
  stableValue,
};

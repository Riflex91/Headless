"use strict";

const { requestFingerprint } = require("./GoalAdapterDispatchSupervisor");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value, fallback = 5000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cycleError(error) {
  return {
    code: text(error?.code),
    message: error instanceof Error ? error.message : String(error),
    statusCode: Number(error?.statusCode) || null,
    details: error?.details || null,
  };
}

class GoalReconciler {
  constructor({
    enabled = false,
    reconcileIntervalMs = 5000,
    getExecutionDecision,
    getAdapterPlan,
    getDispatchState,
    dispatch,
    emit = () => {},
    persistLastCycle = async () => {},
    now = Date.now,
  } = {}) {
    for (const [name, dependency] of Object.entries({
      getExecutionDecision,
      getAdapterPlan,
      getDispatchState,
      dispatch,
    })) {
      if (typeof dependency !== "function") {
        throw new Error(`GoalReconciler requires ${name}`);
      }
    }

    this.enabled = enabled === true;
    this.reconcileIntervalMs = Math.max(
      1000,
      Math.min(60000, positiveInteger(reconcileIntervalMs)),
    );
    this.getExecutionDecision = getExecutionDecision;
    this.getAdapterPlan = getAdapterPlan;
    this.getDispatchState = getDispatchState;
    this.dispatch = dispatch;
    this.emit = typeof emit === "function" ? emit : () => {};
    this.persistLastCycle =
      typeof persistLastCycle === "function" ? persistLastCycle : async () => {};
    this.now = typeof now === "function" ? now : Date.now;
    this.running = false;
    this.sequence = 0;
    this.lastCycle = null;
  }

  snapshot() {
    return {
      implemented: true,
      enabled: this.enabled,
      running: this.running,
      reconcileIntervalMs: this.reconcileIntervalMs,
      maxActionsPerCycle: 1,
      blindRetryEnabled: false,
      requiresFreshPlanEachCycle: true,
      unknownHoldStopsMutation: true,
      lastCycle: this.lastCycle,
    };
  }

  async saveCycle(cycle) {
    this.lastCycle = cycle;
    try {
      await this.persistLastCycle(cycle);
    } catch (error) {
      this.emit("GOAL_RECONCILE_PERSIST_FAILED", null, {
        cycle_id: cycle.cycleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return cycle;
  }

  async noDispatch({
    trigger,
    state,
    reason,
    decision = null,
    adapter = null,
    details = null,
  }) {
    this.sequence += 1;
    const cycle = {
      cycleId: `goal-reconcile-${this.now()}-${this.sequence}`,
      timestamp: this.now(),
      trigger,
      state,
      reason,
      dispatched: false,
      goalId: text(decision?.action?.goalId) || text(adapter?.request?.goalId),
      taskId: text(decision?.action?.taskId) || text(adapter?.request?.taskId),
      kind: text(decision?.action?.kind) || text(adapter?.request?.kind),
      runtimeOutcome: null,
      runtimeReason: null,
      unknownHoldActive: record(this.getDispatchState()).unknownHold?.active === true,
      details,
    };
    return this.saveCycle(cycle);
  }

  async run(trigger = "INTERVAL") {
    if (!this.enabled) {
      return this.noDispatch({
        trigger,
        state: "DISABLED",
        reason: "GOAL_RECONCILE_DISABLED",
      });
    }
    if (this.running) {
      return this.noDispatch({
        trigger,
        state: "BLOCKED",
        reason: "GOAL_RECONCILE_ALREADY_RUNNING",
      });
    }

    const decision = record(this.getExecutionDecision());
    if (
      decision.enabled !== true ||
      decision.state !== "READY" ||
      decision.dispatchAllowed !== true ||
      decision.dispatchImplemented !== false ||
      decision.mutationDispatched !== false
    ) {
      return this.noDispatch({
        trigger,
        state: decision.state === "STABLE" ? "STABLE" : "BLOCKED",
        reason:
          text(decision.reason) || "GOAL_RECONCILE_EXECUTION_NOT_READY",
        decision,
      });
    }

    const adapter = record(this.getAdapterPlan());
    const request = record(adapter.request);
    const action = record(decision.action);
    if (
      adapter.state !== "READY" ||
      adapter.dispatchAllowed !== false ||
      adapter.dispatchImplemented !== false ||
      adapter.requestDispatched !== false ||
      adapter.mutationDispatched !== false ||
      request.dispatchAllowed !== false ||
      request.dispatchImplemented !== false ||
      text(request.goalId) !== text(action.goalId) ||
      text(request.taskId) !== text(action.taskId) ||
      text(request.kind) !== text(action.kind)
    ) {
      return this.noDispatch({
        trigger,
        state: "BLOCKED",
        reason: "GOAL_RECONCILE_ADAPTER_NOT_READY",
        decision,
        adapter,
      });
    }

    const dispatchState = record(this.getDispatchState());
    if (dispatchState.active === true || Number(dispatchState.pending) > 0) {
      return this.noDispatch({
        trigger,
        state: "BLOCKED",
        reason: "GOAL_RECONCILE_DISPATCH_IN_FLIGHT",
        decision,
        adapter,
      });
    }

    const currentFingerprint = requestFingerprint(request);
    const hold = record(dispatchState.unknownHold);
    if (
      hold.active === true &&
      text(hold.requestFingerprint) === currentFingerprint
    ) {
      return this.noDispatch({
        trigger,
        state: "BLOCKED",
        reason: "GOAL_RECONCILE_UNKNOWN_HOLD_ACTIVE",
        decision,
        adapter,
        details: {
          requestId: text(hold.requestId),
          holdReason: text(hold.reason),
        },
      });
    }

    this.running = true;
    this.sequence += 1;
    const cycleId = `goal-reconcile-${this.now()}-${this.sequence}`;
    this.emit("GOAL_RECONCILE_DISPATCH_STARTED", text(request.characterName), {
      cycle_id: cycleId,
      trigger,
      goal_id: text(request.goalId),
      task_id: text(request.taskId),
      kind: text(request.kind),
      max_actions_per_cycle: 1,
      blind_retry_allowed: false,
    });

    try {
      const response = await this.dispatch({
        expectedGoalId: text(request.goalId),
        expectedTaskId: text(request.taskId),
      });
      const result = record(response?.result);
      const responseScope = record(response?.scope);
      const holdActive = responseScope.unknownHoldActive === true;
      const runtimeOutcome = text(result.outcome);
      const runtimeReason = text(result.reason);

      const cycle = {
        cycleId,
        timestamp: this.now(),
        trigger,
        state: holdActive
          ? "BLOCKED"
          : runtimeOutcome === "PASS"
            ? "DISPATCHED"
            : "BLOCKED",
        reason: holdActive
          ? "GOAL_RECONCILE_UNKNOWN_HOLD_SET"
          : runtimeOutcome === "PASS"
            ? "GOAL_RECONCILE_DISPATCH_CONFIRMED"
            : "GOAL_RECONCILE_DISPATCH_NOT_CONFIRMED",
        dispatched: true,
        goalId: text(request.goalId),
        taskId: text(request.taskId),
        kind: text(request.kind),
        characterName: text(request.characterName),
        runtimeOutcome,
        runtimeReason,
        unknownHoldActive: holdActive,
        scope: {
          maxActionsPerCycle: 1,
          blindRetryUsed: responseScope.retryUsed === true,
          preflightVerified: responseScope.preflightVerified === true,
        },
      };

      this.emit("GOAL_RECONCILE_DISPATCH_COMPLETED", cycle.characterName, {
        cycle_id: cycleId,
        goal_id: cycle.goalId,
        task_id: cycle.taskId,
        kind: cycle.kind,
        runtime_outcome: runtimeOutcome,
        runtime_reason: runtimeReason,
        unknown_hold_active: holdActive,
      });
      return await this.saveCycle(cycle);
    } catch (error) {
      const normalized = cycleError(error);
      const holdActive =
        normalized.code === "GOAL_ADAPTER_DISPATCH_OUTCOME_UNKNOWN" ||
        normalized.code === "GOAL_ADAPTER_DISPATCH_UNKNOWN_HOLD_ACTIVE";
      const cycle = {
        cycleId,
        timestamp: this.now(),
        trigger,
        state: "BLOCKED",
        reason: holdActive
          ? "GOAL_RECONCILE_UNKNOWN_HOLD_ACTIVE"
          : "GOAL_RECONCILE_DISPATCH_FAILED",
        dispatched: false,
        goalId: text(request.goalId),
        taskId: text(request.taskId),
        kind: text(request.kind),
        characterName: text(request.characterName),
        runtimeOutcome: null,
        runtimeReason: null,
        unknownHoldActive: holdActive,
        error: normalized,
      };
      this.emit("GOAL_RECONCILE_DISPATCH_FAILED", cycle.characterName, {
        cycle_id: cycleId,
        goal_id: cycle.goalId,
        task_id: cycle.taskId,
        kind: cycle.kind,
        error_code: normalized.code,
        error: normalized.message,
        unknown_hold_active: holdActive,
      });
      return await this.saveCycle(cycle);
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  GoalReconciler,
  cycleError,
};

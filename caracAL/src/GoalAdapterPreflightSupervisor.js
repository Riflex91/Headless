"use strict";

const DEFAULT_GOAL_ADAPTER_PREFLIGHT_TIMEOUT_MS = 10000;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function preflightError(code, message, statusCode = 400, details = null) {
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

class GoalAdapterPreflightSupervisor {
  constructor({
    getCharacter,
    send,
    emit = () => {},
    timeoutMs = DEFAULT_GOAL_ADAPTER_PREFLIGHT_TIMEOUT_MS,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    if (typeof getCharacter !== "function") {
      throw new Error("GoalAdapterPreflightSupervisor requires getCharacter");
    }
    if (typeof send !== "function") {
      throw new Error("GoalAdapterPreflightSupervisor requires send");
    }

    this.getCharacter = getCharacter;
    this.send = send;
    this.emit = typeof emit === "function" ? emit : () => {};
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 10000);
    this.now = typeof now === "function" ? now : Date.now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pending = new Map();
    this.sequence = 0;
  }

  snapshot() {
    return {
      pending: this.pending.size,
      timeoutMs: this.timeoutMs,
      retryEnabled: false,
      runtimeStartAllowed: false,
      lifecycleMutationAllowed: false,
      gameplayMutationAllowed: false,
      valueMutationAllowed: false,
    };
  }

  async run(characterName, rawRequest) {
    const name = text(characterName);
    const request = record(rawRequest);

    if (!name) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_CHARACTER_REQUIRED",
        "Goal adapter preflight requires a target character",
      );
    }
    if (!text(request.kind) || Number(request.version) !== 1) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_REQUEST_INVALID",
        "Goal adapter preflight requires a version 1 adapter request",
      );
    }
    if (
      request.dispatchAllowed !== false ||
      request.dispatchImplemented !== false
    ) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_DISPATCH_BOUNDARY_INVALID",
        "Goal adapter preflight only accepts non-dispatchable adapter requests",
      );
    }

    const declaredCharacter = text(request.characterName);
    if (declaredCharacter && declaredCharacter !== name) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_CHARACTER_MISMATCH",
        "Goal adapter request targets a different runtime",
        409,
        {
          requestedCharacter: name,
          declaredCharacter,
        },
      );
    }

    if (
      [...this.pending.values()].some(
        (pending) => pending.characterName === name,
      )
    ) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_ALREADY_RUNNING",
        `Goal adapter preflight already running for ${name}`,
        409,
      );
    }

    const character = this.getCharacter(name);
    if (!character) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_CHARACTER_NOT_FOUND",
        `Unknown character: ${name}`,
        404,
      );
    }
    if (character.account_owned !== true) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_ACCOUNT_CHARACTER_REQUIRED",
        `Goal adapter preflight requires an account-owned character: ${name}`,
        400,
      );
    }
    if (!runtimeReady(character)) {
      throw preflightError(
        "GOAL_ADAPTER_PREFLIGHT_RUNTIME_NOT_READY",
        `Goal adapter preflight requires an already-running runtime: ${name}`,
        409,
      );
    }

    this.sequence += 1;
    const requestId = `goal-adapter-preflight-${this.now()}-${this.sequence}`;

    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.pending.delete(requestId);
        const error = preflightError(
          "GOAL_ADAPTER_PREFLIGHT_TIMEOUT",
          `Goal adapter preflight timed out for ${name}`,
          504,
          { requestId },
        );
        this.emit("GOAL_ADAPTER_PREFLIGHT_TIMEOUT", name, {
          request_id: requestId,
        });
        reject(error);
      }, this.timeoutMs);

      this.pending.set(requestId, {
        characterName: name,
        resolve,
        reject,
        timer,
      });

      const sent = this.send(character.instance, {
        type: "goal_adapter_preflight",
        request_id: requestId,
        request,
      });
      if (!sent) {
        this.clearTimer(timer);
        this.pending.delete(requestId);
        reject(
          preflightError(
            "GOAL_ADAPTER_PREFLIGHT_SEND_FAILED",
            `Goal adapter preflight IPC send failed for ${name}`,
            503,
            { requestId },
          ),
        );
        return;
      }

      this.emit("GOAL_ADAPTER_PREFLIGHT_SENT", name, {
        request_id: requestId,
        goal_id: text(request.goalId),
        task_id: text(request.taskId),
        kind: text(request.kind),
        readOnly: true,
      });
    });
  }

  handleResult(characterName, message) {
    const source = record(message);
    const requestId = text(source.request_id);
    const pending = requestId ? this.pending.get(requestId) : null;
    if (!pending || pending.characterName !== characterName) {
      return false;
    }

    this.clearTimer(pending.timer);
    this.pending.delete(requestId);
    pending.resolve({
      requestId,
      characterName,
      result: source.result || null,
      error: text(source.error),
      scope: {
        readOnly: true,
        retryUsed: false,
        lifecycleMutationDispatched: false,
        gameplayMutationDispatched: false,
        valueMutationDispatched: false,
      },
    });
    this.emit("GOAL_ADAPTER_PREFLIGHT_RESULT_RECEIVED", characterName, {
      request_id: requestId,
      outcome: source.result?.outcome || null,
      reason: source.result?.reason || null,
      error: text(source.error),
    });
    return true;
  }

  cancelAll(reason = "GOAL_ADAPTER_PREFLIGHT_CANCELLED") {
    for (const [requestId, pending] of this.pending.entries()) {
      this.clearTimer(pending.timer);
      pending.reject(
        preflightError(
          reason,
          `Goal adapter preflight cancelled for ${pending.characterName}`,
          503,
          { requestId },
        ),
      );
      this.pending.delete(requestId);
    }
  }
}

module.exports = {
  DEFAULT_GOAL_ADAPTER_PREFLIGHT_TIMEOUT_MS,
  GoalAdapterPreflightSupervisor,
  preflightError,
  runtimeReady,
};

"use strict";

const GOAL_ADAPTER_STATES = Object.freeze({
  EMPTY: "EMPTY",
  BLOCKED: "BLOCKED",
  READY: "READY",
});

const GOAL_ADAPTER_REQUEST_VERSION = 1;

const GOAL_ADAPTER_CAPABILITIES = Object.freeze({
  FARM_ITEM: Object.freeze({
    bridge: "MaterialGatheringTaskRunner",
    runtimeMethod: "runMaterialGatherTask",
    translationSupported: true,
    runtimeBridgeImplemented: false,
  }),
  TRAIN_CHARACTER: Object.freeze({
    bridge: null,
    runtimeMethod: null,
    translationSupported: false,
    runtimeBridgeImplemented: false,
    blockedReason: "GOAL_ADAPTER_TRAINING_RUNTIME_WORKER_MISSING",
  }),
  ACQUIRE_GEAR: Object.freeze({
    bridge: null,
    runtimeMethod: null,
    translationSupported: false,
    runtimeBridgeImplemented: false,
    blockedReason: "GOAL_ADAPTER_GEAR_ACQUISITION_RUNTIME_WORKER_MISSING",
  }),
  ACCUMULATE_GOLD: Object.freeze({
    bridge: null,
    runtimeMethod: null,
    translationSupported: false,
    runtimeBridgeImplemented: false,
    blockedReason: "GOAL_ADAPTER_GOLD_RUNTIME_WORKER_MISSING",
  }),
  PLAN_CRAFT: Object.freeze({
    bridge: "CraftController",
    runtimeMethod: "executeCraftNext",
    preflightMethod: "runCraftMaterialPlan",
    translationSupported: true,
    runtimeBridgeImplemented: false,
  }),
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function runtimeHints(action) {
  const metadata = record(action?.metadata);
  return record(metadata.runtime ?? metadata.execution);
}

function recipientPosition(value) {
  const source = record(value);
  const map = text(source.map);
  const x = finite(source.x);
  const y = finite(source.y);
  return map && x !== null && y !== null ? { map, x, y } : null;
}

function baseProjection(decision) {
  return {
    timestamp: Date.now(),
    state: GOAL_ADAPTER_STATES.BLOCKED,
    reason: null,
    readOnly: true,
    dispatchAllowed: false,
    dispatchImplemented: false,
    requestDispatched: false,
    mutationDispatched: false,
    decisionState: text(decision?.state),
    decisionReason: text(decision?.reason),
    goalId: text(decision?.action?.goalId),
    kind: text(decision?.action?.kind),
    request: null,
    capability: null,
    policy: {
      existingRuntimeBridgesOnly: true,
      explicitRuntimeHintsRequired: true,
      noInventedExecutionParameters: true,
      singleRequestPlanOnly: true,
      dispatcherRequired: true,
      directGameplayMutationAllowed: false,
      directValueMutationAllowed: false,
      directLifecycleMutationAllowed: false,
    },
  };
}

function blocked(base, reason, details = null) {
  return {
    ...base,
    state: GOAL_ADAPTER_STATES.BLOCKED,
    reason,
    ...(details && { details }),
  };
}

function farmItemRequest(action, capability, base) {
  const target = record(action.target);
  const hints = runtimeHints(action);
  const itemName = text(target.itemName ?? target.item);
  const quantity = positiveInteger(target.quantity);
  const workerCharacter = text(hints.workerCharacter);
  const monsterType = text(hints.monsterType);
  const recipient = text(hints.recipient);
  const position = recipientPosition(hints.recipientPosition);
  const fixedCharacter = text(action.characterName);

  if (!itemName || !quantity) {
    return blocked(base, "GOAL_ADAPTER_FARM_TARGET_INVALID");
  }
  if (fixedCharacter) {
    return blocked(base, "GOAL_ADAPTER_FARM_FIXED_CHARACTER_UNSUPPORTED", {
      characterName: fixedCharacter,
    });
  }

  const missing = [];
  if (!workerCharacter) missing.push("workerCharacter");
  if (!monsterType) missing.push("monsterType");
  if (!recipient) missing.push("recipient");
  if (!position) missing.push("recipientPosition");

  if (missing.length > 0) {
    return blocked(base, "GOAL_ADAPTER_FARM_RUNTIME_HINTS_REQUIRED", {
      missing,
    });
  }

  const itemLevel =
    hints.itemLevel === undefined ? null : nonNegativeInteger(hints.itemLevel);
  if (hints.itemLevel !== undefined && itemLevel === null) {
    return blocked(base, "GOAL_ADAPTER_FARM_ITEM_LEVEL_INVALID");
  }

  const timeoutMs =
    hints.timeoutMs === undefined ? null : positiveInteger(hints.timeoutMs);
  const pollMs =
    hints.pollMs === undefined ? null : positiveInteger(hints.pollMs);
  if (hints.timeoutMs !== undefined && timeoutMs === null) {
    return blocked(base, "GOAL_ADAPTER_FARM_TIMEOUT_INVALID");
  }
  if (hints.pollMs !== undefined && pollMs === null) {
    return blocked(base, "GOAL_ADAPTER_FARM_POLL_INVALID");
  }

  return {
    ...base,
    state: GOAL_ADAPTER_STATES.READY,
    reason: "GOAL_ADAPTER_FARM_REQUEST_READY",
    capability,
    request: {
      version: GOAL_ADAPTER_REQUEST_VERSION,
      type: "GOAL_RUNTIME_METHOD",
      goalId: text(action.goalId),
      taskId: text(action.taskId),
      kind: "FARM_ITEM",
      bridge: capability.bridge,
      runtimeMethod: capability.runtimeMethod,
      characterName: workerCharacter,
      arguments: {
        itemName,
        quantity,
        monsterType,
        recipient,
        recipientPosition: position,
        ...(itemLevel !== null && { itemLevel }),
        ...(timeoutMs !== null && { timeoutMs }),
        ...(pollMs !== null && { pollMs }),
      },
      runtimeGuards: [
        "TARGET_RUNTIME_RUNNING",
        "TARGET_RANGER_REQUIRED",
        "NO_CONTROLLED_ACTIVITY",
        "EMERGENCY_STOP_CLEAR",
        "UNKNOWN_OUTCOME_NO_BLIND_RETRY",
      ],
      mutationDomain: "GAMEPLAY_VALUE",
      dispatchAllowed: false,
      dispatchImplemented: false,
    },
  };
}

function craftRequest(action, capability, base) {
  const target = record(action.target);
  const itemName = text(target.itemName ?? target.item);
  const quantity = positiveInteger(target.quantity);

  if (!itemName || !quantity) {
    return blocked(base, "GOAL_ADAPTER_CRAFT_TARGET_INVALID");
  }

  return {
    ...base,
    state: GOAL_ADAPTER_STATES.READY,
    reason: "GOAL_ADAPTER_CRAFT_REQUEST_READY",
    capability,
    request: {
      version: GOAL_ADAPTER_REQUEST_VERSION,
      type: "GOAL_RUNTIME_SEQUENCE",
      goalId: text(action.goalId),
      taskId: text(action.taskId),
      kind: "PLAN_CRAFT",
      bridge: capability.bridge,
      characterName:
        text(action.characterName) || text(runtimeHints(action).workerCharacter),
      preflight: {
        runtimeMethod: capability.preflightMethod,
        arguments: { recipe: itemName },
        readOnly: true,
      },
      scopedConfigOverride: {
        craft: {
          enabled: true,
          allowedRecipes: [itemName],
        },
      },
      execution: {
        runtimeMethod: capability.runtimeMethod,
        maxInvocations: 1,
      },
      cleanup: {
        clearConfigOverride: true,
        refreshPlanning: true,
      },
      completionTarget: {
        itemName,
        quantity,
      },
      runtimeGuards: [
        "TARGET_RUNTIME_RUNNING",
        "NO_CONTROLLED_ACTIVITY",
        "ECONOMY_ARBITER_AUTHORIZED",
        "RISK_POLICY_CLEAR",
        "UNKNOWN_OUTCOME_NO_BLIND_RETRY",
        "SCOPED_OVERRIDE_MUST_BE_CLEARED",
      ],
      mutationDomain: "VALUE",
      dispatchAllowed: false,
      dispatchImplemented: false,
    },
  };
}

function buildGoalAdapterPlan(goalExecutionDecision, { now = Date.now } = {}) {
  const decision = record(goalExecutionDecision);
  const base = {
    ...baseProjection(decision),
    timestamp: finite(now()) ?? Date.now(),
  };

  if (decision.state === "DISABLED") {
    return {
      ...base,
      state: GOAL_ADAPTER_STATES.EMPTY,
      reason: "GOAL_ADAPTER_EXECUTION_DISABLED",
    };
  }
  if (decision.state !== "READY" || decision.dispatchAllowed !== true) {
    return blocked(base, "GOAL_ADAPTER_EXECUTION_DECISION_NOT_READY");
  }
  if (
    decision.dispatchImplemented === true ||
    decision.mutationDispatched === true
  ) {
    return blocked(base, "GOAL_ADAPTER_EXECUTION_BOUNDARY_INVALID");
  }

  const action = record(decision.action);
  if (
    action.type !== "GOAL_HANDOFF" ||
    action.requiresAdapterDispatcher !== true
  ) {
    return blocked(base, "GOAL_ADAPTER_ACTION_INVALID");
  }

  const kind = text(action.kind);
  const capability = kind ? GOAL_ADAPTER_CAPABILITIES[kind] : null;
  if (!capability) {
    return blocked(base, "GOAL_ADAPTER_KIND_UNSUPPORTED");
  }
  if (capability.translationSupported !== true) {
    return blocked(
      base,
      capability.blockedReason || "GOAL_ADAPTER_KIND_UNSUPPORTED",
      {
        capability,
      },
    );
  }

  if (kind === "FARM_ITEM") {
    return farmItemRequest(action, capability, base);
  }
  if (kind === "PLAN_CRAFT") {
    return craftRequest(action, capability, base);
  }

  return blocked(base, "GOAL_ADAPTER_KIND_UNSUPPORTED");
}

module.exports = {
  GOAL_ADAPTER_CAPABILITIES,
  GOAL_ADAPTER_REQUEST_VERSION,
  GOAL_ADAPTER_STATES,
  buildGoalAdapterPlan,
  craftRequest,
  farmItemRequest,
  recipientPosition,
  runtimeHints,
};

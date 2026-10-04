"use strict";

const {
  DEFAULT_PRIORITY,
  GOAL_STATUSES,
  GOAL_TYPES,
  PLAN_STATES,
  planGoal,
} = require("./GoalPlanner");

const GOAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const GOAL_MUTATIONS = Object.freeze({
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  STATUS: "STATUS",
});

const STATUS_TRANSITIONS = Object.freeze({
  [GOAL_STATUSES.ACTIVE]: Object.freeze([
    GOAL_STATUSES.PAUSED,
    GOAL_STATUSES.COMPLETED,
    GOAL_STATUSES.CANCELLED,
  ]),
  [GOAL_STATUSES.PAUSED]: Object.freeze([
    GOAL_STATUSES.ACTIVE,
    GOAL_STATUSES.COMPLETED,
    GOAL_STATUSES.CANCELLED,
  ]),
  [GOAL_STATUSES.COMPLETED]: Object.freeze([]),
  [GOAL_STATUSES.CANCELLED]: Object.freeze([]),
});

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(record(source), key);
}

function goalManagementError(code, message, statusCode = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeGoalId(value) {
  const normalized = text(value);
  if (!normalized || !GOAL_ID_PATTERN.test(normalized)) {
    throw goalManagementError(
      "GOAL_ID_INVALID",
      "Goal id must be 1-96 characters and use letters, numbers, '.', '_', ':' or '-'",
      400,
    );
  }
  return normalized;
}

function normalizeCharacterName(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = text(value);
  if (!normalized || normalized.length > 64) {
    throw goalManagementError(
      "GOAL_CHARACTER_INVALID",
      "Goal character name must be a non-empty string up to 64 characters",
      400,
    );
  }
  return normalized;
}

function normalizeStatus(value, { create = false } = {}) {
  const normalized = text(value)?.toUpperCase() || GOAL_STATUSES.ACTIVE;
  if (!Object.values(GOAL_STATUSES).includes(normalized)) {
    throw goalManagementError(
      "GOAL_STATUS_INVALID",
      `Unsupported Goal status: ${String(value)}`,
      400,
    );
  }
  if (
    create &&
    ![GOAL_STATUSES.ACTIVE, GOAL_STATUSES.PAUSED].includes(normalized)
  ) {
    throw goalManagementError(
      "GOAL_CREATE_STATUS_INVALID",
      "New Goals may only start ACTIVE or PAUSED",
      400,
    );
  }
  return normalized;
}

function normalizePriority(value, { fallback = DEFAULT_PRIORITY } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = finite(value);
  if (
    parsed === null ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > 100
  ) {
    throw goalManagementError(
      "GOAL_PRIORITY_INVALID",
      "Goal priority must be an integer from 0 to 100",
      400,
    );
  }
  return parsed;
}

function normalizeGoalDefinition(input, existing = null) {
  const source = record(input);
  const prior = record(existing);
  const rawType = hasOwn(source, "type") ? source.type : prior.type;
  const type = text(rawType)?.toUpperCase() || null;
  if (!Object.values(GOAL_TYPES).includes(type)) {
    throw goalManagementError(
      "GOAL_TYPE_INVALID",
      `Unsupported Goal type: ${String(rawType)}`,
      400,
    );
  }

  const priority = normalizePriority(
    hasOwn(source, "priority") ? source.priority : prior.priority,
  );
  const target = hasOwn(source, "target")
    ? clone(record(source.target), {})
    : clone(record(prior.target), {});
  const metadata = hasOwn(source, "metadata")
    ? clone(record(source.metadata), {})
    : clone(record(prior.metadata), {});

  return {
    type,
    priority,
    target,
    metadata,
  };
}

function persistedRow(goalId, row) {
  if (!row) return null;
  return {
    goal_id: goalId,
    character_name: row.character_name || null,
    status: row.status,
    goal: clone(record(row.goal), {}),
    updated_at: finite(row.updated_at),
  };
}

function assertExpectedUpdatedAt(existing, expectedUpdatedAt) {
  if (expectedUpdatedAt === undefined || expectedUpdatedAt === null) return;

  const expected = finite(expectedUpdatedAt);
  if (expected === null || !Number.isInteger(expected)) {
    throw goalManagementError(
      "GOAL_EXPECTED_UPDATED_AT_INVALID",
      "expectedUpdatedAt must be an integer timestamp",
      400,
    );
  }

  if (finite(existing?.updated_at) !== expected) {
    throw goalManagementError(
      "GOAL_STALE_UPDATE",
      "Goal changed since the caller's last snapshot",
      409,
      {
        expectedUpdatedAt: expected,
        actualUpdatedAt: finite(existing?.updated_at),
      },
    );
  }
}

function assertStatusTransition(current, next) {
  if (current === next) return;
  const allowed = STATUS_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw goalManagementError(
      "GOAL_STATUS_TRANSITION_INVALID",
      `Goal status cannot transition from ${current} to ${next}`,
      409,
      { current, next },
    );
  }
}

function assertDefinitionEditable(status) {
  if ([GOAL_STATUSES.COMPLETED, GOAL_STATUSES.CANCELLED].includes(status)) {
    throw goalManagementError(
      "GOAL_TERMINAL",
      `Goal in terminal status ${status} cannot be edited`,
      409,
      { status },
    );
  }
}

function candidatePlan(row, planningContext) {
  const plan = planGoal(row, record(planningContext));
  if (plan.state === PLAN_STATES.INVALID) {
    throw goalManagementError(
      "GOAL_DEFINITION_INVALID",
      plan.reason || "Goal definition is invalid",
      400,
      { errors: plan.errors || [] },
    );
  }
  return plan;
}

class GoalManagementService {
  constructor({
    persistence,
    getPlanningContext = () => ({}),
    onMutation = null,
  } = {}) {
    if (!persistence) {
      throw new Error("GoalManagementService requires persistence");
    }
    this.persistence = persistence;
    this.getPlanningContext =
      typeof getPlanningContext === "function"
        ? getPlanningContext
        : () => ({});
    this.onMutation = typeof onMutation === "function" ? onMutation : null;
  }

  read(goalId) {
    const normalizedId = normalizeGoalId(goalId);
    return persistedRow(normalizedId, this.persistence.getGoal(normalizedId));
  }

  async create(input = {}) {
    const source = record(input);
    const goalId = normalizeGoalId(source.goalId ?? source.goal_id);
    if (this.persistence.getGoal(goalId)) {
      throw goalManagementError(
        "GOAL_ALREADY_EXISTS",
        `Goal already exists: ${goalId}`,
        409,
      );
    }

    const characterName = normalizeCharacterName(
      source.characterName ?? source.character_name,
    );
    const status = normalizeStatus(source.status, { create: true });
    const goal = normalizeGoalDefinition(source.goal);
    const row = {
      goal_id: goalId,
      character_name: characterName,
      status,
      goal,
      updated_at: null,
    };
    const plan = candidatePlan(row, this.getPlanningContext());

    await this.persistence.saveGoal(goalId, {
      characterName,
      status,
      goal,
    });

    const persisted = persistedRow(goalId, this.persistence.getGoal(goalId));
    const result = {
      mutation: GOAL_MUTATIONS.CREATE,
      goal: persisted,
      plan: candidatePlan(persisted, this.getPlanningContext()),
    };
    this.onMutation?.({
      type: "GOAL_CREATED",
      goalId,
      characterName,
      status,
      planState: plan.state,
    });
    return result;
  }

  async update(goalId, input = {}) {
    const normalizedId = normalizeGoalId(goalId);
    const source = record(input);
    const existing = persistedRow(
      normalizedId,
      this.persistence.getGoal(normalizedId),
    );
    if (!existing) {
      throw goalManagementError(
        "GOAL_NOT_FOUND",
        `Goal not found: ${normalizedId}`,
        404,
      );
    }

    assertExpectedUpdatedAt(existing, source.expectedUpdatedAt);
    const definitionMutation =
      hasOwn(source, "goal") ||
      hasOwn(source, "characterName") ||
      hasOwn(source, "character_name");
    const statusMutation = hasOwn(source, "status");

    if (!definitionMutation && !statusMutation) {
      throw goalManagementError(
        "GOAL_UPDATE_EMPTY",
        "Goal update must change status, characterName or goal definition",
        400,
      );
    }
    if (definitionMutation && statusMutation) {
      throw goalManagementError(
        "GOAL_UPDATE_AMBIGUOUS",
        "Goal definition and lifecycle status must be changed in separate requests",
        400,
      );
    }

    let characterName = existing.character_name;
    let status = existing.status;
    let goal = existing.goal;
    let mutation = GOAL_MUTATIONS.UPDATE;

    if (statusMutation) {
      const nextStatus = normalizeStatus(source.status);
      assertStatusTransition(existing.status, nextStatus);
      status = nextStatus;
      mutation = GOAL_MUTATIONS.STATUS;
    } else {
      assertDefinitionEditable(existing.status);
      if (hasOwn(source, "characterName") || hasOwn(source, "character_name")) {
        characterName = normalizeCharacterName(
          hasOwn(source, "characterName")
            ? source.characterName
            : source.character_name,
        );
      }
      if (hasOwn(source, "goal")) {
        if (!source.goal || typeof source.goal !== "object") {
          throw goalManagementError(
            "GOAL_DEFINITION_INVALID",
            "goal must be an object",
            400,
          );
        }
        goal = normalizeGoalDefinition(source.goal, existing.goal);
      }
    }

    const row = {
      goal_id: normalizedId,
      character_name: characterName,
      status,
      goal,
      updated_at: existing.updated_at,
    };
    candidatePlan(row, this.getPlanningContext());

    await this.persistence.saveGoal(normalizedId, {
      characterName,
      status,
      goal,
    });

    const persisted = persistedRow(
      normalizedId,
      this.persistence.getGoal(normalizedId),
    );
    const result = {
      mutation,
      goal: persisted,
      plan: candidatePlan(persisted, this.getPlanningContext()),
    };
    this.onMutation?.({
      type:
        mutation === GOAL_MUTATIONS.STATUS
          ? "GOAL_STATUS_CHANGED"
          : "GOAL_UPDATED",
      goalId: normalizedId,
      characterName,
      status,
      planState: result.plan.state,
    });
    return result;
  }
}

module.exports = {
  GOAL_ID_PATTERN,
  GOAL_MUTATIONS,
  STATUS_TRANSITIONS,
  GoalManagementService,
  assertExpectedUpdatedAt,
  assertStatusTransition,
  goalManagementError,
  normalizeCharacterName,
  normalizeGoalDefinition,
  normalizeGoalId,
  normalizePriority,
  normalizeStatus,
  persistedRow,
};

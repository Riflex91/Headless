"use strict";

const { manualStopProtected } = require("./FullAutonomy");

const GOAL_TYPES = Object.freeze({
  FARM_ITEM: "FARM_ITEM",
  LEVEL_CHARACTER: "LEVEL_CHARACTER",
  ACQUIRE_GEAR: "ACQUIRE_GEAR",
  ACCUMULATE_GOLD: "ACCUMULATE_GOLD",
  CRAFT_ITEM: "CRAFT_ITEM",
  PREPARE_BOSS: "PREPARE_BOSS",
});

const GOAL_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
});

const PLAN_STATES = Object.freeze({
  PLANNED: "PLANNED",
  BLOCKED: "BLOCKED",
  COMPLETE: "COMPLETE",
  PAUSED: "PAUSED",
  CANCELLED: "CANCELLED",
  INVALID: "INVALID",
});

const DEFAULT_PRIORITY = 50;

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

function positive(value, fallback = null) {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function boundedPriority(value) {
  const parsed = finite(value);
  if (parsed === null) return DEFAULT_PRIORITY;
  return Math.max(0, Math.min(100, Math.trunc(parsed)));
}

function clone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function profileForName(accountStrategy, name) {
  return (
    array(accountStrategy?.profiles).find(
      (profile) => profile?.name === name,
    ) || null
  );
}

function characterBlock(characterManage, name) {
  return record(characterManage)[name] || null;
}

function itemQuantity(items, itemName, minimumLevel = null) {
  return array(items).reduce((total, item) => {
    if (!item || text(item.name) !== itemName) return total;
    const level = finite(item.level) ?? 0;
    if (minimumLevel !== null && level < minimumLevel) return total;
    return total + Math.max(1, finite(item.q) ?? 1);
  }, 0);
}

function inventoryEvidence(
  characterManage,
  { characterName = null, itemName, minimumLevel = null } = {},
) {
  const entries = Object.entries(record(characterManage)).filter(
    ([, block]) => block?.account_owned === true,
  );
  const scoped = characterName
    ? entries.filter(([name]) => name === characterName)
    : entries;
  let quantity = 0;
  let knownCharacters = 0;

  for (const [, block] of scoped) {
    if (!Array.isArray(block?.live_state?.items)) continue;
    knownCharacters += 1;
    quantity += itemQuantity(block.live_state.items, itemName, minimumLevel);
  }

  return {
    quantity,
    knownCharacters,
    expectedCharacters: scoped.length,
    completeCoverage:
      scoped.length > 0 && knownCharacters === scoped.length,
  };
}

function equipmentEvidence(
  accountStrategy,
  { characterName = null, itemName, minimumLevel = null } = {},
) {
  const profiles = array(accountStrategy?.profiles).filter(
    (profile) => !characterName || profile?.name === characterName,
  );
  const matches = [];

  for (const profile of profiles) {
    for (const [slot, item] of Object.entries(
      record(profile?.gear?.equipment),
    )) {
      if (text(item?.name) !== itemName) continue;
      const level = finite(item?.level) ?? 0;
      if (minimumLevel !== null && level < minimumLevel) continue;
      matches.push({ characterName: profile.name, slot, level });
    }
  }

  return matches;
}

function targetCharacterName(row, target) {
  return text(target.characterName) || text(row.character_name);
}

function manualStopCheck(characterManage, characterName) {
  if (!characterName) {
    return { ready: true, code: "NO_FIXED_CHARACTER", detail: null };
  }

  const block = characterBlock(characterManage, characterName);
  if (!block) {
    return {
      ready: false,
      code: "TARGET_CHARACTER_NOT_REGISTERED",
      detail: characterName,
    };
  }

  if (manualStopProtected(block)) {
    return {
      ready: false,
      code: "MANUAL_STOP_PROTECTED",
      detail: characterName,
    };
  }

  return {
    ready: true,
    code: "TARGET_CHARACTER_AVAILABLE",
    detail: characterName,
  };
}

function criterion(
  id,
  description,
  { status = "UNKNOWN", observed = null, target = null } = {},
) {
  return { id, description, status, observed, target };
}

function progressFromQuantity(current, target, evidenceKnown) {
  if (!evidenceKnown) {
    return {
      state: "UNKNOWN",
      current: null,
      target,
      ratio: null,
    };
  }

  const ratio =
    target > 0 ? Math.max(0, Math.min(1, current / target)) : 1;
  return {
    state: current >= target ? "COMPLETE" : "IN_PROGRESS",
    current,
    target,
    ratio,
  };
}

function baseTask(
  goalId,
  index,
  kind,
  subsystem,
  description,
  extra = {},
) {
  return {
    taskId: `${goalId}:${index + 1}`,
    kind,
    subsystem,
    description,
    status: "PLANNED",
    executionAllowed: false,
    mutationDispatched: false,
    ...extra,
  };
}

function planFarmItem(goalId, row, target, context) {
  const itemName = text(target.itemName || target.item);
  const quantity = positive(target.quantity, 1);
  const characterName = targetCharacterName(row, target);

  if (!itemName || quantity === null) {
    return { error: "FARM_ITEM_TARGET_INVALID" };
  }

  const inventory = inventoryEvidence(context.characterManage, {
    characterName,
    itemName,
  });
  const progress = progressFromQuantity(
    inventory.quantity,
    quantity,
    inventory.knownCharacters > 0,
  );
  const criteria = [
    criterion("ITEM_QUANTITY", `Own ${quantity} x ${itemName}`, {
      status:
        progress.state === "COMPLETE"
          ? "MET"
          : progress.state === "UNKNOWN"
            ? "UNKNOWN"
            : "UNMET",
      observed: progress.current,
      target: quantity,
    }),
  ];

  return {
    target: { itemName, quantity, characterName },
    progress,
    criteria,
    tasks: [
      baseTask(
        goalId,
        0,
        "VERIFY_INVENTORY",
        "InventoryIntelligence",
        `Measure account inventory for ${itemName}`,
      ),
      baseTask(
        goalId,
        1,
        "SELECT_FARM_TARGET",
        "FarmIntelligence",
        `Select farming opportunity for ${itemName}`,
      ),
      baseTask(
        goalId,
        2,
        "FARM_ITEM",
        "FullAutonomy/FarmIntelligence",
        `Farm until ${quantity} x ${itemName} is confirmed`,
        { characterName },
      ),
    ],
  };
}

function planLevelCharacter(goalId, row, target, context) {
  const characterName = targetCharacterName(row, target);
  const level = positive(target.level, null);

  if (!characterName || level === null) {
    return { error: "LEVEL_CHARACTER_TARGET_INVALID" };
  }

  const profile = profileForName(context.accountStrategy, characterName);
  const current = finite(profile?.level);
  const progress =
    current === null
      ? {
          state: "UNKNOWN",
          current: null,
          target: level,
          ratio: null,
        }
      : {
          state: current >= level ? "COMPLETE" : "IN_PROGRESS",
          current,
          target: level,
          ratio: Math.max(0, Math.min(1, current / level)),
        };

  return {
    target: { characterName, level },
    progress,
    criteria: [
      criterion(
        "CHARACTER_LEVEL",
        `${characterName} reaches level ${level}`,
        {
          status:
            progress.state === "COMPLETE"
              ? "MET"
              : progress.state === "UNKNOWN"
                ? "UNKNOWN"
                : "UNMET",
          observed: current,
          target: level,
        },
      ),
    ],
    tasks: [
      baseTask(
        goalId,
        0,
        "ASSESS_TRAINING",
        "AccountStrategy",
        `Assess training state for ${characterName}`,
        { characterName },
      ),
      baseTask(
        goalId,
        1,
        "TRAIN_CHARACTER",
        "FullAutonomy/FarmIntelligence",
        `Prioritize XP-producing farming for ${characterName}`,
        { characterName },
      ),
    ],
  };
}

function planAcquireGear(goalId, row, target, context) {
  const itemName = text(target.itemName || target.item);
  const minimumLevel = Math.max(
    0,
    Math.trunc(finite(target.level) ?? 0),
  );
  const characterName = targetCharacterName(row, target);

  if (!itemName) {
    return { error: "ACQUIRE_GEAR_TARGET_INVALID" };
  }

  const equipped = equipmentEvidence(context.accountStrategy, {
    characterName,
    itemName,
    minimumLevel,
  });
  const inventory = inventoryEvidence(context.characterManage, {
    characterName,
    itemName,
    minimumLevel,
  });
  const found = equipped.length > 0 || inventory.quantity > 0;
  const evidenceKnown =
    found ||
    inventory.knownCharacters > 0 ||
    array(context.accountStrategy?.profiles).length > 0;

  return {
    target: { itemName, level: minimumLevel, characterName },
    progress: {
      state: found
        ? "COMPLETE"
        : evidenceKnown
          ? "IN_PROGRESS"
          : "UNKNOWN",
      current: found ? 1 : evidenceKnown ? 0 : null,
      target: 1,
      ratio: found ? 1 : evidenceKnown ? 0 : null,
    },
    criteria: [
      criterion(
        "GEAR_OWNERSHIP",
        `Own ${itemName}${
          minimumLevel > 0 ? ` +${minimumLevel} or better` : ""
        }`,
        {
          status: found
            ? "MET"
            : evidenceKnown
              ? "UNMET"
              : "UNKNOWN",
          observed: found
            ? {
                equipped,
                inventoryQuantity: inventory.quantity,
              }
            : null,
          target: { itemName, minimumLevel },
        },
      ),
    ],
    tasks: [
      baseTask(
        goalId,
        0,
        "ASSESS_GEAR",
        "GearScoring/FutureGear/AccountGearReservation",
        `Assess ${itemName} against account gear needs`,
        { characterName },
      ),
      baseTask(
        goalId,
        1,
        "ACQUIRE_GEAR",
        "FarmIntelligence/InventoryIntelligence",
        `Plan safe acquisition of ${itemName}`,
        { characterName },
      ),
    ],
  };
}

function planAccumulateGold(goalId, row, target, context) {
  const amount = positive(target.amount ?? target.gold, null);
  const characterName = targetCharacterName(row, target);

  if (amount === null) {
    return { error: "ACCUMULATE_GOLD_TARGET_INVALID" };
  }

  const profiles = array(context.accountStrategy?.profiles).filter(
    (profile) => !characterName || profile?.name === characterName,
  );
  const known = profiles.filter(
    (profile) => finite(profile?.gold) !== null,
  );
  const current = known.reduce(
    (sum, profile) => sum + (finite(profile.gold) ?? 0),
    0,
  );
  const progress = progressFromQuantity(
    current,
    amount,
    known.length > 0,
  );

  return {
    target: { amount, characterName },
    progress,
    criteria: [
      criterion(
        "GOLD_AMOUNT",
        `${characterName || "Account"} owns at least ${amount} gold`,
        {
          status:
            progress.state === "COMPLETE"
              ? "MET"
              : progress.state === "UNKNOWN"
                ? "UNKNOWN"
                : "UNMET",
          observed: progress.current,
          target: amount,
        },
      ),
    ],
    tasks: [
      baseTask(
        goalId,
        0,
        "MEASURE_GOLD",
        "AccountStrategy",
        "Measure known account gold",
        { characterName },
      ),
      baseTask(
        goalId,
        1,
        "ACCUMULATE_GOLD",
        "FarmIntelligence/EconomyArbiter",
        `Prioritize safe gold-producing work until ${amount} is reached`,
        { characterName },
      ),
    ],
  };
}

function planCraftItem(goalId, row, target, context) {
  const itemName = text(target.itemName || target.item);
  const quantity = positive(target.quantity, 1);

  if (!itemName || quantity === null) {
    return { error: "CRAFT_ITEM_TARGET_INVALID" };
  }

  const inventory = inventoryEvidence(context.characterManage, {
    itemName,
  });
  const progress = progressFromQuantity(
    inventory.quantity,
    quantity,
    inventory.knownCharacters > 0,
  );

  return {
    target: { itemName, quantity },
    progress,
    criteria: [
      criterion(
        "CRAFT_OUTPUT_OWNERSHIP",
        `Own ${quantity} x ${itemName}`,
        {
          status:
            progress.state === "COMPLETE"
              ? "MET"
              : progress.state === "UNKNOWN"
                ? "UNKNOWN"
                : "UNMET",
          observed: progress.current,
          target: quantity,
        },
      ),
    ],
    tasks: [
      baseTask(
        goalId,
        0,
        "VERIFY_CRAFT_MATERIALS",
        "InventoryIntelligence/CraftController",
        `Evaluate recipe and protected material requirements for ${itemName}`,
      ),
      baseTask(
        goalId,
        1,
        "PLAN_CRAFT",
        "CraftController/EconomyArbiter",
        `Prepare a guarded CraftController plan for ${itemName}`,
      ),
    ],
  };
}

function planPrepareBoss(goalId, row, target, context) {
  const bossName = text(target.bossName || target.boss);

  if (!bossName) {
    return { error: "PREPARE_BOSS_TARGET_INVALID" };
  }

  const requiredCapabilities = array(target.requiredCapabilities)
    .map(text)
    .filter(Boolean);
  const available = new Set(
    array(context.accountStrategy?.profiles).flatMap((profile) =>
      array(profile?.capabilities),
    ),
  );
  const missingCapabilities = requiredCapabilities.filter(
    (capability) => !available.has(capability),
  );
  const rosterReady = missingCapabilities.length === 0;

  return {
    target: { bossName, requiredCapabilities },
    progress: {
      state: "UNKNOWN",
      current: null,
      target: 1,
      ratio: null,
    },
    criteria: [
      criterion(
        "ROSTER_CAPABILITIES",
        `Account satisfies declared capability requirements for ${bossName}`,
        {
          status: rosterReady ? "MET" : "UNMET",
          observed: { missingCapabilities },
          target: requiredCapabilities,
        },
      ),
      criterion(
        "ENCOUNTER_PLAN",
        `Phase 20 encounter plan exists for ${bossName}`,
        {
          status: "UNKNOWN",
          observed: null,
          target: bossName,
        },
      ),
    ],
    tasks: [
      baseTask(
        goalId,
        0,
        "ASSESS_BOSS_ROSTER",
        "AccountStrategy",
        `Assess account roster for ${bossName}`,
      ),
      baseTask(
        goalId,
        1,
        "PREPARE_ENCOUNTER",
        "Phase20/Encounter",
        `Hand off ${bossName} encounter planning when Phase 20 capability is available`,
      ),
    ],
    extraPreconditions: [
      {
        ready: false,
        code: "PHASE20_ENCOUNTER_PLANNING_DEFERRED",
        detail: bossName,
      },
    ],
  };
}

const TYPE_PLANNERS = Object.freeze({
  [GOAL_TYPES.FARM_ITEM]: planFarmItem,
  [GOAL_TYPES.LEVEL_CHARACTER]: planLevelCharacter,
  [GOAL_TYPES.ACQUIRE_GEAR]: planAcquireGear,
  [GOAL_TYPES.ACCUMULATE_GOLD]: planAccumulateGold,
  [GOAL_TYPES.CRAFT_ITEM]: planCraftItem,
  [GOAL_TYPES.PREPARE_BOSS]: planPrepareBoss,
});

function normalizeGoalRow(row) {
  const source = record(row);
  const goal = record(source.goal);

  return {
    goalId: text(source.goal_id || source.goalId),
    characterName: text(
      source.character_name || source.characterName,
    ),
    status:
      text(source.status)?.toUpperCase() || GOAL_STATUSES.ACTIVE,
    type: text(goal.type)?.toUpperCase() || null,
    priority: boundedPriority(goal.priority),
    target: clone(record(goal.target), {}),
    metadata: clone(record(goal.metadata), {}),
    updatedAt: finite(source.updated_at || source.updatedAt),
    raw: goal,
  };
}

function invalidPlan(normalized, reason, errors) {
  return {
    ...normalized,
    state: PLAN_STATES.INVALID,
    reason,
    readOnly: true,
    executionEnabled: false,
    preconditions: [],
    progress: {
      state: "UNKNOWN",
      current: null,
      target: null,
      ratio: null,
    },
    completion: {
      met: false,
      source: null,
      criteria: [],
    },
    tasks: [],
    errors,
  };
}

function planGoal(row, context) {
  const normalized = normalizeGoalRow(row);
  const invalid = [];

  if (!normalized.goalId) invalid.push("GOAL_ID_REQUIRED");
  if (!Object.values(GOAL_STATUSES).includes(normalized.status)) {
    invalid.push("GOAL_STATUS_UNSUPPORTED");
  }
  if (!Object.values(GOAL_TYPES).includes(normalized.type)) {
    invalid.push("GOAL_TYPE_UNSUPPORTED");
  }
  if (invalid.length > 0) {
    return invalidPlan(normalized, invalid[0], invalid);
  }

  const planner = TYPE_PLANNERS[normalized.type];
  const planned = planner(
    normalized.goalId,
    {
      ...row,
      character_name: normalized.characterName,
    },
    normalized.target,
    context,
  );
  if (planned.error) {
    return invalidPlan(
      normalized,
      planned.error,
      [planned.error],
    );
  }

  const fixedCharacter = text(planned.target?.characterName);
  const preconditions = [
    manualStopCheck(context.characterManage, fixedCharacter),
    ...(planned.extraPreconditions || []),
  ];
  const evidenceComplete =
    planned.criteria.length > 0 &&
    planned.criteria.every((entry) => entry.status === "MET");
  const persistedComplete =
    normalized.status === GOAL_STATUSES.COMPLETED;
  const complete = evidenceComplete || persistedComplete;
  const blocked = preconditions.some(
    (entry) => entry.ready === false,
  );

  let state = PLAN_STATES.PLANNED;
  let reason = "GOAL_PLAN_READY";

  if (normalized.status === GOAL_STATUSES.PAUSED) {
    state = PLAN_STATES.PAUSED;
    reason = "GOAL_PAUSED";
  } else if (normalized.status === GOAL_STATUSES.CANCELLED) {
    state = PLAN_STATES.CANCELLED;
    reason = "GOAL_CANCELLED";
  } else if (complete) {
    state = PLAN_STATES.COMPLETE;
    reason = persistedComplete
      ? "GOAL_COMPLETED_PERSISTED"
      : "GOAL_COMPLETION_CRITERIA_MET";
  } else if (blocked) {
    state = PLAN_STATES.BLOCKED;
    reason =
      preconditions.find((entry) => entry.ready === false)?.code ||
      "GOAL_PRECONDITION_BLOCKED";
  }

  const tasks =
    state === PLAN_STATES.PLANNED ||
    state === PLAN_STATES.BLOCKED
      ? planned.tasks.map((task) => ({
          ...task,
          status: blocked ? "BLOCKED" : task.status,
        }))
      : [];

  return {
    ...normalized,
    target: planned.target,
    state,
    reason,
    readOnly: true,
    executionEnabled: false,
    preconditions,
    progress: planned.progress,
    completion: {
      met: complete,
      source: persistedComplete
        ? "PERSISTED_STATUS"
        : evidenceComplete
          ? "OBSERVED_EVIDENCE"
          : null,
      criteria: planned.criteria,
    },
    tasks,
    errors: [],
  };
}

function buildGoalPlan(
  persistedGoals = [],
  {
    accountStrategy = null,
    characterManage = {},
    fullAutonomy = null,
    now = Date.now,
  } = {},
) {
  const context = {
    accountStrategy: record(accountStrategy),
    characterManage: record(characterManage),
    fullAutonomy: record(fullAutonomy),
  };
  const goals = array(persistedGoals)
    .map((row) => planGoal(row, context))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.goalId.localeCompare(right.goalId),
    );
  const active = goals.filter(
    (goal) => goal.status === GOAL_STATUSES.ACTIVE,
  );
  const invalid = goals.some(
    (goal) => goal.state === PLAN_STATES.INVALID,
  );

  return {
    timestamp: finite(now()) ?? Date.now(),
    state: goals.length === 0 ? "EMPTY" : invalid ? "PARTIAL" : "READY",
    reason:
      goals.length === 0
        ? "GOALS_EMPTY"
        : invalid
          ? "GOALS_PARTIAL_INVALID"
          : "GOAL_PLANS_READY",
    readOnly: true,
    executionEnabled: false,
    gameplayMutationDispatched: false,
    valueMutationDispatched: false,
    lifecycleMutationDispatched: false,
    goals,
    summary: {
      total: goals.length,
      active: active.length,
      planned: goals.filter(
        (goal) => goal.state === PLAN_STATES.PLANNED,
      ).length,
      blocked: goals.filter(
        (goal) => goal.state === PLAN_STATES.BLOCKED,
      ).length,
      complete: goals.filter(
        (goal) => goal.state === PLAN_STATES.COMPLETE,
      ).length,
      paused: goals.filter(
        (goal) => goal.state === PLAN_STATES.PAUSED,
      ).length,
      cancelled: goals.filter(
        (goal) => goal.state === PLAN_STATES.CANCELLED,
      ).length,
      invalid: goals.filter(
        (goal) => goal.state === PLAN_STATES.INVALID,
      ).length,
      byType: Object.fromEntries(
        Object.values(GOAL_TYPES).map((type) => [
          type,
          goals.filter((goal) => goal.type === type).length,
        ]),
      ),
    },
    policy: {
      intentExecutionSeparated: true,
      manualStopRespected: true,
      fullAutonomyHandoffOnly: true,
      directGameplayMutationAllowed: false,
      directValueMutationAllowed: false,
      directLifecycleMutationAllowed: false,
    },
  };
}

module.exports = {
  DEFAULT_PRIORITY,
  GOAL_STATUSES,
  GOAL_TYPES,
  PLAN_STATES,
  buildGoalPlan,
  inventoryEvidence,
  normalizeGoalRow,
  planGoal,
};

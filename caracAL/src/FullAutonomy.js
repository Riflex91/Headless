"use strict";

const { DESIRED_RUNTIME_STATES } = require("./CharacterControl");

const FULL_AUTONOMY_STATES = Object.freeze({
  READY: "READY",
  PARTIAL: "PARTIAL",
  EMPTY: "EMPTY",
});

const MANUAL_STOP_SOURCES = new Set(["MANUAL_STOP", "PERSISTED_STOP"]);

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

function desiredState(block) {
  const explicit = text(block?.desired_runtime_state);
  if (Object.values(DESIRED_RUNTIME_STATES).includes(explicit)) {
    return explicit;
  }
  return block?.enabled
    ? DESIRED_RUNTIME_STATES.RUNNING
    : DESIRED_RUNTIME_STATES.STOPPED;
}

function desiredStateSource(block) {
  const explicit = text(block?.desired_runtime_state_source);
  if (explicit) return explicit;
  if (
    desiredState(block) === DESIRED_RUNTIME_STATES.STOPPED &&
    block?.enabled === false
  ) {
    return "PERSISTED_STOP";
  }
  return "UNKNOWN";
}

function manualStopProtected(block) {
  const source = desiredStateSource(block);
  return (
    desiredState(block) === DESIRED_RUNTIME_STATES.STOPPED &&
    (MANUAL_STOP_SOURCES.has(source) ||
      block?.full_autonomy_manual_stop === true)
  );
}

function profileForName(accountStrategy, name) {
  return (
    array(accountStrategy?.profiles).find(
      (profile) => profile?.name === name,
    ) || null
  );
}

function characterClass(block, profile) {
  return (
    text(profile?.class) ||
    text(block?.account_character_type) ||
    text(block?.live_state?.ctype)
  );
}

function capabilities(profile) {
  return array(profile?.capabilities).filter((value) => text(value) !== null);
}

function isMerchantProfile(block, profile) {
  return (
    characterClass(block, profile)?.toLowerCase() === "merchant" ||
    capabilities(profile).includes("ECONOMY")
  );
}

function isCombatProfile(block, profile) {
  if (isMerchantProfile(block, profile)) return false;
  const combatCapabilities = new Set([
    "TANK",
    "HEALER",
    "DPS",
    "AOE",
    "RANGED",
    "MELEE",
    "SUPPORT",
  ]);
  return capabilities(profile).some((capability) =>
    combatCapabilities.has(capability),
  );
}

function farmSignal(block, profile) {
  const runtime = record(block?.farm_intelligence_runtime);
  const selected = record(runtime.selected);
  const profileTraining = record(profile?.training);
  const score =
    finite(selected.score) ??
    finite(profileTraining.score) ??
    finite(selected.components?.observedPerformance) ??
    0;

  return {
    state: text(runtime.state) || text(profileTraining.state) || "UNKNOWN",
    score,
    farmKey: text(selected.farmKey) || text(profileTraining.farmKey),
    monster: text(selected.monster) || text(profileTraining.monster),
    map: text(selected.map) || text(profileTraining.map),
  };
}

function economySignal(block) {
  const runtime = record(block?.economy_arbiter_runtime);
  const selected = record(runtime.selected);
  return {
    state: text(runtime.state) || "UNKNOWN",
    lane: text(selected.lane),
    reason: text(selected.reason) || text(runtime.reason),
    active: ["READY", "BLOCKED", "UNKNOWN"].includes(text(runtime.state)),
  };
}

function encounterSignal(block) {
  const explicit = record(block?.encounter_runtime);
  const combat = record(block?.combat_runtime);
  const group = record(block?.group_combat_runtime);
  const target =
    text(explicit.target) ||
    text(explicit.targetId) ||
    text(combat.target) ||
    text(combat.targetId) ||
    text(group.target) ||
    text(group.targetId);
  const state =
    text(explicit.state) ||
    text(combat.state) ||
    text(group.state) ||
    "UNKNOWN";
  const connected = block?.connected === true;
  return {
    state,
    target,
    active:
      connected &&
      (explicit.active === true ||
        target !== null ||
        ["COMBAT", "ENGAGED", "ACTIVE"].includes(state)),
  };
}

function candidatePriority(block, profile) {
  const farm = farmSignal(block, profile);
  const encounter = encounterSignal(block);
  const current = desiredState(block);
  return {
    encounter: encounter.active ? 1 : 0,
    continuity:
      current === DESIRED_RUNTIME_STATES.RUNNING ||
      current === DESIRED_RUNTIME_STATES.PAUSED
        ? 1
        : 0,
    farm: farm.score,
    level: finite(profile?.level) ?? 0,
  };
}

function compareCandidates(left, right) {
  for (const key of ["encounter", "continuity", "farm", "level"]) {
    const delta = Number(right.priority[key]) - Number(left.priority[key]);
    if (delta !== 0) return delta;
  }
  return left.name.localeCompare(right.name);
}

function recommendationFor(
  name,
  block,
  profile,
  { selected, reason, role, priority = null } = {},
) {
  const currentDesiredState = desiredState(block);
  const source = desiredStateSource(block);
  const protectedStop = manualStopProtected(block);
  return {
    name,
    role,
    class: characterClass(block, profile),
    capabilities: capabilities(profile),
    currentDesiredState,
    desiredStateSource: source,
    recommendedDesiredState: selected
      ? DESIRED_RUNTIME_STATES.RUNNING
      : DESIRED_RUNTIME_STATES.STOPPED,
    selected: selected === true,
    manualStopProtected: protectedStop,
    reason,
    priority,
    signals: {
      lifecycle: {
        state: text(block?.lifecycle_state) || "STOPPED",
        connected: block?.connected === true,
        enabled: block?.enabled === true,
      },
      farming: farmSignal(block, profile),
      economy: economySignal(block),
      encounter: encounterSignal(block),
    },
  };
}

function buildFullAutonomyPlan(
  characterManage = {},
  {
    accountStrategy = null,
    merchantLogistics = null,
    maxOnlineCharacters = 4,
    now = Date.now,
  } = {},
) {
  const manage = record(characterManage);
  const strategy = record(accountStrategy);
  const entries = Object.entries(manage)
    .filter(([, block]) => block?.account_owned === true)
    .map(([name, block]) => ({
      name,
      block,
      profile: profileForName(strategy, name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const boundedMaxOnline = Math.max(
    1,
    Math.min(4, Math.trunc(Number(maxOnlineCharacters) || 4)),
  );
  const merchantSlots = boundedMaxOnline > 0 ? 1 : 0;
  const combatSlots = Math.min(
    3,
    Math.max(0, boundedMaxOnline - merchantSlots),
  );

  const merchants = entries
    .filter((entry) => isMerchantProfile(entry.block, entry.profile))
    .filter((entry) => !manualStopProtected(entry.block))
    .map((entry) => ({
      ...entry,
      priority: candidatePriority(entry.block, entry.profile),
    }))
    .sort(compareCandidates);

  const combat = entries
    .filter((entry) => isCombatProfile(entry.block, entry.profile))
    .filter((entry) => !manualStopProtected(entry.block))
    .map((entry) => ({
      ...entry,
      priority: candidatePriority(entry.block, entry.profile),
    }))
    .sort(compareCandidates);

  const selectedMerchant = merchants.slice(0, merchantSlots);
  const selectedCombat = combat.slice(0, combatSlots);
  const selectedNames = new Set(
    [...selectedMerchant, ...selectedCombat].map((entry) => entry.name),
  );

  const recommendations = entries.map((entry) => {
    const protectedStop = manualStopProtected(entry.block);
    const merchant = isMerchantProfile(entry.block, entry.profile);
    const selected = selectedNames.has(entry.name);
    const priority = candidatePriority(entry.block, entry.profile);
    let reason;

    if (protectedStop) {
      reason = "MANUAL_STOP_PRECEDENCE";
    } else if (selected && merchant) {
      reason = "MERCHANT_INDEPENDENT_SLOT";
    } else if (selected && priority.encounter) {
      reason = "ACTIVE_ENCOUNTER_CONTINUITY";
    } else if (selected && priority.continuity) {
      reason = "ACTIVE_COMBAT_CONTINUITY";
    } else if (selected) {
      reason = "FARM_CANDIDATE_SELECTED";
    } else if (merchant) {
      reason = "MERCHANT_SLOT_NOT_SELECTED";
    } else if (isCombatProfile(entry.block, entry.profile)) {
      reason = "COMBAT_SLOT_NOT_SELECTED";
    } else {
      reason = "NO_AUTONOMY_ROLE";
    }

    return recommendationFor(entry.name, entry.block, entry.profile, {
      selected,
      reason,
      role: merchant ? "MERCHANT" : "COMBAT",
      priority,
    });
  });

  const strategyState = text(strategy.state);
  let state = FULL_AUTONOMY_STATES.PARTIAL;
  if (entries.length === 0) {
    state = FULL_AUTONOMY_STATES.EMPTY;
  } else if (strategyState === "READY") {
    state = FULL_AUTONOMY_STATES.READY;
  }
  const selected = recommendations.filter((entry) => entry.selected);
  const protectedStops = recommendations.filter(
    (entry) => entry.manualStopProtected,
  );
  const farmSignals = recommendations.filter(
    (entry) => entry.signals.farming.state !== "UNKNOWN",
  );
  const economySignals = recommendations.filter(
    (entry) => entry.signals.economy.state !== "UNKNOWN",
  );
  const encounterSignals = recommendations.filter(
    (entry) => entry.signals.encounter.active,
  );
  const logistics = record(merchantLogistics);

  let reason = "FULL_AUTONOMY_ACCOUNT_STRATEGY_PARTIAL";
  if (state === FULL_AUTONOMY_STATES.READY) {
    reason = "FULL_AUTONOMY_RECONCILIATION_READY";
  } else if (state === FULL_AUTONOMY_STATES.EMPTY) {
    reason = "FULL_AUTONOMY_NO_ACCOUNT_CHARACTERS";
  }

  return {
    timestamp: finite(now()) ?? Date.now(),
    state,
    reason,
    readOnly: true,
    executionEnabled: false,
    desiredStateMutationDispatched: false,
    merchantIndependent: true,
    maxOnlineCharacters: boundedMaxOnline,
    combatSlots,
    recommendations,
    summary: {
      accountOwnedCharacters: entries.length,
      selectedCharacters: selected.length,
      selectedMerchant: selected.filter((entry) => entry.role === "MERCHANT")
        .length,
      selectedCombat: selected.filter((entry) => entry.role === "COMBAT")
        .length,
      manualStopProtected: protectedStops.length,
      farmSignals: farmSignals.length,
      economySignals: economySignals.length,
      encounterSignals: encounterSignals.length,
      merchantClaims: Array.isArray(logistics.claims)
        ? logistics.claims.length
        : 0,
    },
    policy: {
      manualStoppedNeverOverridden: true,
      maxFourCharacters: true,
      merchantIndependent: true,
      combatPartyTarget: 3,
      stableSelectionPreferred: true,
      activeEncounterPreferred: true,
      unknownSignalsAreNeutral: true,
    },
  };
}

module.exports = {
  FULL_AUTONOMY_STATES,
  buildFullAutonomyPlan,
  candidatePriority,
  compareCandidates,
  desiredState,
  desiredStateSource,
  economySignal,
  encounterSignal,
  farmSignal,
  isCombatProfile,
  isMerchantProfile,
  manualStopProtected,
};

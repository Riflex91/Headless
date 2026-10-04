"use strict";

const EXPECTED_ACCOUNT_CHARACTERS = 8;
const HISTORY_LIMIT = 10;
const CAPABILITY_ORDER = Object.freeze([
  "TANK",
  "HEALER",
  "DPS",
  "AOE",
  "RANGED",
  "MELEE",
  "SUPPORT",
  "ECONOMY",
  "LOGISTICS",
]);
const CLASS_CAPABILITIES = Object.freeze({
  warrior: Object.freeze(["TANK", "DPS", "AOE", "MELEE"]),
  priest: Object.freeze(["HEALER", "RANGED", "SUPPORT"]),
  ranger: Object.freeze(["DPS", "AOE", "RANGED"]),
  mage: Object.freeze(["DPS", "AOE", "RANGED", "SUPPORT"]),
  rogue: Object.freeze(["DPS", "MELEE"]),
  merchant: Object.freeze(["SUPPORT", "ECONOMY", "LOGISTICS"]),
  paladin: Object.freeze(["TANK", "HEALER", "DPS", "MELEE", "SUPPORT"]),
});
const STAT_KEYS = Object.freeze([
  "hp",
  "max_hp",
  "mp",
  "max_mp",
  "xp",
  "max_xp",
  "attack",
  "frequency",
  "speed",
  "armor",
  "resistance",
  "range",
  "str",
  "dex",
  "int",
  "vit",
  "crit",
  "evasion",
  "reflection",
  "lifesteal",
  "manasteal",
  "apiercing",
  "rpiercing",
]);

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

function capabilitiesForClass(characterClass) {
  const normalized = text(characterClass)?.toLowerCase() || "";
  const capabilities = CLASS_CAPABILITIES[normalized] || [];
  return CAPABILITY_ORDER.filter((capability) => capabilities.includes(capability));
}

function strategyStats(liveState) {
  const live = record(liveState);
  return Object.fromEntries(
    STAT_KEYS.map((key) => [key, finite(live[key])]).filter(
      ([, value]) => value !== null,
    ),
  );
}

function gearProjection(block) {
  const live = record(block?.live_state);
  const scoring = record(block?.gear_scoring_runtime);
  const future = record(block?.future_gear_runtime);
  const reservation = record(block?.account_gear_reservation_runtime);

  return {
    equipment: clone(record(live.slots), {}),
    scoringState: text(scoring.state),
    scoringTimestamp: finite(scoring.timestamp),
    futureGearState: text(future.state),
    sourceReservations: Array.isArray(reservation.sourceReservations)
      ? clone(reservation.sourceReservations, [])
      : [],
    targetReservations: Array.isArray(reservation.targetReservations)
      ? clone(reservation.targetReservations, [])
      : [],
  };
}

function trainingProjection(block) {
  const farm = record(block?.farm_intelligence_runtime);
  const selected = record(farm.selected);
  const farmKey = text(selected.farmKey);

  return {
    state: text(farm.state) || "UNKNOWN",
    active: block?.connected === true && farmKey !== null,
    farmKey,
    monster: text(selected.monster),
    map: text(selected.map),
    score: finite(selected.score),
  };
}

function historyProjection(block) {
  const history = Array.isArray(block?.account_strategy_history)
    ? block.account_strategy_history
    : [];

  return history.slice(0, HISTORY_LIMIT).map((entry) => {
    const row = record(entry);
    return {
      farmKey: text(row.farm_key ?? row.farmKey),
      startedAt: finite(row.sample_started_at ?? row.startedAt),
      endedAt: finite(row.sample_ended_at ?? row.endedAt),
      stats: clone(record(row.stats), {}),
    };
  });
}

function profileForCharacter(name, block) {
  const live = record(block?.live_state);
  const characterClass =
    text(block?.account_character_type) || text(live.ctype);
  const level = finite(live.level);
  const gold = finite(live.gold);
  const map = text(live.map);
  const online = block?.connected === true;

  return {
    name,
    class: characterClass,
    level,
    gear: gearProjection(block),
    stats: strategyStats(live),
    capabilities: capabilitiesForClass(characterClass),
    training: trainingProjection(block),
    online,
    map,
    gold,
    history: historyProjection(block),
    realm: text(block?.realm),
    desiredRuntimeState: text(block?.desired_runtime_state),
    profileCompleteness: {
      class: characterClass !== null,
      level: level !== null,
      gear: Object.keys(record(live.slots)).length > 0,
      stats: Object.keys(strategyStats(live)).length > 0,
      training: text(record(block?.farm_intelligence_runtime).state) !== null,
      map: map !== null,
      gold: gold !== null,
      history: historyProjection(block).length > 0,
    },
  };
}

function buildAccountStrategy(characterManage, { now = Date.now } = {}) {
  const profiles = Object.entries(record(characterManage))
    .filter(([, block]) => block?.account_owned === true)
    .map(([name, block]) => profileForCharacter(name, block))
    .sort((left, right) => left.name.localeCompare(right.name));

  const capabilityCounts = Object.fromEntries(
    CAPABILITY_ORDER.map((capability) => [
      capability,
      profiles.filter((profile) => profile.capabilities.includes(capability))
        .length,
    ]),
  );
  const timestamp = finite(now()) ?? Date.now();
  const registered = profiles.length;
  const state =
    registered >= EXPECTED_ACCOUNT_CHARACTERS
      ? "READY"
      : registered > 0
        ? "PARTIAL"
        : "EMPTY";

  return {
    timestamp,
    state,
    reason:
      state === "READY"
        ? "ACCOUNT_STRATEGY_PROFILES_READY"
        : state === "PARTIAL"
          ? "ACCOUNT_STRATEGY_PROFILES_PARTIAL"
          : "ACCOUNT_STRATEGY_NO_ACCOUNT_CHARACTERS",
    readOnly: true,
    expectedCharacters: EXPECTED_ACCOUNT_CHARACTERS,
    profiles,
    summary: {
      accountOwnedCharacters: registered,
      onlineCharacters: profiles.filter((profile) => profile.online).length,
      liveLevelProfiles: profiles.filter((profile) => profile.level !== null)
        .length,
      historyProfiles: profiles.filter((profile) => profile.history.length > 0)
        .length,
      capabilities: capabilityCounts,
    },
  };
}

module.exports = {
  CAPABILITY_ORDER,
  CLASS_CAPABILITIES,
  EXPECTED_ACCOUNT_CHARACTERS,
  HISTORY_LIMIT,
  STAT_KEYS,
  buildAccountStrategy,
  capabilitiesForClass,
  gearProjection,
  historyProjection,
  profileForCharacter,
  strategyStats,
  trainingProjection,
};

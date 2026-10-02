"use strict";

const CHARACTER_CONFIG_SCHEMA_VERSION = 1;
const DYNAMIC_OBJECT_PATHS = new Set(["skills.enabled"]);

const CLASS_SKILL_DEFAULTS = {
  warrior: {
    cleave: true,
    warcry: true,
    charge: true,
    stomp: true,
  },
  priest: {
    heal: true,
    partyheal: true,
    absorb: true,
    curse: true,
    revive: true,
  },
  ranger: {
    huntersmark: true,
    supershot: true,
    "3shot": true,
    "5shot": true,
  },
  mage: {
    burst: true,
    cburst: true,
    energize: true,
    blink: true,
  },
  rogue: {
    quickpunch: true,
    quickstab: true,
    invis: true,
    mentalburst: true,
  },
  paladin: {
    selfheal: true,
    purify: true,
    smash: true,
    mana: true,
  },
  merchant: {
    mluck: true,
    fishing: true,
    mining: true,
    mcourage: true,
    mfrenzy: true,
    massproduction: true,
    massproductionpp: true,
    massexchange: true,
    massexchangepp: true,
  },
};

function createDefaultCharacterConfig(ctype = null) {
  const normalizedType = String(ctype || "").toLowerCase();
  const config = {
    schema_version: CHARACTER_CONFIG_SCHEMA_VERSION,
    general: {
      bot_enabled: true,
      auto_reconnect: true,
      auto_respawn: true,
      default_role: "AUTO",
      preferred_server: "AUTO",
    },
    skills: {
      automatic_use: true,
      enabled: { ...(CLASS_SKILL_DEFAULTS[normalizedType] || {}) },
      mp_reserve: 0,
      min_mp_after_skill: 0,
    },
    supply: {
      hp_potion: "hpot1",
      mp_potion: "mpot1",
      hp_target: 400,
      mp_target: 400,
      hp_reorder_below: 100,
      mp_reorder_below: 100,
      emergency_reserve: 20,
      merchant_delivery: true,
      fallback_self_procure: true,
      max_emergency_gold: 100000,
    },
    potions: {
      hp_use_below_pct: 70,
      critical_hp_pct: 30,
      mp_use_below_pct: 60,
      respect_skill_reserve: true,
    },
    combat: {
      enabled: normalizedType !== "merchant",
      auto_target: true,
      aggressive_pulls: false,
      max_targets: "AUTO",
      aoe: true,
      kiting: "AUTO",
      retreat: true,
      retreat_below_hp_pct: 30,
      avoid_dangerous_targets: true,
      avoid_kill_steal: true,
      consider_other_players: true,
    },
    farming: {
      enabled: normalizedType !== "merchant",
      target: "AUTO",
      preferred_monsters: [],
      forbidden_monsters: [],
      auto_spot: true,
      xp_weight: 1,
      gold_weight: 1,
      drop_weight: 1,
      catch_up: true,
    },
    party: {
      auto_join: normalizedType !== "merchant",
      prefer_account_party: true,
      group_focus: true,
      leader: "AUTO",
      formation: "AUTO",
      max_distance: "AUTO",
      auto_regroup: true,
      heal_below_pct: normalizedType === "priest" ? 75 : null,
    },
    inventory: {
      min_free_slots: 5,
      merchant_call_threshold: 8,
      auto_loot: true,
      keep_unknown: true,
      never_modify_locked: true,
      never_sell_event: true,
    },
    gear: {
      auto_optimize: true,
      auto_equip: true,
      future_gear: true,
      account_reservation: true,
      role: "AUTO",
    },
    safety: {
      auto_retreat: true,
      death_recovery: true,
      unknown_policy: "SUSPEND",
      max_deaths_per_10m: 3,
      connection_recovery: true,
    },
    advanced: {
      decision_tick_ms: "AUTO",
      movement_timeout_ms: "AUTO",
      action_timeout_ms: "AUTO",
      log_level: "INFO",
      diagnostic_detail: "NORMAL",
    },
  };

  if (normalizedType === "merchant") {
    config.merchant = {
      autonomy: {
        enabled: true,
        merrit: true,
        ponty: true,
        fishing: true,
        mining: true,
        giveaway_join_only: true,
        wishlist: true,
        merchant_stand: true,
        bank: true,
        exchange: true,
        craft: true,
        upgrade: true,
        compound: true,
      },
      farmer_service: {
        auto_supply: true,
        deliver_hp_potions: true,
        deliver_mp_potions: true,
        collect_items: true,
        collect_gold: true,
        mluck: true,
        gear_delivery: true,
        max_delivery_distance: "AUTO",
        farmer_priority: "AUTO",
      },
    };
  }

  return config;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeConfigError(code, message, statusCode = 400, path = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.path = path;
  return error;
}

function mergeConfigPatch(base, patch, path = "") {
  if (!isPlainObject(patch)) {
    throw makeConfigError(
      "INVALID_CONFIG_PATCH",
      "Character config patch must be an object",
      400,
      path || null,
    );
  }

  const result = cloneJson(base);

  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw makeConfigError(
        "INVALID_CONFIG_KEY",
        `Unsafe config key: ${key}`,
        400,
        path ? `${path}.${key}` : key,
      );
    }

    const nextPath = path ? `${path}.${key}` : key;
    const dynamicObject = DYNAMIC_OBJECT_PATHS.has(path);

    if (!dynamicObject && !Object.prototype.hasOwnProperty.call(base, key)) {
      throw makeConfigError(
        "UNKNOWN_CONFIG_KEY",
        `Unknown character config key: ${nextPath}`,
        400,
        nextPath,
      );
    }

    if (dynamicObject) {
      if (typeof value !== "boolean") {
        throw makeConfigError(
          "INVALID_CONFIG_VALUE",
          `Skill toggle must be boolean: ${nextPath}`,
          400,
          nextPath,
        );
      }
      result[key] = value;
      continue;
    }

    const baseValue = base[key];
    if (isPlainObject(baseValue)) {
      if (!isPlainObject(value)) {
        throw makeConfigError(
          "INVALID_CONFIG_VALUE",
          `Expected object at ${nextPath}`,
          400,
          nextPath,
        );
      }
      result[key] = mergeConfigPatch(baseValue, value, nextPath);
    } else {
      result[key] = cloneJson(value);
    }
  }

  return result;
}

function assertBoolean(config, path, value) {
  if (typeof value !== "boolean") {
    throw makeConfigError(
      "INVALID_CONFIG_VALUE",
      `Expected boolean at ${path}`,
      400,
      path,
    );
  }
}

function assertNumberRange(config, path, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw makeConfigError(
      "INVALID_CONFIG_VALUE",
      `Expected ${path} between ${min} and ${max}`,
      400,
      path,
    );
  }
}

function assertStringOrAuto(path, value, min, max) {
  if (value === "AUTO") return;
  assertNumberRange(null, path, value, min, max);
}

function assertOneOf(path, value, allowed) {
  if (!allowed.includes(value)) {
    throw makeConfigError(
      "INVALID_CONFIG_VALUE",
      `Expected ${path} to be one of: ${allowed.join(", ")}`,
      400,
      path,
    );
  }
}

function assertNonEmptyString(path, value) {
  if (typeof value !== "string" || !value.trim()) {
    throw makeConfigError(
      "INVALID_CONFIG_VALUE",
      `Expected non-empty string at ${path}`,
      400,
      path,
    );
  }
}

function assertStringArray(path, value) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw makeConfigError(
      "INVALID_CONFIG_VALUE",
      `Expected string array at ${path}`,
      400,
      path,
    );
  }
}

function validateCharacterConfig(config, ctype = null) {
  if (!isPlainObject(config)) {
    throw makeConfigError(
      "INVALID_CONFIG",
      "Character config must be an object",
    );
  }

  if (config.schema_version !== CHARACTER_CONFIG_SCHEMA_VERSION) {
    throw makeConfigError(
      "CONFIG_SCHEMA_MISMATCH",
      `Unsupported character config schema: ${config.schema_version}`,
      409,
      "schema_version",
    );
  }

  const booleanPaths = [
    ["general.bot_enabled", config.general.bot_enabled],
    ["general.auto_reconnect", config.general.auto_reconnect],
    ["general.auto_respawn", config.general.auto_respawn],
    ["skills.automatic_use", config.skills.automatic_use],
    ["supply.merchant_delivery", config.supply.merchant_delivery],
    ["supply.fallback_self_procure", config.supply.fallback_self_procure],
    ["potions.respect_skill_reserve", config.potions.respect_skill_reserve],
    ["combat.enabled", config.combat.enabled],
    ["combat.auto_target", config.combat.auto_target],
    ["combat.aggressive_pulls", config.combat.aggressive_pulls],
    ["combat.aoe", config.combat.aoe],
    ["combat.retreat", config.combat.retreat],
    ["combat.avoid_dangerous_targets", config.combat.avoid_dangerous_targets],
    ["combat.avoid_kill_steal", config.combat.avoid_kill_steal],
    ["combat.consider_other_players", config.combat.consider_other_players],
    ["farming.enabled", config.farming.enabled],
    ["farming.auto_spot", config.farming.auto_spot],
    ["farming.catch_up", config.farming.catch_up],
    ["party.auto_join", config.party.auto_join],
    ["party.prefer_account_party", config.party.prefer_account_party],
    ["party.group_focus", config.party.group_focus],
    ["party.auto_regroup", config.party.auto_regroup],
    ["inventory.auto_loot", config.inventory.auto_loot],
    ["inventory.keep_unknown", config.inventory.keep_unknown],
    ["inventory.never_modify_locked", config.inventory.never_modify_locked],
    ["inventory.never_sell_event", config.inventory.never_sell_event],
    ["gear.auto_optimize", config.gear.auto_optimize],
    ["gear.auto_equip", config.gear.auto_equip],
    ["gear.future_gear", config.gear.future_gear],
    ["gear.account_reservation", config.gear.account_reservation],
    ["safety.auto_retreat", config.safety.auto_retreat],
    ["safety.death_recovery", config.safety.death_recovery],
    ["safety.connection_recovery", config.safety.connection_recovery],
  ];
  for (const [path, value] of booleanPaths) {
    assertBoolean(config, path, value);
  }

  for (const [skill, enabled] of Object.entries(config.skills.enabled)) {
    assertBoolean(config, `skills.enabled.${skill}`, enabled);
  }

  assertOneOf("general.default_role", config.general.default_role, [
    "AUTO",
    "FARMER",
    "BOSS",
    "EVENT",
    "SUPPORT",
    "MERCHANT",
    "LOGISTICS",
    "TRAINING",
  ]);
  assertNonEmptyString("general.preferred_server", config.general.preferred_server);
  assertNonEmptyString("supply.hp_potion", config.supply.hp_potion);
  assertNonEmptyString("supply.mp_potion", config.supply.mp_potion);
  assertOneOf("combat.kiting", config.combat.kiting, [
    "AUTO",
    true,
    false,
  ]);
  assertNonEmptyString("farming.target", config.farming.target);
  assertStringArray(
    "farming.preferred_monsters",
    config.farming.preferred_monsters,
  );
  assertStringArray(
    "farming.forbidden_monsters",
    config.farming.forbidden_monsters,
  );
  assertNonEmptyString("party.leader", config.party.leader);
  assertNonEmptyString("party.formation", config.party.formation);
  assertOneOf("gear.role", config.gear.role, [
    "AUTO",
    "FARMER",
    "BOSS",
    "EVENT",
    "SUPPORT",
    "MERCHANT",
    "LOGISTICS",
    "TRAINING",
  ]);
  assertOneOf("safety.unknown_policy", config.safety.unknown_policy, [
    "SUSPEND",
  ]);
  assertOneOf("advanced.log_level", config.advanced.log_level, [
    "ERROR",
    "WARN",
    "INFO",
    "DEBUG",
  ]);
  assertOneOf(
    "advanced.diagnostic_detail",
    config.advanced.diagnostic_detail,
    ["MINIMAL", "NORMAL", "VERBOSE"],
  );

  const percentages = [
    ["potions.hp_use_below_pct", config.potions.hp_use_below_pct],
    ["potions.critical_hp_pct", config.potions.critical_hp_pct],
    ["potions.mp_use_below_pct", config.potions.mp_use_below_pct],
    ["combat.retreat_below_hp_pct", config.combat.retreat_below_hp_pct],
  ];
  if (config.party.heal_below_pct !== null) {
    percentages.push(["party.heal_below_pct", config.party.heal_below_pct]);
  }
  for (const [path, value] of percentages) {
    assertNumberRange(config, path, value, 0, 100);
  }

  const counts = [
    ["skills.mp_reserve", config.skills.mp_reserve, 0, 100000],
    ["skills.min_mp_after_skill", config.skills.min_mp_after_skill, 0, 100000],
    ["supply.hp_target", config.supply.hp_target, 0, 10000],
    ["supply.mp_target", config.supply.mp_target, 0, 10000],
    ["supply.hp_reorder_below", config.supply.hp_reorder_below, 0, 10000],
    ["supply.mp_reorder_below", config.supply.mp_reorder_below, 0, 10000],
    ["supply.emergency_reserve", config.supply.emergency_reserve, 0, 10000],
    ["supply.max_emergency_gold", config.supply.max_emergency_gold, 0, 1000000000],
    ["inventory.min_free_slots", config.inventory.min_free_slots, 0, 100],
    ["inventory.merchant_call_threshold", config.inventory.merchant_call_threshold, 0, 100],
    ["safety.max_deaths_per_10m", config.safety.max_deaths_per_10m, 0, 100],
  ];
  for (const [path, value, min, max] of counts) {
    assertNumberRange(config, path, value, min, max);
  }

  for (const [path, value] of [
    ["farming.xp_weight", config.farming.xp_weight],
    ["farming.gold_weight", config.farming.gold_weight],
    ["farming.drop_weight", config.farming.drop_weight],
  ]) {
    assertNumberRange(config, path, value, 0, 100);
  }

  assertStringOrAuto("combat.max_targets", config.combat.max_targets, 1, 100);
  assertStringOrAuto("party.max_distance", config.party.max_distance, 0, 100000);
  assertStringOrAuto("advanced.decision_tick_ms", config.advanced.decision_tick_ms, 25, 60000);
  assertStringOrAuto("advanced.movement_timeout_ms", config.advanced.movement_timeout_ms, 100, 600000);
  assertStringOrAuto("advanced.action_timeout_ms", config.advanced.action_timeout_ms, 100, 600000);

  if (String(ctype || "").toLowerCase() === "merchant") {
    if (!config.merchant) {
      throw makeConfigError(
        "INVALID_CONFIG_VALUE",
        "Merchant config section is required",
        400,
        "merchant",
      );
    }
    for (const [sectionName, section] of Object.entries(config.merchant)) {
      for (const [key, value] of Object.entries(section)) {
        if (
          ["max_delivery_distance", "farmer_priority"].includes(key) &&
          value === "AUTO"
        ) {
          continue;
        }
        assertBoolean(config, `merchant.${sectionName}.${key}`, value);
      }
    }
  }

  return config;
}

class CharacterConfigService {
  constructor({ persistence }) {
    if (!persistence) {
      throw new Error("CharacterConfigService requires persistence");
    }
    this.persistence = persistence;
    this.cache = new Map();
  }

  async ensure(characterName, ctype = null) {
    const name = String(characterName);
    if (this.cache.has(name)) {
      return cloneJson(this.cache.get(name));
    }

    const stored = this.persistence.getCharacterConfig(name);
    if (stored) {
      validateCharacterConfig(stored.config, ctype);
      const entry = {
        revision: stored.revision,
        config: stored.config,
        updated_at: stored.updated_at,
      };
      this.cache.set(name, entry);
      return cloneJson(entry);
    }

    const config = createDefaultCharacterConfig(ctype);
    validateCharacterConfig(config, ctype);
    await this.persistence.saveCharacterConfig(name, 1, config);
    const entry = {
      revision: 1,
      config,
      updated_at: Date.now(),
    };
    this.cache.set(name, entry);
    return cloneJson(entry);
  }

  async update(
    characterName,
    ctype,
    patch,
    { expectedRevision } = {},
  ) {
    const name = String(characterName);
    const current = await this.ensure(name, ctype);

    if (
      expectedRevision !== undefined &&
      expectedRevision !== null &&
      Number(expectedRevision) !== current.revision
    ) {
      throw makeConfigError(
        "CONFIG_REVISION_CONFLICT",
        `Expected revision ${expectedRevision}, current revision is ${current.revision}`,
        409,
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(patch || {}, "schema_version") &&
      patch.schema_version !== CHARACTER_CONFIG_SCHEMA_VERSION
    ) {
      throw makeConfigError(
        "CONFIG_SCHEMA_IMMUTABLE",
        "schema_version cannot be changed",
        400,
        "schema_version",
      );
    }

    const nextConfig = mergeConfigPatch(current.config, patch);
    validateCharacterConfig(nextConfig, ctype);
    const nextRevision = current.revision + 1;

    await this.persistence.saveCharacterConfig(
      name,
      nextRevision,
      nextConfig,
    );

    const entry = {
      revision: nextRevision,
      config: nextConfig,
      updated_at: Date.now(),
    };
    this.cache.set(name, entry);
    return cloneJson(entry);
  }

  getCached(characterName) {
    const entry = this.cache.get(String(characterName));
    return entry ? cloneJson(entry) : null;
  }
}

module.exports = {
  CHARACTER_CONFIG_SCHEMA_VERSION,
  CLASS_SKILL_DEFAULTS,
  CharacterConfigService,
  createDefaultCharacterConfig,
  makeConfigError,
  mergeConfigPatch,
  validateCharacterConfig,
};

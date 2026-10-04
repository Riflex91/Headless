"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  EXPECTED_ACCOUNT_CHARACTERS,
  buildAccountStrategy,
  capabilitiesForClass,
  profileForCharacter,
} = require("../src/AccountStrategy");

const ROSTER = [
  ["My_Ranger1", "ranger"],
  ["My_Ranger2", "ranger"],
  ["My_Ranger3", "ranger"],
  ["My_Merchant", "merchant"],
  ["My_Mage", "mage"],
  ["My_Priest", "priest"],
  ["My_Warrior", "warrior"],
  ["My_Rogue", "rogue"],
];

function characterBlock(type, overrides = {}) {
  return {
    account_owned: true,
    account_character_type: type,
    connected: false,
    desired_runtime_state: "STOPPED",
    realm: "EUII",
    live_state: null,
    account_strategy_history: [],
    ...overrides,
  };
}

test("Phase 17 account strategy projects all eight registered account characters", () => {
  const characterManage = Object.fromEntries(
    ROSTER.map(([name, type]) => [name, characterBlock(type)]),
  );

  const strategy = buildAccountStrategy(characterManage, {
    now: () => 123456,
  });

  assert.equal(EXPECTED_ACCOUNT_CHARACTERS, 8);
  assert.equal(strategy.timestamp, 123456);
  assert.equal(strategy.state, "READY");
  assert.equal(strategy.reason, "ACCOUNT_STRATEGY_PROFILES_READY");
  assert.equal(strategy.readOnly, true);
  assert.equal(strategy.profiles.length, 8);
  assert.equal(strategy.summary.accountOwnedCharacters, 8);
  assert.equal(strategy.summary.onlineCharacters, 0);
  assert.deepEqual(
    strategy.profiles.map((profile) => profile.name),
    ROSTER.map(([name]) => name).sort(),
  );
});

test("Phase 17 capabilities follow account roles deterministically", () => {
  assert.deepEqual(capabilitiesForClass("warrior"), [
    "TANK",
    "DPS",
    "AOE",
    "MELEE",
  ]);
  assert.deepEqual(capabilitiesForClass("priest"), [
    "HEALER",
    "RANGED",
    "SUPPORT",
  ]);
  assert.deepEqual(capabilitiesForClass("merchant"), [
    "SUPPORT",
    "ECONOMY",
    "LOGISTICS",
  ]);
  assert.deepEqual(capabilitiesForClass("unknown"), []);

  const strategy = buildAccountStrategy({
    Warrior: characterBlock("warrior"),
    Priest: characterBlock("priest"),
    Merchant: characterBlock("merchant"),
  });

  assert.equal(strategy.summary.capabilities.TANK, 1);
  assert.equal(strategy.summary.capabilities.HEALER, 1);
  assert.equal(strategy.summary.capabilities.ECONOMY, 1);
  assert.equal(strategy.summary.capabilities.LOGISTICS, 1);
  assert.equal(strategy.summary.capabilities.DPS, 1);
});

test("Phase 17 live profile includes level gear stats training map gold and history", () => {
  const profile = profileForCharacter(
    "My_Ranger1",
    characterBlock("ranger", {
      connected: true,
      desired_runtime_state: "RUNNING",
      live_state: {
        ctype: "ranger",
        level: 77,
        gold: 1234567,
        map: "main",
        hp: 900,
        max_hp: 1000,
        mp: 400,
        max_mp: 500,
        attack: 812,
        armor: 321,
        resistance: 222,
        range: 160,
        dex: 145,
        slots: {
          mainhand: { name: "bow", level: 8 },
        },
      },
      gear_scoring_runtime: {
        state: "READY",
        timestamp: 5000,
      },
      future_gear_runtime: {
        state: "READY",
      },
      farm_intelligence_runtime: {
        state: "READY",
        selected: {
          farmKey: "bee@main:0",
          monster: "bee",
          map: "main",
          score: 0.75,
        },
      },
      account_strategy_history: [
        {
          farm_key: "bee@main:0",
          sample_started_at: 1000,
          sample_ended_at: 2000,
          stats: {
            xpPerHour: 100000,
            goldPerHour: 50000,
          },
        },
      ],
    }),
  );

  assert.equal(profile.class, "ranger");
  assert.equal(profile.level, 77);
  assert.equal(profile.online, true);
  assert.equal(profile.map, "main");
  assert.equal(profile.gold, 1234567);
  assert.deepEqual(profile.gear.equipment.mainhand, {
    name: "bow",
    level: 8,
  });
  assert.equal(profile.stats.attack, 812);
  assert.equal(profile.stats.armor, 321);
  assert.equal(profile.stats.dex, 145);
  assert.equal(profile.training.active, true);
  assert.equal(profile.training.farmKey, "bee@main:0");
  assert.equal(profile.training.monster, "bee");
  assert.equal(profile.history.length, 1);
  assert.equal(profile.history[0].farmKey, "bee@main:0");
  assert.equal(profile.profileCompleteness.history, true);
});

test("Phase 17 retains offline account profiles without inventing live values", () => {
  const profile = profileForCharacter(
    "My_Mage",
    characterBlock("mage", {
      connected: false,
      live_state: null,
    }),
  );

  assert.equal(profile.class, "mage");
  assert.equal(profile.online, false);
  assert.equal(profile.level, null);
  assert.equal(profile.map, null);
  assert.equal(profile.gold, null);
  assert.deepEqual(profile.stats, {});
  assert.deepEqual(profile.gear.equipment, {});
  assert.equal(profile.training.active, false);
});

test("Phase 17 reports PARTIAL until all eight account characters are registered", () => {
  const strategy = buildAccountStrategy({
    One: characterBlock("ranger"),
    Two: characterBlock("merchant"),
  });

  assert.equal(strategy.state, "PARTIAL");
  assert.equal(strategy.reason, "ACCOUNT_STRATEGY_PROFILES_PARTIAL");
  assert.equal(strategy.summary.accountOwnedCharacters, 2);
});

test("Phase 17 account strategy is wired into supervisor state and persisted history cache", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const monitoring = fs.readFileSync(
    path.join(__dirname, "..", "monitoring_util.js"),
    "utf8",
  );

  assert.match(coordinator, /buildAccountStrategy/);
  assert.match(
    coordinator,
    /getAccountStrategyState:\s*account_strategy_state/,
  );
  assert.match(coordinator, /persistence\.listFarmStatistics\(/);
  assert.match(coordinator, /account_strategy_history/);
  assert.match(dashboard, /account_strategy:\s*accountStrategyState/);
  assert.match(dashboard, /getAccountStrategyState\?\.\(\)/);
  assert.match(monitoring, /"attack"/);
  assert.match(monitoring, /"armor"/);
  assert.match(monitoring, /"resistance"/);
  assert.match(monitoring, /"range"/);
});

test("Account Strategy foundation is read-only and has no action/control dependency", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "AccountStrategy.js"),
    "utf8",
  );

  assert.match(source, /readOnly: true/);
  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /socket\.emit/);
  assert.doesNotMatch(source, /pontyBuy/);
  assert.doesNotMatch(source, /tradeList/);
});

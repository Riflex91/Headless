"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFullAutonomyPlan,
  manualStopProtected,
} = require("../src/FullAutonomy");

const ROSTER = [
  ["My_Merchant", "merchant", ["SUPPORT", "ECONOMY", "LOGISTICS"]],
  ["My_Warrior", "warrior", ["TANK", "DPS", "AOE", "MELEE"]],
  ["My_Priest", "priest", ["HEALER", "RANGED", "SUPPORT"]],
  ["My_Ranger1", "ranger", ["DPS", "AOE", "RANGED"]],
  ["My_Ranger2", "ranger", ["DPS", "AOE", "RANGED"]],
  ["My_Ranger3", "ranger", ["DPS", "AOE", "RANGED"]],
  ["My_Mage", "mage", ["DPS", "AOE", "RANGED", "SUPPORT"]],
  ["My_Rogue", "rogue", ["DPS", "MELEE"]],
];

function profile(name, characterClass, capabilities, score = 0) {
  return {
    name,
    class: characterClass,
    level: 80,
    capabilities,
    training: {
      state: "READY",
      active: false,
      farmKey: name + "-farm",
      monster: "bee",
      map: "main",
      score,
    },
  };
}

function setup({
  running = ["My_Merchant", "My_Warrior", "My_Priest", "My_Ranger1"],
  farmScores = {},
  manualStopped = [],
  encounters = [],
} = {}) {
  const characterManage = {};
  const profiles = [];

  for (const [name, characterClass, capabilities] of ROSTER) {
    const desired = running.includes(name) ? "RUNNING" : "STOPPED";
    characterManage[name] = {
      account_owned: true,
      account_character_type: characterClass,
      enabled: desired !== "STOPPED",
      connected: desired !== "STOPPED",
      lifecycle_state: desired !== "STOPPED" ? "ONLINE" : "STOPPED",
      desired_runtime_state: desired,
      desired_runtime_state_source: manualStopped.includes(name)
        ? "MANUAL_STOP"
        : "CONFIG",
      farm_intelligence_runtime: {
        state: "READY",
        selected: {
          farmKey: name + "-farm",
          monster: "bee",
          map: "main",
          score: farmScores[name] ?? 0,
        },
      },
      economy_arbiter_runtime:
        characterClass === "merchant"
          ? {
              state: "READY",
              selected: {
                lane: "ECONOMY",
                reason: "ECONOMY_READY",
              },
            }
          : null,
      combat_runtime: encounters.includes(name)
        ? {
            state: "COMBAT",
            target: "target-" + name,
          }
        : {
            state: "IDLE",
            target: null,
          },
    };
    profiles.push(
      profile(name, characterClass, capabilities, farmScores[name] ?? 0),
    );
  }

  return {
    characterManage,
    accountStrategy: {
      state: "READY",
      reason: "ACCOUNT_STRATEGY_PROFILES_READY",
      profiles,
    },
    merchantLogistics: {
      merchantIndependent: true,
      claims: [{ id: "claim-1", status: "READY" }],
    },
  };
}

test("Full Autonomy selects one independent merchant plus three combat characters", () => {
  const source = setup({
    farmScores: {
      My_Warrior: 0.9,
      My_Priest: 0.8,
      My_Ranger1: 0.7,
      My_Ranger2: 0.6,
    },
  });

  const plan = buildFullAutonomyPlan(source.characterManage, {
    accountStrategy: source.accountStrategy,
    merchantLogistics: source.merchantLogistics,
    maxOnlineCharacters: 4,
    now: () => 1000,
  });

  assert.equal(plan.state, "READY");
  assert.equal(plan.readOnly, true);
  assert.equal(plan.executionEnabled, false);
  assert.equal(plan.desiredStateMutationDispatched, false);
  assert.equal(plan.merchantIndependent, true);
  assert.equal(plan.maxOnlineCharacters, 4);
  assert.equal(plan.combatSlots, 3);
  assert.deepEqual(
    plan.recommendations
      .filter((entry) => entry.selected)
      .map((entry) => entry.name)
      .sort(),
    ["My_Merchant", "My_Priest", "My_Ranger1", "My_Warrior"].sort(),
  );
  assert.equal(plan.summary.selectedMerchant, 1);
  assert.equal(plan.summary.selectedCombat, 3);
  assert.equal(plan.summary.merchantClaims, 1);
});

test("Full Autonomy never recommends a manually stopped character", () => {
  const source = setup({
    running: ["My_Merchant", "My_Priest", "My_Ranger1"],
    manualStopped: ["My_Warrior"],
    farmScores: {
      My_Warrior: 99,
      My_Priest: 0.8,
      My_Ranger1: 0.7,
      My_Ranger2: 0.6,
    },
  });

  source.characterManage.My_Warrior.enabled = false;
  source.characterManage.My_Warrior.desired_runtime_state = "STOPPED";

  const plan = buildFullAutonomyPlan(source.characterManage, {
    accountStrategy: source.accountStrategy,
    merchantLogistics: source.merchantLogistics,
  });
  const warrior = plan.recommendations.find(
    (entry) => entry.name === "My_Warrior",
  );

  const warriorBlock = source.characterManage.My_Warrior;
  assert.equal(manualStopProtected(warriorBlock), true);
  assert.equal(warrior.manualStopProtected, true);
  assert.equal(warrior.selected, false);
  assert.equal(warrior.recommendedDesiredState, "STOPPED");
  assert.equal(warrior.reason, "MANUAL_STOP_PRECEDENCE");
  assert.equal(plan.summary.manualStopProtected, 1);
  assert.equal(
    plan.recommendations.some(
      (entry) => entry.name === "My_Ranger2" && entry.selected,
    ),
    true,
  );
});

test("Merchant selection is independent of combat farm readiness", () => {
  const source = setup({
    running: [],
    farmScores: {},
  });

  for (const [name, block] of Object.entries(source.characterManage)) {
    block.enabled = false;
    block.connected = false;
    block.lifecycle_state = "STOPPED";
    block.desired_runtime_state = "STOPPED";
    block.desired_runtime_state_source = "CONFIG";
    if (name !== "My_Merchant") {
      block.farm_intelligence_runtime = {
        state: "UNKNOWN",
        selected: null,
      };
    }
  }

  const plan = buildFullAutonomyPlan(source.characterManage, {
    accountStrategy: source.accountStrategy,
    merchantLogistics: source.merchantLogistics,
  });
  const merchant = plan.recommendations.find(
    (entry) => entry.name === "My_Merchant",
  );

  assert.equal(merchant.selected, true);
  assert.equal(merchant.reason, "MERCHANT_INDEPENDENT_SLOT");
  assert.equal(merchant.recommendedDesiredState, "RUNNING");
  assert.equal(plan.summary.selectedMerchant, 1);
});

test("Active encounter continuity outranks a higher farm score", () => {
  const source = setup({
    running: ["My_Merchant", "My_Warrior", "My_Priest", "My_Ranger1"],
    encounters: ["My_Ranger2"],
    farmScores: {
      My_Warrior: 10,
      My_Priest: 9,
      My_Ranger1: 8,
      My_Ranger2: 0.01,
    },
  });

  const ranger2 = source.characterManage.My_Ranger2;
  ranger2.enabled = false;
  ranger2.connected = false;
  ranger2.lifecycle_state = "STOPPED";
  ranger2.desired_runtime_state = "STOPPED";
  ranger2.desired_runtime_state_source = "CONFIG";

  const plan = buildFullAutonomyPlan(source.characterManage, {
    accountStrategy: source.accountStrategy,
    merchantLogistics: source.merchantLogistics,
  });

  const ranger2Recommendation = plan.recommendations.find(
    (entry) => entry.name === "My_Ranger2",
  );

  assert.equal(ranger2Recommendation.selected, true);
  assert.equal(ranger2Recommendation.reason, "ACTIVE_ENCOUNTER_CONTINUITY");
  assert.equal(plan.summary.encounterSignals, 1);
});

test("Full Autonomy stays PARTIAL when Account Strategy is not ready", () => {
  const source = setup();
  source.accountStrategy.state = "PARTIAL";

  const plan = buildFullAutonomyPlan(source.characterManage, {
    accountStrategy: source.accountStrategy,
  });

  assert.equal(plan.state, "PARTIAL");
  assert.equal(plan.reason, "FULL_AUTONOMY_ACCOUNT_STRATEGY_PARTIAL");
  assert.equal(plan.desiredStateMutationDispatched, false);
});

test("Persisted STOP without explicit source is protected conservatively", () => {
  const block = {
    enabled: false,
    desired_runtime_state: "STOPPED",
  };

  assert.equal(manualStopProtected(block), true);
});

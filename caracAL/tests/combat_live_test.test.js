"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", fileName),
  );
}

function action(id, status = "CONFIRMED") {
  return { id, status };
}

function makeSetup({ attackStatus = "CONFIRMED", visibleTarget = true } = {}) {
  const { CombatLiveTestRunner } = coreModule("combat-live-test.lib.ts");
  let now = 1000;
  let combatEnabled = false;
  let attackAction = null;
  let returned = false;
  const calls = [];
  const state = {
    character: {
      name: "My_Ranger1",
      ctype: "ranger",
      map: "main",
      x: 0,
      y: 0,
      hp: 900,
      maxHp: 1000,
      mp: 400,
      maxMp: 500,
      range: 120,
      gold: 0,
      target: null,
      rip: false,
      moving: false,
    },
    entities: visibleTarget
      ? [
          {
            id: "goo-1",
            type: "monster",
            name: null,
            mtype: "goo",
            map: "main",
            x: 80,
            y: 0,
            hp: 100,
            maxHp: 100,
            target: null,
            dead: false,
            rip: false,
          },
        ]
      : [],
  };

  const combat = {
    setConfigOverride(config) {
      combatEnabled = config?.combat?.enabled === true;
      calls.push(["config", combatEnabled]);
    },
    clearConfigOverride() {
      combatEnabled = false;
      calls.push(["config-clear"]);
    },
    status() {
      return {
        timestamp: now,
        state: combatEnabled ? "ATTACKING" : "DISABLED",
        reason: combatEnabled ? "ATTACK_DISPATCHED" : "COMBAT_DISABLED",
        enabled: combatEnabled,
        resources: {
          hp: state.character.hp,
          maxHp: state.character.maxHp,
          hpPercent: 90,
          mp: state.character.mp,
          maxMp: state.character.maxMp,
          mpPercent: 80,
          criticalHp: false,
        },
        target: combatEnabled
          ? {
              id: "goo-1",
              name: null,
              mtype: "goo",
              hp: 100,
              maxHp: 100,
              distance: 80,
              attackRange: 120,
              inRange: true,
            }
          : null,
        cooldowns: {
          attackRemainingMs: attackAction ? 500 : 0,
          hpPotionRemainingMs: 0,
          mpPotionRemainingMs: 0,
        },
        movement: {
          owner: null,
          mode: "IDLE",
          safePoint: null,
        },
        lastAction: attackAction,
      };
    },
    async tick() {
      if (combatEnabled && !attackAction) {
        attackAction = {
          id: "attack-1",
          status: attackStatus,
          kind: "ATTACK",
        };
      }
      return this.status();
    },
  };

  const movement = {
    status() {
      return {
        owner: null,
        mode: "IDLE",
        path: null,
        safePoint: null,
        stuck: {
          commandKey: null,
          stuck: false,
          stuckSince: null,
          lastProgressAt: null,
          lastPosition: null,
        },
        active: null,
      };
    },
    async cancel() {
      calls.push(["cancel"]);
      return action("cancel-1");
    },
    async smart(request) {
      calls.push(["smart", request.destination]);
      if (typeof request.destination === "string") {
        state.character.map = "main";
        state.character.x = 0;
        state.character.y = 0;
        state.entities = [
          {
            id: "goo-1",
            type: "monster",
            name: null,
            mtype: "goo",
            map: "main",
            x: 80,
            y: 0,
            hp: 100,
            maxHp: 100,
            target: null,
            dead: false,
            rip: false,
          },
        ];
      } else if (request.why === "COMBAT_LIVE_E2E_RETURN") {
        state.character.x = 0;
        state.character.y = 0;
        returned = true;
      }
      return action("smart-1");
    },
  };

  const runner = new CombatLiveTestRunner({
    combat,
    movement,
    character: () => ({ ...state.character }),
    entities: () => state.entities.map((entity) => ({ ...entity })),
    gameData: () => ({ monsters: { goo: { hp: 100 } } }),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  return {
    runner,
    calls,
    state,
    returned: () => returned,
  };
}

test("combat live runner confirms real combat flow without forced death", async () => {
  const setup = makeSetup();
  const result = await setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "COMBAT_LIVE_E2E_CONFIRMED");
  assert.equal(result.combat.targetId, "goo-1");
  assert.equal(result.combat.attackActionStatus, "CONFIRMED");
  assert.equal(result.combat.cooldownObserved, true);
  assert.equal(result.combat.resourcesVisible, true);
  assert.equal(result.scope.deathMutationForced, false);
  assert.equal(result.scope.potionMutationForced, false);
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("combat live runner navigates autonomously when no target is visible", async () => {
  const setup = makeSetup({ visibleTarget: false });
  const result = await setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.preparation.selectedMonsterType, "goo");
  assert.equal(
    setup.calls.some(
      (entry) => entry[0] === "smart" && entry[1] === "goo",
    ),
    true,
  );
});

test("combat live runner never treats UNKNOWN attack as success", async () => {
  const setup = makeSetup({ attackStatus: "UNKNOWN" });
  const result = await setup.runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "ATTACK_OUTCOME_UNKNOWN");
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

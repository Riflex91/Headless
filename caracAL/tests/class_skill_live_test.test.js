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

function makeSetup({ actionStatus = "CONFIRMED", ctype = "ranger" } = {}) {
  const { ClassSkillLiveTestRunner } = coreModule(
    "class-skill-live-test.lib.ts",
  );
  let now = 1000;
  let classSkillEnabled = false;
  let action = null;
  let cooldownMs = 0;
  const state = {
    character: {
      name: "My_Ranger1",
      ctype,
      map: "main",
      x: 10,
      y: 20,
      hp: 1000,
      maxHp: 1000,
      mp: 500,
      maxMp: 1000,
      range: 140,
      gold: 0,
      target: null,
      rip: false,
      moving: false,
    },
  };

  const classSkills = {
    setConfigOverride(config) {
      classSkillEnabled =
        config?.classSkills?.ranger?.enabled === true &&
        config?.classSkills?.ranger?.skills?.track?.enabled === true;
    },
    clearConfigOverride() {
      classSkillEnabled = false;
    },
    status() {
      return {
        timestamp: now,
        className: "ranger",
        module: "RangerSkillController",
        enabled: classSkillEnabled,
        state: action ? "USING" : classSkillEnabled ? "IDLE" : "DISABLED",
        reason: action ? "CLASS_SKILL_DISPATCHED" : "CLASS_SKILLS_DISABLED",
        configuredSkills: classSkillEnabled ? ["track"] : [],
        selectedSkill: action ? "track" : null,
        targetId: null,
        lastAction: action,
        unknownSkill: null,
      };
    },
    async tick() {
      if (classSkillEnabled && !action) {
        action = {
          id: "skill-1",
          status: actionStatus,
          skill: "track",
        };
        if (actionStatus === "CONFIRMED") {
          state.character.mp -= 80;
          cooldownMs = 1600;
        }
      }
      return this.status();
    },
  };

  const combat = {
    setConfigOverride() {},
    clearConfigOverride() {},
    async tick() {
      state.character.rip = false;
      return {};
    },
  };

  const runner = new ClassSkillLiveTestRunner({
    classSkills,
    combat,
    character: () => ({ ...state.character }),
    skills: () => [
      {
        key: "track",
        name: "Track",
        classes: ["ranger"],
        mp: 80,
        cooldown: 1600,
        range: 1440,
        hostile: false,
        party: false,
        passive: false,
      },
    ],
    cooldowns: () =>
      cooldownMs > 0
        ? [
            {
              skill: "track",
              readyAt: now + cooldownMs,
              remainingMs: cooldownMs,
              ready: false,
            },
          ]
        : [],
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      cooldownMs = Math.max(0, cooldownMs - ms);
    },
  });

  return { runner, state };
}

test("class skill live runner confirms safe Ranger track skill", async () => {
  const setup = makeSetup();
  const result = await setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CLASS_SKILL_LIVE_E2E_CONFIRMED");
  assert.equal(result.preparation.selectedSkill, "track");
  assert.equal(result.classSkill.actionStatus, "CONFIRMED");
  assert.equal(result.classSkill.cooldownObserved, true);
  assert.equal(result.classSkill.mpCostObserved, true);
  assert.equal(result.scope.consumableMutationForced, false);
  assert.equal(result.scope.combatMutationForced, false);
  assert.equal(result.cleanup.classSkillOverrideCleared, true);
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("class skill live runner never treats UNKNOWN as success", async () => {
  const setup = makeSetup({ actionStatus: "UNKNOWN" });
  const result = await setup.runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CLASS_SKILL_OUTCOME_UNKNOWN");
  assert.equal(result.cleanup.classSkillOverrideCleared, true);
});

test("class skill live runner rejects non-ranger characters safely", async () => {
  const setup = makeSetup({ ctype: "warrior" });
  const result = await setup.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CLASS_SKILL_LIVE_E2E_REQUIRES_RANGER");
  assert.equal(result.scope.combatMutationForced, false);
});

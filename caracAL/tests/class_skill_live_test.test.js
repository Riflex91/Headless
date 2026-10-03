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
  const merchant = ctype === "merchant";
  const safeSkill = merchant ? "massproduction" : "track";
  const moduleName = merchant
    ? "MerchantSkillController"
    : "RangerSkillController";
  const skillMp = merchant ? 20 : 80;
  const skillCooldown = merchant ? 50 : 1600;
  let now = 1000;
  let classSkillEnabled = false;
  let action = null;
  let cooldownMs = 0;
  const state = {
    character: {
      name: merchant ? "My_Merchant" : "My_Ranger1",
      ctype,
      map: "main",
      x: 10,
      y: 20,
      hp: 1000,
      maxHp: 1000,
      mp: 500,
      maxMp: 1000,
      level: merchant ? 58 : 80,
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
        config?.classSkills?.[ctype]?.enabled === true &&
        config?.classSkills?.[ctype]?.skills?.[safeSkill]?.enabled === true;
    },
    clearConfigOverride() {
      classSkillEnabled = false;
    },
    status() {
      return {
        timestamp: now,
        className: ctype,
        module: moduleName,
        enabled: classSkillEnabled,
        state: action ? "USING" : classSkillEnabled ? "IDLE" : "DISABLED",
        reason: action ? "CLASS_SKILL_DISPATCHED" : "CLASS_SKILLS_DISABLED",
        configuredSkills: classSkillEnabled ? [safeSkill] : [],
        selectedSkill: action ? safeSkill : null,
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
          skill: safeSkill,
        };
        if (actionStatus === "CONFIRMED") {
          state.character.mp -= skillMp;
          cooldownMs = skillCooldown;
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
        key: safeSkill,
        name: merchant ? "Mass Production" : "Track",
        classes: [ctype],
        level: merchant ? 30 : null,
        mp: skillMp,
        cooldown: skillCooldown,
        range: merchant ? null : 1440,
        hostile: false,
        party: false,
        passive: false,
      },
    ],
    cooldowns: () =>
      cooldownMs > 0
        ? [
            {
              skill: safeSkill,
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
  assert.equal(result.scope.testedClass, "ranger");
  assert.equal(result.scope.safeSkill, "track");
  assert.equal(result.scope.consumableMutationForced, false);
  assert.equal(result.scope.combatMutationForced, false);
  assert.equal(result.cleanup.classSkillOverrideCleared, true);
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("class skill live runner confirms safe Merchant massproduction skill", async () => {
  const setup = makeSetup({ ctype: "merchant" });
  const result = await setup.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CLASS_SKILL_LIVE_E2E_CONFIRMED");
  assert.equal(result.preparation.selectedSkill, "massproduction");
  assert.equal(result.classSkill.module, "MerchantSkillController");
  assert.equal(result.classSkill.actionStatus, "CONFIRMED");
  assert.equal(result.classSkill.cooldownObserved, true);
  assert.equal(result.classSkill.mpCostObserved, true);
  assert.equal(result.scope.testedClass, "merchant");
  assert.equal(result.scope.safeSkill, "massproduction");
  assert.equal(result.scope.combatMutationForced, false);
  assert.equal(result.scope.targetMutationForced, false);
});

test("class skill live runner never treats UNKNOWN as success", async () => {
  const setup = makeSetup({ actionStatus: "UNKNOWN" });
  const result = await setup.runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CLASS_SKILL_OUTCOME_UNKNOWN");
  assert.equal(result.cleanup.classSkillOverrideCleared, true);
});

test("class skill live runner rejects unsupported characters safely", async () => {
  const setup = makeSetup({ ctype: "warrior" });
  const result = await setup.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CLASS_SKILL_LIVE_E2E_UNSUPPORTED_CLASS");
  assert.equal(result.scope.combatMutationForced, false);
  assert.equal(result.cleanup.classSkillOverrideCleared, true);
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

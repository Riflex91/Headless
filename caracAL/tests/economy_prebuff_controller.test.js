"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadModule() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-prebuff-controller.lib.ts",
    ),
  );
}

function riskPolicy(overrides = {}) {
  return {
    timestamp: 1000,
    enabled: true,
    state: "READY",
    reason: "RISK_POLICY_CANDIDATE_ALLOWED",
    policy: {
      minExpectedDeltaGold: 0,
      minSuccessProbability: 0,
      maxInputValueGold: null,
      maxFailureLossGold: null,
      allowedKinds: ["UPGRADE", "COMPOUND"],
      unknownAlwaysBlocked: true,
    },
    selected: {
      kind: "UPGRADE",
      name: "helmet",
      currentLevel: 1,
      targetLevel: 2,
      itemSlots: [2],
      expectedDeltaGold: 100,
      successProbability: 1,
      inputValueGold: 100,
      failureOutcomeValueGold: 100,
      failureLossGold: 0,
      decision: "ALLOW",
      reason: "RISK_POLICY_ALLOWED",
    },
    decisions: [],
    summary: {
      estimates: 1,
      allowed: 1,
      blocked: 0,
      unknown: 0,
      upgradeAllowed: 1,
      compoundAllowed: 0,
      selectedKind: "UPGRADE",
      selectedName: "helmet",
      selectedExpectedDeltaGold: 100,
    },
    ...overrides,
  };
}

function skill(key, level, mp) {
  return {
    key,
    name: key,
    classes: ["merchant"],
    level,
    mp,
    cooldown: 50,
    range: null,
    hostile: false,
    party: false,
    passive: false,
  };
}

function makeController({
  config = {},
  character = {},
  risk = riskPolicy(),
  skills = [
    skill("massproduction", 30, 20),
    skill("massproductionpp", 60, 200),
    skill("massexchange", 40, 30),
    skill("massexchangepp", 70, 200),
  ],
  cooldowns = [],
} = {}) {
  const { EconomyPrebuffController } = loadModule();
  const currentCharacter = {
    name: "My_Merchant",
    ctype: "merchant",
    map: "main",
    x: 0,
    y: 0,
    hp: 1000,
    maxHp: 1000,
    mp: 1000,
    maxMp: 1000,
    level: 80,
    xp: 0,
    attack: 0,
    frequency: 0,
    armor: 0,
    resistance: 0,
    range: 0,
    gold: 0,
    target: null,
    rip: false,
    moving: false,
    ...character,
  };
  const events = [];
  const controller = new EconomyPrebuffController(
    {
      character: () => ({ ...currentCharacter }),
      skills: () => skills.map((entry) => ({ ...entry })),
      cooldowns: () => cooldowns.map((entry) => ({ ...entry })),
    },
    {
      status: () => risk,
    },
    {
      config: () => config,
      now: () => 1000,
      onEvent: (event) => events.push(event),
    },
  );
  return { controller, events };
}

function merchantConfig(skills, extra = {}) {
  return {
    economyPrebuff: {
      enabled: true,
      ...extra,
    },
    classSkills: {
      merchant: {
        enabled: true,
        skills,
      },
    },
  };
}

test("Economy Prebuff maps official skill families deterministically", () => {
  const { economyPrebuffSkillsForKind } = loadModule();

  assert.deepEqual(economyPrebuffSkillsForKind("UPGRADE"), [
    "massproductionpp",
    "massproduction",
  ]);
  assert.deepEqual(economyPrebuffSkillsForKind("COMPOUND"), [
    "massproductionpp",
    "massproduction",
  ]);
  assert.deepEqual(economyPrebuffSkillsForKind("EXCHANGE"), [
    "massexchangepp",
    "massexchange",
  ]);
  assert.deepEqual(economyPrebuffSkillsForKind("UPGRADE", false), [
    "massproduction",
    "massproductionpp",
  ]);
});

test("Economy Prebuff prefers Mass Production++ for an allowed upgrade", () => {
  const setup = makeController({
    config: merchantConfig({
      massproduction: true,
      massproductionpp: true,
    }),
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "ECONOMY_PREBUFF_READY");
  assert.equal(status.demand.kind, "UPGRADE");
  assert.equal(status.selectedSkill, "massproductionpp");
  assert.equal(status.candidates[0].reductionPercent, 90);
  assert.equal(status.policy.buffLifetimeMs, 10000);
  assert.equal(status.policy.executionEnabled, false);
  assert.equal(status.policy.arbiterLaneActivationEnabled, false);
  assert.equal(status.policy.valueMutationForced, false);
});

test("Economy Prebuff falls back to base skill when enhanced skill is not ready", () => {
  const setup = makeController({
    config: merchantConfig({
      massproduction: true,
      massproductionpp: true,
    }),
    character: {
      level: 45,
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.selectedSkill, "massproduction");
  assert.equal(
    status.candidates[0].reason,
    "ECONOMY_PREBUFF_LEVEL_INSUFFICIENT",
  );
  assert.equal(status.candidates[1].reason, "ECONOMY_PREBUFF_SKILL_READY");
});

test("Economy Prebuff holds when Risk Policy contains UNKNOWN evidence", () => {
  const setup = makeController({
    config: merchantConfig({
      massproduction: true,
      massproductionpp: true,
    }),
    risk: riskPolicy({
      state: "PARTIAL",
      reason: "RISK_POLICY_PARTIAL_UNKNOWN",
      selected: null,
      summary: {
        ...riskPolicy().summary,
        allowed: 0,
        unknown: 1,
        upgradeAllowed: 0,
        selectedKind: null,
        selectedName: null,
        selectedExpectedDeltaGold: null,
      },
    }),
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_PREBUFF_RISK_POLICY_UNKNOWN");
  assert.equal(status.selectedSkill, null);
  assert.equal(status.demand.unknown, 1);
});

test("Economy Prebuff supports a temporary Merchant Skill override and restores config", () => {
  const setup = makeController({
    config: merchantConfig({}),
  });

  assert.equal(setup.controller.tick().reason, "ECONOMY_PREBUFF_NO_CONFIGURED_SKILL");

  setup.controller.setConfigOverride(
    merchantConfig({
      massproduction: true,
      massproductionpp: true,
    }),
  );
  const overridden = setup.controller.tick();

  assert.equal(overridden.state, "READY");
  assert.equal(overridden.reason, "ECONOMY_PREBUFF_READY");
  assert.equal(overridden.selectedSkill, "massproductionpp");

  setup.controller.clearConfigOverride();
  const restored = setup.controller.tick();

  assert.equal(restored.state, "BLOCKED");
  assert.equal(restored.reason, "ECONOMY_PREBUFF_NO_CONFIGURED_SKILL");
  assert.equal(restored.selectedSkill, null);
});

test("Economy Prebuff requires explicit Merchant Skill configuration", () => {
  const setup = makeController({
    config: merchantConfig({}),
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_PREBUFF_NO_CONFIGURED_SKILL");
  assert.equal(status.selectedSkill, null);
});

test("Economy Prebuff remains read-only for non-merchant characters", () => {
  const setup = makeController({
    config: merchantConfig({
      massproduction: true,
    }),
    character: {
      ctype: "ranger",
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "UNSUPPORTED_CLASS");
  assert.equal(status.reason, "ECONOMY_PREBUFF_REQUIRES_MERCHANT");
  assert.equal(status.selectedSkill, null);
  assert.equal(status.policy.executionEnabled, false);
});

test("Economy Prebuff publishes only when its decision changes", () => {
  const setup = makeController({
    config: merchantConfig({
      massproduction: true,
      massproductionpp: true,
    }),
  });

  setup.controller.tick();
  setup.controller.tick();

  assert.equal(setup.events.length, 1);
  assert.equal(setup.events[0].type, "ECONOMY_PREBUFF_UPDATED");
});

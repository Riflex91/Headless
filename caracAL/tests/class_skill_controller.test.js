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

function confirmed(id = "skill-1") {
  return { id, status: "CONFIRMED" };
}

function stateFor(ctype = "ranger") {
  return {
    character: {
      name: "Test",
      ctype,
      map: "main",
      x: 0,
      y: 0,
      hp: 1000,
      maxHp: 1000,
      mp: 1000,
      maxMp: 1000,
      range: 140,
      gold: 0,
      target: "monster-1",
      rip: false,
      moving: false,
    },
    target: {
      id: "monster-1",
      type: "monster",
      name: null,
      mtype: "goo",
      map: "main",
      x: 80,
      y: 0,
      hp: 500,
      maxHp: 500,
      target: null,
      dead: false,
      rip: false,
    },
    cooldowns: [],
  };
}

function makeController(ctype = "ranger", config = {}, options = {}) {
  const { createClassSkillController } = coreModule(
    "class-skill-factory.lib.ts",
  );
  const state = options.state || stateFor(ctype);
  const calls = [];
  const skills = options.skills || [
    {
      key: "huntersmark",
      name: "Hunter's Mark",
      classes: ["ranger"],
      mp: 240,
      cooldown: 10000,
      range: null,
      hostile: true,
      party: false,
      passive: false,
    },
    {
      key: "supershot",
      name: "Supershot",
      classes: ["ranger"],
      mp: 400,
      cooldown: 30000,
      range: null,
      hostile: true,
      party: false,
      passive: false,
    },
  ];
  const game = {
    character: () => ({ ...state.character }),
    entity: (id) => (id === state.target.id ? { ...state.target } : null),
    skills: () => skills.map((skill) => ({ ...skill })),
    cooldowns: () => state.cooldowns.map((entry) => ({ ...entry })),
  };
  const actions = {
    async useSkill(request) {
      calls.push(request);
      return confirmed();
    },
    ...(options.actions || {}),
  };
  const combat = {
    status: () => ({ target: { id: state.target.id } }),
  };
  const events = [];
  const controller = createClassSkillController(ctype, game, actions, combat, {
    config: () => config,
    onEvent: (event) => events.push(event),
  });
  return { controller, state, calls, events };
}

test("factory creates all six Phase 7 class controllers", () => {
  const { createClassSkillController } = coreModule(
    "class-skill-factory.lib.ts",
  );
  const fake = {
    character: () => stateFor("ranger").character,
    entity: () => null,
    skills: () => [],
    cooldowns: () => [],
  };
  const actions = { useSkill: async () => confirmed() };
  const combat = { status: () => ({ target: null }) };

  const expected = {
    warrior: "WarriorSkillController",
    ranger: "RangerSkillController",
    mage: "MageSkillController",
    priest: "PriestSkillController",
    rogue: "RogueSkillController",
    merchant: "MerchantSkillController",
  };

  for (const [ctype, module] of Object.entries(expected)) {
    const controller = createClassSkillController(ctype, fake, actions, combat);
    assert.ok(controller);
    assert.equal(controller.status().module, module);
  }
});

test("class skills stay disabled without explicit CharacterConfig", async () => {
  const setup = makeController("ranger", {});
  const status = await setup.controller.tick();
  assert.equal(status.state, "DISABLED");
  assert.equal(status.reason, "CLASS_SKILLS_DISABLED");
  assert.equal(setup.calls.length, 0);
});

test("configured ranger skill targets current combat monster", async () => {
  const setup = makeController("ranger", {
    classSkills: {
      ranger: {
        enabled: true,
        skills: {
          huntersmark: { enabled: true, priority: 100 },
        },
      },
    },
  });
  const status = await setup.controller.tick();
  assert.equal(status.state, "USING");
  assert.equal(status.selectedSkill, "huntersmark");
  assert.equal(status.targetId, "monster-1");
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0].skill, "huntersmark");
  assert.equal(setup.calls[0].targetId, "monster-1");
});

test("priority, MP, cooldown, and range gates select the safe ready skill", async () => {
  const setup = makeController(
    "ranger",
    {
      classSkills: {
        ranger: {
          enabled: true,
          skills: {
            supershot: { enabled: true, priority: 200 },
            huntersmark: { enabled: true, priority: 100 },
          },
        },
      },
    },
    {
      skills: [
        {
          key: "huntersmark",
          name: "Hunter's Mark",
          classes: ["ranger"],
          mp: 240,
          cooldown: 10000,
          range: null,
          hostile: true,
          party: false,
          passive: false,
        },
        {
          key: "supershot",
          name: "Supershot",
          classes: ["ranger"],
          mp: 1200,
          cooldown: 30000,
          range: null,
          hostile: true,
          party: false,
          passive: false,
        },
      ],
    },
  );
  const status = await setup.controller.tick();
  assert.equal(status.selectedSkill, "huntersmark");
  assert.equal(setup.calls[0].skill, "huntersmark");
});

test("UNKNOWN skill outcome is held and never blindly retried", async () => {
  let uses = 0;
  const setup = makeController(
    "ranger",
    {
      classSkills: {
        ranger: {
          enabled: true,
          skills: {
            huntersmark: true,
          },
        },
      },
    },
    {
      actions: {
        async useSkill() {
          uses += 1;
          return { id: "unknown-skill", status: "UNKNOWN" };
        },
      },
    },
  );

  let status = await setup.controller.tick();
  assert.equal(status.reason, "SKILL_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);

  status = await setup.controller.tick();
  assert.equal(status.reason, "SKILL_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);

  setup.state.cooldowns = [
    {
      skill: "huntersmark",
      readyAt: Date.now() + 1000,
      remainingMs: 1000,
      ready: false,
    },
  ];
  status = await setup.controller.tick();
  assert.notEqual(status.reason, "SKILL_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);
});

test("Phase 8 AoE skills are not exposed by Phase 7 ranger controller", () => {
  const setup = makeController("ranger", {
    classSkills: {
      ranger: {
        enabled: true,
        skills: {
          "3shot": true,
          "5shot": true,
        },
      },
    },
  });
  const status = setup.controller.status();
  assert.deepEqual(status.configuredSkills, []);
});

test("merchant controller skips skills above character level", async () => {
  const state = stateFor("merchant");
  state.character.level = 58;
  state.character.mp = 1000;
  const setup = makeController(
    "merchant",
    {
      classSkills: {
        merchant: {
          enabled: true,
          skills: {
            mcourage: { enabled: true, priority: 200 },
            massproduction: { enabled: true, priority: 100 },
          },
        },
      },
    },
    {
      state,
      skills: [
        {
          key: "mcourage",
          name: "Merchant's Courage",
          classes: ["merchant"],
          level: 70,
          mp: 2400,
          cooldown: 2000,
          range: null,
          hostile: false,
          party: false,
          passive: false,
        },
        {
          key: "massproduction",
          name: "Mass Production",
          classes: ["merchant"],
          level: 30,
          mp: 20,
          cooldown: 50,
          range: null,
          hostile: false,
          party: false,
          passive: false,
        },
      ],
    },
  );

  const status = await setup.controller.tick();

  assert.equal(status.state, "USING");
  assert.equal(status.selectedSkill, "massproduction");
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0].skill, "massproduction");
});

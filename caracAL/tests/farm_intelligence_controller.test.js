"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadController() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "farm-intelligence-controller.lib.ts",
    ),
  ).FarmIntelligenceController;
}

function scoreWeights(overrides = {}) {
  return {
    xp: 0,
    gold: 0,
    drops: 0,
    goal: 0,
    danger: 0,
    travel: 0,
    respawn: 0,
    partyDps: 0,
    tankSafety: 0,
    observed: 0,
    ...overrides,
  };
}

function makeSetup({
  farming = {},
  map = "main",
  x = 0,
  y = 0,
  entities = [],
  party = {},
  gameData = null,
} = {}) {
  const FarmIntelligenceController = loadController();
  let now = 1000;
  const events = [];
  const state = {
    character: {
      name: "Farmer",
      ctype: "ranger",
      map,
      x,
      y,
      hp: 1000,
      maxHp: 1000,
      mp: 500,
      maxMp: 500,
      level: 50,
      xp: 1000,
      attack: 100,
      frequency: 1,
      armor: 100,
      resistance: 100,
      range: 140,
      gold: 1000,
      target: null,
      rip: false,
      moving: false,
    },
    entities: entities.map((entry) => ({ ...entry })),
    party: { ...party },
    inventory: [{ slot: 0, item: { name: "slime", q: 1 } }],
    gameData:
      gameData ||
      {
        monsters: {
          goo: {
            hp: 100,
            xp: 50,
            attack: 20,
            frequency: 1,
            respawn: 1,
            drop: "goo_drop",
          },
          bee: {
            hp: 400,
            xp: 300,
            attack: 100,
            frequency: 1,
            respawn: 5,
            drop: "bee_drop",
          },
        },
        monster_gold: {
          goo: 20,
          bee: 200,
        },
        items: {
          slime: {},
          honey: {},
        },
        drops: {
          goo_drop: [[1, "slime"]],
          bee_drop: [[1, "honey"]],
        },
        maps: {
          main: {
            monsters: [
              { type: "goo", count: 5, boundary: [-100, -100, 100, 100] },
              { type: "bee", count: 3, boundary: [500, 0, 600, 100] },
            ],
          },
          winterland: {
            monsters: [
              {
                type: "bee",
                count: 8,
                boundary: [-200, -100, 0, 100],
              },
            ],
          },
        },
      },
  };

  const game = {
    character: () => ({ ...state.character }),
    entities: () => state.entities.map((entry) => ({ ...entry })),
    party: () => ({ ...state.party }),
    inventory: () =>
      state.inventory.map((entry) => ({
        slot: entry.slot,
        item: entry.item ? { ...entry.item } : null,
      })),
    gameData: () => JSON.parse(JSON.stringify(state.gameData)),
  };

  const controller = new FarmIntelligenceController(game, {
    now: () => now,
    config: () => ({ farming: { enabled: true, ...farming } }),
    onEvent: (event) => events.push(event),
  });

  return {
    controller,
    state,
    events,
    advance(ms) {
      now += ms;
    },
  };
}

test("farm intelligence can select by XP potential and explains the choice", () => {
  const setup = makeSetup({
    farming: {
      weights: scoreWeights({ xp: 1 }),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.selected.monster, "bee");
  assert.equal(status.selected.map, "main");
  assert.equal(status.selected.components.xpPerHourPotential > 0, true);
  assert.equal(status.selected.estimated.partyDps, 100);
  assert.match(status.selected.whyMonster, /bee: Score/);
  assert.match(status.selected.whyMonster, /XP/);
  assert.match(status.selected.whySpot, /main/);
});

test("goal utility and forbidden monsters are applied before ranking", () => {
  const setup = makeSetup({
    farming: {
      goalMonster: "goo",
      preferredMonsters: ["goo"],
      forbiddenMonsters: ["bee"],
      weights: scoreWeights({ goal: 1 }),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.selected.monster, "goo");
  assert.deepEqual(
    [...new Set(status.candidates.map((candidate) => candidate.monster))],
    ["goo"],
  );
  assert.equal(status.selected.components.goalUtility, 100);
});

test("travel scoring prefers the nearby spot for the same monster", () => {
  const setup = makeSetup({
    x: 20,
    y: 10,
    farming: {
      preferredMonsters: ["bee"],
      forbiddenMonsters: ["goo"],
      weights: scoreWeights({ travel: 1 }),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.selected.monster, "bee");
  assert.equal(status.selected.map, "main");
  assert.equal(
    status.candidates.some((candidate) => candidate.map === "winterland"),
    true,
  );
  assert.equal(
    status.selected.components.travelCost <
      status.candidates.find((candidate) => candidate.map === "winterland")
        .components.travelCost,
    true,
  );
});

test("party DPS and tank safety include visible configured party members", () => {
  const setup = makeSetup({
    party: { Farmer: {}, Tank: {} },
    entities: [
      {
        id: "tank-id",
        type: "character",
        name: "Tank",
        mtype: null,
        map: "main",
        x: 5,
        y: 5,
        hp: 2000,
        maxHp: 2000,
        level: 50,
        attack: 250,
        frequency: 1.2,
        armor: 500,
        resistance: 300,
        range: 60,
        target: null,
        dead: false,
        rip: false,
      },
    ],
    farming: {
      weights: scoreWeights({ partyDps: 1 }),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.selected.estimated.partyDps, 400);
  assert.equal(status.selected.estimated.tankHp, 2000);
  assert.equal(status.selected.components.partyDpsFit > 0, true);
  assert.equal(status.selected.components.tankSafety > 0, true);
});

test("observed performance records XP, gold and positive inventory deltas", () => {
  const setup = makeSetup({
    farming: {
      forbiddenMonsters: ["bee"],
      observationSampleMs: 5000,
      observationWindowMs: 60000,
      weights: scoreWeights({ observed: 1 }),
    },
  });

  let status = setup.controller.tick();
  assert.equal(status.selected.monster, "goo");

  setup.state.character.xp += 120;
  setup.state.character.gold += 60;
  setup.state.inventory[0].item.q = 3;
  setup.advance(6000);

  status = setup.controller.tick();
  const sampleEvent = setup.events.find(
    (event) => event.type === "FARM_INTELLIGENCE_SAMPLE",
  );

  assert.ok(sampleEvent);
  assert.equal(sampleEvent.sample.monster, "goo");
  assert.equal(sampleEvent.sample.stats.xpDelta, 120);
  assert.equal(sampleEvent.sample.stats.goldDelta, 60);
  assert.equal(sampleEvent.sample.stats.dropDelta, 2);
  assert.equal(sampleEvent.sample.stats.xpPerHour, 72000);
  assert.equal(sampleEvent.sample.stats.goldPerHour, 36000);
  assert.equal(sampleEvent.sample.stats.dropsPerHour, 1200);
  assert.equal(status.selected.observed.xpPerHour, 72000);
});

test("farm intelligence stays disabled unless explicitly configured", () => {
  const FarmIntelligenceController = loadController();
  const game = {
    character: () => ({
      name: "Farmer",
      ctype: "ranger",
      map: "main",
      x: 0,
      y: 0,
      hp: 1000,
      maxHp: 1000,
      mp: 500,
      maxMp: 500,
      level: 1,
      xp: 0,
      attack: 100,
      frequency: 1,
      armor: 0,
      resistance: 0,
      range: 140,
      gold: 0,
      target: null,
      rip: false,
      moving: false,
    }),
    entities: () => [],
    party: () => ({}),
    inventory: () => [],
    gameData: () => ({}),
  };
  const controller = new FarmIntelligenceController(game, {
    config: () => ({}),
  });

  const status = controller.tick();
  assert.equal(status.state, "DISABLED");
  assert.equal(status.selected, null);
});

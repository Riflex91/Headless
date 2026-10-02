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

function makeState() {
  return {
    character: {
      name: "My_Ranger1",
      ctype: "ranger",
      map: "main",
      x: 0,
      y: 0,
      hp: 1000,
      maxHp: 1000,
      mp: 500,
      maxMp: 500,
      range: 120,
      gold: 0,
      target: null,
      rip: false,
      moving: false,
    },
    entities: [
      {
        id: "near",
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
      {
        id: "far",
        type: "monster",
        name: null,
        mtype: "bee",
        map: "main",
        x: 250,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: null,
        dead: false,
        rip: false,
      },
    ],
    cooldowns: [],
    movement: {
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
    },
  };
}

function makeController(options = {}) {
  const { CombatController } = coreModule("combat-controller.lib.ts");
  const state = options.state || makeState();
  const calls = [];
  let now = 1000;

  const game = {
    character: () => ({ ...state.character }),
    entities: () => state.entities.map((entity) => ({ ...entity })),
    entity: (id) => {
      const entity = state.entities.find((candidate) => candidate.id === id);
      return entity ? { ...entity } : null;
    },
    cooldowns: () => state.cooldowns.map((entry) => ({ ...entry })),
  };

  const actions = {
    async attack(request) {
      calls.push(["attack", request.targetId]);
      return action("attack-1");
    },
    async useSkill(request) {
      calls.push(["skill", request.skill]);
      if (request.skill === "use_hp") state.character.hp += 300;
      if (request.skill === "use_mp") state.character.mp += 200;
      return action("skill-1");
    },
    respawn() {
      calls.push(["respawn"]);
      state.character.rip = false;
      return action("respawn-1");
    },
    ...(options.actions || {}),
  };

  const movement = {
    status: () => ({
      ...state.movement,
      safePoint: state.movement.safePoint
        ? { ...state.movement.safePoint }
        : null,
      active: state.movement.active ? { ...state.movement.active } : null,
    }),
    captureSafePoint(_tolerance, source) {
      calls.push(["captureSafePoint", source]);
      state.movement.safePoint = {
        map: state.character.map,
        x: state.character.x,
        y: state.character.y,
        tolerance: 12,
        source,
        capturedAt: now,
      };
      return state.movement.safePoint;
    },
    async cancel(request) {
      calls.push(["cancel", request.force]);
      state.movement.owner = null;
      state.movement.mode = "IDLE";
      state.movement.active = null;
      return action("cancel-1");
    },
    async returnToSafePoint() {
      calls.push(["returnToSafePoint"]);
      state.movement.owner = "CombatController";
      state.movement.mode = "RETURN";
      return action("return-1", "DISPATCHED");
    },
    ...(options.movement || {}),
  };

  const config = options.config || {
    combat: { enabled: true },
    potionUsage: { enabled: true, hpBelowPercent: 50, mpBelowPercent: 40 },
    safety: {},
  };

  const events = [];
  const controller = new CombatController(game, actions, movement, {
    now: () => now,
    config: () => config,
    onEvent: (event) => events.push(event),
  });

  return {
    controller,
    state,
    calls,
    events,
    setNow(value) {
      now = value;
    },
  };
}

test("combat stays disabled unless config enables it", async () => {
  const setup = makeController({ config: { combat: { enabled: false } } });
  const status = await setup.controller.tick();
  assert.equal(status.state, "DISABLED");
  assert.deepEqual(setup.calls, []);
});

test("HP management uses potion before attacking", async () => {
  const setup = makeController();
  setup.state.character.hp = 400;
  const status = await setup.controller.tick();
  assert.deepEqual(setup.calls[0], ["skill", "use_hp"]);
  assert.equal(status.state, "RECOVERING");
  assert.equal(status.reason, "HP_POTION_USED");
  assert.equal(setup.calls.some((entry) => entry[0] === "attack"), false);
});

test("MP management uses potion at configured threshold", async () => {
  const setup = makeController();
  setup.state.character.mp = 150;
  const status = await setup.controller.tick();
  assert.deepEqual(setup.calls[0], ["skill", "use_mp"]);
  assert.equal(status.state, "RECOVERING");
  assert.equal(status.reason, "MP_POTION_USED");
});

test("UNKNOWN potion outcome is not blindly retried", async () => {
  let uses = 0;
  const setup = makeController({
    actions: {
      async useSkill(request) {
        uses += 1;
        return action("unknown-pot", "UNKNOWN");
      },
    },
  });
  setup.state.character.hp = 400;

  let status = await setup.controller.tick();
  assert.equal(status.reason, "POTION_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);

  status = await setup.controller.tick();
  assert.equal(status.reason, "POTION_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);

  setup.state.cooldowns = [
    { skill: "use_hp", readyAt: 2000, remainingMs: 1000, ready: false },
  ];
  status = await setup.controller.tick();
  assert.notEqual(status.reason, "POTION_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);
});

test("nearest eligible monster is attacked in range", async () => {
  const setup = makeController();
  const status = await setup.controller.tick();
  const attackCall = setup.calls.find((entry) => entry[0] === "attack");
  assert.deepEqual(attackCall, ["attack", "near"]);
  assert.equal(status.state, "ATTACKING");
  assert.equal(status.target.id, "near");
  assert.equal(status.target.inRange, true);
});

test("range gating prevents out-of-range attack", async () => {
  const setup = makeController();
  setup.state.entities = [setup.state.entities[1]];
  const status = await setup.controller.tick();
  assert.equal(status.state, "OUT_OF_RANGE");
  assert.equal(status.reason, "TARGET_OUT_OF_ATTACK_RANGE");
  assert.equal(setup.calls.some((entry) => entry[0] === "attack"), false);
});

test("attack cooldown prevents dispatch", async () => {
  const setup = makeController();
  setup.state.cooldowns = [
    { skill: "attack", readyAt: 1500, remainingMs: 500, ready: false },
  ];
  const status = await setup.controller.tick();
  assert.equal(status.state, "COOLDOWN");
  assert.equal(status.cooldowns.attackRemainingMs, 500);
  assert.equal(setup.calls.some((entry) => entry[0] === "attack"), false);
});

test("retreat captures anchor and returns on low HP", async () => {
  const setup = makeController({
    config: {
      combat: { enabled: true, retreat: true, retreatHpPercent: 35 },
      potionUsage: { enabled: false },
    },
  });

  let status = await setup.controller.tick();
  assert.equal(
    setup.calls.some((entry) => entry[0] === "captureSafePoint"),
    true,
  );
  assert.equal(status.state, "ATTACKING");

  setup.state.character.x = 200;
  setup.state.character.hp = 300;
  status = await setup.controller.tick();
  assert.equal(
    setup.calls.some((entry) => entry[0] === "returnToSafePoint"),
    true,
  );
  assert.equal(status.state, "RETREATING");
  assert.equal(status.reason, "RETREAT_LOW_HP");
});

test("retreat force-cancels another movement owner first", async () => {
  const setup = makeController({
    config: {
      combat: { enabled: true, retreat: true, retreatHpPercent: 35 },
      potionUsage: { enabled: false },
    },
  });
  setup.state.movement.safePoint = {
    map: "main",
    x: 0,
    y: 0,
    tolerance: 12,
    source: "TEST",
    capturedAt: 0,
  };
  setup.state.character.x = 200;
  setup.state.character.hp = 300;
  setup.state.movement.owner = "FarmController";
  setup.state.movement.mode = "PATH";
  setup.state.movement.active = {
    id: 1,
    type: "DIRECT",
    owner: "FarmController",
    module: "Farm",
    reason: "MOVE",
    startedAt: 1,
    actionId: "move-1",
    target: null,
  };

  const status = await setup.controller.tick();
  assert.deepEqual(setup.calls[0], ["cancel", true]);
  assert.equal(setup.calls[1][0], "returnToSafePoint");
  assert.equal(status.state, "RETREATING");
});

test("death handling auto-respawns with retry throttle", async () => {
  let respawns = 0;
  const setup = makeController({
    config: {
      combat: { enabled: true },
      safety: { autoRespawn: true, respawnRetryMs: 3000 },
    },
    actions: {
      respawn() {
        respawns += 1;
        return action("respawn-1", "DISPATCHED");
      },
    },
  });
  setup.state.character.rip = true;

  let status = await setup.controller.tick();
  assert.equal(status.state, "RESPAWNING");
  assert.equal(respawns, 1);

  setup.setNow(2000);
  status = await setup.controller.tick();
  assert.equal(respawns, 1);

  setup.setNow(4500);
  status = await setup.controller.tick();
  assert.equal(respawns, 2);
});

 // PRETTIER_PROBE_START
test("prettier probe", async () => {
  const fs = require("node:fs");
  const prettier = await import("prettier");
  const source = fs.readFileSync(__filename, "utf8");
  const stripped = source.replace(
    /\n \/\/ PRETTIER_PROBE_START[\s\S]*\/\/ PRETTIER_PROBE_END\n?$/,
    "\n",
  );
  const formatted = await prettier.format(stripped, { filepath: __filename });
  console.log(
    `PRETTIER_PROBE_BASE64=${Buffer.from(formatted).toString("base64")}`,
  );
});
// PRETTIER_PROBE_END

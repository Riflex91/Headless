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

function makeSource() {
  const state = {
    character: {
      name: "My_Ranger1",
      ctype: "ranger",
      map: "main",
      x: 10,
      y: 20,
      hp: 800,
      max_hp: 1000,
      mp: 400,
      max_mp: 500,
      gold: 12345,
      target: "m-1",
      rip: false,
      moving: false,
      items: [{ name: "hpot1", q: 20 }, null, { name: "bow", level: 2 }],
      slots: {
        mainhand: { name: "bow", level: 2 },
        helmet: null,
      },
    },
    entities: {
      "m-1": {
        id: "m-1",
        type: "monster",
        mtype: "goo",
        map: "main",
        x: 15,
        y: 25,
        hp: 100,
        max_hp: 100,
        target: "My_Ranger1",
      },
      "p-1": {
        id: "p-1",
        type: "character",
        name: "Friend",
        map: "main",
        x: 30,
        y: 40,
        hp: 900,
        max_hp: 900,
      },
    },
    party: {
      My_Ranger1: { type: "ranger" },
      My_Priest: { type: "priest" },
    },
    G: {
      items: {
        hpot1: { name: "Health Potion" },
      },
    },
  };

  return {
    state,
    source: {
      character: () => state.character,
      entities: () => state.entities,
      party: () => state.party,
      gameData: () => state.G,
    },
  };
}

test("GameAdapter returns read-only snapshots instead of live references", () => {
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const { state, source } = makeSource();
  const adapter = new GameAdapter(source);

  assert.deepEqual(adapter.character(), {
    name: "My_Ranger1",
    ctype: "ranger",
    map: "main",
    x: 10,
    y: 20,
    hp: 800,
    maxHp: 1000,
    mp: 400,
    maxMp: 500,
    range: null,
    gold: 12345,
    target: "m-1",
    rip: false,
    moving: false,
  });

  assert.deepEqual(
    adapter.entities().map((entity) => entity.id),
    ["m-1", "p-1"],
  );
  assert.equal(adapter.entity("m-1").mtype, "goo");
  assert.deepEqual(adapter.map(), { name: "main", x: 10, y: 20 });

  const inventory = adapter.inventory();
  inventory[0].item.q = 999;
  assert.equal(state.character.items[0].q, 20);

  const equipment = adapter.equipment();
  equipment.mainhand.level = 99;
  assert.equal(state.character.slots.mainhand.level, 2);

  const party = adapter.party();
  party.My_Ranger1.type = "warrior";
  assert.equal(state.party.My_Ranger1.type, "ranger");

  const gameData = adapter.gameData();
  gameData.items.hpot1.name = "Changed";
  assert.equal(state.G.items.hpot1.name, "Health Potion");
});

test("ActionBoundary blocks move before dispatch during emergency stop", () => {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const { source } = makeSource();
  const game = new GameAdapter(source);
  let moveCalls = 0;
  const ledger = new ActionLedger({
    isEmergencyStopActive: () => true,
    nextActionId: () => "A-stop",
    nextCorrelationId: () => "C-stop",
  });
  const boundary = new ActionBoundary(ledger, game, {
    move() {
      moveCalls += 1;
    },
    resolveEntity() {
      return null;
    },
    canAttack() {
      return false;
    },
    attack() {},
  });

  const result = boundary.move({
    x: 100,
    y: 200,
    module: "Movement",
    why: "TEST_MOVE",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(moveCalls, 0);
});

test("ActionBoundary keeps successful move as DISPATCHED until effect evidence exists", () => {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const { source } = makeSource();
  const game = new GameAdapter(source);
  const calls = [];
  const ledger = new ActionLedger({
    nextActionId: () => "A-move",
    nextCorrelationId: () => "C-move",
  });
  const boundary = new ActionBoundary(ledger, game, {
    move(x, y) {
      calls.push([x, y]);
    },
    resolveEntity() {
      return null;
    },
    canAttack() {
      return false;
    },
    attack() {},
  });

  const result = boundary.move({
    x: 101,
    y: 202,
    module: "Movement",
    why: "MOVE_TO_FARM_SPOT",
  });

  assert.equal(result.status, "DISPATCHED");
  assert.deepEqual(calls, [[101, 202]]);
});

test("ActionBoundary marks uncertain post-dispatch move failures UNKNOWN", () => {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const { source } = makeSource();
  const game = new GameAdapter(source);
  const ledger = new ActionLedger({
    nextActionId: () => "A-unknown",
    nextCorrelationId: () => "C-unknown",
  });
  const boundary = new ActionBoundary(ledger, game, {
    move() {
      throw new Error("transport lost");
    },
    resolveEntity() {
      return null;
    },
    canAttack() {
      return false;
    },
    attack() {},
  });

  const result = boundary.move({
    x: 100,
    y: 200,
    module: "Movement",
    why: "TEST_UNCERTAIN_MOVE",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(ledger.canRetry(result.id), false);
  assert.throws(
    () => ledger.assertRetryAllowed(result.id),
    /must not be retried blindly/,
  );
});

test("ActionBoundary blocks attack preflight without dispatch", async () => {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const { source } = makeSource();
  const game = new GameAdapter(source);
  const ledger = new ActionLedger({
    nextActionId: () => "A-blocked",
    nextCorrelationId: () => "C-blocked",
  });
  let attackCalls = 0;
  const boundary = new ActionBoundary(ledger, game, {
    move() {},
    resolveEntity() {
      return { id: "m-1" };
    },
    canAttack() {
      return false;
    },
    attack() {
      attackCalls += 1;
    },
  });

  const result = await boundary.attack({
    targetId: "m-1",
    module: "Combat",
    why: "TARGET_SELECTED",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(attackCalls, 0);
});

test("ActionBoundary confirms resolved attack and records after evidence", async () => {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const { state, source } = makeSource();
  const game = new GameAdapter(source);
  const ledger = new ActionLedger({
    nextActionId: () => "A-attack",
    nextCorrelationId: () => "C-attack",
  });
  const boundary = new ActionBoundary(ledger, game, {
    move() {},
    resolveEntity(id) {
      return state.entities[id] || null;
    },
    canAttack() {
      return true;
    },
    async attack(entity) {
      entity.hp = 70;
      return "ok";
    },
  });

  const result = await boundary.attack({
    targetId: "m-1",
    module: "Combat",
    why: "SAFE_TARGET",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.after.target.hp, 70);
  assert.equal(result.evidence.apiResolved, true);
  assert.equal(result.evidence.result, "ok");
});

test("ActionBoundary never relabels an uncertain dispatched attack as BLOCKED", async () => {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const { state, source } = makeSource();
  const game = new GameAdapter(source);
  const ledger = new ActionLedger({
    nextActionId: () => "A-attack-unknown",
    nextCorrelationId: () => "C-attack-unknown",
  });
  const boundary = new ActionBoundary(ledger, game, {
    move() {},
    resolveEntity(id) {
      return state.entities[id] || null;
    },
    canAttack() {
      return true;
    },
    async attack() {
      throw new Error("socket timeout");
    },
  });

  const result = await boundary.attack({
    targetId: "m-1",
    module: "Combat",
    why: "SAFE_TARGET",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.dispatchedAt !== undefined, true);
  assert.equal(ledger.canRetry(result.id), false);
});

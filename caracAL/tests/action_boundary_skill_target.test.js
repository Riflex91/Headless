"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

test("skill target IDs are resolved inside ActionBoundary", async () => {
  const { ActionBoundary } = loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "action-boundary.lib.ts",
    ),
  );

  const target = { id: "monster-1" };
  let calledArgs = null;
  let sequence = 0;
  const ledger = {
    create(intent) {
      sequence += 1;
      return { id: `A-${sequence}`, status: "INTENT", intent };
    },
    dispatch(id) {
      return { id, status: "DISPATCHED" };
    },
    confirm(id) {
      return { id, status: "CONFIRMED" };
    },
    reject(id) {
      return { id, status: "REJECTED" };
    },
    unknown(id) {
      return { id, status: "UNKNOWN" };
    },
    block(id) {
      return { id, status: "BLOCKED" };
    },
    get() {
      return undefined;
    },
  };
  const game = {
    character: () => ({
      name: "Test",
      ctype: "ranger",
      map: "main",
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      mp: 500,
      maxMp: 500,
      range: 120,
      gold: 0,
      target: "monster-1",
      rip: false,
      moving: false,
    }),
    entity: (id) =>
      id === "monster-1"
        ? {
            id,
            type: "monster",
            name: null,
            mtype: "goo",
            map: "main",
            x: 50,
            y: 0,
            hp: 100,
            maxHp: 100,
            target: null,
            dead: false,
            rip: false,
          }
        : null,
    skills: () => [
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
    ],
    inventory: () => [],
    equipment: () => ({}),
    tradeSlots: () => ({}),
    party: () => ({}),
    bank: () => ({ available: false, gold: null, packs: [], access: [] }),
    map: () => ({ name: "main", x: 0, y: 0 }),
    gameData: () => ({}),
  };
  const driver = {
    resolveEntity: (id) => (id === "monster-1" ? target : null),
    canUseSkill: () => true,
    useSkill: async (...args) => {
      calledArgs = args;
      return true;
    },
  };

  const boundary = new ActionBoundary(ledger, game, driver);
  const result = await boundary.useSkill({
    skill: "huntersmark",
    targetId: "monster-1",
    module: "Test",
    why: "TEST_TARGET_SKILL",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(calledArgs[0], "huntersmark");
  assert.equal(calledArgs[1], target);
});

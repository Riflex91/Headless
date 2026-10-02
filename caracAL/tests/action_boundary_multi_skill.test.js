"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

test("ActionBoundary resolves multi-target skill entity arrays", async () => {
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

  const resolved = {
    m1: { id: "m1" },
    m2: { id: "m2" },
    m3: { id: "m3" },
  };
  let called = null;
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
  const character = {
    name: "Ranger",
    ctype: "ranger",
    map: "main",
    x: 0,
    y: 0,
    hp: 1000,
    maxHp: 1000,
    mp: 1000,
    maxMp: 1000,
    range: 140,
    gold: 0,
    target: null,
    rip: false,
    moving: false,
  };
  const entities = {
    m1: { ...resolved.m1, type: "monster", x: 10, y: 0, hp: 100 },
    m2: { ...resolved.m2, type: "monster", x: 20, y: 0, hp: 100 },
    m3: { ...resolved.m3, type: "monster", x: 30, y: 0, hp: 100 },
  };
  const game = {
    character: () => ({ ...character }),
    entity: (id) => entities[id] || null,
    skills: () => [
      {
        key: "3shot",
        name: "3-Shot",
        classes: ["ranger"],
        mp: 200,
        cooldown: null,
        range: 140,
        hostile: true,
        party: false,
        passive: false,
      },
    ],
  };
  const driver = {
    resolveEntity: (id) => resolved[id] || null,
    canUseSkill: () => true,
    async useSkill(...args) {
      called = args;
      return true;
    },
  };

  const boundary = new ActionBoundary(ledger, game, driver);
  const result = await boundary.useSkill({
    skill: "3shot",
    targetIds: ["m1", "m2", "m3"],
    module: "GroupCombatController",
    why: "AOE_TARGET_THRESHOLD",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(called[0], "3shot");
  assert.deepEqual(called[1], [resolved.m1, resolved.m2, resolved.m3]);
});

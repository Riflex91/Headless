"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

function record(action, status = "CONFIRMED", extras = {}) {
  return {
    id: action + "-1",
    correlationId: action + "-C",
    module: "MerchantFishingController",
    action,
    why: action,
    createdAt: 1,
    dispatchedAt: 1,
    completedAt: 1,
    status,
    ...extras,
  };
}

function fixture(options = {}) {
  const state = {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      x: 0,
      y: 0,
      hp: 1000,
      maxHp: 1000,
      mp: 500,
      maxMp: 500,
      level: 30,
      xp: 0,
      attack: 100,
      frequency: 1,
      armor: 0,
      resistance: 0,
      range: 25,
      gold: 100000,
      target: null,
      rip: false,
      moving: false,
    },
    inventory: options.inventory || [
      { slot: 0, item: { name: "rod" } },
      { slot: 1, item: null },
      { slot: 2, item: null },
      { slot: 3, item: null },
    ],
    equipment: options.equipment || {
      mainhand: { name: "sword", level: 3, rid: "OLD-WEAPON" },
    },
    entities: options.entities || [],
    gameData: {
      items: {
        rod: { type: "tool", wtype: "rod", g: 2000 },
        staff: { type: "weapon", wtype: "staff", g: 6000 },
        sword: { type: "weapon", wtype: "sword", g: 1000 },
        spidersilk: { type: "material", g: 300 },
      },
      skills: {
        fishing: {
          class: ["merchant"],
          wtype: ["rod"],
          level: 16,
          mp: 120,
          reuse_cooldown: 2880000,
        },
      },
      craft: {
        rod: {
          items: [
            [1, "staff"],
            [1, "spidersilk"],
          ],
          cost: 100,
        },
      },
      maps: {
        main: {
          npcs: [
            { id: "basics", position: [0, 0] },
            { id: "craftsman", position: [100, 100] },
            { id: "fisherman", position: [-100, -100] },
          ],
          zones: [
            {
              type: "fishing",
              drop: "f1",
              polygon: [
                [-150, -150],
                [-50, -150],
                [-50, -50],
                [-150, -50],
              ],
            },
          ],
        },
      },
      npcs: {},
    },
  };
  const calls = [];

  const game = {
    character: () => ({ ...state.character }),
    inventory: () =>
      state.inventory.map((entry) => ({
        slot: entry.slot,
        item: entry.item ? { ...entry.item } : null,
      })),
    equipment: () => {
      const result = {};
      for (const [slot, item] of Object.entries(state.equipment)) {
        result[slot] = item ? { ...item } : null;
      }
      return result;
    },
    entities: () => state.entities.map((entity) => ({ ...entity })),
    cooldowns: () => [],
    gameData: () => state.gameData,
  };

  function firstEmptySlot() {
    return state.inventory.find((entry) => entry.item === null)?.slot ?? null;
  }

  const actions = {
    async useSkill(request) {
      calls.push(["useSkill", request.skill]);
      if (options.skillUnknown) return record("SKILL", "UNKNOWN");
      return record("SKILL", "CONFIRMED", {
        evidence: {
          result: {
            success: true,
            response:
              options.found === true ? "fishing_success" : "fishing_none",
            found: options.found === true,
          },
        },
      });
    },
    async equip(request) {
      calls.push(["equip", request.inventorySlot, request.slot]);
      if (options.equipUnknown) return record("EQUIP", "UNKNOWN");
      const inventoryEntry = state.inventory.find(
        (entry) => entry.slot === request.inventorySlot,
      );
      const previous = state.equipment[request.slot || "mainhand"] || null;
      state.equipment[request.slot || "mainhand"] = inventoryEntry.item;
      inventoryEntry.item = previous;
      return record("EQUIP");
    },
    async unequip(request) {
      calls.push(["unequip", request.slot]);
      const empty = firstEmptySlot();
      if (empty === null) return record("UNEQUIP", "BLOCKED");
      const entry = state.inventory.find(
        (candidate) => candidate.slot === empty,
      );
      entry.item = state.equipment[request.slot] || null;
      state.equipment[request.slot] = null;
      return record("UNEQUIP");
    },
    async buy(request) {
      calls.push(["buy", request.itemName]);
      const empty = firstEmptySlot();
      if (empty === null) return record("BUY", "BLOCKED");
      state.inventory.find((entry) => entry.slot === empty).item = {
        name: request.itemName,
      };
      state.character.gold -= state.gameData.items[request.itemName].g || 0;
      return record("BUY");
    },
    async craft(request) {
      calls.push(["craft", request.recipe, [...request.itemSlots]]);
      const first = state.inventory.find(
        (entry) => entry.slot === request.itemSlots[0],
      );
      const second = state.inventory.find(
        (entry) => entry.slot === request.itemSlots[1],
      );
      first.item = { name: "rod" };
      second.item = null;
      state.character.gold -= 100;
      return record("CRAFT");
    },
    async attack(request) {
      calls.push(["attack", request.targetId]);
      const spider = state.entities.find(
        (entity) => entity.id === request.targetId,
      );
      if (spider) {
        spider.dead = true;
        spider.hp = 0;
      }
      return record("ATTACK");
    },
    async loot() {
      calls.push(["loot"]);
      const empty = firstEmptySlot();
      if (empty !== null) {
        state.inventory.find((entry) => entry.slot === empty).item = {
          name: "spidersilk",
        };
      }
      return record("LOOT");
    },
  };

  const movement = {
    status() {
      return {
        owner: null,
        mode: "IDLE",
        path: null,
        safePoint: null,
        stuck: {},
        active: null,
      };
    },
    async smart(request) {
      calls.push(["smart", request.destination]);
      if (typeof request.destination === "string") {
        if (request.destination === "spider") {
          state.character.map = "main";
          state.character.x = 500;
          state.character.y = 500;
        }
      } else {
        state.character.map = request.destination.map || state.character.map;
        state.character.x = request.destination.x;
        state.character.y = request.destination.y;
      }
      state.character.moving = false;
      return record("SMART_MOVE");
    },
  };

  const events = [];
  const { MerchantFishingController } = core(
    "merchant-fishing-controller.lib.ts",
  );
  const controller = new MerchantFishingController(game, actions, movement, {
    now: () => 1000,
    config: () => ({
      merchantAutonomy: {
        enabled: true,
        fishing: {
          enabled: true,
          goldReserve: 1000,
          acquireTool: true,
        },
      },
    }),
    onEvent: (event) => events.push(event),
  });

  return { state, calls, controller, events };
}

test("Fishing follows zone -> equip -> skill result -> old weapon restore", async () => {
  const s = fixture({ found: false });

  assert.equal((await s.controller.tick()).state, "TRAVEL");
  assert.equal((await s.controller.tick()).state, "EQUIP");

  const result = await s.controller.tick();
  assert.equal(result.state, "RESULT");
  assert.equal(result.result.attempted, true);
  assert.equal(result.result.found, false);
  assert.equal(result.result.response, "fishing_none");

  const restore = await s.controller.tick();
  assert.equal(restore.state, "RESTORE");
  assert.equal(restore.restore.restored, true);
  assert.equal(s.state.equipment.mainhand.name, "sword");
  assert.equal(s.state.equipment.mainhand.rid, "OLD-WEAPON");

  const complete = await s.controller.tick();
  assert.equal(complete.state, "COMPLETE");
  assert.equal(complete.reason, "FISHING_ROADMAP_COMPLETE");
  assert.equal(
    s.calls.some(([name]) => name === "useSkill"),
    true,
  );
  assert.equal(
    s.events.some((event) => event.type === "FISHING_RESULT_CONFIRMED"),
    true,
  );
});

test("Fishing requests spidersilk from workers, crafts rod, and never attacks as merchant", async () => {
  const s = fixture({
    found: true,
    inventory: [
      { slot: 0, item: null },
      { slot: 1, item: null },
      { slot: 2, item: null },
      { slot: 3, item: null },
    ],
  });

  const staff = await s.controller.tick();
  assert.equal(staff.reason, "FISHING_STAFF_ACQUIRED");

  const request = await s.controller.tick();
  assert.equal(request.state, "TOOL_ACQUIRE");
  assert.equal(request.reason, "FISHING_WAITING_FOR_MATERIAL");
  assert.equal(request.materialRequest.pending, true);
  assert.equal(request.materialRequest.itemName, "spidersilk");
  assert.equal(request.materialRequest.quantity, 1);
  assert.equal(
    s.events.some((event) => event.type === "FISHING_MATERIAL_REQUESTED"),
    true,
  );
  assert.equal(
    s.calls.some(([name]) => name === "attack" || name === "loot"),
    false,
  );

  const empty = s.state.inventory.find((entry) => entry.item === null);
  empty.item = { name: "spidersilk" };
  s.controller.reportMaterialRequestResult({
    itemName: "spidersilk",
    success: true,
    reason: "FISHING_MATERIAL_DELIVERY_CONFIRMED",
  });

  const seen = [];
  for (let index = 0; index < 16; index += 1) {
    const current = await s.controller.tick();
    seen.push([current.state, current.reason]);
    if (current.state === "COMPLETE") break;
  }

  assert.equal(seen.at(-1)[0], "COMPLETE");
  assert.equal(
    s.calls.some(([name, item]) => name === "buy" && item === "staff"),
    true,
  );
  assert.equal(
    s.calls.some(([name, recipe]) => name === "craft" && recipe === "rod"),
    true,
  );
  assert.equal(s.calls.some(([name]) => name === "useSkill"), true);
  assert.equal(
    s.calls.some(([name]) => name === "attack" || name === "loot"),
    false,
  );
  assert.equal(s.state.equipment.mainhand.name, "sword");
  assert.equal(s.state.equipment.mainhand.rid, "OLD-WEAPON");
});

test("Fishing blocks after an explicit worker-pool material failure", async () => {
  const s = fixture({
    inventory: [
      { slot: 0, item: { name: "staff" } },
      { slot: 1, item: null },
      { slot: 2, item: null },
      { slot: 3, item: null },
    ],
  });

  const request = await s.controller.tick();
  assert.equal(request.reason, "FISHING_WAITING_FOR_MATERIAL");

  s.controller.reportMaterialRequestResult({
    itemName: "spidersilk",
    success: false,
    reason: "FISHING_MATERIAL_NO_WORKER_SUCCEEDED",
  });
  const blocked = await s.controller.tick();

  assert.equal(blocked.state, "BLOCKED");
  assert.equal(
    blocked.reason,
    "FISHING_MATERIAL_REQUEST_FAILED:FISHING_MATERIAL_NO_WORKER_SUCCEEDED",
  );
});

test("Fishing stops permanently after UNKNOWN equipment mutation", async () => {
  const s = fixture({ equipUnknown: true });

  await s.controller.tick();
  const first = await s.controller.tick();
  const second = await s.controller.tick();

  assert.equal(first.state, "UNKNOWN");
  assert.equal(second.state, "UNKNOWN");
  assert.match(second.reason, /REQUIRES_RECONCILIATION/);
  assert.equal(s.calls.filter(([name]) => name === "equip").length, 1);
  assert.equal(
    s.events.some((event) => event.type === "FISHING_ACTION_UNKNOWN"),
    true,
  );
});

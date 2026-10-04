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

function action(actionName, status = "CONFIRMED") {
  return {
    id: actionName + "-1",
    correlationId: "C-1",
    module: "MaterialGatheringTask",
    action: actionName,
    why: actionName,
    createdAt: 1,
    status,
  };
}

function setup({ existingMaterial = false, unknownAttack = false } = {}) {
  let now = 1000;
  const state = {
    character: {
      name: "My_Ranger1",
      ctype: "ranger",
      map: "main",
      x: 0,
      y: 0,
      range: 50,
      rip: false,
    },
    inventory: [
      {
        slot: 0,
        item: existingMaterial ? { name: "spidersilk", q: 1 } : null,
      },
      { slot: 1, item: null },
    ],
    entities: existingMaterial
      ? []
      : [
          {
            id: "spider-1",
            name: "Spider",
            type: "monster",
            mtype: "spider",
            map: "main",
            x: 10,
            y: 0,
            hp: 20,
            maxHp: 20,
            dead: false,
            rip: false,
          },
        ],
  };
  const calls = [];

  const game = {
    character() {
      return { ...state.character };
    },
    inventory() {
      return state.inventory.map((entry) => ({
        slot: entry.slot,
        item: entry.item ? { ...entry.item } : null,
      }));
    },
    entities() {
      return state.entities.map((entity) => ({ ...entity }));
    },
    entity(id) {
      const entity = state.entities.find((candidate) => candidate.id === id);
      return entity ? { ...entity } : null;
    },
  };

  const combat = {
    override: null,
    preferred: null,
    setConfigOverride(value) {
      this.override = value;
      calls.push(["combatOverride", true]);
    },
    clearConfigOverride() {
      this.override = null;
      calls.push(["combatOverride", false]);
    },
    setPreferredTargetId(id) {
      this.preferred = id;
      calls.push(["preferred", id]);
    },
    status() {
      return {
        state: "IDLE",
        reason: "NO_ELIGIBLE_TARGET",
      };
    },
    async tick() {
      calls.push(["combatTick"]);
      if (unknownAttack) {
        return {
          state: "BLOCKED",
          reason: "ATTACK_OUTCOME_UNKNOWN",
        };
      }
      const entity = state.entities.find(
        (candidate) => candidate.id === this.preferred,
      );
      if (entity) {
        entity.hp = 0;
        entity.dead = true;
      }
      return {
        state: "ATTACKING",
        reason: "ATTACK_DISPATCHED",
      };
    },
  };

  const movement = {
    status() {
      return {
        owner: null,
        mode: "IDLE",
        active: null,
      };
    },
    async smart(request) {
      calls.push(["smart", request.destination]);
      if (typeof request.destination === "object") {
        state.character.map = request.destination.map || state.character.map;
        state.character.x = request.destination.x;
        state.character.y = request.destination.y;
      }
      return action("SMART_MOVE");
    },
  };

  const actions = {
    async loot() {
      calls.push(["loot"]);
      if (!state.inventory[0].item) {
        state.inventory[0].item = { name: "spidersilk", q: 1 };
      }
      return action("LOOT");
    },
  };

  const logistics = {
    async execute(claim) {
      calls.push(["logistics", claim]);
      const slot = state.inventory.find(
        (entry) => entry.item?.name === claim.itemName,
      );
      if (!slot) {
        return {
          claimId: claim.id,
          type: claim.type,
          source: "My_Ranger1",
          target: "My_Merchant",
          outcome: "BLOCKED",
          reason: "CLAIM_ITEM_UNAVAILABLE",
          actionId: null,
          itemName: claim.itemName,
          requestedQuantity: claim.quantity,
          executedQuantity: null,
          amount: null,
          fulfilled: false,
        };
      }
      slot.item = null;
      return {
        claimId: claim.id,
        type: claim.type,
        source: "My_Ranger1",
        target: "My_Merchant",
        outcome: "CONFIRMED",
        reason: "SEND_ITEM_STATE_CONFIRMED",
        actionId: "SEND-1",
        itemName: claim.itemName,
        requestedQuantity: claim.quantity,
        executedQuantity: claim.quantity,
        amount: null,
        fulfilled: true,
      };
    },
  };

  const { MaterialGatheringTaskRunner } = core(
    "material-gathering-task.lib.ts",
  );
  const runner = new MaterialGatheringTaskRunner({
    game,
    combat,
    movement,
    actions,
    logistics,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  return { runner, state, calls, combat };
}

function options() {
  return {
    requestId: "material-1",
    itemName: "spidersilk",
    monsterType: "spider",
    quantity: 1,
    recipient: "My_Merchant",
    recipientPosition: {
      map: "main",
      x: 100,
      y: 100,
    },
    timeoutMs: 30000,
    pollMs: 100,
  };
}

test("material worker delivers existing ranger stock without combat", async () => {
  const s = setup({ existingMaterial: true });

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MATERIAL_GATHER_AND_DELIVERY_CONFIRMED");
  assert.equal(result.inventory.deliveredQuantity, 1);
  assert.equal(result.evidence.deliveryConfirmed, true);
  assert.equal(
    s.calls.some(([name]) => name === "combatTick"),
    false,
  );
  assert.equal(
    s.calls.some(
      ([name, claim]) =>
        name === "logistics" &&
        claim.type === "MATERIAL_DELIVERY" &&
        claim.metadata.authorized === true,
    ),
    true,
  );
  assert.equal(result.cleanup.combatOverrideCleared, true);
  assert.equal(result.cleanup.preferredTargetCleared, true);
});

test("material worker uses CombatController, loots, and delivers acquired spidersilk", async () => {
  const s = setup();

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidence.combatControllerUsed, true);
  assert.equal(result.evidence.lootConfirmed, true);
  assert.equal(result.evidence.materialObserved, true);
  assert.equal(result.evidence.deliveryConfirmed, true);
  assert.equal(
    s.calls.some(([name]) => name === "combatTick"),
    true,
  );
  assert.equal(
    s.calls.some(([name]) => name === "loot"),
    true,
  );
  assert.equal(
    s.calls.some(([name]) => name === "logistics"),
    true,
  );
});

test("compound material worker preserves exact level and purpose in delivery claim", async () => {
  const s = setup({ existingMaterial: true });
  s.state.inventory[0].item = { name: "ring", level: 0 };

  const result = await s.runner.run({
    ...options(),
    itemName: "ring",
    itemLevel: 0,
    monsterType: "goo",
    purpose: "COMPOUND_TEST_MATERIAL",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.itemLevel, 0);
  const delivery = s.calls.find(([name]) => name === "logistics");
  assert.ok(delivery);
  assert.equal(delivery[1].metadata.purpose, "COMPOUND_TEST_MATERIAL");
  assert.equal(delivery[1].metadata.itemLevel, 0);
});

test("material worker can keep qualifying minimum-level gear on the worker", async () => {
  const s = setup({ existingMaterial: true });
  s.state.inventory[0].item = { name: "helmet", level: 2 };

  const result = await s.runner.run({
    requestId: "gear-1",
    itemName: "helmet",
    minimumItemLevel: 1,
    monsterType: "goo",
    quantity: 1,
    deliveryMode: "KEEP_ON_WORKER",
    timeoutMs: 30000,
    pollMs: 100,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MATERIAL_GATHER_KEEP_ON_WORKER_CONFIRMED");
  assert.equal(result.minimumItemLevel, 1);
  assert.equal(result.deliveryMode, "KEEP_ON_WORKER");
  assert.equal(result.recipient, null);
  assert.equal(result.evidence.materialObserved, true);
  assert.equal(result.evidence.deliveryConfirmed, false);
  assert.equal(result.evidence.keptOnWorkerConfirmed, true);
  assert.equal(
    s.calls.some(([name]) => name === "logistics"),
    false,
  );
});

test("minimum-level gear filtering does not accept a lower-level item", async () => {
  const s = setup({ existingMaterial: true });
  s.state.inventory[0].item = { name: "helmet", level: 0 };

  const result = await s.runner.run({
    requestId: "gear-2",
    itemName: "helmet",
    minimumItemLevel: 1,
    monsterType: "missingmonster",
    quantity: 1,
    deliveryMode: "KEEP_ON_WORKER",
    timeoutMs: 30000,
    pollMs: 100,
  });

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.reason, "MATERIAL_GATHER_TIMEOUT");
  assert.equal(result.evidence.materialObserved, false);
  assert.equal(result.evidence.keptOnWorkerConfirmed, false);
  assert.equal(
    s.calls.some(([name]) => name === "logistics"),
    false,
  );
});

test("material worker rejects simultaneous exact and minimum item levels", async () => {
  const s = setup({ existingMaterial: true });
  s.state.inventory[0].item = { name: "helmet", level: 2 };

  const result = await s.runner.run({
    requestId: "gear-invalid",
    itemName: "helmet",
    itemLevel: 2,
    minimumItemLevel: 1,
    monsterType: "goo",
    quantity: 1,
    deliveryMode: "KEEP_ON_WORKER",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MATERIAL_GATHER_REQUEST_INVALID");
  assert.equal(
    s.calls.some(([name]) => name === "combatOverride"),
    false,
  );
  assert.equal(
    s.calls.some(([name]) => name === "logistics"),
    false,
  );
});

test("material worker never fails over internally after unreconciled UNKNOWN attack", async () => {
  const s = setup({ unknownAttack: true });

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "MATERIAL_ATTACK_OUTCOME_UNKNOWN");
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(
    s.calls.some(([name]) => name === "logistics"),
    false,
  );
  assert.equal(result.cleanup.combatOverrideCleared, true);
  assert.equal(result.cleanup.preferredTargetCleared, true);
});

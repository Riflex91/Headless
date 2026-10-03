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

function makeState() {
  return {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      x: 0,
      y: 0,
      hp: 900,
      max_hp: 900,
      mp: 500,
      max_mp: 500,
      gold: 10000,
      target: null,
      rip: false,
      moving: false,
      items: [
        { name: "hpot1", q: 10 },
        { name: "bow", level: 2, l: "locked" },
        null,
      ],
      slots: {},
    },
    entities: {
      target: {
        id: "target",
        type: "monster",
        mtype: "goo",
        map: "main",
        x: 10,
        y: 10,
        hp: 100,
        max_hp: 100,
      },
    },
    party: {},
    G: {
      items: {
        hpot1: { name: "Health Potion", g: 100 },
        bow: { name: "Bow", g: 1000 },
      },
      skills: {
        mluck: {
          name: "Merchant's Luck",
          class: ["merchant"],
          mp: 10,
          cooldown: 1000,
          range: 320,
        },
      },
    },
  };
}

function makeGameAdapter(state) {
  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  return new GameAdapter({
    character: () => state.character,
    entities: () => state.entities,
    party: () => state.party,
    gameData: () => state.G,
    nextSkill: () => ({}),
    bankPacks: () => ({}),
    now: () => 1000,
  });
}

function makeLedger(options = {}) {
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  let actionId = 0;
  return new ActionLedger({
    nextActionId: () => `A-${++actionId}`,
    nextCorrelationId: () => `C-${actionId}`,
    ...options,
  });
}

function makeDriver(overrides = {}) {
  return {
    move() {},
    resolveEntity() {
      return null;
    },
    canAttack() {
      return true;
    },
    async attack() {},
    canUseSkill() {
      return true;
    },
    async useSkill() {
      return { success: true };
    },
    async loot() {
      return { success: true };
    },
    async buy() {
      return { success: true };
    },
    async sell() {},
    async sendItem() {},
    async sendGold() {},
    ...overrides,
  };
}

function makeBoundary(state, driver, ledger = makeLedger()) {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  return {
    boundary: new ActionBoundary(
      ledger,
      makeGameAdapter(state),
      makeDriver(driver),
    ),
    ledger,
  };
}

test("attack treats structured API rejection as retryable rejection while preserving unstructured UNKNOWN safety", async () => {
  const rejectedState = makeState();
  const rejected = makeBoundary(rejectedState, {
    resolveEntity(id) {
      return rejectedState.entities[id] || null;
    },
    async attack() {
      throw { reason: "too_far", distance: 60 };
    },
  });

  const rejectedResult = await rejected.boundary.attack({
    targetId: "target",
    module: "CombatController",
    why: "TARGET_IN_RANGE_AND_READY",
  });

  assert.equal(rejectedResult.status, "REJECTED");
  assert.equal(rejectedResult.evidence.reason, "too_far");
  assert.equal(rejected.ledger.canRetry(rejectedResult.id), true);

  const unknownState = makeState();
  const unknown = makeBoundary(unknownState, {
    resolveEntity(id) {
      return unknownState.entities[id] || null;
    },
    async attack() {
      throw new Error("socket timeout");
    },
  });

  const unknownResult = await unknown.boundary.attack({
    targetId: "target",
    module: "CombatController",
    why: "TARGET_IN_RANGE_AND_READY",
  });

  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknown.ledger.canRetry(unknownResult.id), false);
});

test("skill is blocked before dispatch during emergency stop", async () => {
  const state = makeState();
  let calls = 0;
  const ledger = makeLedger({
    isEmergencyStopActive: () => true,
  });
  const { boundary } = makeBoundary(
    state,
    {
      async useSkill() {
        calls += 1;
      },
    },
    ledger,
  );

  const result = await boundary.useSkill({
    skill: "mluck",
    module: "MerchantSkills",
    why: "BUFF_TARGET",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("skill preflight blocks unknown or unavailable skills", async () => {
  const state = makeState();
  const unknown = makeBoundary(state).boundary;
  const unknownResult = await unknown.useSkill({
    skill: "does_not_exist",
    module: "Skills",
    why: "TEST",
  });
  assert.equal(unknownResult.status, "BLOCKED");

  const unavailable = makeBoundary(state, {
    canUseSkill() {
      return false;
    },
  }).boundary;
  const unavailableResult = await unavailable.useSkill({
    skill: "mluck",
    module: "Skills",
    why: "COOLDOWN_CHECK",
  });
  assert.equal(unavailableResult.status, "BLOCKED");
  assert.equal(unavailableResult.dispatchedAt, undefined);
});

test("skill API resolution confirms while thrown post-dispatch result is UNKNOWN", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async useSkill() {
      state.character.mp -= 10;
      return { success: true };
    },
  }).boundary;

  const confirmedResult = await confirmed.useSkill({
    skill: "mluck",
    args: ["Friend"],
    module: "MerchantSkills",
    why: "MLUCK_FRIEND",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");
  assert.equal(confirmedResult.expectedCost.mp, 10);

  const unknownSetup = makeBoundary(makeState(), {
    async useSkill() {
      throw new Error("socket timeout");
    },
  });
  const unknownResult = await unknownSetup.boundary.useSkill({
    skill: "mluck",
    module: "MerchantSkills",
    why: "MLUCK_SELF",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("loot confirms API resolution and keeps thrown post-dispatch failures UNKNOWN", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async loot() {
      state.character.gold += 50;
      return { success: true };
    },
  }).boundary;

  const confirmedResult = await confirmed.loot({
    chestId: "chest-1",
    module: "Loot",
    why: "CHEST_VISIBLE",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");

  const unknownSetup = makeBoundary(makeState(), {
    async loot() {
      throw new Error("lost response");
    },
  });
  const unknownResult = await unknownSetup.boundary.loot({
    module: "Loot",
    why: "LOOT_NEAREST",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("buy confirms explicit success and rejects explicit server failure", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async buy(_name, quantity) {
      state.character.gold -= 100 * quantity;
      state.character.items[0].q += quantity;
      return {
        success: true,
        response: "buy_success",
        place: "buy",
      };
    },
  }).boundary;

  const confirmedResult = await confirmed.buy({
    itemName: "hpot1",
    quantity: 2,
    module: "Supplies",
    why: "RESTOCK_HP",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");
  assert.equal(confirmedResult.expectedCost.gold, 200);

  const rejected = makeBoundary(makeState(), {
    async buy() {
      return { success: false, reason: "not_enough" };
    },
  }).boundary;
  const rejectedResult = await rejected.buy({
    itemName: "hpot1",
    quantity: 2,
    module: "Supplies",
    why: "RESTOCK_HP",
  });
  assert.equal(rejectedResult.status, "REJECTED");
});

test("buy without postcondition evidence becomes UNKNOWN and cannot blind retry", async () => {
  const setup = makeBoundary(makeState(), {
    async buy() {
      return undefined;
    },
  });
  const result = await setup.boundary.buy({
    itemName: "hpot1",
    module: "Supplies",
    why: "RESTOCK_HP",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.ledger.canRetry(result.id), false);
  assert.throws(
    () => setup.ledger.assertRetryAllowed(result.id),
    /must not be retried blindly/,
  );
});

test("sell blocks locked items before dispatch", async () => {
  const state = makeState();
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async sell() {
      calls += 1;
    },
  });

  const result = await boundary.sell({
    inventorySlot: 1,
    module: "Inventory",
    why: "SELL_UNUSED",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("sell confirms only with observable value-state change", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async sell(slot, quantity) {
      state.character.items[slot].q -= quantity;
      state.character.gold += 100 * quantity;
    },
  }).boundary;

  const confirmedResult = await confirmed.sell({
    inventorySlot: 0,
    quantity: 3,
    module: "Inventory",
    why: "SELL_SURPLUS",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");

  const unknownSetup = makeBoundary(makeState(), {
    async sell() {},
  });
  const unknownResult = await unknownSetup.boundary.sell({
    inventorySlot: 0,
    quantity: 1,
    module: "Inventory",
    why: "SELL_SURPLUS",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("send item blocks locked items and confirms inventory reduction", async () => {
  const state = makeState();
  const blocked = makeBoundary(state).boundary;
  const blockedResult = await blocked.sendItem({
    recipient: "My_Ranger1",
    inventorySlot: 1,
    module: "Logistics",
    why: "DELIVER_GEAR",
  });
  assert.equal(blockedResult.status, "BLOCKED");

  const confirmedState = makeState();
  const confirmed = makeBoundary(confirmedState, {
    async sendItem(_recipient, slot, quantity) {
      confirmedState.character.items[slot].q -= quantity;
    },
  }).boundary;
  const confirmedResult = await confirmed.sendItem({
    recipient: "My_Ranger1",
    inventorySlot: 0,
    quantity: 4,
    module: "Logistics",
    why: "DELIVER_POTIONS",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");
});

test("send item without inventory evidence is UNKNOWN and not retryable", async () => {
  const setup = makeBoundary(makeState(), {
    async sendItem() {},
  });
  const result = await setup.boundary.sendItem({
    recipient: "My_Ranger1",
    inventorySlot: 0,
    quantity: 2,
    module: "Logistics",
    why: "DELIVER_POTIONS",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("send gold blocks invalid funds and confirms own gold delta", async () => {
  const blocked = makeBoundary(makeState()).boundary;
  const blockedResult = await blocked.sendGold({
    recipient: "My_Ranger1",
    amount: 20000,
    module: "Logistics",
    why: "GOLD_TRANSFER",
  });
  assert.equal(blockedResult.status, "BLOCKED");

  const state = makeState();
  const confirmed = makeBoundary(state, {
    async sendGold(_recipient, amount) {
      state.character.gold -= amount;
    },
  }).boundary;
  const confirmedResult = await confirmed.sendGold({
    recipient: "My_Ranger1",
    amount: 2500,
    module: "Logistics",
    why: "GOLD_TRANSFER",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");
  assert.equal(confirmedResult.evidence.goldDelta, 2500);
});

test("send gold without observable debit is UNKNOWN and not retryable", async () => {
  const setup = makeBoundary(makeState(), {
    async sendGold() {},
  });
  const result = await setup.boundary.sendGold({
    recipient: "My_Ranger1",
    amount: 1000,
    module: "Logistics",
    why: "GOLD_TRANSFER",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

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
        { name: "iron", q: 2 },
        { name: "wood", q: 1 },
        { name: "raregem", level: 2 },
        null,
      ],
      slots: {
        mainhand: { name: "staff", level: 0 },
        trade1: {
          name: "hpot1",
          q: 20,
          price: 50,
          rid: "sale-rid",
        },
      },
      bank: null,
    },
    entities: {},
    party: {},
    G: {
      items: {
        iron: { name: "Iron" },
        wood: { name: "Wood" },
        raregem: { name: "Rare Gem" },
        swordx: { name: "Crafted Sword" },
        hpot1: { name: "Health Potion" },
      },
      craft: {
        swordx: {
          cost: 500,
          items: [
            [2, "iron"],
            [1, "wood"],
            [1, "raregem", 2],
          ],
        },
      },
      skills: {},
      maps: {},
      npcs: {},
    },
    bankPacks: {},
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
    bankPacks: () => state.bankPacks,
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
      return false;
    },
    async attack() {},
    canUseSkill() {
      return false;
    },
    async useSkill() {},
    async loot() {},
    async buy() {},
    async sell() {},
    async sendItem() {},
    async sendGold() {},
    async bankStore() {},
    async bankRetrieve() {},
    bankDeposit() {},
    bankWithdraw() {},
    async equip() {},
    unequip() {},
    async upgrade() {},
    async compound() {},
    async exchange() {},
    async craft() {},
    wishlist() {},
    ...overrides,
  };
}

function makeBoundary(state, driver = {}, ledger = makeLedger()) {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  return {
    game: makeGameAdapter(state),
    boundary: new ActionBoundary(
      ledger,
      makeGameAdapter(state),
      makeDriver(driver),
    ),
    ledger,
  };
}

test("own trade slot snapshots exclude equipment and do not leak live references", () => {
  const state = makeState();
  const game = makeGameAdapter(state);

  const tradeSlots = game.tradeSlots();
  assert.deepEqual(tradeSlots, {
    trade1: {
      name: "hpot1",
      q: 20,
      price: 50,
      rid: "sale-rid",
    },
  });

  tradeSlots.trade1.q = 999;
  assert.equal(state.character.slots.trade1.q, 20);
  assert.equal(game.equipment().trade1, undefined);
});

test("craft blocks unknown recipes and ingredient mismatches before dispatch", async () => {
  const state = makeState();
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async craft() {
      calls += 1;
    },
  });

  const unknown = await boundary.craft({
    recipe: "not-a-recipe",
    itemSlots: [0],
    module: "Craft",
    why: "CRAFT_UNKNOWN",
  });
  assert.equal(unknown.status, "BLOCKED");

  state.character.items[0].q = 1;
  const insufficient = await boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });
  assert.equal(insufficient.status, "BLOCKED");

  state.character.items[0].q = 2;
  state.character.items[2].level = 1;
  const wrongLevel = await boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });
  assert.equal(wrongLevel.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("craft blocks insufficient known gold before dispatch", async () => {
  const state = makeState();
  state.character.gold = 100;
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async craft() {
      calls += 1;
    },
  });

  const result = await boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("craft structured success confirms the executed recipe", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    async craft() {
      return {
        success: true,
        response: "craft",
        place: "craft",
        name: "swordx",
        num: 0,
      };
    },
  });

  const result = await boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.structuredSuccess, true);
  assert.equal(result.expectedCost.gold, 500);
});

test("craft failure response rejects while thrown post-dispatch failure is UNKNOWN", async () => {
  const rejected = makeBoundary(makeState(), {
    async craft() {
      return {
        failed: true,
        reason: "not_close_enough",
      };
    },
  }).boundary;
  const rejectedResult = await rejected.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });
  assert.equal(rejectedResult.status, "REJECTED");

  const unknownSetup = makeBoundary(makeState(), {
    async craft() {
      throw new Error("socket timeout");
    },
  });
  const unknownResult = await unknownSetup.boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("craft thrown structured rejection is REJECTED with preserved reason", async () => {
  const setup = makeBoundary(makeState(), {
    async craft() {
      throw { reason: "not_close_enough" };
    },
  });

  const result = await setup.boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.error, "not_close_enough");
  assert.equal(result.evidence.reason, "not_close_enough");
  assert.equal(setup.ledger.canRetry(result.id), true);
});

test("craft can confirm from observable ingredient consumption", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    async craft(itemSlots) {
      state.character.items[itemSlots[0]] = null;
      state.character.items[itemSlots[1]] = null;
      state.character.items[itemSlots[2]] = {
        name: "swordx",
        level: 0,
      };
      state.character.gold -= 500;
      return undefined;
    },
  });

  const result = await boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.ingredientStateChanged, true);
});

test("craft without API or state evidence is UNKNOWN and not retryable", async () => {
  const setup = makeBoundary(makeState());
  const result = await setup.boundary.craft({
    recipe: "swordx",
    itemSlots: [0, 1, 2],
    module: "Craft",
    why: "CRAFT_SWORD",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("wishlist validates slot item price level and quantity before dispatch", () => {
  const state = makeState();
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    wishlist() {
      calls += 1;
    },
  });

  const invalidSlot = boundary.wishlist({
    slot: "trade31",
    itemName: "hpot1",
    price: 100,
    module: "Merchant",
    why: "BUY_POTIONS",
  });
  assert.equal(invalidSlot.status, "BLOCKED");

  const invalidPrice = boundary.wishlist({
    slot: "trade2",
    itemName: "hpot1",
    price: 0,
    module: "Merchant",
    why: "BUY_POTIONS",
  });
  assert.equal(invalidPrice.status, "BLOCKED");

  const invalidItem = boundary.wishlist({
    slot: "trade2",
    itemName: "unknown",
    price: 100,
    module: "Merchant",
    why: "BUY_UNKNOWN",
  });
  assert.equal(invalidItem.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("wishlist confirms when own trade slot immediately reflects the request", () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    wishlist(slot, itemName, price, level, quantity) {
      const key = typeof slot === "number" ? `trade${slot}` : slot;
      state.character.slots[key] = {
        name: itemName,
        price,
        level: level ?? 0,
        q: quantity,
        b: true,
        rid: "wishlist-rid",
      };
    },
  });

  const result = boundary.wishlist({
    slot: 2,
    itemName: "hpot1",
    price: 100,
    level: 0,
    quantity: 25,
    module: "Merchant",
    why: "BUY_POTIONS",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.matched, true);
});

test("wishlist remains DISPATCHED without immediate state evidence", () => {
  const setup = makeBoundary(makeState());
  const result = setup.boundary.wishlist({
    slot: "trade2",
    itemName: "hpot1",
    price: 100,
    quantity: 10,
    module: "Merchant",
    why: "BUY_POTIONS",
  });

  assert.equal(result.status, "DISPATCHED");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("wishlist thrown post-dispatch failure is UNKNOWN", () => {
  const setup = makeBoundary(makeState(), {
    wishlist() {
      throw new Error("socket unavailable");
    },
  });
  const result = setup.boundary.wishlist({
    slot: "trade2",
    itemName: "hpot1",
    price: 100,
    module: "Merchant",
    why: "BUY_POTIONS",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("phase 4.6 mutation capabilities are advertised", () => {
  const { boundary } = makeBoundary(makeState());

  for (const capability of ["CRAFT", "WISHLIST"]) {
    assert.equal(boundary.capabilities().includes(capability), true);
  }
});

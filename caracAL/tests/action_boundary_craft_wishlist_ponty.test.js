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
      items: [{ name: "wood", q: 4 }, { name: "blade", level: 2 }, null, null],
      slots: {},
      bank: null,
    },
    entities: {},
    party: {},
    G: {
      items: {
        wood: { name: "Wood" },
        blade: { name: "Blade" },
        pickaxe: { name: "Pickaxe" },
        hpot1: { name: "Health Potion" },
        gem0: { name: "Gem" },
      },
      craft: {
        pickaxe: {
          cost: 1000,
          items: [
            [2, "wood"],
            [1, "blade", 2],
          ],
        },
      },
      skills: {},
      maps: {},
      npcs: {},
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
    async autoCraft() {},
    wishlist() {},
    pontyBuy() {},
    ...overrides,
  };
}

function makeBoundary(state, driver = {}, ledger = makeLedger()) {
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

test("craft blocks missing ingredients and insufficient gold before dispatch", async () => {
  const missingState = makeState();
  missingState.character.items[0].q = 1;
  let calls = 0;
  const missing = makeBoundary(missingState, {
    async autoCraft() {
      calls += 1;
    },
  }).boundary;

  const missingResult = await missing.craft({
    itemName: "pickaxe",
    module: "Craft",
    why: "MAKE_PICKAXE",
  });
  assert.equal(missingResult.status, "BLOCKED");

  const poorState = makeState();
  poorState.character.gold = 500;
  const poor = makeBoundary(poorState, {
    async autoCraft() {
      calls += 1;
    },
  }).boundary;
  const poorResult = await poor.craft({
    itemName: "pickaxe",
    module: "Craft",
    why: "MAKE_PICKAXE",
  });
  assert.equal(poorResult.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("craft explicit success is confirmed", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    async autoCraft() {
      state.character.items[2] = { name: "pickaxe" };
      state.character.gold -= 1000;
      return {
        success: true,
        response: "craft",
        place: "craft",
        name: "pickaxe",
        num: 2,
      };
    },
  });

  const result = await boundary.craft({
    itemName: "pickaxe",
    module: "Craft",
    why: "MAKE_PICKAXE",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.outputDelta, 1);
});

test("craft explicit failure is REJECTED while unverifiable result is UNKNOWN", async () => {
  const rejected = makeBoundary(makeState(), {
    async autoCraft() {
      return { failed: true, reason: "not_ready" };
    },
  }).boundary;
  const rejectedResult = await rejected.craft({
    itemName: "pickaxe",
    module: "Craft",
    why: "MAKE_PICKAXE",
  });
  assert.equal(rejectedResult.status, "REJECTED");

  const unknownSetup = makeBoundary(makeState(), {
    async autoCraft() {
      return undefined;
    },
  });
  const unknownResult = await unknownSetup.boundary.craft({
    itemName: "pickaxe",
    module: "Craft",
    why: "MAKE_PICKAXE",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("craft can confirm from observable output inventory settlement", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    async autoCraft() {
      state.character.items[2] = { name: "pickaxe" };
      return undefined;
    },
  });

  const result = await boundary.craft({
    itemName: "pickaxe",
    module: "Craft",
    why: "MAKE_PICKAXE",
  });

  assert.equal(result.status, "CONFIRMED");
});

test("wishlist validates slot item price level and quantity before dispatch", async () => {
  let calls = 0;
  const { boundary } = makeBoundary(makeState(), {
    wishlist() {
      calls += 1;
    },
  });

  for (const request of [
    {
      slot: "trade31",
      itemName: "hpot1",
      price: 100,
    },
    {
      slot: "trade1",
      itemName: "missing",
      price: 100,
    },
    {
      slot: "trade1",
      itemName: "hpot1",
      price: 0,
    },
    {
      slot: "trade1",
      itemName: "hpot1",
      price: 100,
      level: -1,
    },
    {
      slot: "trade1",
      itemName: "hpot1",
      price: 100,
      quantity: 0,
    },
  ]) {
    const result = await boundary.wishlist({
      ...request,
      module: "Market",
      why: "SET_WISHLIST",
    });
    assert.equal(result.status, "BLOCKED");
  }

  assert.equal(calls, 0);
});

test("wishlist fire-and-forget stays DISPATCHED without settlement evidence", async () => {
  const setup = makeBoundary(makeState(), {
    wishlist() {
      return undefined;
    },
  });

  const result = await setup.boundary.wishlist({
    slot: "trade1",
    itemName: "hpot1",
    price: 100,
    quantity: 50,
    module: "Market",
    why: "BUY_POTIONS",
  });

  assert.equal(result.status, "DISPATCHED");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("wishlist explicit response can confirm or reject", async () => {
  const confirmed = makeBoundary(makeState(), {
    wishlist() {
      return { success: true };
    },
  }).boundary;
  const confirmedResult = await confirmed.wishlist({
    slot: 1,
    itemName: "hpot1",
    price: 100,
    module: "Market",
    why: "BUY_POTIONS",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");

  const rejected = makeBoundary(makeState(), {
    wishlist() {
      return { success: false, reason: "invalid_slot" };
    },
  }).boundary;
  const rejectedResult = await rejected.wishlist({
    slot: "trade1",
    itemName: "hpot1",
    price: 100,
    module: "Market",
    why: "BUY_POTIONS",
  });
  assert.equal(rejectedResult.status, "REJECTED");
});

test("Ponty purchase blocks invalid metadata and insufficient funds", async () => {
  let calls = 0;
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    pontyBuy() {
      calls += 1;
    },
  });

  const badRid = await boundary.pontyBuy({
    rid: "",
    itemName: "gem0",
    price: 1000,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(badRid.status, "BLOCKED");

  const unknownItem = await boundary.pontyBuy({
    rid: "RID-1",
    itemName: "missing",
    price: 1000,
    module: "Ponty",
    why: "BUY_UNKNOWN",
  });
  assert.equal(unknownItem.status, "BLOCKED");

  const tooExpensive = await boundary.pontyBuy({
    rid: "RID-2",
    itemName: "gem0",
    price: 20000,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(tooExpensive.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("Ponty purchase confirms from own inventory or gold settlement", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    pontyBuy() {
      state.character.items[2] = { name: "gem0" };
      state.character.gold -= 2500;
      return true;
    },
  });

  const result = await boundary.pontyBuy({
    rid: "RID-1",
    itemName: "gem0",
    price: 2500,
    module: "Ponty",
    why: "BUY_GEM",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.itemDelta, 1);
  assert.equal(result.evidence.goldDelta, 2500);
});

test("Ponty fire-and-forget remains DISPATCHED and thrown emit is UNKNOWN", async () => {
  const dispatchedSetup = makeBoundary(makeState(), {
    pontyBuy() {
      return true;
    },
  });
  const dispatched = await dispatchedSetup.boundary.pontyBuy({
    rid: "RID-1",
    itemName: "gem0",
    price: 2500,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(dispatched.status, "DISPATCHED");
  assert.equal(dispatchedSetup.ledger.canRetry(dispatched.id), false);

  const unknownSetup = makeBoundary(makeState(), {
    pontyBuy() {
      throw new Error("socket unavailable");
    },
  });
  const unknown = await unknownSetup.boundary.pontyBuy({
    rid: "RID-2",
    itemName: "gem0",
    price: 2500,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(unknown.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknown.id), false);
});

test("phase 4.6 capabilities are advertised", () => {
  const capabilities = makeBoundary(makeState()).boundary.capabilities();

  for (const capability of ["CRAFT", "WISHLIST", "PONTY_BUY"]) {
    assert.equal(capabilities.includes(capability), true);
  }
});

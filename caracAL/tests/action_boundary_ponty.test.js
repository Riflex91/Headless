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
      items: [null, null, null],
      slots: {},
      bank: null,
    },
    entities: {},
    party: {},
    G: {
      items: {
        gem0: { name: "Gem" },
        hpot1: { name: "Health Potion" },
      },
      craft: {},
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
    async craft() {},
    wishlist() {},
    requestPontySnapshot() {
      return { items: [] };
    },
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

test("Ponty snapshot request is read-only and confirms correlated response without purchase", async () => {
  const state = makeState();
  let snapshotCalls = 0;
  let purchaseCalls = 0;
  const { boundary } = makeBoundary(state, {
    async requestPontySnapshot() {
      snapshotCalls += 1;
      return { items: [{ name: "gem0", rid: "RID-READ" }] };
    },
    pontyBuy() {
      purchaseCalls += 1;
    },
  });

  const beforeGold = state.character.gold;
  const beforeItems = structuredClone(state.character.items);
  const result = await boundary.requestPontySnapshot({
    module: "MarketIntelligenceLiveProbe",
    why: "PHASE16_PONTY_READ_REQUEST",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.action, "PONTY_SNAPSHOT_REQUEST");
  assert.equal(result.expectedEffect.valueMutation, false);
  assert.equal(result.evidence.readOnly, true);
  assert.equal(result.evidence.requestDispatched, true);
  assert.equal(result.evidence.responseReceived, true);
  assert.equal(result.evidence.itemCount, 1);
  assert.equal(snapshotCalls, 1);
  assert.equal(purchaseCalls, 0);
  assert.equal(state.character.gold, beforeGold);
  assert.deepEqual(state.character.items, beforeItems);
});

test("Ponty snapshot request failure becomes UNKNOWN and is not retryable", async () => {
  const setup = makeBoundary(makeState(), {
    requestPontySnapshot() {
      throw new Error("socket unavailable");
    },
  });

  const result = await setup.boundary.requestPontySnapshot({
    module: "MarketIntelligenceLiveProbe",
    why: "PHASE16_PONTY_READ_REQUEST",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.action, "PONTY_SNAPSHOT_REQUEST");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("Ponty snapshot invalid correlated response becomes UNKNOWN", async () => {
  const setup = makeBoundary(makeState(), {
    requestPontySnapshot() {
      return { success: true };
    },
  });

  const result = await setup.boundary.requestPontySnapshot({
    module: "MarketIntelligenceLiveProbe",
    why: "PHASE16_PONTY_READ_REQUEST",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.why, "PONTY_SNAPSHOT_RESPONSE_INVALID");
  assert.equal(result.evidence.responseReceived, true);
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("Ponty purchase blocks invalid listing metadata before dispatch", () => {
  let calls = 0;
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    pontyBuy() {
      calls += 1;
    },
  });

  const invalidRid = boundary.pontyBuy({
    rid: "",
    itemName: "gem0",
    price: 1000,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(invalidRid.status, "BLOCKED");

  const invalidItem = boundary.pontyBuy({
    rid: "RID-1",
    itemName: "missing",
    price: 1000,
    module: "Ponty",
    why: "BUY_UNKNOWN",
  });
  assert.equal(invalidItem.status, "BLOCKED");

  const invalidPrice = boundary.pontyBuy({
    rid: "RID-2",
    itemName: "gem0",
    price: 0,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(invalidPrice.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("Ponty purchase blocks known insufficient gold before dispatch", () => {
  const state = makeState();
  state.character.gold = 500;
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    pontyBuy() {
      calls += 1;
    },
  });

  const result = boundary.pontyBuy({
    rid: "RID-1",
    itemName: "gem0",
    price: 1000,
    module: "Ponty",
    why: "BUY_GEM",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("Ponty purchase confirms from own inventory and gold settlement", () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    pontyBuy() {
      state.character.items[0] = { name: "gem0" };
      state.character.gold -= 2500;
      return true;
    },
  });

  const result = boundary.pontyBuy({
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

test("Ponty fire-and-forget purchase stays DISPATCHED without settlement evidence", () => {
  const setup = makeBoundary(makeState(), {
    pontyBuy() {
      return true;
    },
  });

  const result = setup.boundary.pontyBuy({
    rid: "RID-1",
    itemName: "gem0",
    price: 2500,
    module: "Ponty",
    why: "BUY_GEM",
  });

  assert.equal(result.status, "DISPATCHED");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("Ponty explicit failure rejects and thrown socket failure becomes UNKNOWN", () => {
  const rejected = makeBoundary(makeState(), {
    pontyBuy() {
      return { success: false, reason: "sold" };
    },
  }).boundary;
  const rejectedResult = rejected.pontyBuy({
    rid: "RID-1",
    itemName: "gem0",
    price: 2500,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(rejectedResult.status, "REJECTED");

  const unknownSetup = makeBoundary(makeState(), {
    pontyBuy() {
      throw new Error("socket unavailable");
    },
  });
  const unknownResult = unknownSetup.boundary.pontyBuy({
    rid: "RID-2",
    itemName: "gem0",
    price: 2500,
    module: "Ponty",
    why: "BUY_GEM",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("Ponty capabilities are advertised by the ActionBoundary", () => {
  const capabilities = makeBoundary(makeState()).boundary.capabilities();
  assert.equal(capabilities.includes("PONTY_SNAPSHOT_REQUEST"), true);
  assert.equal(capabilities.includes("PONTY_BUY"), true);
});

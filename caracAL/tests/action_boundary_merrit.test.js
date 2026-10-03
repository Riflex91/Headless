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

function stateFixture() {
  return {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      in: "main",
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
      stand: false,
      merrit: {
        reasons: [{ code: "closed" }],
        next_at: 1000,
      },
      items: [{ name: "stand0" }, { name: "hpot0", q: 10 }, null, null],
      slots: {},
    },
    entities: {},
    party: {},
    G: {
      items: {
        stand0: { type: "stand", stand: "stand0" },
        hpot0: { type: "pot", s: 9999 },
      },
      craft: {},
      skills: {},
      maps: {},
      npcs: {},
    },
  };
}

function game(state) {
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

function ledger() {
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  let sequence = 0;
  return new ActionLedger({
    nextActionId: () => `M-${++sequence}`,
    nextCorrelationId: () => `MC-${sequence}`,
  });
}

function driver(overrides = {}) {
  return {
    move() {},
    smartMove() {},
    cancelMovement() {},
    resolveEntity() {
      return null;
    },
    canAttack() {
      return false;
    },
    attack() {},
    canUseSkill() {
      return false;
    },
    useSkill() {},
    loot() {},
    buy() {},
    sell() {},
    sendItem() {},
    sendGold() {},
    bankStore() {},
    bankRetrieve() {},
    bankDeposit() {},
    bankWithdraw() {},
    equip() {},
    unequip() {},
    upgrade() {},
    compound() {},
    exchange() {},
    craft() {},
    openStand() {},
    closeStand() {},
    tradeList() {},
    tradeUnlist() {},
    requestMerritStatus() {},
    wishlist() {},
    pontyBuy() {},
    partyInvite() {},
    partyRequest() {},
    partyAcceptInvite() {},
    partyAcceptRequest() {},
    partyLeave() {},
    respawn() {},
    ...overrides,
  };
}

function boundary(state, overrides = {}) {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const actionLedger = ledger();
  return {
    actionLedger,
    value: new ActionBoundary(actionLedger, game(state), driver(overrides)),
  };
}

test("game adapter exposes current stand, instance and Merrit server status", () => {
  const snapshot = game(stateFixture()).character();

  assert.equal(snapshot.instance, "main");
  assert.equal(snapshot.stand, false);
  assert.deepEqual(snapshot.merrit, {
    reasons: [{ code: "closed" }],
    next_at: 1000,
  });
});

test("stand open and close confirm only from observed character state", async () => {
  const state = stateFixture();
  const setup = boundary(state, {
    async openStand(slot) {
      assert.equal(slot, 0);
      state.character.stand = "stand0";
      return { success: true };
    },
    async closeStand() {
      state.character.stand = false;
      return { success: true };
    },
  });

  const opened = await setup.value.openStand({
    inventorySlot: 0,
    module: "MerchantMerrit",
    why: "MERRIT_STAND_REQUIRED",
  });
  assert.equal(opened.status, "CONFIRMED");

  const closed = await setup.value.closeStand({
    module: "MerchantMerrit",
    why: "MERRIT_TEST_RESTORE_STAND",
  });
  assert.equal(closed.status, "CONFIRMED");
});

test("stand outcome without observable confirmation is UNKNOWN and not retryable", async () => {
  const state = stateFixture();
  const setup = boundary(state, {
    async openStand() {
      return { success: true };
    },
  });

  const result = await setup.value.openStand({
    inventorySlot: 0,
    module: "MerchantMerrit",
    why: "MERRIT_STAND_REQUIRED",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.actionLedger.canRetry(result.id), false);
});

test("trade listing and reversible unlisting confirm from own trade slot", async () => {
  const state = stateFixture();
  const setup = boundary(state, {
    async tradeList(inventorySlot, slot, price, quantity) {
      const item = state.character.items[inventorySlot];
      state.character.items[inventorySlot] = null;
      state.character.slots[slot] = {
        ...item,
        q: quantity,
        price,
        rid: "MERRIT-RID",
      };
      return { success: true };
    },
    async tradeUnlist(slot) {
      state.character.items[2] = state.character.slots[slot];
      delete state.character.slots[slot];
      return { success: true };
    },
  });

  const listed = await setup.value.tradeList({
    inventorySlot: 1,
    slot: "trade1",
    price: 999999999,
    quantity: 1,
    module: "MerchantMerrit",
    why: "MERRIT_LISTING_REQUIRED",
  });
  assert.equal(listed.status, "CONFIRMED");
  assert.equal(state.character.slots.trade1.name, "hpot0");

  const unlisted = await setup.value.tradeUnlist({
    slot: "trade1",
    module: "MerchantMerrit",
    why: "MERRIT_TEST_RESTORE_LISTING",
  });
  assert.equal(unlisted.status, "CONFIRMED");
  assert.equal(state.character.slots.trade1, undefined);
});

test("Merrit status request is audited and capabilities are advertised", () => {
  let requested = 0;
  const setup = boundary(stateFixture(), {
    requestMerritStatus() {
      requested += 1;
    },
  });
  const statusRequest = setup.value.requestMerritStatus({
    module: "MerchantMerrit",
    why: "MERRIT_STATUS_REFRESH",
  });
  assert.equal(statusRequest.status, "CONFIRMED");
  assert.equal(requested, 1);

  const capabilities = setup.value.capabilities();
  for (const capability of [
    "OPEN_STAND",
    "CLOSE_STAND",
    "TRADE_LIST",
    "TRADE_UNLIST",
    "MERRIT_STATUS_REQUEST",
  ]) {
    assert.equal(capabilities.includes(capability), true, capability);
  }
});

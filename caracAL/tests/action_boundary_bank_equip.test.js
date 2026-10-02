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
      map: "bank",
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
      items: [{ name: "gem0", q: 2 }, { name: "bow", level: 2 }, null, null],
      slots: {
        mainhand: { name: "staff", level: 1 },
        offhand: null,
      },
      bank: {
        gold: 50000,
        items0: [null, { name: "scroll0", q: 3 }],
      },
    },
    entities: {},
    party: {},
    G: {
      items: {
        gem0: { name: "Gem" },
        bow: { name: "Bow" },
        staff: { name: "Staff" },
        scroll0: { name: "Scroll" },
      },
      skills: {},
      maps: {},
      npcs: {},
    },
    bankPacks: {
      items0: ["bank", 0, 0],
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

test("bank store blocks before dispatch when bank state is unavailable", async () => {
  const state = makeState();
  state.character.bank = null;
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async bankStore() {
      calls += 1;
    },
  });

  const result = await boundary.bankStore({
    inventorySlot: 0,
    pack: "items0",
    packSlot: 0,
    module: "Bank",
    why: "STORE_GEM",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("bank store confirms only when inventory or target bank slot changes", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async bankStore(inventorySlot, pack, packSlot) {
      state.character.bank[pack][packSlot] =
        state.character.items[inventorySlot];
      state.character.items[inventorySlot] = null;
    },
  }).boundary;

  const confirmedResult = await confirmed.bankStore({
    inventorySlot: 0,
    pack: "items0",
    packSlot: 0,
    module: "Bank",
    why: "STORE_GEM",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");

  const unknownSetup = makeBoundary(makeState());
  const unknownResult = await unknownSetup.boundary.bankStore({
    inventorySlot: 0,
    pack: "items0",
    packSlot: 0,
    module: "Bank",
    why: "STORE_GEM",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("bank retrieve confirms bank removal or inventory arrival", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async bankRetrieve(pack, packSlot, inventorySlot) {
      state.character.items[inventorySlot] =
        state.character.bank[pack][packSlot];
      state.character.bank[pack][packSlot] = null;
    },
  }).boundary;

  const result = await confirmed.bankRetrieve({
    pack: "items0",
    packSlot: 1,
    inventorySlot: 2,
    module: "Bank",
    why: "RETRIEVE_SCROLL",
  });

  assert.equal(result.status, "CONFIRMED");
});

test("bank retrieve blocks empty bank slots before dispatch", async () => {
  const state = makeState();
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async bankRetrieve() {
      calls += 1;
    },
  });

  const result = await boundary.bankRetrieve({
    pack: "items0",
    packSlot: 0,
    module: "Bank",
    why: "RETRIEVE_EMPTY",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("bank gold confirms observable settlement", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    bankDeposit(amount) {
      state.character.gold -= amount;
      state.character.bank.gold += amount;
    },
    bankWithdraw(amount) {
      state.character.bank.gold -= amount;
      state.character.gold += amount;
    },
  });

  const deposit = await boundary.bankDepositGold({
    amount: 2000,
    module: "Bank",
    why: "RESERVE_GOLD",
  });
  assert.equal(deposit.status, "CONFIRMED");

  const withdraw = await boundary.bankWithdrawGold({
    amount: 1000,
    module: "Bank",
    why: "RESTORE_CASH",
  });
  assert.equal(withdraw.status, "CONFIRMED");
});

test("fire-and-forget bank gold stays DISPATCHED without immediate evidence", async () => {
  const setup = makeBoundary(makeState());

  const result = await setup.boundary.bankDepositGold({
    amount: 1000,
    module: "Bank",
    why: "RESERVE_GOLD",
  });

  assert.equal(result.status, "DISPATCHED");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("bank withdraw blocks insufficient known bank gold", async () => {
  const state = makeState();
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    bankWithdraw() {
      calls += 1;
    },
  });

  const result = await boundary.bankWithdrawGold({
    amount: 60000,
    module: "Bank",
    why: "RESTORE_CASH",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("equip confirms only after source item reaches equipment", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async equip(inventorySlot, slot) {
      const previous = state.character.slots[slot];
      state.character.slots[slot] = state.character.items[inventorySlot];
      state.character.items[inventorySlot] = previous;
    },
  }).boundary;

  const result = await confirmed.equip({
    inventorySlot: 1,
    slot: "mainhand",
    module: "Gear",
    why: "EQUIP_BOW",
  });

  assert.equal(result.status, "CONFIRMED");

  const unknownSetup = makeBoundary(makeState());
  const unknownResult = await unknownSetup.boundary.equip({
    inventorySlot: 1,
    slot: "mainhand",
    module: "Gear",
    why: "EQUIP_BOW",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("unequip confirms equipment removal plus inventory arrival", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    unequip(slot) {
      state.character.items[2] = state.character.slots[slot];
      state.character.slots[slot] = null;
    },
  });

  const result = await boundary.unequip({
    slot: "mainhand",
    module: "Gear",
    why: "REMOVE_STAFF",
  });

  assert.equal(result.status, "CONFIRMED");
});

test("unequip blocks empty slots and keeps unverifiable dispatch UNKNOWN", async () => {
  const emptyState = makeState();
  emptyState.character.slots.offhand = null;
  const blocked = await makeBoundary(emptyState).boundary.unequip({
    slot: "offhand",
    module: "Gear",
    why: "REMOVE_OFFHAND",
  });
  assert.equal(blocked.status, "BLOCKED");

  const unknownSetup = makeBoundary(makeState());
  const unknown = await unknownSetup.boundary.unequip({
    slot: "mainhand",
    module: "Gear",
    why: "REMOVE_STAFF",
  });
  assert.equal(unknown.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknown.id), false);
});

test("bank and equipment capabilities are advertised by the boundary", () => {
  const { boundary } = makeBoundary(makeState());
  const capabilities = boundary.capabilities();

  for (const capability of [
    "BANK_STORE",
    "BANK_RETRIEVE",
    "BANK_DEPOSIT_GOLD",
    "BANK_WITHDRAW_GOLD",
    "EQUIP",
    "UNEQUIP",
  ]) {
    assert.equal(capabilities.includes(capability), true);
  }
});

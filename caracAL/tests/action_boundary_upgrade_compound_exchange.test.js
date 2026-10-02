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
      gold: 100000,
      target: null,
      rip: false,
      moving: false,
      items: [
        { name: "sword", level: 0 },
        { name: "scroll0", q: 5 },
        { name: "offeringp", q: 2 },
        { name: "ring", level: 0 },
        { name: "ring", level: 0 },
        { name: "ring", level: 0 },
        { name: "cscroll0", q: 4 },
        { name: "token", q: 5 },
        null,
      ],
      slots: {},
    },
    entities: {},
    party: {},
    G: {
      items: {
        sword: {
          name: "Sword",
          upgrade: { attack: 2 },
        },
        scroll0: {
          name: "Upgrade Scroll",
        },
        offeringp: {
          name: "Primordial Essence",
        },
        ring: {
          name: "Ring",
          compound: { attack: 1 },
        },
        cscroll0: {
          name: "Compound Scroll",
        },
        token: {
          name: "Exchange Token",
          e: 5,
        },
        junk: {
          name: "Junk",
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

test("upgrade blocks non-upgradable or invalid slot plans before dispatch", async () => {
  const state = makeState();
  state.character.items[0] = { name: "junk" };
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async upgrade() {
      calls += 1;
    },
  });

  const notUpgradable = await boundary.upgrade({
    itemSlot: 0,
    scrollSlot: 1,
    module: "Upgrade",
    why: "TEST_INVALID_ITEM",
  });
  assert.equal(notUpgradable.status, "BLOCKED");

  state.character.items[0] = { name: "sword", level: 0 };
  const overlapping = await boundary.upgrade({
    itemSlot: 0,
    scrollSlot: 0,
    module: "Upgrade",
    why: "TEST_OVERLAP",
  });
  assert.equal(overlapping.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("upgrade chance failure is a confirmed executed outcome", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    async upgrade() {
      return {
        success: false,
        level: 0,
        num: 0,
      };
    },
  });

  const result = await boundary.upgrade({
    itemSlot: 0,
    scrollSlot: 1,
    offeringSlot: 2,
    module: "Upgrade",
    why: "UPGRADE_SWORD",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.upgradeSucceeded, false);
});

test("upgrade precondition rejection is REJECTED while thrown outcome is UNKNOWN", async () => {
  const rejected = makeBoundary(makeState(), {
    async upgrade() {
      return { reason: "not_enough_gold" };
    },
  }).boundary;
  const rejectedResult = await rejected.upgrade({
    itemSlot: 0,
    scrollSlot: 1,
    module: "Upgrade",
    why: "UPGRADE_SWORD",
  });
  assert.equal(rejectedResult.status, "REJECTED");

  const unknownSetup = makeBoundary(makeState(), {
    async upgrade() {
      throw new Error("socket timeout");
    },
  });
  const unknownResult = await unknownSetup.boundary.upgrade({
    itemSlot: 0,
    scrollSlot: 1,
    module: "Upgrade",
    why: "UPGRADE_SWORD",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("upgrade can confirm from observable inventory state change", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    async upgrade(itemSlot) {
      state.character.items[itemSlot].level = 1;
      return undefined;
    },
  });

  const result = await boundary.upgrade({
    itemSlot: 0,
    scrollSlot: 1,
    module: "Upgrade",
    why: "UPGRADE_SWORD",
  });

  assert.equal(result.status, "CONFIRMED");
});

test("compound blocks mismatched items before dispatch", async () => {
  const state = makeState();
  state.character.items[5] = { name: "sword", level: 0 };
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async compound() {
      calls += 1;
    },
  });

  const result = await boundary.compound({
    itemSlots: [3, 4, 5],
    scrollSlot: 6,
    module: "Compound",
    why: "COMPOUND_RING",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("compound chance failure is a confirmed executed outcome", async () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    async compound() {
      return {
        success: false,
        level: 0,
        num: 3,
      };
    },
  });

  const result = await boundary.compound({
    itemSlots: [3, 4, 5],
    scrollSlot: 6,
    offeringSlot: 2,
    module: "Compound",
    why: "COMPOUND_RING",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.compoundSucceeded, false);
});

test("compound API rejection stays distinct from uncertain post-dispatch result", async () => {
  const rejected = makeBoundary(makeState(), {
    async compound() {
      return { reason: "invalid_scroll" };
    },
  }).boundary;
  const rejectedResult = await rejected.compound({
    itemSlots: [3, 4, 5],
    scrollSlot: 6,
    module: "Compound",
    why: "COMPOUND_RING",
  });
  assert.equal(rejectedResult.status, "REJECTED");

  const unknownSetup = makeBoundary(makeState(), {
    async compound() {
      return undefined;
    },
  });
  const unknownResult = await unknownSetup.boundary.compound({
    itemSlots: [3, 4, 5],
    scrollSlot: 6,
    module: "Compound",
    why: "COMPOUND_RING",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("exchange blocks non-exchangeable and insufficient stacks before dispatch", async () => {
  const state = makeState();
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    async exchange() {
      calls += 1;
    },
  });

  state.character.items[7] = { name: "junk", q: 5 };
  const notExchangeable = await boundary.exchange({
    itemSlot: 7,
    module: "Exchange",
    why: "EXCHANGE_JUNK",
  });
  assert.equal(notExchangeable.status, "BLOCKED");

  state.character.items[7] = { name: "token", q: 4 };
  const insufficient = await boundary.exchange({
    itemSlot: 7,
    module: "Exchange",
    why: "EXCHANGE_TOKEN",
  });
  assert.equal(insufficient.status, "BLOCKED");
  assert.equal(calls, 0);
});

test("exchange success confirms and explicit failed result rejects", async () => {
  const confirmed = makeBoundary(makeState(), {
    async exchange() {
      return {
        success: true,
        num: 7,
        reward: "gem0",
      };
    },
  }).boundary;
  const confirmedResult = await confirmed.exchange({
    itemSlot: 7,
    module: "Exchange",
    why: "EXCHANGE_TOKEN",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");
  assert.equal(confirmedResult.evidence.exchangeSucceeded, true);

  const rejected = makeBoundary(makeState(), {
    async exchange() {
      return {
        success: false,
        num: 7,
      };
    },
  }).boundary;
  const rejectedResult = await rejected.exchange({
    itemSlot: 7,
    module: "Exchange",
    why: "EXCHANGE_TOKEN",
  });
  assert.equal(rejectedResult.status, "REJECTED");
});

test("exchange can confirm from consumed stack and otherwise remains UNKNOWN", async () => {
  const state = makeState();
  const confirmed = makeBoundary(state, {
    async exchange(itemSlot) {
      state.character.items[itemSlot] = null;
      return undefined;
    },
  }).boundary;
  const confirmedResult = await confirmed.exchange({
    itemSlot: 7,
    module: "Exchange",
    why: "EXCHANGE_TOKEN",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");

  const unknownSetup = makeBoundary(makeState(), {
    async exchange() {
      return undefined;
    },
  });
  const unknownResult = await unknownSetup.boundary.exchange({
    itemSlot: 7,
    module: "Exchange",
    why: "EXCHANGE_TOKEN",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("phase 4.5 mutation capabilities are advertised", () => {
  const { boundary } = makeBoundary(makeState());

  for (const capability of ["UPGRADE", "COMPOUND", "EXCHANGE"]) {
    assert.equal(boundary.capabilities().includes(capability), true);
  }
});

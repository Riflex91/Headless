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
      items: [],
      slots: {},
      bank: null,
    },
    entities: {},
    party: {},
    G: {
      items: {},
      craft: {},
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
    pontyBuy() {},
    partyInvite() {},
    partyRequest() {},
    partyAcceptInvite() {},
    partyAcceptRequest() {},
    async partyLeave() {},
    respawn() {},
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

test("party invite blocks invalid self and existing-member targets before dispatch", () => {
  const state = makeState();
  state.party = {
    My_Merchant: { name: "My_Merchant" },
    Existing: { name: "Existing" },
  };
  let calls = 0;
  const { boundary } = makeBoundary(state, {
    partyInvite() {
      calls += 1;
    },
  });

  for (const name of ["", "My_Merchant", "Existing"]) {
    const result = boundary.partyInvite({
      name,
      module: "Party",
      why: "INVITE_MEMBER",
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.dispatchedAt, undefined);
  }

  assert.equal(calls, 0);
});

test("party invite stays DISPATCHED without immediate party state evidence", () => {
  const setup = makeBoundary(makeState());
  const result = setup.boundary.partyInvite({
    name: "My_Warrior",
    module: "Party",
    why: "INVITE_MEMBER",
  });

  assert.equal(result.status, "DISPATCHED");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("party invite confirms when target appears in party state", () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    partyInvite(target) {
      state.party = {
        My_Merchant: { name: "My_Merchant" },
        [target]: { name: target },
      };
    },
  });

  const result = boundary.partyInvite({
    name: "My_Warrior",
    module: "Party",
    why: "INVITE_MEMBER",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.targetJoined, true);
});

test("party request explicit API failure rejects and thrown call is UNKNOWN", () => {
  const rejected = makeBoundary(makeState(), {
    partyRequest() {
      return { success: false, reason: "not_available" };
    },
  }).boundary;

  const rejectedResult = rejected.partyRequest({
    name: "My_Warrior",
    module: "Party",
    why: "REQUEST_JOIN",
  });
  assert.equal(rejectedResult.status, "REJECTED");

  const unknownSetup = makeBoundary(makeState(), {
    partyRequest() {
      throw new Error("socket unavailable");
    },
  });
  const unknownResult = unknownSetup.boundary.partyRequest({
    name: "My_Warrior",
    module: "Party",
    why: "REQUEST_JOIN",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("accept party invite confirms when inviter and self appear in party", () => {
  const state = makeState();
  const { boundary } = makeBoundary(state, {
    partyAcceptInvite(inviter) {
      state.party = {
        [inviter]: { name: inviter },
        My_Merchant: { name: "My_Merchant" },
      };
    },
  });

  const result = boundary.partyAcceptInvite({
    name: "Leader",
    module: "Party",
    why: "ACCEPT_INVITE",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.joined, true);
});

test("accept party request confirms when requester joins existing party", () => {
  const state = makeState();
  state.party = {
    My_Merchant: { name: "My_Merchant" },
  };
  const { boundary } = makeBoundary(state, {
    partyAcceptRequest(requester) {
      state.party[requester] = { name: requester };
    },
  });

  const result = boundary.partyAcceptRequest({
    name: "My_Ranger",
    module: "Party",
    why: "ACCEPT_REQUEST",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.joined, true);
});

test("party leave blocks when no party is joined", async () => {
  let calls = 0;
  const { boundary } = makeBoundary(makeState(), {
    async partyLeave() {
      calls += 1;
    },
  });

  const result = await boundary.partyLeave({
    module: "Party",
    why: "LEAVE_PARTY",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("party leave confirms a resolved API call even before state refresh", async () => {
  const state = makeState();
  state.party = {
    My_Merchant: { name: "My_Merchant" },
    My_Warrior: { name: "My_Warrior" },
  };
  const { boundary } = makeBoundary(state);

  const result = await boundary.partyLeave({
    module: "Party",
    why: "LEAVE_PARTY",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.apiResolved, true);
  assert.equal(result.evidence.left, false);
});

test("party leave confirms visible party removal and thrown result is UNKNOWN", async () => {
  const state = makeState();
  state.party = {
    My_Merchant: { name: "My_Merchant" },
    My_Warrior: { name: "My_Warrior" },
  };
  const confirmed = makeBoundary(state, {
    async partyLeave() {
      state.party = {};
    },
  }).boundary;

  const confirmedResult = await confirmed.partyLeave({
    module: "Party",
    why: "LEAVE_PARTY",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");
  assert.equal(confirmedResult.evidence.left, true);

  const unknownState = makeState();
  unknownState.party = {
    My_Merchant: { name: "My_Merchant" },
  };
  const unknownSetup = makeBoundary(unknownState, {
    async partyLeave() {
      throw new Error("socket timeout");
    },
  });
  const unknownResult = await unknownSetup.boundary.partyLeave({
    module: "Party",
    why: "LEAVE_PARTY",
  });
  assert.equal(unknownResult.status, "UNKNOWN");
  assert.equal(unknownSetup.ledger.canRetry(unknownResult.id), false);
});

test("respawn blocks a living character before dispatch", () => {
  let calls = 0;
  const { boundary } = makeBoundary(makeState(), {
    respawn() {
      calls += 1;
    },
  });

  const result = boundary.respawn({
    module: "Lifecycle",
    why: "RESPAWN_AFTER_DEATH",
  });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.dispatchedAt, undefined);
  assert.equal(calls, 0);
});

test("respawn confirms when rip clears", () => {
  const state = makeState();
  state.character.rip = true;
  const { boundary } = makeBoundary(state, {
    respawn() {
      state.character.rip = false;
    },
  });

  const result = boundary.respawn({
    module: "Lifecycle",
    why: "RESPAWN_AFTER_DEATH",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.respawned, true);
});

test("respawn remains DISPATCHED without immediate state evidence", () => {
  const state = makeState();
  state.character.rip = true;
  const setup = makeBoundary(state);

  const result = setup.boundary.respawn({
    module: "Lifecycle",
    why: "RESPAWN_AFTER_DEATH",
  });

  assert.equal(result.status, "DISPATCHED");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("respawn thrown post-dispatch failure is UNKNOWN", () => {
  const state = makeState();
  state.character.rip = true;
  const setup = makeBoundary(state, {
    respawn() {
      throw new Error("socket unavailable");
    },
  });

  const result = setup.boundary.respawn({
    module: "Lifecycle",
    why: "RESPAWN_AFTER_DEATH",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("phase 4.7 party and lifecycle capabilities are advertised", () => {
  const { boundary } = makeBoundary(makeState());

  for (const capability of [
    "PARTY_INVITE",
    "PARTY_REQUEST",
    "PARTY_ACCEPT_INVITE",
    "PARTY_ACCEPT_REQUEST",
    "PARTY_LEAVE",
    "RESPAWN",
  ]) {
    assert.equal(boundary.capabilities().includes(capability), true);
  }
});

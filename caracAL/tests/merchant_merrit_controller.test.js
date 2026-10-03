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

function setup(options = {}) {
  let now = 1000000;
  const state = {
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
      gold: 100000,
      target: null,
      rip: false,
      moving: false,
      stand: false,
      merrit: {
        reasons: [{ code: "closed" }],
        server_now: now,
        next_at: now,
      },
      items: [
        { name: "stand0" },
        { name: "hpot0", q: 10 },
        null,
        null,
      ],
      slots: {},
    },
    entities: {},
    party: {},
    G: {
      items: {
        stand0: {
          name: "Stand",
          type: "stand",
          stand: "stand0",
          g: 4000,
        },
        hpot0: { name: "HP Potion", type: "pot", s: 9999, g: 20 },
        marketparcel: { name: "Market Parcel", type: "gem" },
      },
      craft: {},
      skills: {},
      maps: {
        main: {
          npcs: [
            { id: "standmerchant", position: [-193, 680] },
            { id: "fancypots", position: [56, -122] },
          ],
        },
      },
      npcs: {
        citizen22: {
          name: "Merrit",
          market: {
            areas: [
              [-240, -120, 240, 144],
              [-88, 144, 88, 360],
            ],
            stops: [
              [0, 0],
              [-96, 0],
              [-192, 104],
              [0, 120],
              [0, 320],
              [32, 200],
              [96, 104],
            ],
            settle_ms: 120000,
            handoff: 32,
            hour_ms: 3600000,
            anchor_tolerance: 4,
            npc_clearance: 40,
            stand_clearance: 10,
            front_clearance: 15,
            front_width: 10,
          },
        },
        standmerchant: { name: "Divian", items: ["stand0"] },
        fancypots: { name: "Ernis", items: ["hpot0"] },
      },
    },
  };

  const { GameAdapter } = coreModule("game-adapter.lib.ts");
  const game = new GameAdapter({
    character: () => state.character,
    entities: () => state.entities,
    party: () => state.party,
    gameData: () => state.G,
    nextSkill: () => ({}),
    bankPacks: () => ({}),
    now: () => now,
  });

  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  let actionSequence = 0;
  const actionLedger = new ActionLedger({
    now: () => now,
    nextActionId: () => `MM-${++actionSequence}`,
    nextCorrelationId: () => `MMC-${actionSequence}`,
  });

  const calls = [];
  const driver = {
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
    async buy(itemName, quantity) {
      calls.push(["buy", itemName, quantity]);
      const empty = state.character.items.findIndex((item) => !item);
      state.character.items[empty] = { name: itemName, q: quantity };
      state.character.gold -= state.G.items[itemName].g * quantity;
      return { success: true, response: "buy_success" };
    },
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
    async openStand(slot) {
      calls.push(["openStand", slot]);
      if (options.openStandThrows) throw new Error("open timeout");
      state.character.stand = "stand0";
      return { success: true };
    },
    async closeStand() {
      calls.push(["closeStand"]);
      state.character.stand = false;
      return { success: true };
    },
    async tradeList(inventorySlot, slot, price, quantity) {
      calls.push(["tradeList", inventorySlot, slot, price, quantity]);
      const item = state.character.items[inventorySlot];
      state.character.items[inventorySlot] = null;
      state.character.slots[slot] = {
        ...item,
        q: quantity,
        price,
        rid: "TEMP-RID",
      };
      return { success: true };
    },
    async tradeUnlist(slot) {
      calls.push(["tradeUnlist", slot]);
      const empty = state.character.items.findIndex((item) => !item);
      state.character.items[empty] = state.character.slots[slot];
      delete state.character.slots[slot];
      return { success: true };
    },
    requestMerritStatus() {
      calls.push(["requestMerritStatus"]);
    },
    wishlist() {},
    pontyBuy() {},
    partyInvite() {},
    partyRequest() {},
    partyAcceptInvite() {},
    partyAcceptRequest() {},
    partyLeave() {},
    respawn() {},
  };

  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const actions = new ActionBoundary(actionLedger, game, driver);

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
      const destination = request.destination;
      state.character.map = destination.map || "main";
      state.character.in = destination.map || "main";
      state.character.x = destination.x;
      state.character.y = destination.y;
      return {
        id: `MOVE-${calls.length}`,
        correlationId: "MOVE-C",
        module: request.module,
        action: "SMART_MOVE",
        why: request.why,
        createdAt: now,
        dispatchedAt: now,
        completedAt: now,
        status: "CONFIRMED",
      };
    },
  };

  const events = [];
  const { MerchantMerritController } = coreModule(
    "merchant-merrit-controller.lib.ts",
  );
  const controller = new MerchantMerritController(game, actions, movement, {
    now: () => now,
    config: () => ({
      merchantAutonomy: {
        enabled: true,
        merrit: {
          enabled: true,
          listingPrice: 999999999,
          goldReserve: 1000,
        },
      },
    }),
    onEvent: (event) => events.push(event),
  });

  return {
    state,
    game,
    actions,
    actionLedger,
    controller,
    calls,
    events,
    now: () => now,
    advance(ms) {
      now += ms;
      state.character.merrit.server_now = now;
    },
  };
}

test("Merrit roadmap progresses stand -> listing -> settle -> handoff -> parcel", async () => {
  const s = setup();

  const stand = await s.controller.tick();
  assert.equal(stand.state, "STAND");
  assert.equal(stand.roadmapStage, "Stand");
  assert.equal(stand.stand.open, true);

  s.advance(1000);
  s.state.character.merrit.reasons = [{ code: "listing" }];
  const listing = await s.controller.tick();
  assert.equal(listing.state, "LISTING");
  assert.equal(listing.listing.valid, true);
  assert.equal(listing.listing.temporarySlot, "trade1");

  s.advance(1000);
  s.state.character.merrit.reasons = [
    { code: "warming", remaining_ms: 119000 },
  ];
  const settling = await s.controller.tick();
  assert.equal(settling.state, "SETTLING");
  assert.equal(settling.roadmapStage, "120 s settle");
  assert.equal(settling.settle.requiredMs, 120000);
  assert.equal(settling.settle.remainingMs, 119000);

  s.advance(120000);
  s.state.character.merrit.reasons = [];
  const handoff = await s.controller.tick();
  assert.equal(handoff.state, "HANDOFF");
  assert.equal(handoff.roadmapStage, "Handoff");

  s.advance(1000);
  s.state.character.merrit.last = {
    name: "My_Merchant",
    at: s.now(),
    shells: 0,
  };
  s.state.character.merrit.next_at = s.now() + 3600000;
  const parcel = await s.controller.tick();
  assert.equal(parcel.state, "PARCEL");
  assert.equal(parcel.reason, "MERRIT_PARCEL_CONFIRMED");
  assert.equal(parcel.parcel.confirmedAt, s.now());
  assert.equal(parcel.parcel.readyAt, s.now() + 3600000);

  const parcelEvents = s.events.filter(
    (event) => event.type === "MERRIT_PARCEL_CONFIRMED",
  );
  assert.equal(parcelEvents.length, 1);
  assert.equal(parcelEvents[0].data.cooldownMs, 3600000);
});

test("Merrit honors real account cooldown before any stand mutation", async () => {
  const s = setup();
  s.state.character.merrit.reasons = [
    { code: "cooldown", remaining_ms: 300000 },
  ];
  s.state.character.merrit.next_at = s.now() + 300000;

  const result = await s.controller.tick();

  assert.equal(result.state, "COOLDOWN");
  assert.equal(result.roadmapStage, "Cooldown");
  assert.equal(
    s.calls.some(([name]) => name === "openStand" || name === "tradeList"),
    false,
  );
});

test("Merrit cleanup restores only controller-created listing and stand", async () => {
  const s = setup();

  await s.controller.tick();
  s.advance(1000);
  await s.controller.tick();

  const cleanup = await s.controller.cleanupTemporaryState();

  assert.equal(cleanup.listing.status, "CONFIRMED");
  assert.equal(cleanup.stand.status, "CONFIRMED");
  assert.equal(s.state.character.slots.trade1, undefined);
  assert.equal(s.state.character.stand, false);
});

test("UNKNOWN stand outcome becomes terminal until a new controller session", async () => {
  const s = setup({ openStandThrows: true });

  const first = await s.controller.tick();
  const second = await s.controller.tick();

  assert.equal(first.state, "UNKNOWN");
  assert.equal(second.state, "UNKNOWN");
  assert.match(second.reason, /REQUIRES_RECONCILIATION/);
  assert.equal(
    s.calls.filter(([name]) => name === "openStand").length,
    1,
  );
  assert.equal(
    s.events.some((event) => event.type === "MERRIT_ACTION_UNKNOWN"),
    true,
  );
});

test("Merrit automatically acquires cheap listing stock then returns to roadmap", async () => {
  const s = setup();
  s.state.character.items[1] = null;

  await s.controller.tick();
  s.advance(1000);
  const acquire = await s.controller.tick();

  assert.equal(acquire.reason, "MERRIT_ACQUIRE_LISTING_ITEM_CONFIRMED");
  assert.equal(
    s.calls.some(
      (call) => call[0] === "buy" && call[1] === "hpot0" && call[2] === 1,
    ),
    true,
  );
});

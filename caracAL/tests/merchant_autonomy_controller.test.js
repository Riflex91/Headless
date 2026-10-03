"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadController() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "merchant-autonomy-controller.lib.ts",
    ),
  ).MerchantAutonomyController;
}

function setup(overrides = {}) {
  const MerchantAutonomyController = loadController();
  const state = {
    character: { name: "My_Merchant", ctype: "merchant", map: "main" },
    inventory: [{ slot: 0, item: { name: "rod" } }],
    equipment: { mainhand: { name: "pickaxe" } },
    tradeSlots: {
      trade1: { name: "staff", b: true, price: 1000, q: 1 },
      trade2: { name: "hpot1", price: 20, q: 10 },
    },
    market: [
      {
        merchantId: "other",
        merchantName: "OtherMerchant",
        map: "main",
        x: 0,
        y: 0,
        stand: true,
        slot: "trade3",
        side: "SELL",
        item: {
          name: "gem0",
          level: 0,
          quantity: 1,
          price: 1,
          rid: "RID-1",
          giveaway: 10,
        },
      },
    ],
    skills: [
      { key: "fishing" },
      { key: "mining" },
      { key: "mcourage" },
      { key: "massproduction" },
    ],
    gameData: {
      items: {
        stand0: { stand: true },
        rod: {},
        pickaxe: {},
      },
      npcs: {
        citizen22: { name: "Merrit" },
        secondhands: { name: "Ponty" },
      },
      maps: {
        main: {
          zones: [
            {
              type: "fishing",
              drop: "f1",
              polygon: [
                [0, 0],
                [1, 1],
              ],
            },
          ],
        },
        tunnel: {
          zones: [{ type: "mining", drop: "m2", polygon: [[2, 2]] }],
        },
      },
    },
    ...overrides,
  };
  const events = [];
  const controller = new MerchantAutonomyController(
    {
      character: () => state.character,
      inventory: () => state.inventory,
      equipment: () => state.equipment,
      tradeSlots: () => state.tradeSlots,
      market: () => state.market,
      skills: () => state.skills,
      gameData: () => state.gameData,
    },
    {
      capabilities: () => ["WISHLIST", "PONTY_BUY"],
    },
    {
      config: () => ({ merchantAutonomy: { enabled: true } }),
      now: () => 1234,
      onEvent: (event) => events.push(event),
    },
  );
  return { controller, events };
}

test("merchant autonomy core maps every Phase 12 feature from real-shaped state", () => {
  const { controller, events } = setup();
  const status = controller.tick();

  assert.equal(status.state, "READY");
  assert.deepEqual(status.featureOrder, [
    "MERRIT",
    "FISHING",
    "MINING",
    "WISHLIST",
    "GIVEAWAYS",
    "PONTY",
    "MERCHANT_SKILLS",
  ]);
  assert.equal(status.merrit.npcPresent, true);
  assert.deepEqual(status.merrit.standItems, ["stand0"]);
  assert.equal(status.merrit.activeListings, 1);
  assert.equal(status.gathering.fishing.skillPresent, true);
  assert.equal(status.gathering.fishing.toolPresent, true);
  assert.equal(status.gathering.fishing.zones.length, 1);
  assert.equal(status.gathering.mining.skillPresent, true);
  assert.equal(status.gathering.mining.toolPresent, true);
  assert.equal(status.gathering.mining.zones.length, 1);
  assert.equal(status.wishlist.boundarySupported, true);
  assert.deepEqual(status.wishlist.activeSlots, ["trade1"]);
  assert.equal(status.giveaways.joinOnly, true);
  assert.equal(status.giveaways.visibleCount, 1);
  assert.equal(status.ponty.boundarySupported, true);
  assert.equal(status.ponty.npcPresent, true);
  assert.equal(status.mutationPolicy.executionEnabled, false);
  assert.equal(status.mutationPolicy.giveawayCreationSupported, false);
  assert.equal(events.length, 1);
});

test("merchant autonomy core stays disabled by default and rejects non-merchants", () => {
  const { controller } = setup({
    character: { name: "Ranger", ctype: "ranger", map: "main" },
  });
  controller.setConfigOverride({ merchantAutonomy: { enabled: true } });
  const wrongClass = controller.tick();
  assert.equal(wrongClass.state, "UNSUPPORTED_CLASS");

  controller.clearConfigOverride();
  const defaultDisabled = new (loadController())(
    {
      character: () => ({
        name: "My_Merchant",
        ctype: "merchant",
        map: "main",
      }),
      inventory: () => [],
      equipment: () => ({}),
      tradeSlots: () => ({}),
      market: () => [],
      skills: () => [],
      gameData: () => ({ items: {}, npcs: {}, maps: {} }),
    },
    { capabilities: () => [] },
  ).tick();
  assert.equal(defaultDisabled.state, "DISABLED");
  assert.equal(defaultDisabled.mutationPolicy.valueMutationForced, false);
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadGameAdapter() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "game-adapter.lib.ts",
    ),
  ).GameAdapter;
}

function makeSource() {
  const state = {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      x: 100,
      y: 200,
      hp: 900,
      max_hp: 900,
      mp: 500,
      max_mp: 500,
      gold: 123456,
      target: null,
      rip: false,
      moving: false,
      items: [{ name: "hpot1", q: 10 }, null],
      slots: {
        mainhand: { name: "broom", level: 0 },
        trade1: {
          name: "hpot1",
          q: 5,
          price: 99,
          rid: "own-listing",
        },
      },
      bank: {
        gold: 777777,
        items0: [{ name: "gem0", q: 2 }, null],
        items1: [null, { name: "scroll0", q: 1 }],
      },
    },
    entities: {
      npc_pots: {
        id: "npc_pots",
        type: "npc",
        npc: "pots",
        name: "Lidia",
        role: "merchant",
        map: "main",
        x: 55,
        y: 66,
      },
      seller: {
        id: "seller",
        type: "character",
        name: "Seller",
        map: "main",
        x: 300,
        y: 400,
        stand: "stand0",
        slots: {
          mainhand: { name: "staff" },
          trade1: {
            name: "hpot1",
            level: 0,
            q: 20,
            price: 50,
            rid: "sell-rid",
          },
          trade2: {
            name: "bow",
            level: 2,
            q: 1,
            price: 100000,
            rid: "buy-rid",
            b: true,
          },
        },
      },
      nonmerchant: {
        id: "nonmerchant",
        type: "character",
        name: "Walker",
        map: "main",
        x: 10,
        y: 20,
        stand: false,
        slots: {
          trade1: {
            name: "gem0",
            price: 1,
            rid: "ignored",
          },
        },
      },
    },
    party: {},
    G: {
      maps: {
        main: {
          npcs: [
            { id: "pots", position: [10, 20] },
            {
              id: "transporter",
              positions: [
                [30, 40],
                [50, 60, 1],
              ],
            },
          ],
          zones: [
            {
              type: "fishing",
              drop: "fish",
              polygon: [
                [1, 2],
                [3, 4],
                [5, 6],
              ],
            },
          ],
        },
      },
      npcs: {
        pots: {
          id: "pots",
          name: "Lidia",
          role: "merchant",
          items: ["hpot1", "mpot1", null],
        },
        transporter: {
          id: "transporter",
          name: "Alia",
          role: "transport",
        },
      },
      skills: {
        mluck: {
          name: "Merchant's Luck",
          class: ["merchant"],
          level: 40,
          mp: 10,
          cooldown: 1000,
          range: 320,
        },
        attack: {
          name: "Attack",
          cooldown: 1000,
          hostile: true,
        },
        fireball: {
          name: "Fireball",
          class: ["mage"],
          mp: 400,
          hostile: true,
        },
      },
    },
    nextSkill: {
      mluck: new Date(12500),
      attack: new Date(9000),
      invalid: "later",
    },
    bankPacks: {
      items0: ["bank", 0, 0],
      items1: ["bank_b", 500000, 10],
    },
    now: 10000,
  };

  return {
    state,
    source: {
      character: () => state.character,
      entities: () => state.entities,
      party: () => state.party,
      gameData: () => state.G,
      nextSkill: () => state.nextSkill,
      bankPacks: () => state.bankPacks,
      now: () => state.now,
    },
  };
}

test("NPC reads combine map metadata with visible live position", () => {
  const GameAdapter = loadGameAdapter();
  const { source } = makeSource();
  const adapter = new GameAdapter(source);

  assert.deepEqual(adapter.npcs(), [
    {
      id: "pots",
      name: "Lidia",
      role: "merchant",
      map: "main",
      x: 55,
      y: 66,
      visible: true,
      positions: [{ x: 10, y: 20 }],
      items: ["hpot1", "mpot1"],
    },
    {
      id: "transporter",
      name: "Alia",
      role: "transport",
      map: "main",
      x: 30,
      y: 40,
      visible: false,
      positions: [
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ],
      items: [],
    },
  ]);
});

test("bank read preserves pack and slot positions without live references", () => {
  const GameAdapter = loadGameAdapter();
  const { state, source } = makeSource();
  const adapter = new GameAdapter(source);

  const bank = adapter.bank();
  assert.equal(bank.available, true);
  assert.equal(bank.gold, 777777);
  assert.deepEqual(bank.access, [
    {
      name: "items0",
      map: "bank",
      goldPrice: 0,
      shellPrice: 0,
    },
    {
      name: "items1",
      map: "bank_b",
      goldPrice: 500000,
      shellPrice: 10,
    },
  ]);
  assert.deepEqual(
    bank.packs.map((pack) => ({
      name: pack.name,
      slots: pack.items.map((item) => item.slot),
    })),
    [
      { name: "items0", slots: [0, 1] },
      { name: "items1", slots: [0, 1] },
    ],
  );

  bank.packs[0].items[0].item.q = 999;
  assert.equal(state.character.bank.items0[0].q, 2);
});

test("market read exposes only visible merchant trade slots", () => {
  const GameAdapter = loadGameAdapter();
  const { source } = makeSource();
  const adapter = new GameAdapter(source);

  assert.deepEqual(adapter.market(), [
    {
      merchantId: "seller",
      merchantName: "Seller",
      map: "main",
      x: 300,
      y: 400,
      stand: "stand0",
      slot: "trade1",
      side: "SELL",
      item: {
        name: "hpot1",
        level: 0,
        quantity: 20,
        price: 50,
        rid: "sell-rid",
        giveaway: null,
      },
    },
    {
      merchantId: "seller",
      merchantName: "Seller",
      map: "main",
      x: 300,
      y: 400,
      stand: "stand0",
      slot: "trade2",
      side: "BUY",
      item: {
        name: "bow",
        level: 2,
        quantity: 1,
        price: 100000,
        rid: "buy-rid",
        giveaway: null,
      },
    },
  ]);
});

test("skill read defaults to current character class and can expose all skills", () => {
  const GameAdapter = loadGameAdapter();
  const { source } = makeSource();
  const adapter = new GameAdapter(source);

  assert.deepEqual(
    adapter.skills().map((skill) => skill.key),
    ["attack", "mluck"],
  );
  assert.deepEqual(
    adapter.skills(false).map((skill) => skill.key),
    ["attack", "fireball", "mluck"],
  );

  const mluck = adapter.skills().find((skill) => skill.key === "mluck");
  assert.deepEqual(mluck, {
    key: "mluck",
    name: "Merchant's Luck",
    classes: ["merchant"],
    level: 40,
    mp: 10,
    cooldown: 1000,
    range: 320,
    hostile: false,
    party: false,
    passive: false,
  });
});

test("cooldown read normalizes next_skill dates against injected time", () => {
  const GameAdapter = loadGameAdapter();
  const { source } = makeSource();
  const adapter = new GameAdapter(source);

  assert.deepEqual(adapter.cooldowns(), [
    {
      skill: "attack",
      readyAt: 9000,
      remainingMs: 0,
      ready: true,
    },
    {
      skill: "mluck",
      readyAt: 12500,
      remainingMs: 2500,
      ready: false,
    },
  ]);
});

test("zone read exposes current map gathering polygons", () => {
  const GameAdapter = loadGameAdapter();
  const { source } = makeSource();
  const adapter = new GameAdapter(source);

  assert.deepEqual(adapter.zones(), [
    {
      map: "main",
      type: "fishing",
      drop: "fish",
      polygon: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    },
  ]);
});

test("equipment read excludes merchant trade slots", () => {
  const GameAdapter = loadGameAdapter();
  const { source } = makeSource();
  const adapter = new GameAdapter(source);

  assert.deepEqual(adapter.equipment(), {
    mainhand: { name: "broom", level: 0 },
  });
});

test("item grade read delegates to the Adventure Land runtime helper safely", () => {
  const GameAdapter = loadGameAdapter();
  const { source } = makeSource();
  source.itemGrade = (item) => (item?.level >= 7 ? 1 : 0);
  const adapter = new GameAdapter(source);

  assert.equal(adapter.itemGrade({ name: "sword", level: 0 }), 0);
  assert.equal(adapter.itemGrade({ name: "sword", level: 7 }), 1);

  source.itemGrade = () => -1;
  assert.equal(adapter.itemGrade({ name: "sword", level: 7 }), null);

  source.itemGrade = () => {
    throw new Error("runtime helper unavailable");
  };
  assert.equal(adapter.itemGrade({ name: "sword", level: 7 }), null);
});


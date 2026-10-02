"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CLAIM_TYPES,
  MerchantLogisticsPlanner,
} = require("../src/MerchantLogisticsPlanner");

function merchant({
  name = "My_Merchant",
  connected = true,
  enabled = true,
} = {}) {
  return {
    account_character_type: "merchant",
    connected,
    runtime_config: {
      merchant: {
        logistics: {
          enabled,
        },
      },
    },
    live_state: connected
      ? {
          ctype: "merchant",
          map: "main",
          x: 0,
          y: 0,
          items: [],
          slots: {},
        }
      : null,
  };
}

function farmer({
  name = "My_Ranger",
  items = [],
  slots = {},
  gold = 1000,
  isize = 42,
  config = {},
  intelligence = null,
} = {}) {
  return {
    account_character_type: "ranger",
    connected: true,
    runtime_config: {
      logistics: {
        enabled: true,
        ...config,
      },
    },
    live_state: {
      name,
      ctype: "ranger",
      map: "main",
      x: 100,
      y: 50,
      gold,
      isize,
      items,
      slots,
    },
    inventory_intelligence_runtime: intelligence,
  };
}

function claimTypes(board) {
  return new Set(board.claims.map((claim) => claim.type));
}

test("planner creates all Phase 11 farmer claim types from live account state", () => {
  const planner = new MerchantLogisticsPlanner({
    now: () => 1000,
  });
  const board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      gold: 5000,
      isize: 4,
      items: [
        { name: "hpot0", q: 20 },
        { name: "junk", q: 2 },
        { name: "keepme", q: 1 },
        null,
      ],
      slots: {},
      config: {
        merchant: "My_Merchant",
        mluck: { enabled: true },
        potions: {
          hpot0: 100,
        },
        items: {
          computer: 2,
        },
        gold: {
          enabled: true,
          keep: 1000,
          pickupAbove: 2000,
          minTransfer: 500,
        },
        inventoryPressure: {
          enabled: true,
          freeSlotsAtOrBelow: 1,
          maxClaims: 2,
        },
        gear: {
          desiredItems: ["bow"],
        },
      },
      intelligence: {
        entries: [
          {
            slot: 1,
            name: "junk",
            quantity: 2,
            disposition: "SELL",
            protected: false,
          },
          {
            slot: 2,
            name: "keepme",
            quantity: 1,
            disposition: "KEEP",
            protected: false,
          },
        ],
      },
    }),
  });

  const types = claimTypes(board);
  for (const type of CLAIM_TYPES) {
    assert.equal(types.has(type), true, type + " missing");
  }

  const potion = board.claims.find((claim) => claim.type === "POTION_DELIVERY");
  assert.equal(potion.itemName, "hpot0");
  assert.equal(potion.quantity, 80);

  const gold = board.claims.find((claim) => claim.type === "GOLD_PICKUP");
  assert.equal(gold.amount, 4000);

  const pressure = board.claims.find(
    (claim) => claim.type === "INVENTORY_PRESSURE",
  );
  assert.equal(pressure.itemName, "junk");
  assert.equal(pressure.inventorySlot, 1);
  assert.equal(pressure.metadata.freeSlots, 1);

  assert.equal(board.summary.total, 6);
  assert.equal(board.summary.ready, 6);
  assert.equal(board.merchantIndependent, true);
});

test("merchant remains independently represented when no farmer claims exist", () => {
  const planner = new MerchantLogisticsPlanner({ now: () => 1000 });
  const board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      config: {
        enabled: false,
      },
    }),
  });

  assert.equal(board.merchants.length, 1);
  assert.equal(board.merchants[0].name, "My_Merchant");
  assert.equal(board.summary.total, 0);
  assert.equal(board.merchantIndependent, true);
});

test("explicit offline merchant keeps claim instead of coupling merchant lifecycle to farmer", () => {
  const planner = new MerchantLogisticsPlanner({ now: () => 1000 });
  const board = planner.plan({
    My_Merchant: merchant({ connected: false }),
    My_Ranger: farmer({
      config: {
        merchant: "My_Merchant",
        potions: {
          hpot0: 100,
        },
      },
    }),
  });

  assert.equal(board.claims.length, 1);
  assert.equal(board.claims[0].status, "WAITING_MERCHANT");
  assert.equal(board.claims[0].merchant.name, "My_Merchant");
});

test("inventory pressure only claims unprotected transferable dispositions", () => {
  const planner = new MerchantLogisticsPlanner({ now: () => 1000 });
  const board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      isize: 3,
      items: [
        { name: "safe", q: 1 },
        { name: "quest", q: 1 },
        { name: "gear", q: 1 },
      ],
      config: {
        inventoryPressure: {
          enabled: true,
          freeSlotsAtOrBelow: 0,
          maxClaims: 5,
        },
      },
      intelligence: {
        entries: [
          {
            slot: 0,
            name: "safe",
            quantity: 1,
            disposition: "BANK",
            protected: false,
          },
          {
            slot: 1,
            name: "quest",
            quantity: 1,
            disposition: "QUEST",
            protected: true,
          },
          {
            slot: 2,
            name: "gear",
            quantity: 1,
            disposition: "GEAR",
            protected: false,
          },
        ],
      },
    }),
  });

  const pressure = board.claims.filter(
    (claim) => claim.type === "INVENTORY_PRESSURE",
  );
  assert.equal(pressure.length, 1);
  assert.equal(pressure[0].itemName, "safe");
});

test("anti-pingpong suppresses immediate reverse item transfers", () => {
  let now = 1000;
  const planner = new MerchantLogisticsPlanner({
    now: () => now,
    pingPongCooldownMs: 120000,
  });

  planner.recordTransfer({
    itemName: "gem0",
    from: "My_Merchant",
    to: "My_Ranger",
  });

  const board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      isize: 1,
      items: [{ name: "gem0", q: 1 }],
      config: {
        inventoryPressure: {
          enabled: true,
          freeSlotsAtOrBelow: 0,
        },
      },
      intelligence: {
        entries: [
          {
            slot: 0,
            name: "gem0",
            quantity: 1,
            disposition: "BANK",
            protected: false,
          },
        ],
      },
    }),
  });

  assert.equal(board.claims.length, 0);
  assert.equal(board.suppressed.length, 1);
  assert.equal(board.suppressed[0].suppressionReason, "ANTI_PINGPONG");

  now += 120001;
  const later = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      isize: 1,
      items: [{ name: "gem0", q: 1 }],
      config: {
        inventoryPressure: {
          enabled: true,
          freeSlotsAtOrBelow: 0,
        },
      },
      intelligence: {
        entries: [
          {
            slot: 0,
            name: "gem0",
            quantity: 1,
            disposition: "BANK",
            protected: false,
          },
        ],
      },
    }),
  });
  assert.equal(later.claims.length, 1);
});

test("recently completed claims are cooled down to avoid duplicate work", () => {
  let now = 1000;
  const planner = new MerchantLogisticsPlanner({
    now: () => now,
    completionCooldownMs: 30000,
  });

  let board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      config: {
        items: {
          computer: 1,
        },
      },
    }),
  });
  assert.equal(board.claims.length, 1);

  planner.recordClaimCompleted(board.claims[0]);
  board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      config: {
        items: {
          computer: 1,
        },
      },
    }),
  });
  assert.equal(board.claims.length, 0);
  assert.equal(board.suppressed[0].suppressionReason, "RECENTLY_COMPLETED");

  now += 30001;
  board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      config: {
        items: {
          computer: 1,
        },
      },
    }),
  });
  assert.equal(board.claims.length, 1);
});

test("gear claim is omitted when farmer already owns desired gear", () => {
  const planner = new MerchantLogisticsPlanner({ now: () => 1000 });
  const board = planner.plan({
    My_Merchant: merchant(),
    My_Ranger: farmer({
      slots: {
        mainhand: { name: "bow", level: 5 },
      },
      config: {
        gear: {
          desiredItems: ["bow"],
        },
      },
    }),
  });

  assert.equal(
    board.claims.some((claim) => claim.type === "GEAR_DELIVERY"),
    false,
  );
});

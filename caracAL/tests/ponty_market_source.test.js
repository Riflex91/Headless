"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadSource() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "ponty-market-source.lib.ts",
    ),
  );
}

test("Ponty Market source normalizes unit price observations", () => {
  const { readPontyMarketObservations } = loadSource();
  const observations = readPontyMarketObservations(
    {
      ponty: () => [
        {
          item: {
            name: "sword",
            level: 2,
            quantity: 3,
            rid: "RID-SWORD",
          },
          unitPrice: 1000,
          totalPrice: 3000,
          cashMultiplier: false,
        },
      ],
    },
    {
      server: () => " EU I ",
      now: () => 123456,
    },
  );

  assert.deepEqual(observations, [
    {
      itemName: "sword",
      level: 2,
      price: 1000,
      quantity: 3,
      server: "EU I",
      seller: "Ponty",
      observedAt: 123456,
      metadata: {
        rid: "RID-SWORD",
        totalPrice: 3000,
        cashMultiplier: false,
        priceBasis: "PONTY_UNIT_PRICE",
      },
    },
  ]);
});

test("Ponty Market source keeps absent realm explicit", () => {
  const { readPontyMarketObservations } = loadSource();
  const observations = readPontyMarketObservations(
    {
      ponty: () => [
        {
          item: {
            name: "cashitem",
            level: 0,
            quantity: 1,
            rid: "RID-CASH",
          },
          unitPrice: 3000,
          totalPrice: 3000,
          cashMultiplier: true,
        },
      ],
    },
    {
      server: () => " ",
      now: () => 999,
    },
  );

  assert.equal(observations[0].server, null);
  assert.equal(observations[0].price, 3000);
  assert.equal(observations[0].metadata.cashMultiplier, true);
});

test("Ponty snapshot tracker does not refresh unchanged passive data", () => {
  const { PontyMarketSnapshotTracker } = loadSource();
  const tracker = new PontyMarketSnapshotTracker();
  let now = 1000;
  const state = {
    listings: [
      {
        item: {
          name: "sword",
          level: 2,
          quantity: 1,
          rid: "RID-1",
        },
        unitPrice: 1000,
        totalPrice: 1000,
        cashMultiplier: false,
      },
    ],
  };
  const game = {
    ponty: () => state.listings,
  };

  const first = tracker.observations(game, {
    server: () => "EU I",
    now: () => now,
  });
  now = 5000;
  const unchanged = tracker.observations(game, {
    server: () => "EU I",
    now: () => now,
  });

  assert.equal(first[0].observedAt, 1000);
  assert.equal(unchanged[0].observedAt, 1000);
  assert.equal(
    unchanged[0].metadata.freshnessBasis,
    "FIRST_OBSERVED_RUNTIME_SNAPSHOT",
  );

  state.listings = [
    {
      ...state.listings[0],
      unitPrice: 1100,
      totalPrice: 1100,
    },
  ];
  const changed = tracker.observations(game, {
    server: () => "EU I",
    now: () => now,
  });

  assert.equal(changed[0].observedAt, 5000);
  assert.equal(changed[0].price, 1100);
});

test("Ponty snapshot tracker resets freshness after the snapshot disappears", () => {
  const { PontyMarketSnapshotTracker } = loadSource();
  const tracker = new PontyMarketSnapshotTracker();
  let now = 1000;
  let listings = [
    {
      item: {
        name: "sword",
        level: 0,
        quantity: 1,
        rid: "RID-1",
      },
      unitPrice: 1000,
      totalPrice: 1000,
      cashMultiplier: false,
    },
  ];
  const game = {
    ponty: () => listings,
  };

  assert.equal(
    tracker.observations(game, { now: () => now })[0].observedAt,
    1000,
  );

  listings = [];
  now = 2000;
  assert.deepEqual(tracker.observations(game, { now: () => now }), []);

  listings = [
    {
      item: {
        name: "sword",
        level: 0,
        quantity: 1,
        rid: "RID-1",
      },
      unitPrice: 1000,
      totalPrice: 1000,
      cashMultiplier: false,
    },
  ];
  now = 3000;
  assert.equal(
    tracker.observations(game, { now: () => now })[0].observedAt,
    3000,
  );
});

test("Ponty Market source is observation-only", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "ponty-market-source.lib.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /pontyBuy/);
  assert.doesNotMatch(source, /tradeList/);
  assert.doesNotMatch(source, /buy\(/);
  assert.doesNotMatch(source, /sell\(/);
});

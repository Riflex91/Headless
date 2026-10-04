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

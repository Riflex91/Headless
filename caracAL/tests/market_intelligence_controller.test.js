"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
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
      "market-intelligence-controller.lib.ts",
    ),
  ).MarketIntelligenceController;
}

function listing({
  merchantId = "merchant-1",
  merchantName = "Seller",
  side = "SELL",
  name = "gem0",
  level = 0,
  quantity = 1,
  price = 100,
  giveaway = null,
  slot = "trade1",
} = {}) {
  return {
    merchantId,
    merchantName,
    map: "main",
    x: 10,
    y: 20,
    stand: true,
    slot,
    side,
    item: {
      name,
      level,
      quantity,
      price,
      rid: "RID-1",
      giveaway,
    },
  };
}

function makeController({
  market = [],
  ponty = [],
  localHistory = [],
  now = 1_000_000,
  server = "EU I",
} = {}) {
  const MarketIntelligenceController = loadController();
  const events = [];
  const controller = new MarketIntelligenceController(
    {
      market: () => market,
    },
    {
      now: () => now,
      server: () => server,
      ponty: () => ponty,
      localHistory: () => localHistory,
      onEvent: (event) => events.push(event),
    },
  );
  return { controller, events };
}

test("Market Intelligence normalizes only visible sell offers into price statistics", () => {
  const setup = makeController({
    market: [
      listing({ merchantId: "a", price: 100, quantity: 2 }),
      listing({
        merchantId: "b",
        merchantName: "Other",
        price: 200,
        quantity: 1,
        slot: "trade2",
      }),
      listing({ merchantId: "c", side: "BUY", price: 150, slot: "trade3" }),
      listing({
        merchantId: "d",
        price: 1,
        giveaway: 10,
        slot: "trade4",
      }),
    ],
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "MARKET_INTELLIGENCE_READY");
  assert.equal(status.summary.observations, 2);
  assert.equal(status.summary.liveVisible, 2);
  assert.equal(status.summary.ponty, 0);
  assert.equal(status.summary.localHistory, 0);
  assert.equal(status.aggregates.length, 1);

  const aggregate = status.aggregates[0];
  assert.equal(aggregate.itemName, "gem0");
  assert.equal(aggregate.level, 0);
  assert.equal(aggregate.server, "EU I");
  assert.equal(aggregate.medianPrice, 150);
  assert.deepEqual(aggregate.priceBand, { min: 100, max: 200 });
  assert.equal(aggregate.volatility, 100 / 150);
  assert.equal(aggregate.samples, 2);
  assert.equal(aggregate.ageMs, 0);
  assert.equal(aggregate.confidence, "LOW");
  assert.deepEqual(aggregate.sources, ["LIVE_VISIBLE"]);

  assert.equal(setup.events.length, 1);
  assert.equal(setup.events[0].type, "MARKET_INTELLIGENCE_STATUS");
  assert.equal(status.policy.readOnly, true);
  assert.equal(status.policy.liveVisibleSellOnly, true);
  assert.equal(status.policy.giveawaysExcluded, true);
});

test("Market Intelligence combines Ponty and local history with transparent metrics", () => {
  const now = 10_000_000;
  const setup = makeController({
    now,
    market: [],
    ponty: [
      {
        itemName: "gem0",
        level: 1,
        price: 100,
        quantity: 1,
        server: "EU I",
        observedAt: now - 60_000,
      },
    ],
    localHistory: [
      {
        item_name: "gem0",
        level: 1,
        price: 80,
        quantity: 1,
        server: "EU I",
        observed_at: now - 600_000,
      },
      {
        itemName: "gem0",
        level: 1,
        price: 120,
        quantity: 2,
        server: "EU I",
        timestamp: now - 300_000,
      },
    ],
  });

  const status = setup.controller.tick();
  const aggregate = status.aggregates[0];

  assert.equal(status.summary.observations, 3);
  assert.equal(status.summary.ponty, 1);
  assert.equal(status.summary.localHistory, 2);
  assert.equal(aggregate.medianPrice, 100);
  assert.deepEqual(aggregate.priceBand, { min: 80, max: 120 });
  assert.equal(aggregate.volatility, 0.4);
  assert.equal(aggregate.samples, 3);
  assert.equal(aggregate.ageMs, 60_000);
  assert.equal(aggregate.confidence, "MEDIUM");
  assert.deepEqual(aggregate.sources, ["LOCAL_HISTORY", "PONTY"]);
});

test("Market Intelligence keeps item levels and servers in separate aggregates", () => {
  const setup = makeController({
    market: [
      listing({ level: 0, price: 100 }),
      listing({ merchantId: "b", level: 1, price: 200, slot: "trade2" }),
    ],
    ponty: [
      {
        itemName: "gem0",
        level: 0,
        price: 300,
        quantity: 1,
        server: "US I",
        observedAt: 999_000,
      },
    ],
  });

  const status = setup.controller.tick();

  assert.equal(status.aggregates.length, 3);
  assert.deepEqual(
    status.aggregates.map((aggregate) => [
      aggregate.itemName,
      aggregate.level,
      aggregate.server,
      aggregate.medianPrice,
    ]),
    [
      ["gem0", 0, "EU I", 100],
      ["gem0", 0, "US I", 300],
      ["gem0", 1, "EU I", 200],
    ],
  );
});

test("Market Intelligence marks fresh ten-sample evidence HIGH confidence", () => {
  const now = 5_000_000;
  const localHistory = Array.from({ length: 10 }, (_, index) => ({
    itemName: "scroll0",
    level: 0,
    price: 1000 + index,
    quantity: 1,
    server: "EU I",
    observedAt: now - index * 10_000,
  }));
  const setup = makeController({ now, localHistory });

  const aggregate = setup.controller.tick().aggregates[0];

  assert.equal(aggregate.samples, 10);
  assert.equal(aggregate.confidence, "HIGH");
  assert.equal(aggregate.ageMs, 0);
});

test("Market Intelligence stays EMPTY when no valid sample exists", () => {
  const setup = makeController({
    market: [
      listing({ side: "BUY" }),
      listing({ price: 0, slot: "trade2" }),
      listing({ giveaway: 5, slot: "trade3" }),
    ],
    ponty: [{ itemName: "", price: 100 }],
    localHistory: [{ itemName: "gem0", price: 0 }],
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "EMPTY");
  assert.equal(status.reason, "MARKET_INTELLIGENCE_NO_SAMPLES");
  assert.equal(status.summary.observations, 0);
  assert.deepEqual(status.aggregates, []);
});

test("Market Intelligence foundation remains read-only and action-free", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "market-intelligence-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(source, /readOnly: true/);
  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /tradeList/);
  assert.doesNotMatch(source, /pontyBuy/);
  assert.doesNotMatch(source, /buy\(/);
  assert.doesNotMatch(source, /sell\(/);
});

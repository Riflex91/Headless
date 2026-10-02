"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildSupervisorSnapshot } = require("../src/HeadlessDashboard");

test("supervisor snapshot exposes account-wide merchant logistics board", () => {
  const board = {
    generatedAt: 1234,
    merchantIndependent: true,
    merchants: [
      {
        name: "My_Merchant",
        live: true,
        enabled: true,
        map: "main",
        x: 0,
        y: 0,
      },
    ],
    claims: [
      {
        id: "POTION_DELIVERY:My_Ranger:My_Merchant:hpot0:",
        type: "POTION_DELIVERY",
        farmer: "My_Ranger",
        merchant: { name: "My_Merchant", live: true },
        itemName: "hpot0",
        quantity: 100,
        priority: 90,
        reason: "POTION_BELOW_TARGET",
        status: "READY",
      },
    ],
    suppressed: [],
    summary: {
      total: 1,
      ready: 1,
      waitingMerchant: 0,
      suppressed: 0,
      byType: {
        MLUCK: 0,
        POTION_DELIVERY: 1,
        ITEM_DELIVERY: 0,
        GOLD_PICKUP: 0,
        INVENTORY_PRESSURE: 0,
        GEAR_DELIVERY: 0,
      },
    },
  };

  const snapshot = buildSupervisorSnapshot(
    {},
    { maxOnlineCharacters: 4 },
    null,
    null,
    null,
    board,
  );

  assert.deepEqual(snapshot.merchant_logistics, board);
  assert.equal(snapshot.merchant_logistics.merchantIndependent, true);
  assert.equal(snapshot.merchant_logistics.claims[0].status, "READY");
});

test("coordinator refreshes logistics from config, inventory intelligence and stat beats", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(coordinator));
  assert.match(coordinator, /MerchantLogisticsPlanner/);
  assert.match(coordinator, /refresh_merchant_logistics/);
  assert.match(coordinator, /INVENTORY_INTELLIGENCE_UPDATED/);
  assert.match(coordinator, /CONFIG_UPDATED/);
  assert.match(coordinator, /STAT_BEAT/);
  assert.match(coordinator, /getMerchantLogisticsState/);
});

test("dashboard source projects merchant logistics as a top-level account concern", () => {
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(dashboard, /merchant_logistics/);
  assert.match(dashboard, /merchantIndependent/);
  assert.match(dashboard, /getMerchantLogisticsState/);
});

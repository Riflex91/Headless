"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadExecutor() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "logistics-claim-executor.lib.ts",
    ),
  ).LogisticsClaimExecutor;
}

function makeAction(status = "CONFIRMED", why = "CONFIRMED") {
  return {
    id: "A-1",
    correlationId: "C-1",
    module: "MerchantLogistics",
    action: "TEST",
    why,
    createdAt: 1,
    status,
  };
}

function setup({
  character = "My_Merchant",
  gold = 10000,
  items = [],
  protectedSlots = [],
  dispositions = {},
  entities = [
    {
      id: "farmer-entity",
      type: "character",
      name: "My_Ranger",
      dead: false,
      rip: false,
    },
  ],
  actionStatus = "CONFIRMED",
} = {}) {
  const calls = [];
  const LogisticsClaimExecutor = loadExecutor();
  const actions = {
    async useSkill(request) {
      calls.push(["useSkill", request]);
      return makeAction(actionStatus, "SKILL_RESULT");
    },
    async sendItem(request) {
      calls.push(["sendItem", request]);
      return makeAction(actionStatus, "SEND_ITEM_RESULT");
    },
    async sendGold(request) {
      calls.push(["sendGold", request]);
      return makeAction(actionStatus, "SEND_GOLD_RESULT");
    },
  };
  const game = {
    character() {
      return { name: character, gold };
    },
    entities() {
      return entities.map((entity) => ({ ...entity }));
    },
    inventory() {
      return items.map((item, slot) => ({ slot, item }));
    },
  };
  const inventoryIntelligence = {
    status() {
      return {
        entries: items
          .map((item, slot) =>
            item
              ? {
                  slot,
                  name: item.name || null,
                  protected: protectedSlots.includes(slot),
                  disposition:
                    dispositions[slot] ||
                    (protectedSlots.includes(slot) ? "RESERVED" : "KEEP"),
                }
              : null,
          )
          .filter(Boolean),
      };
    },
  };
  return {
    calls,
    executor: new LogisticsClaimExecutor(actions, game, inventoryIntelligence),
  };
}

test("mluck claim executes from merchant through ActionBoundary", async () => {
  const { executor, calls } = setup();
  const result = await executor.execute({
    id: "claim-mluck",
    type: "MLUCK",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    reason: "MLUCK_REQUESTED",
  });

  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(result.fulfilled, true);
  assert.equal(result.source, "My_Merchant");
  assert.equal(result.target, "My_Ranger");
  assert.deepEqual(calls[0], [
    "useSkill",
    {
      skill: "mluck",
      targetId: "farmer-entity",
      module: "MerchantLogistics",
      why: "MLUCK_REQUESTED",
      correlationId: "claim-mluck",
    },
  ]);
});

test("merchant item delivery revalidates inventory and sends bounded quantity", async () => {
  const { executor, calls } = setup({
    items: [
      { name: "hpot0", q: 20 },
      { name: "hpot0", q: 50 },
    ],
  });
  const result = await executor.execute({
    id: "claim-potion",
    type: "POTION_DELIVERY",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "hpot0",
    quantity: 80,
    reason: "POTION_BELOW_TARGET",
  });

  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(result.executedQuantity, 50);
  assert.equal(result.requestedQuantity, 80);
  assert.equal(result.fulfilled, false);
  assert.equal(calls[0][0], "sendItem");
  assert.equal(calls[0][1].inventorySlot, 1);
  assert.equal(calls[0][1].quantity, 50);
});

test("gear delivery uses the same safe item transfer path", async () => {
  const { executor, calls } = setup({
    items: [{ name: "bow", level: 3 }],
  });
  const result = await executor.execute({
    id: "claim-gear",
    type: "GEAR_DELIVERY",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "bow",
    quantity: 1,
  });

  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(result.fulfilled, true);
  assert.equal(calls[0][0], "sendItem");
});

test("gold pickup executes on farmer and sends gold to merchant", async () => {
  const { executor, calls } = setup({
    character: "My_Ranger",
  });
  const result = await executor.execute({
    id: "claim-gold",
    type: "GOLD_PICKUP",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    amount: 2500,
    reason: "GOLD_ABOVE_RESERVE",
  });

  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(result.fulfilled, true);
  assert.deepEqual(calls[0], [
    "sendGold",
    {
      recipient: "My_Merchant",
      amount: 2500,
      module: "MerchantLogistics",
      why: "GOLD_ABOVE_RESERVE",
      correlationId: "claim-gold",
    },
  ]);
});

test("inventory pressure revalidates exact slot and item identity", async () => {
  const { executor, calls } = setup({
    character: "My_Ranger",
    items: [{ name: "junk", q: 4 }],
  });
  const result = await executor.execute({
    id: "claim-pressure",
    type: "INVENTORY_PRESSURE",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "junk",
    inventorySlot: 0,
    quantity: 3,
  });

  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(result.executedQuantity, 3);
  assert.equal(result.fulfilled, true);
  assert.equal(calls[0][0], "sendItem");

  const mismatch = setup({
    character: "My_Ranger",
    items: [{ name: "other", q: 4 }],
  });
  const blocked = await mismatch.executor.execute({
    id: "claim-pressure",
    type: "INVENTORY_PRESSURE",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "junk",
    inventorySlot: 0,
    quantity: 3,
  });
  assert.equal(blocked.outcome, "BLOCKED");
  assert.equal(blocked.reason, "CLAIM_ITEM_REVALIDATION_FAILED");
  assert.equal(mismatch.calls.length, 0);
});

test("claim cannot execute on the wrong source character", async () => {
  const { executor, calls } = setup({
    character: "My_Ranger",
    items: [{ name: "hpot0", q: 100 }],
  });
  const result = await executor.execute({
    id: "claim-potion",
    type: "POTION_DELIVERY",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "hpot0",
    quantity: 10,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "CLAIM_SOURCE_MISMATCH");
  assert.equal(calls.length, 0);
});

test("UNKNOWN outcome is preserved and never reported as fulfilled", async () => {
  const { executor } = setup({
    items: [{ name: "hpot0", q: 100 }],
    actionStatus: "UNKNOWN",
  });
  const result = await executor.execute({
    id: "claim-potion",
    type: "POTION_DELIVERY",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "hpot0",
    quantity: 10,
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.fulfilled, false);
});

test("mluck blocks when farmer is not visible instead of guessing target identity", async () => {
  const { executor, calls } = setup({ entities: [] });
  const result = await executor.execute({
    id: "claim-mluck-hidden",
    type: "MLUCK",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "CLAIM_TARGET_NOT_VISIBLE");
  assert.equal(calls.length, 0);
});

test("protected outbound item is revalidated immediately before mutation", async () => {
  const { executor, calls } = setup({
    items: [{ name: "bow", level: 3 }],
    protectedSlots: [0],
  });
  const result = await executor.execute({
    id: "claim-gear-protected",
    type: "GEAR_DELIVERY",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "bow",
    quantity: 1,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "CLAIM_ITEM_UNAVAILABLE");
  assert.equal(calls.length, 0);
});

test("inventory pressure blocks if item became protected after claim creation", async () => {
  const { executor, calls } = setup({
    character: "My_Ranger",
    items: [{ name: "junk", q: 4 }],
    protectedSlots: [0],
  });
  const result = await executor.execute({
    id: "claim-pressure-protected",
    type: "INVENTORY_PRESSURE",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "junk",
    inventorySlot: 0,
    quantity: 3,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "CLAIM_ITEM_PROTECTED");
  assert.equal(calls.length, 0);
});

test("gold pickup revalidates reserve and caps stale claim amount", async () => {
  const { executor, calls } = setup({
    character: "My_Ranger",
    gold: 2500,
  });
  const result = await executor.execute({
    id: "claim-gold-reserve",
    type: "GOLD_PICKUP",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    amount: 4000,
    metadata: { keepGold: 1000 },
  });

  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(result.amount, 1500);
  assert.equal(result.fulfilled, false);
  assert.equal(calls[0][0], "sendGold");
  assert.equal(calls[0][1].amount, 1500);
});

test("gold pickup blocks when current balance reached reserve", async () => {
  const { executor, calls } = setup({
    character: "My_Ranger",
    gold: 1000,
  });
  const result = await executor.execute({
    id: "claim-gold-reserve-block",
    type: "GOLD_PICKUP",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    amount: 4000,
    metadata: { keepGold: 1000 },
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "CLAIM_GOLD_RESERVE_REACHED");
  assert.equal(calls.length, 0);
});

test("missing outbound item blocks before mutation", async () => {
  const { executor, calls } = setup({ items: [] });
  const result = await executor.execute({
    id: "claim-item",
    type: "ITEM_DELIVERY",
    farmer: "My_Ranger",
    merchant: { name: "My_Merchant", live: true },
    itemName: "computer",
    quantity: 1,
  });

  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.reason, "CLAIM_ITEM_UNAVAILABLE");
  assert.equal(calls.length, 0);
});

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadRunner() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "logistics-live-test.lib.ts",
    ),
  ).LogisticsLiveTestRunner;
}

function inventoryStatus(entries = []) {
  return {
    timestamp: 1000,
    enabled: true,
    state: entries.length ? "READY" : "EMPTY",
    reason: entries.length
      ? "INVENTORY_INTELLIGENCE_READY"
      : "INVENTORY_INTELLIGENCE_EMPTY",
    entries,
    summary: {
      totalItems: entries.length,
      protectedItems: entries.filter((entry) => entry.protected).length,
      dispositions: {},
      protections: {},
    },
  };
}

test("logistics live runner validates inventory safety and reaches blocked executor path", async () => {
  const LogisticsLiveTestRunner = loadRunner();
  const calls = [];
  let now = 1000;
  const runner = new LogisticsLiveTestRunner({
    logisticsClaims: {
      async execute(claim) {
        calls.push(["execute", claim]);
        return {
          claimId: claim.id,
          type: claim.type,
          source: "My_Merchant",
          target: "My_Merchant",
          outcome: "BLOCKED",
          reason: "CLAIM_SELF_TRANSFER_BLOCKED",
          actionId: null,
          itemName: claim.itemName,
          requestedQuantity: claim.quantity,
          executedQuantity: null,
          amount: null,
          fulfilled: false,
        };
      },
    },
    inventoryIntelligence: {
      setConfigOverride(config) {
        calls.push(["set", config.inventory.intelligence.enabled]);
      },
      clearConfigOverride() {
        calls.push(["clear"]);
      },
      tick() {
        return inventoryStatus([
          {
            slot: 0,
            name: "mystery",
            level: null,
            quantity: 1,
            definitionKnown: false,
            itemType: null,
            disposition: "UNKNOWN",
            protected: true,
            protections: ["UNKNOWN"],
            why: "UNKNOWN via unknown item metadata · protected: UNKNOWN",
          },
        ]);
      },
    },
    character: () => ({ name: "My_Merchant", ctype: "merchant" }),
    now: () => {
      now += 10;
      return now;
    },
  });

  const result = await runner.run({ requestId: "L-1" });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "LOGISTICS_LIVE_RUNTIME_CONFIRMED");
  assert.equal(result.safetyProbe.reason, "CLAIM_SELF_TRANSFER_BLOCKED");
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.valueMutationForced, false);
  assert.equal(result.scope.sendItemForced, false);
  assert.equal(result.cleanup.inventoryOverrideCleared, true);
  assert.deepEqual(calls[0], ["set", true]);
  assert.equal(calls[1][0], "clear");
  assert.equal(calls[2][0], "execute");
  assert.equal(calls[2][1].farmer, "My_Merchant");
  assert.equal(calls[2][1].merchant.name, "My_Merchant");
});

test("logistics live runner fails when the safe probe would cross the mutation boundary", async () => {
  const LogisticsLiveTestRunner = loadRunner();
  const runner = new LogisticsLiveTestRunner({
    logisticsClaims: {
      async execute(claim) {
        return {
          claimId: claim.id,
          type: claim.type,
          source: "My_Merchant",
          target: "My_Merchant",
          outcome: "CONFIRMED",
          reason: "UNEXPECTED_MUTATION",
          actionId: "A-1",
          itemName: claim.itemName,
          requestedQuantity: claim.quantity,
          executedQuantity: 1,
          amount: null,
          fulfilled: true,
        };
      },
    },
    inventoryIntelligence: {
      setConfigOverride() {},
      clearConfigOverride() {},
      tick() {
        return inventoryStatus([]);
      },
    },
    character: () => ({ name: "My_Merchant", ctype: "merchant" }),
  });

  const result = await runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "LOGISTICS_LIVE_SAFE_PROBE_NOT_BLOCKED");
  assert.equal(result.scope.valueMutationForced, false);
});

test("logistics live runner fails conservative inventory safety before declaring pass", async () => {
  const LogisticsLiveTestRunner = loadRunner();
  const runner = new LogisticsLiveTestRunner({
    logisticsClaims: {
      async execute(claim) {
        return {
          claimId: claim.id,
          type: claim.type,
          source: "My_Merchant",
          target: "My_Merchant",
          outcome: "BLOCKED",
          reason: "CLAIM_SELF_TRANSFER_BLOCKED",
          actionId: null,
          itemName: claim.itemName,
          requestedQuantity: claim.quantity,
          executedQuantity: null,
          amount: null,
          fulfilled: false,
        };
      },
    },
    inventoryIntelligence: {
      setConfigOverride() {},
      clearConfigOverride() {},
      tick() {
        return inventoryStatus([
          {
            slot: 0,
            name: "mystery",
            level: null,
            quantity: 1,
            definitionKnown: false,
            itemType: null,
            disposition: "UNKNOWN",
            protected: false,
            protections: [],
            why: "UNKNOWN via unknown item metadata",
          },
        ]);
      },
    },
    character: () => ({ name: "My_Merchant", ctype: "merchant" }),
  });

  const result = await runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "LOGISTICS_LIVE_INVENTORY_SAFETY_INVALID");
});

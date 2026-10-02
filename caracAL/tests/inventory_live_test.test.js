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
      "inventory-live-test.lib.ts",
    ),
  ).InventoryLiveTestRunner;
}

function status(entries, state = "READY") {
  return {
    timestamp: 1000,
    enabled: true,
    state,
    reason:
      state === "EMPTY"
        ? "INVENTORY_INTELLIGENCE_EMPTY"
        : "INVENTORY_INTELLIGENCE_READY",
    entries,
    summary: {
      totalItems: entries.length,
      protectedItems: entries.filter((entry) => entry.protected).length,
      dispositions: {},
      protections: {},
    },
  };
}

test("inventory live runner validates real classification and conservative unknown protection", () => {
  const InventoryLiveTestRunner = loadRunner();
  const calls = [];
  let now = 1000;
  const runner = new InventoryLiveTestRunner({
    inventoryIntelligence: {
      setConfigOverride(config) {
        calls.push(["set", config.inventory.intelligence.enabled]);
      },
      clearConfigOverride() {
        calls.push(["clear"]);
      },
      tick() {
        return status([
          {
            slot: 0,
            name: "hpot1",
            disposition: "CONSUMABLE",
            protected: false,
            protections: [],
            why: "CONSUMABLE via Adventure Land item metadata",
          },
          {
            slot: 1,
            name: "mystery",
            disposition: "UNKNOWN",
            protected: true,
            protections: ["UNKNOWN"],
            why: "UNKNOWN via unknown item metadata · protected: UNKNOWN",
          },
        ]);
      },
    },
    inventory: () => [
      { slot: 0, item: { name: "hpot1" } },
      { slot: 1, item: { name: "mystery" } },
      { slot: 2, item: null },
    ],
    now: () => {
      now += 10;
      return now;
    },
  });

  const result = runner.run({ requestId: "I-1" });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "INVENTORY_LIVE_E2E_CONFIRMED");
  assert.equal(result.inventory.nonEmptySlots, 2);
  assert.equal(result.inventory.classifiedEntries, 2);
  assert.equal(result.inventory.unknownItemsProtected, true);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.valueMutationForced, false);
  assert.equal(result.cleanup.inventoryOverrideCleared, true);
  assert.deepEqual(calls, [
    ["set", true],
    ["clear"],
  ]);
});

test("inventory live runner accepts a genuinely empty inventory without manual preconditions", () => {
  const InventoryLiveTestRunner = loadRunner();
  const runner = new InventoryLiveTestRunner({
    inventoryIntelligence: {
      setConfigOverride() {},
      clearConfigOverride() {},
      tick() {
        return status([], "EMPTY");
      },
    },
    inventory: () => [],
  });

  const result = runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "INVENTORY_LIVE_E2E_EMPTY_VALID");
  assert.equal(result.inventory.nonEmptySlots, 0);
  assert.equal(result.inventory.classifiedEntries, 0);
});

test("inventory live runner rejects an unprotected unknown item", () => {
  const InventoryLiveTestRunner = loadRunner();
  const runner = new InventoryLiveTestRunner({
    inventoryIntelligence: {
      setConfigOverride() {},
      clearConfigOverride() {},
      tick() {
        return status([
          {
            slot: 0,
            name: "mystery",
            disposition: "UNKNOWN",
            protected: false,
            protections: [],
            why: "UNKNOWN via unknown item metadata",
          },
        ]);
      },
    },
    inventory: () => [{ slot: 0, item: { name: "mystery" } }],
  });

  const result = runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(
    result.reason,
    "INVENTORY_LIVE_E2E_CLASSIFICATION_INVALID",
  );
});

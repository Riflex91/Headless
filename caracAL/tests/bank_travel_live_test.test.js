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
      "bank-travel-live-test.lib.ts",
    ),
  ).BankTravelLiveTestRunner;
}

function makeStatus({
  state,
  reason,
  stage,
  bankAvailable = false,
  packs = [],
  targetMap = "bank",
  action = null,
}) {
  return {
    timestamp: 1000,
    enabled: true,
    state,
    reason,
    roadmapStage: stage,
    character: {
      name: "My_Merchant",
      map: bankAvailable ? "bank" : "main",
      x: 0,
      y: 0,
      moving: false,
    },
    bank: {
      available: bankAvailable,
      gold: bankAvailable ? 50000 : null,
      packs,
    },
    target: {
      map: targetMap,
      pack: targetMap ? "items0" : null,
      goldPrice: 0,
      shellPrice: 0,
      source: targetMap ? "bank_packs" : null,
    },
    movement: {
      owner: null,
      mode: "IDLE",
    },
    lastAction: action,
  };
}

function setup(sequence) {
  const BankTravelLiveTestRunner = loadRunner();
  let now = 1000;
  let index = 0;
  let override = null;
  const statuses = sequence.map((entry) => ({ ...entry }));

  const bankTravel = {
    setConfigOverride(config) {
      override = config;
    },
    clearConfigOverride() {
      override = null;
    },
    status() {
      return statuses[Math.min(index, statuses.length - 1)];
    },
    async tick() {
      const value = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return value;
    },
  };

  const runner = new BankTravelLiveTestRunner({
    bankTravel,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  return {
    runner,
    getOverride: () => override,
  };
}

test("bank travel live runner confirms locate, travel, and bank evidence", async () => {
  const setupResult = setup([
    makeStatus({
      state: "TRAVEL",
      reason: "BANK_TRAVEL_IN_PROGRESS",
      stage: "Travel",
      action: {
        id: "move-1",
        status: "CONFIRMED",
        destination: "bank",
      },
    }),
    makeStatus({
      state: "READY",
      reason: "BANK_AVAILABLE",
      stage: "Bank bereit",
      bankAvailable: true,
      packs: ["items0"],
      action: {
        id: "move-1",
        status: "CONFIRMED",
        destination: "bank",
      },
    }),
  ]);

  const result = await setupResult.runner.run();

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "BANK_TRAVEL_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.accessLocated, true);
  assert.equal(result.evidence.travelObserved, true);
  assert.equal(result.evidence.bankAvailable, true);
  assert.equal(result.evidence.bankPacksVisible, true);
  assert.equal(result.evidence.unknownOutcomeAvoided, true);
  assert.equal(result.scope.bankItemMutationAllowed, false);
  assert.equal(result.scope.bankGoldMutationAllowed, false);
  assert.equal(result.cleanup.configOverrideCleared, true);
  assert.equal(setupResult.getOverride(), null);
});

test("bank travel live runner never accepts UNKNOWN", async () => {
  const setupResult = setup([
    makeStatus({
      state: "UNKNOWN",
      reason: "BANK_TRAVEL_OUTCOME_UNKNOWN",
      stage: "Travel",
      action: {
        id: "move-unknown",
        status: "UNKNOWN",
        destination: "bank",
      },
    }),
  ]);

  const result = await setupResult.runner.run();

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "BANK_TRAVEL_LIVE_OUTCOME_UNKNOWN");
  assert.equal(result.evidence.unknownOutcomeAvoided, false);
  assert.equal(result.cleanup.configOverrideCleared, true);
});

test("bank travel live runner rejects READY without travel evidence", async () => {
  const setupResult = setup([
    makeStatus({
      state: "READY",
      reason: "BANK_AVAILABLE",
      stage: "Bank bereit",
      bankAvailable: true,
      packs: ["items0"],
      action: null,
    }),
  ]);

  const result = await setupResult.runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "BANK_TRAVEL_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.travelObserved, false);
});

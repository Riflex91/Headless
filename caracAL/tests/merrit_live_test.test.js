"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", fileName),
  );
}

function status(overrides = {}) {
  const base = {
    timestamp: 1000,
    enabled: true,
    state: "SYNCING",
    reason: "TEST",
    roadmapStage: "Cooldown",
    character: {
      name: "My_Merchant",
      map: "main",
      instance: "main",
      x: 0,
      y: 0,
    },
    server: {
      statusKnown: true,
      reasonCodes: [],
      serverNow: 1000,
      nextAt: 1000,
      lastReceipt: null,
    },
    target: {
      map: "main",
      x: 0,
      y: 0,
      candidateIndex: 0,
      candidateCount: 7,
      inEligibleArea: true,
      positioned: true,
    },
    stand: {
      open: false,
      itemPresent: true,
      openedByController: false,
    },
    listing: {
      valid: false,
      activeSlots: [],
      temporarySlot: null,
      itemName: "hpot0",
    },
    settle: {
      requiredMs: 120000,
      remainingMs: null,
    },
    parcel: {
      confirmedAt: null,
      readyAt: null,
    },
    lastAction: null,
  };
  return {
    ...base,
    ...overrides,
    character: {
      ...base.character,
      ...(overrides.character || {}),
    },
    server: {
      ...base.server,
      ...(overrides.server || {}),
    },
    target: {
      ...base.target,
      ...(overrides.target || {}),
    },
    stand: {
      ...base.stand,
      ...(overrides.stand || {}),
    },
    listing: {
      ...base.listing,
      ...(overrides.listing || {}),
    },
    settle: {
      ...base.settle,
      ...(overrides.settle || {}),
    },
    parcel: {
      ...base.parcel,
      ...(overrides.parcel || {}),
    },
  };
}

function runnerFor(sequence, cleanup = {}) {
  let index = 0;
  let now = 1000;
  let overrideSet = false;
  let overrideCleared = false;
  const controller = {
    setConfigOverride() {
      overrideSet = true;
    },
    clearConfigOverride() {
      overrideCleared = true;
    },
    status() {
      return sequence[0];
    },
    async tick() {
      const value = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return value;
    },
    async cleanupTemporaryState() {
      return {
        listing:
          cleanup.listingStatus === undefined
            ? null
            : { status: cleanup.listingStatus },
        stand:
          cleanup.standStatus === undefined
            ? null
            : { status: cleanup.standStatus },
      };
    },
  };
  const { MerritLiveTestRunner } = coreModule("merrit-live-test.lib.ts");
  const runner = new MerritLiveTestRunner({
    merrit: controller,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return {
    runner,
    state() {
      return { overrideSet, overrideCleared, ticks: index };
    },
  };
}

test("Merrit live runner confirms the roadmap through Parcel", async () => {
  const setup = runnerFor(
    [
      status({
        state: "STAND",
        roadmapStage: "Stand",
        stand: { open: true },
      }),
      status({
        state: "LISTING",
        roadmapStage: "Listing",
        stand: { open: true },
        listing: { valid: true, temporarySlot: "trade1" },
      }),
      status({
        state: "SETTLING",
        roadmapStage: "120 s settle",
        stand: { open: true },
        listing: { valid: true, temporarySlot: "trade1" },
        settle: { remainingMs: 119000 },
      }),
      status({
        state: "HANDOFF",
        roadmapStage: "Handoff",
        stand: { open: true },
        listing: { valid: true, temporarySlot: "trade1" },
      }),
      status({
        state: "PARCEL",
        roadmapStage: "Cooldown persistieren",
        stand: { open: true },
        listing: { valid: true, temporarySlot: "trade1" },
        parcel: {
          confirmedAt: 5000,
          readyAt: 3605000,
        },
      }),
    ],
    {
      listingStatus: "CONFIRMED",
      standStatus: "CONFIRMED",
    },
  );

  const result = await setup.runner.run({
    requestId: "merrit-live-test",
    timeoutMs: 30000,
    pollMs: 250,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MERRIT_LIVE_RUNTIME_CONFIRMED");
  assert.equal(result.evidence.cooldownChecked, true);
  assert.equal(result.evidence.positionConfirmed, true);
  assert.equal(result.evidence.standConfirmed, true);
  assert.equal(result.evidence.listingConfirmed, true);
  assert.equal(result.evidence.settleObserved, true);
  assert.equal(result.evidence.handoffSatisfied, true);
  assert.equal(result.evidence.parcelConfirmed, true);
  assert.equal(result.evidence.cooldownReadyAtPresent, true);
  assert.equal(result.scope.blindRetryAllowed, false);
  assert.equal(result.cleanup.temporaryListingRestored, true);
  assert.equal(result.cleanup.standRestored, true);
  assert.deepEqual(setup.state(), {
    overrideSet: true,
    overrideCleared: true,
    ticks: 5,
  });
});

test("Merrit live runner stops cleanly on an existing account cooldown", async () => {
  const setup = runnerFor([
    status({
      state: "COOLDOWN",
      reason: "MERRIT_ACCOUNT_COOLDOWN_ACTIVE",
      roadmapStage: "Cooldown",
      server: {
        reasonCodes: ["cooldown"],
        nextAt: 500000,
      },
    }),
  ]);

  const result = await setup.runner.run({
    timeoutMs: 30000,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MERRIT_LIVE_ACCOUNT_COOLDOWN_ACTIVE");
  assert.equal(setup.state().ticks, 1);
  assert.equal(result.cleanup.autonomyOverrideCleared, true);
});

test("Merrit live runner never continues after UNKNOWN", async () => {
  const setup = runnerFor([
    status({
      state: "UNKNOWN",
      reason: "MERRIT_ACTION_OUTCOME_UNKNOWN",
      roadmapStage: "Stand",
    }),
    status({
      state: "PARCEL",
      roadmapStage: "Cooldown persistieren",
      parcel: { confirmedAt: 5000, readyAt: 3605000 },
    }),
  ]);

  const result = await setup.runner.run({
    timeoutMs: 30000,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MERRIT_LIVE_ACTION_OUTCOME_UNKNOWN");
  assert.equal(setup.state().ticks, 1);
});

test("Merrit live runner fails a PASS candidate when cleanup cannot restore state", async () => {
  const setup = runnerFor(
    [
      status({
        state: "SETTLING",
        roadmapStage: "120 s settle",
        stand: { open: true },
        listing: { valid: true, temporarySlot: "trade1" },
      }),
      status({
        state: "PARCEL",
        roadmapStage: "Cooldown persistieren",
        stand: { open: true },
        listing: { valid: true, temporarySlot: "trade1" },
        parcel: { confirmedAt: 5000, readyAt: 3605000 },
      }),
    ],
    {
      listingStatus: "UNKNOWN",
      standStatus: "CONFIRMED",
    },
  );

  const result = await setup.runner.run({
    timeoutMs: 30000,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MERRIT_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.cleanup.temporaryListingRestored, false);
});

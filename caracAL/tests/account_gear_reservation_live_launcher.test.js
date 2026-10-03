"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  accountGearReservationEvidence,
  combineSupervisorResult,
  evidenceComplete,
  expectedReservationPlan,
  selectReservationPair,
} = require("../scripts/run_account_gear_reservation_live_e2e");

function scoring({
  inventory = [],
  mainhandScore = 20,
  weights = { attack: 1, dex: 2 },
} = {}) {
  return {
    state: "READY",
    characterClass: "ranger",
    weights,
    entries: [
      ...inventory,
      {
        location: "EQUIPMENT",
        slot: "mainhand",
        name: "bow",
        level: 1,
        score: mainhandScore,
        stats: { attack: mainhandScore },
      },
    ],
  };
}

function inventoryGear({
  slot = 3,
  name = "candidate_bow",
  score = 30,
  stats = { attack: 24, dex: 3 },
} = {}) {
  return {
    location: "INVENTORY",
    slot,
    name,
    level: 2,
    slotGroup: "weapon",
    score,
    stats,
  };
}

function character(
  name,
  {
    inventory = [],
    mainhandScore = 20,
    sourceReservations = [],
    targetReservations = [],
    reservedSlots = [],
  } = {},
) {
  return {
    name,
    accountOwned: true,
    connected: true,
    ctype: "ranger",
    scoring: scoring({ inventory, mainhandScore }),
    futureGear: {
      state: "READY",
      minScoreDelta: 0,
      entries: [],
    },
    inventoryIntelligence: {
      state: "READY",
      entries: inventory.map((entry) => ({
        slot: entry.slot,
        name: entry.name,
        disposition: reservedSlots.includes(entry.slot) ? "RESERVED" : "GEAR",
        protected: reservedSlots.includes(entry.slot),
        protections: reservedSlots.includes(entry.slot) ? ["RESERVED"] : [],
      })),
    },
    accountReservation: {
      state: "READY",
      sourceReservations,
      targetReservations,
      summary: {},
    },
    slots: {
      mainhand: { name: "bow", level: 1 },
      offhand: null,
      ring1: null,
      ring2: null,
    },
  };
}

function reservation() {
  return {
    sourceCharacter: "RangerA",
    sourceInventorySlot: 3,
    itemName: "candidate_bow",
    level: 2,
    sourceClass: "ranger",
    reservedForCharacter: "RangerB",
    targetClass: "ranger",
    targetSlot: "mainhand",
    targetScore: 30,
    baselineScore: 20,
    scoreDelta: 10,
    minScoreDelta: 0,
    reason: "ACCOUNT_GEAR_RESERVATION_SCORE_IMPROVEMENT",
  };
}

function completeCharacters() {
  const expectedReservation = reservation();
  const base = [
    character("RangerA", {
      inventory: [inventoryGear()],
      mainhandScore: 50,
      sourceReservations: [expectedReservation],
      reservedSlots: [3],
    }),
    character("RangerB", {
      inventory: [],
      mainhandScore: 20,
      targetReservations: [expectedReservation],
    }),
  ];
  const expected = expectedReservationPlan(base);
  for (const entry of base) {
    entry.accountReservation.summary = {
      ...expected.summary,
      sourceReservations:
        entry.name === "RangerA" ? expected.reservations.length : 0,
      targetReservations:
        entry.name === "RangerB" ? expected.reservations.length : 0,
    };
  }
  return base;
}

function supervisorResult(overrides = {}) {
  const before = completeCharacters();
  const after = completeCharacters();
  return {
    request_id: "account-gear-reservation-live-1",
    outcome: "PASS",
    reason: "ACCOUNT_GEAR_RESERVATION_LIVE_RUNTIME_E2E_CONFIRMED",
    source: "RangerA",
    target: "RangerB",
    characterClass: "ranger",
    before,
    after,
    scope: {
      readOnly: true,
      itemTransferMutationForced: false,
      equipmentMutationForced: false,
      valueMutationForced: false,
      upgradeMutationForced: false,
      runtimeOverrideApplied: true,
    },
    cleanup: {
      equipmentBaselineRestored: true,
      inventoryGearBaselineRestored: true,
      runtimeStatesRestored: true,
    },
    ...overrides,
  };
}

test("Account Gear Reservation live evidence recomputes real cross-character reservation", () => {
  const evidence = accountGearReservationEvidence(completeCharacters());

  assert.equal(evidence.readyPairObserved, true);
  assert.equal(evidence.inventoryGearObserved, true);
  assert.equal(evidence.expectedReservationCount, 1);
  assert.equal(evidence.observedReservationCount, 1);
  assert.equal(evidence.allReservationsRecomputed, true);
  assert.equal(evidence.reservationProtectionComplete, true);
  assert.equal(evidence.summaryMatches, true);
  assert.equal(evidenceComplete(evidence), true);
});

test("Account Gear Reservation live result requires complete cleanup and evidence", () => {
  const result = combineSupervisorResult(supervisorResult());

  assert.equal(result.outcome, "PASS");
  assert.equal(
    result.reason,
    "ACCOUNT_GEAR_RESERVATION_LIVE_E2E_CONFIRMED",
  );
  assert.equal(result.evidence.allReservationsRecomputed, true);
  assert.equal(result.evidence.reservationProtectionComplete, true);
  assert.equal(result.evidence.runtimeStatesRestored, true);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.itemTransferMutationForced, false);
  assert.equal(result.scope.upgradeMutationForced, false);
});

test("Account Gear Reservation live gate accepts a legitimate zero-reservation account evaluation", () => {
  const rangerA = character("RangerA", {
    inventory: [inventoryGear({ score: 10, stats: { attack: 10 } })],
    mainhandScore: 50,
  });
  const rangerB = character("RangerB", {
    mainhandScore: 20,
  });
  const chars = [rangerA, rangerB];
  const expected = expectedReservationPlan(chars);
  assert.equal(expected.reservations.length, 0);

  for (const entry of chars) {
    entry.accountReservation.summary = {
      ...expected.summary,
      sourceReservations: 0,
      targetReservations: 0,
    };
  }

  const result = combineSupervisorResult(
    supervisorResult({
      before: chars,
      after: JSON.parse(JSON.stringify(chars)),
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidence.expectedReservationCount, 0);
  assert.equal(result.evidence.inventoryGearObserved, true);
});

test("Account Gear Reservation live gate rejects missing RESERVED protection", () => {
  const after = completeCharacters();
  after[0].inventoryIntelligence.entries[0] = {
    ...after[0].inventoryIntelligence.entries[0],
    disposition: "GEAR",
    protected: false,
    protections: [],
  };

  const result = combineSupervisorResult(
    supervisorResult({
      after,
    }),
  );

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.evidence.reservationProtectionComplete, false);
});

test("Account Gear Reservation live gate rejects invented supervisor reservation", () => {
  const after = completeCharacters();
  after[0].accountReservation.sourceReservations[0].scoreDelta = 999;

  const result = combineSupervisorResult(
    supervisorResult({
      after,
    }),
  );

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.evidence.allReservationsRecomputed, false);
});

test("Account Gear Reservation live pair selection prefers same-class connected ranger", () => {
  const snapshot = {
    characters: [
      {
        name: "Mage",
        account_owned: true,
        connected: true,
        ctype: "mage",
      },
      {
        name: "RangerB",
        account_owned: true,
        connected: false,
        ctype: "ranger",
      },
      {
        name: "RangerA",
        account_owned: true,
        connected: true,
        ctype: "ranger",
      },
      {
        name: "Merchant",
        account_owned: true,
        connected: true,
        ctype: "merchant",
      },
    ],
  };

  const pair = selectReservationPair(snapshot);

  assert.equal(pair.source.name, "RangerA");
  assert.equal(pair.target.name, "RangerB");
});

test("Account Gear Reservation live wiring uses the two-character TYPECODE harness", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "scripts",
      "run_account_gear_reservation_live_e2e.js",
    ),
    "utf8",
  );

  assert.match(coordinator, /run_account_gear_reservation_live_test/);
  assert.match(
    coordinator,
    /wait_for_account_gear_reservation_live_runtime/,
  );
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/account-gear-reservation/,
  );
  assert.match(launcher, /ACCOUNT_GEAR_RESERVATION_LIVE_E2E_CONFIRMED/);
  assert.match(launcher, /reservationProtectionComplete/);
});

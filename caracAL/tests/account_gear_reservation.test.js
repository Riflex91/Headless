"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAccountGearReservationPlan,
  reservationProjectionForCharacter,
  reservedSlotsForCharacter,
  scoreStats,
  targetBaseline,
} = require("../src/AccountGearReservation");

function inventoryGear({
  slot = 3,
  name = "candidate_bow",
  level = 2,
  slotGroup = "weapon",
  score = 30,
  stats = { attack: 30 },
} = {}) {
  return {
    location: "INVENTORY",
    slot,
    name,
    level,
    slotGroup,
    score,
    stats,
  };
}

function equipmentGear(slot, score, name = "bow") {
  return {
    location: "EQUIPMENT",
    slot,
    name,
    level: 1,
    score,
    stats: {},
  };
}

function character({
  type = "ranger",
  inventory = [],
  equipmentEntries = [equipmentGear("mainhand", 20)],
  slots = { mainhand: { name: "bow", level: 1 } },
  weights = { attack: 1, dex: 2 },
  minScoreDelta = 0,
  selfFutureSlots = [],
  owned = true,
} = {}) {
  return {
    account_owned: owned,
    account_character_type: type,
    connected: true,
    bot_runtime_started_at: 1000,
    live_state: {
      ctype: type,
      slots,
    },
    gear_scoring_runtime: {
      state: "READY",
      characterClass: type,
      weights,
      entries: [...inventory, ...equipmentEntries],
    },
    future_gear_runtime: {
      state: "READY",
      minScoreDelta,
      entries: selfFutureSlots.map((inventorySlot) => ({
        inventorySlot,
        candidate: true,
      })),
    },
  };
}

test("account Gear Reservation reserves a source item for a weaker same-class peer", () => {
  const plan = buildAccountGearReservationPlan(
    {
      RangerA: character({
        inventory: [
          inventoryGear({
            stats: { attack: 24, dex: 3 },
            score: 30,
          }),
        ],
        equipmentEntries: [equipmentGear("mainhand", 40)],
      }),
      RangerB: character({
        inventory: [],
        equipmentEntries: [equipmentGear("mainhand", 20)],
        weights: { attack: 1, dex: 2 },
      }),
    },
    { now: () => 1000 },
  );

  assert.equal(plan.state, "READY");
  assert.equal(plan.summary.accountOwnedCharacters, 2);
  assert.equal(plan.summary.readyGearCharacters, 2);
  assert.equal(plan.summary.eligiblePairs, 2);
  assert.equal(plan.reservations.length, 1);

  const reservation = plan.reservations[0];
  assert.equal(reservation.sourceCharacter, "RangerA");
  assert.equal(reservation.sourceInventorySlot, 3);
  assert.equal(reservation.reservedForCharacter, "RangerB");
  assert.equal(reservation.targetSlot, "mainhand");
  assert.equal(reservation.targetScore, 30);
  assert.equal(reservation.baselineScore, 20);
  assert.equal(reservation.scoreDelta, 10);
  assert.equal(
    reservation.reason,
    "ACCOUNT_GEAR_RESERVATION_SCORE_IMPROVEMENT",
  );
  assert.deepEqual(reservedSlotsForCharacter(plan, "RangerA"), [3]);
});

test("account Gear Reservation never crosses character classes", () => {
  const plan = buildAccountGearReservationPlan({
    Ranger: character({
      type: "ranger",
      inventory: [inventoryGear()],
    }),
    Mage: character({
      type: "mage",
      equipmentEntries: [equipmentGear("mainhand", 5, "staff")],
      slots: { mainhand: { name: "staff" } },
    }),
  });

  assert.equal(plan.summary.eligiblePairs, 0);
  assert.equal(plan.reservations.length, 0);
});

test("account Gear Reservation chooses the strongest claim for one target slot", () => {
  const plan = buildAccountGearReservationPlan({
    RangerA: character({
      inventory: [
        inventoryGear({
          slot: 3,
          name: "bow_a",
          stats: { attack: 30 },
          score: 30,
        }),
        inventoryGear({
          slot: 4,
          name: "bow_b",
          stats: { attack: 40 },
          score: 40,
        }),
      ],
      equipmentEntries: [equipmentGear("mainhand", 50)],
    }),
    RangerB: character({
      equipmentEntries: [equipmentGear("mainhand", 10)],
    }),
  });

  assert.equal(plan.summary.candidateClaims, 2);
  assert.equal(plan.reservations.length, 1);
  assert.equal(plan.reservations[0].itemName, "bow_b");
  assert.equal(plan.reservations[0].sourceInventorySlot, 4);
  assert.equal(plan.reservations[0].scoreDelta, 30);
});

test("account Gear Reservation respects the target Future Gear delta threshold", () => {
  const plan = buildAccountGearReservationPlan({
    RangerA: character({
      inventory: [
        inventoryGear({
          stats: { attack: 25 },
          score: 25,
        }),
      ],
      equipmentEntries: [equipmentGear("mainhand", 50)],
    }),
    RangerB: character({
      equipmentEntries: [equipmentGear("mainhand", 20)],
      minScoreDelta: 5,
    }),
  });

  assert.equal(plan.reservations.length, 0);
  assert.equal(plan.summary.candidateClaims, 0);
});

test("account Gear Reservation does not claim an occupied target with unknown baseline", () => {
  const source = inventoryGear();
  const target = character({
    equipmentEntries: [
      {
        ...equipmentGear("mainhand", null),
        score: null,
      },
    ],
  });

  assert.equal(targetBaseline(source, target), null);

  const plan = buildAccountGearReservationPlan({
    RangerA: character({
      inventory: [source],
      equipmentEntries: [equipmentGear("mainhand", 50)],
    }),
    RangerB: target,
  });

  assert.equal(plan.reservations.length, 0);
});

test("account Gear Reservation uses an empty compatible target slot as zero baseline", () => {
  const plan = buildAccountGearReservationPlan({
    RangerA: character({
      inventory: [
        inventoryGear({
          slotGroup: "offhand",
          stats: { dex: 3 },
          score: 6,
        }),
      ],
      equipmentEntries: [equipmentGear("mainhand", 50)],
    }),
    RangerB: character({
      slots: {
        mainhand: { name: "bow" },
        offhand: null,
      },
      equipmentEntries: [equipmentGear("mainhand", 20)],
      weights: { dex: 2 },
    }),
  });

  assert.equal(plan.reservations.length, 1);
  assert.equal(plan.reservations[0].targetSlot, "offhand");
  assert.equal(plan.reservations[0].baselineScore, 0);
  assert.equal(plan.reservations[0].targetScore, 6);
});

test("reservation projection separates source and target claims", () => {
  const plan = buildAccountGearReservationPlan({
    RangerA: character({
      inventory: [inventoryGear()],
      equipmentEntries: [equipmentGear("mainhand", 50)],
    }),
    RangerB: character({
      equipmentEntries: [equipmentGear("mainhand", 10)],
    }),
  });

  const source = reservationProjectionForCharacter(plan, "RangerA");
  const target = reservationProjectionForCharacter(plan, "RangerB");

  assert.equal(source.sourceReservations.length, 1);
  assert.equal(source.targetReservations.length, 0);
  assert.equal(target.sourceReservations.length, 0);
  assert.equal(target.targetReservations.length, 1);
});

test("scoreStats applies target-character weights deterministically", () => {
  assert.equal(
    scoreStats(
      { attack: 10, dex: 4, hp: 100 },
      { attack: 1, dex: 2, hp: 0.05 },
    ),
    23,
  );
});

test("account Gear Reservation ignores stale disconnected projections", () => {
  const disconnected = character({
    inventory: [inventoryGear()],
  });
  disconnected.connected = false;

  const plan = buildAccountGearReservationPlan({
    RangerA: disconnected,
    RangerB: character(),
  });

  assert.equal(plan.summary.readyGearCharacters, 1);
  assert.equal(plan.summary.eligiblePairs, 0);
  assert.equal(plan.reservations.length, 0);
});

test("account Gear Reservation never steals the source character own Future Gear", () => {
  const plan = buildAccountGearReservationPlan({
    RangerA: character({
      inventory: [inventoryGear({ slot: 3 })],
      equipmentEntries: [equipmentGear("mainhand", 50)],
      selfFutureSlots: [3],
    }),
    RangerB: character({
      equipmentEntries: [equipmentGear("mainhand", 5)],
    }),
  });

  assert.equal(plan.reservations.length, 0);
  assert.equal(plan.summary.candidateClaims, 0);
});

test("account Gear Reservation waits for Future Gear readiness", () => {
  const rangerA = character({
    inventory: [inventoryGear()],
  });
  rangerA.future_gear_runtime.state = "EMPTY";

  const plan = buildAccountGearReservationPlan({
    RangerA: rangerA,
    RangerB: character(),
  });

  assert.equal(plan.summary.readyGearCharacters, 1);
  assert.equal(plan.reservations.length, 0);
});


"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  contributionMatches,
  equipmentSignature,
  evidenceComplete,
  gearScoringEvidence,
  runGearScoringLiveVerification,
  selectGearScoringCharacter,
  waitForGearScoringCharacter,
  waitForGearScoringProjection,
} = require("../scripts/run_gear_scoring_live_e2e");

function scoring(overrides = {}) {
  return {
    timestamp: 1000,
    enabled: true,
    state: "READY",
    reason: "GEAR_SCORING_READY",
    characterClass: "ranger",
    profile: "ranger",
    weights: {
      attack: 1,
      str: 2,
      armor: 0.5,
    },
    entries: [
      {
        location: "EQUIPMENT",
        slot: "mainhand",
        name: "bow",
        level: 2,
        definitionKnown: true,
        score: 18,
        stats: {
          attack: 14,
          str: 2,
        },
        contributions: {
          attack: 14,
          str: 4,
        },
        why: "GEAR_SCORE_WEIGHTED_ADVENTURE_LAND_STATS",
      },
    ],
    summary: {
      inventoryGear: 0,
      equippedGear: 1,
      scoredItems: 1,
      unknownItems: 0,
      equipmentScore: 18,
      bestInventoryScore: null,
    },
    ...overrides,
  };
}

function character(name = "My_Ranger1", overrides = {}) {
  return {
    name,
    account_owned: true,
    connected: true,
    lifecycle_state: "ONLINE",
    game: {
      ctype: "ranger",
      slots: {
        mainhand: { name: "bow", level: 2 },
      },
    },
    gear_scoring_runtime: scoring(),
    ...overrides,
  };
}

test("gear scoring evidence proves a real equipped score and recomputes it", () => {
  const evidence = gearScoringEvidence(character());

  assert.equal(evidence.supervisorProjectionVisible, true);
  assert.equal(evidence.equippedScoreObserved, true);
  assert.equal(evidence.allKnownScoresFinite, true);
  assert.equal(evidence.unknownScoresRemainNull, true);
  assert.equal(evidence.allScoredEntriesRecomputed, true);
  assert.equal(evidence.equipmentCountMatches, true);
  assert.equal(evidenceComplete(evidence), true);
});

test("gear scoring evidence rejects a mismatched contribution", () => {
  const item = scoring().entries[0];
  const weights = scoring().weights;

  assert.equal(contributionMatches(item, weights), true);
  assert.equal(
    contributionMatches(
      {
        ...item,
        contributions: {
          ...item.contributions,
          attack: 13,
        },
      },
      weights,
    ),
    false,
  );
});

test("gear scoring character selection never auto-selects offline gear", () => {
  const offline = character("Offline", {
    connected: false,
    gear_scoring_runtime: null,
  });
  const snapshot = {
    characters: [offline, character("Ready")],
  };

  assert.equal(selectGearScoringCharacter(snapshot).name, "Ready");
  assert.equal(selectGearScoringCharacter(snapshot, "Offline").name, "Offline");
  assert.equal(selectGearScoringCharacter({ characters: [offline] }), null);
});

test("wait for gear scoring character survives dashboard-ready before character-online", async () => {
  const offline = character("My_Mage", {
    connected: false,
    gear_scoring_runtime: null,
  });
  const connected = character("My_Ranger1");
  let reads = 0;

  const result = await waitForGearScoringCharacter(null, {
    initialState: { characters: [offline] },
    readStateImpl: async () => {
      reads += 1;
      return { characters: [offline, connected] };
    },
    timeoutMs: 100,
    pollMs: 1,
    now: (() => {
      let value = 0;
      return () => {
        value += 1;
        return value;
      };
    })(),
    sleepImpl: async () => {},
  });

  assert.equal(result.name, "My_Ranger1");
  assert.equal(reads, 1);
});

test("equipment signature ignores trade slots but detects gear changes", () => {
  const base = character();
  base.game.slots.trade1 = { name: "hpot0", q: 1 };

  const sameGearDifferentTrade = character();
  sameGearDifferentTrade.game.slots.trade1 = { name: "mpot0", q: 99 };

  const changedGear = character();
  changedGear.game.slots.mainhand = { name: "bow", level: 3 };

  assert.equal(
    equipmentSignature(base),
    equipmentSignature(sameGearDifferentTrade),
  );
  assert.notEqual(equipmentSignature(base), equipmentSignature(changedGear));
});

test("wait for gear scoring projection accepts the first READY runtime projection", async () => {
  let calls = 0;
  const ready = character();

  const result = await waitForGearScoringProjection("My_Ranger1", {
    readStateImpl: async () => {
      calls += 1;
      return {
        characters: [
          calls === 1
            ? character("My_Ranger1", {
                gear_scoring_runtime: {
                  ...scoring(),
                  state: "EMPTY",
                },
              })
            : ready,
        ],
      };
    },
    timeoutMs: 100,
    pollMs: 1,
    now: (() => {
      let value = 0;
      return () => {
        value += 1;
        return value;
      };
    })(),
    sleepImpl: async () => {},
  });

  assert.equal(result.gear_scoring_runtime.state, "READY");
  assert.equal(calls, 2);
});

test("live verification stays read-only and requires stable equipment", async () => {
  const snapshots = [
    { characters: [character()] },
    { characters: [character()] },
  ];
  let index = 0;
  const result = await runGearScoringLiveVerification("My_Ranger1", {
    readStateImpl: async () =>
      snapshots[Math.min(index++, snapshots.length - 1)],
    sleepImpl: async () => {},
    settleMs: 0,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GEAR_SCORING_LIVE_E2E_CONFIRMED");
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.valueMutationForced, false);
  assert.equal(result.cleanup.equipmentBaselineRestored, true);
});

test("live verification fails when equipment changes during the read-only window", async () => {
  const changed = character();
  changed.game.slots.mainhand = { name: "bow", level: 3 };
  const snapshots = [{ characters: [character()] }, { characters: [changed] }];
  let index = 0;
  const result = await runGearScoringLiveVerification("My_Ranger1", {
    readStateImpl: async () =>
      snapshots[Math.min(index++, snapshots.length - 1)],
    sleepImpl: async () => {},
    settleMs: 0,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.cleanup.equipmentBaselineRestored, false);
});

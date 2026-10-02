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
      "farm-intelligence-live-test.lib.ts",
    ),
  ).FarmIntelligenceLiveTestRunner;
}

test("farm intelligence live runner confirms passive selection and observation", async () => {
  const FarmIntelligenceLiveTestRunner = loadRunner();
  let now = 1000;
  let override = null;
  let ticks = 0;
  let cleared = false;

  const selected = {
    farmKey: "goo@main:0",
    monster: "goo",
    map: "main",
    x: 0,
    y: 0,
    spawnCount: 5,
    score: 88,
    components: {},
    componentScores: {},
    estimated: { dropItems: [] },
    observed: null,
    whyMonster: "goo: Score 88 · XP 100",
    whySpot: "main @ 0, 0 · same map · travel 0 · spawn 5",
  };
  const controller = {
    status() {
      return this.tick();
    },
    tick() {
      ticks += 1;
      return {
        timestamp: now,
        enabled: !!override,
        state: override ? "READY" : "DISABLED",
        reason: override
          ? "FARM_CANDIDATE_SELECTED"
          : "FARM_INTELLIGENCE_DISABLED",
        selected: override
          ? {
              ...selected,
              observed:
                ticks >= 2
                  ? {
                      sampleMs: 1200,
                      xpPerHour: 0,
                      goldPerHour: 0,
                      dropsPerHour: 0,
                      updatedAt: now,
                    }
                  : null,
            }
          : null,
        candidates: override ? [selected] : [],
        weights: {},
        preferredMonsters: [],
        forbiddenMonsters: [],
        goalMonster: null,
        goalItems: [],
      };
    },
    setConfigOverride(value) {
      override = value;
    },
    clearConfigOverride() {
      override = null;
      cleared = true;
    },
  };

  const runner = new FarmIntelligenceLiveTestRunner({
    farmIntelligence: controller,
    character: () => ({
      name: "Farmer",
      map: "main",
      x: 0,
      y: 0,
      xp: 100,
      gold: 200,
    }),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  const result = await runner.run({ requestId: "farm-live-1", sampleMs: 1200 });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "FARM_INTELLIGENCE_LIVE_CONFIRMED");
  assert.equal(result.intelligence.selectedMonster, "goo");
  assert.equal(result.intelligence.observedSample, true);
  assert.equal(result.scope.movementMutationForced, false);
  assert.equal(result.scope.combatMutationForced, false);
  assert.equal(result.scope.valueMutationForced, false);
  assert.equal(result.cleanup.farmOverrideCleared, true);
  assert.equal(cleared, true);
  assert.equal(override, null);
});

test("farm intelligence live runner fails safely when no candidates exist", async () => {
  const FarmIntelligenceLiveTestRunner = loadRunner();
  let override = null;
  const controller = {
    status() {
      return this.tick();
    },
    tick() {
      return {
        timestamp: 1000,
        enabled: !!override,
        state: override ? "NO_CANDIDATES" : "DISABLED",
        reason: override
          ? "NO_FARM_CANDIDATES"
          : "FARM_INTELLIGENCE_DISABLED",
        selected: null,
        candidates: [],
        weights: {},
        preferredMonsters: [],
        forbiddenMonsters: [],
        goalMonster: null,
        goalItems: [],
      };
    },
    setConfigOverride(value) {
      override = value;
    },
    clearConfigOverride() {
      override = null;
    },
  };

  const runner = new FarmIntelligenceLiveTestRunner({
    farmIntelligence: controller,
    character: () => ({
      name: "Farmer",
      map: "main",
      x: 0,
      y: 0,
      xp: 0,
      gold: 0,
    }),
    now: () => 1000,
    sleep: async () => {},
  });

  const result = await runner.run();

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "FARM_INTELLIGENCE_NO_CANDIDATES");
  assert.equal(result.cleanup.farmOverrideCleared, true);
});

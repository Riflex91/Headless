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
      "farm-live-test.lib.ts",
    ),
  ).FarmLiveTestRunner;
}

function selected(observed = null) {
  return {
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
    observed,
    whyMonster: "goo: Score 88 · XP 100",
    whySpot: "main @ 0, 0 · same map",
  };
}

test("farm live runner confirms real selection, WHY projection and observed performance", async () => {
  const FarmLiveTestRunner = loadRunner();
  const calls = [];
  let now = 1000;
  let ticks = 0;
  const controller = {
    setConfigOverride(config) {
      calls.push(["set", config.farming.enabled]);
    },
    clearConfigOverride() {
      calls.push(["clear"]);
    },
    tick() {
      ticks += 1;
      if (ticks === 1) return { state: "READY", selected: selected(null) };
      if (ticks === 2) {
        return {
          state: "READY",
          selected: selected({
            sampleMs: 1100,
            xpPerHour: 0,
            goldPerHour: 0,
            dropsPerHour: 0,
            updatedAt: 2100,
          }),
        };
      }
      return { state: "DISABLED", selected: null };
    },
  };
  const runner = new FarmLiveTestRunner({
    farmIntelligence: controller,
    character: () => ({
      name: "Farmer",
      map: "main",
      x: 1,
      y: 2,
      xp: 100,
      gold: 200,
    }),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  const result = await runner.run({ requestId: "F-1", sampleMs: 1000 });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "FARM_LIVE_E2E_CONFIRMED");
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.valueMutationForced, false);
  assert.equal(result.selection.observedPerformanceProjected, true);
  assert.equal(result.cleanup.farmOverrideCleared, true);
  assert.deepEqual(calls, [
    ["set", true],
    ["clear"],
  ]);
});

test("farm live runner fails safely when no candidates exist and clears override", async () => {
  const FarmLiveTestRunner = loadRunner();
  let cleared = false;
  const runner = new FarmLiveTestRunner({
    farmIntelligence: {
      setConfigOverride() {},
      clearConfigOverride() {
        cleared = true;
      },
      tick() {
        return { state: "NO_CANDIDATES", selected: null };
      },
    },
    character: () => ({
      name: "Farmer",
      map: "main",
      x: 0,
      y: 0,
      xp: 0,
      gold: 0,
    }),
    sleep: async () => {},
  });

  const result = await runner.run({ sampleMs: 1000 });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "FARM_LIVE_E2E_NO_CANDIDATES");
  assert.equal(cleared, true);
  assert.equal(result.cleanup.farmOverrideCleared, true);
});

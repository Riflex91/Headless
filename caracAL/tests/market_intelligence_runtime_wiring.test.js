"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Phase 16 Market Intelligence runtime wiring stays read-only", () => {
  const kernel = read("TYPECODE/bot/core/runtime-kernel.lib.ts");
  const controller = read(
    "TYPECODE/bot/core/market-intelligence-controller.lib.ts",
  );

  assert.match(kernel, /MarketIntelligenceController/);
  assert.match(kernel, /MARKET_INTELLIGENCE_JOB_ID/);
  assert.match(kernel, /MARKET_INTELLIGENCE_INTERVAL_MS = 5000/);
  assert.match(kernel, /this\.marketIntelligence\.tick\(\)/);
  assert.match(
    kernel,
    /marketIntelligence: this\.marketIntelligence\.status\(\)/,
  );
  assert.match(kernel, /runWhenPaused: true/);
  assert.match(kernel, /server: runtimeRealm/);
  assert.match(kernel, /MarketIntelligenceController",/);

  const schedulerStart = kernel.indexOf("id: MARKET_INTELLIGENCE_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "this.registerMerchantAutonomyJob()",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);

  assert.match(schedulerBlock, /this\.marketIntelligence\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /execute/);
  assert.doesNotMatch(controller, /ActionBoundary/);
  assert.doesNotMatch(controller, /pontyBuy/);
  assert.match(controller, /readOnly: true/);
});

test("supervisor propagates realm and persists deduped LIVE_VISIBLE samples only", () => {
  const thread = read("src/CharacterThread.js");
  const coordinator = read("standalones/CharacterCoordinator.js");

  assert.match(thread, /extensions\.realm = proc_args\.realm \|\| null/);
  assert.match(coordinator, /realm: char_block\.realm/);
  assert.match(coordinator, /market_intelligence_runtime/);
  assert.match(coordinator, /market_live_observation_signatures/);
  assert.match(coordinator, /selectNewLiveMarketObservations/);
  assert.match(coordinator, /persistence\.appendMarketObservation/);
  assert.match(coordinator, /source: "LIVE_VISIBLE"/);
  assert.match(coordinator, /market_intelligence_live_visible/);

  const marketStart = coordinator.indexOf(
    "const selected_market_observations = selectNewLiveMarketObservations",
  );
  const marketEnd = coordinator.indexOf(
    "if (\n      char_block &&\n      normalized.data?.inventoryIntelligence",
    marketStart,
  );
  assert.ok(marketStart >= 0);
  assert.ok(marketEnd > marketStart);
  const persistenceBlock = coordinator.slice(marketStart, marketEnd);

  assert.match(persistenceBlock, /appendMarketObservation/);
  assert.doesNotMatch(persistenceBlock, /tradeList/);
  assert.doesNotMatch(persistenceBlock, /tradeUnlist/);
  assert.doesNotMatch(persistenceBlock, /pontyBuy/);
  assert.doesNotMatch(persistenceBlock, /buy\(/);
  assert.doesNotMatch(persistenceBlock, /sell\(/);
});

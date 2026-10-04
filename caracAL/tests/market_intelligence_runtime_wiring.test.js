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
  assert.match(kernel, /PontyMarketSnapshotTracker/);
  assert.match(
    kernel,
    /ponty: \(\) =>\s*this\.pontyMarketSnapshotTracker\.observations/,
  );
  assert.match(kernel, /localHistory: \(\) => this\.marketLocalHistory/);
  assert.match(kernel, /setMarketLocalHistory\(observations: unknown\)/);
  assert.match(kernel, /MARKET_INTELLIGENCE_LOCAL_HISTORY_APPLIED/);
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
  assert.match(thread, /case "market_intelligence_history"/);
  assert.match(thread, /runtime\.setMarketLocalHistory\(observations\)/);
  assert.match(thread, /market_intelligence_history_applied/);
  assert.match(coordinator, /realm: char_block\.realm/);
  assert.match(coordinator, /market_intelligence_runtime/);
  assert.match(coordinator, /market_live_observation_signatures/);
  assert.match(coordinator, /market_ponty_observation_signatures/);
  assert.match(coordinator, /market_local_history_sync_signature/);
  assert.match(coordinator, /selectNewLiveMarketObservations/);
  assert.match(coordinator, /selectNewPontyMarketObservations/);
  assert.match(coordinator, /selectMarketLocalHistoryForRuntime/);
  assert.match(coordinator, /marketLocalHistorySyncSignature/);
  assert.match(
    coordinator,
    /persistence\.listMarketHistory\(\{ limit: 500 \}\)/,
  );
  assert.match(coordinator, /type: "market_intelligence_history"/);
  assert.match(coordinator, /persistence\.appendMarketObservation/);
  assert.match(coordinator, /persistence\.appendPontyObservation/);
  assert.match(coordinator, /source: "LIVE_VISIBLE"/);
  assert.match(coordinator, /market_intelligence_ponty/);
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

  const historyStart = coordinator.indexOf(
    "function sync_market_local_history",
  );
  const historyEnd = coordinator.indexOf(
    "function persist_character_runtime_state",
    historyStart,
  );
  assert.ok(historyStart >= 0);
  assert.ok(historyEnd > historyStart);
  const historyBlock = coordinator.slice(historyStart, historyEnd);

  assert.match(historyBlock, /listMarketHistory/);
  assert.match(historyBlock, /listPontyHistory/);
  assert.match(historyBlock, /pontySignatures/);
  assert.match(historyBlock, /selectMarketLocalHistoryForRuntime/);
  assert.match(historyBlock, /market_intelligence_history/);
  assert.doesNotMatch(historyBlock, /tradeList/);
  assert.doesNotMatch(historyBlock, /tradeUnlist/);
  assert.doesNotMatch(historyBlock, /pontyBuy/);
  assert.doesNotMatch(historyBlock, /buy\(/);
  assert.doesNotMatch(historyBlock, /sell\(/);

  const pontyStart = coordinator.indexOf(
    "const selected_ponty_observations",
  );
  const pontyEnd = coordinator.indexOf(
    "sync_market_local_history",
    pontyStart,
  );
  assert.ok(pontyStart >= 0);
  assert.ok(pontyEnd > pontyStart);
  const pontyBlock = coordinator.slice(pontyStart, pontyEnd);

  assert.match(pontyBlock, /selectNewPontyMarketObservations/);
  assert.match(pontyBlock, /appendPontyObservation/);
  assert.doesNotMatch(pontyBlock, /pontyBuy/);
  assert.doesNotMatch(pontyBlock, /sbuy/);
  assert.doesNotMatch(pontyBlock, /tradeList/);
  assert.doesNotMatch(pontyBlock, /buy\(/);
  assert.doesNotMatch(pontyBlock, /sell\(/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  evaluateMarketIntelligence,
  formatCompactResult,
  marketIntelligenceEvidence,
  parseCliArgs,
  selectMarketIntelligenceCharacter,
  waitForMarketIntelligenceCharacter,
} = require("../scripts/run_market_intelligence_live_e2e");

function policy() {
  return {
    readOnly: true,
    liveVisibleSellOnly: true,
    giveawaysExcluded: true,
    priceBand: "OBSERVED_MIN_MAX",
    volatility: "RELATIVE_RANGE_OVER_MEDIAN",
    confidence: {
      low: "fallback when MEDIUM/HIGH thresholds are not met",
      medium: {
        minSamples: 3,
        maxAgeMs: 3600000,
      },
      high: {
        minSamples: 10,
        maxAgeMs: 900000,
      },
    },
  };
}

function observation({
  itemName,
  level = 0,
  price,
  source,
  seller,
  timestamp = 1000,
} = {}) {
  return {
    itemName,
    level,
    price,
    quantity: 1,
    server: "EU I",
    seller,
    timestamp,
    source,
    metadata: {},
  };
}

function aggregate({ itemName, level = 0, price, source, ageMs = 0 } = {}) {
  return {
    itemName,
    level,
    server: "EU I",
    medianPrice: price,
    priceBand: {
      min: price,
      max: price,
    },
    volatility: 0,
    samples: 1,
    ageMs,
    confidence: "LOW",
    sources: [source],
  };
}

function projection({
  includePonty = true,
  summaryOverride = {},
  aggregateOverride = null,
} = {}) {
  const observations = [
    observation({
      itemName: "hpot1",
      price: 42,
      source: "LIVE_VISIBLE",
      seller: "Trader",
    }),
    ...(includePonty
      ? [
          observation({
            itemName: "sword",
            level: 2,
            price: 1000,
            source: "PONTY",
            seller: "Ponty",
          }),
        ]
      : []),
    observation({
      itemName: "scroll0",
      level: null,
      price: 900,
      source: "LOCAL_HISTORY",
      seller: "History",
      timestamp: 500,
    }),
  ];

  const aggregates = [
    aggregate({
      itemName: "hpot1",
      price: 42,
      source: "LIVE_VISIBLE",
    }),
    ...(includePonty
      ? [
          aggregate({
            itemName: "sword",
            level: 2,
            price: 1000,
            source: "PONTY",
          }),
        ]
      : []),
    aggregate({
      itemName: "scroll0",
      level: null,
      price: 900,
      source: "LOCAL_HISTORY",
      ageMs: 500,
    }),
  ];

  if (aggregateOverride) {
    Object.assign(aggregates[0], aggregateOverride);
  }

  return {
    timestamp: 1000,
    state: "READY",
    reason: "MARKET_INTELLIGENCE_READY",
    observations,
    aggregates,
    summary: {
      observations: observations.length,
      aggregates: aggregates.length,
      liveVisible: 1,
      ponty: includePonty ? 1 : 0,
      localHistory: 1,
      ...summaryOverride,
    },
    policy: policy(),
  };
}

function character(name = "My_Merchant", options = {}) {
  return {
    name,
    account_owned: options.account_owned ?? true,
    connected: options.connected ?? true,
    realm: options.realm ?? "EU I",
    market_intelligence_runtime:
      options.market_intelligence_runtime ?? projection(),
  };
}

test("Market Intelligence live evidence confirms all three Phase 16 sources", () => {
  const result = evaluateMarketIntelligence(character());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MARKET_INTELLIGENCE_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.projectionReady, true);
  assert.equal(result.evidence.metricsValid, true);
  assert.equal(result.evidence.policyValid, true);
  assert.equal(result.evidence.allSourcesObserved, true);
  assert.deepEqual(result.evidence.observedSources, {
    LIVE_VISIBLE: 1,
    PONTY: 1,
    LOCAL_HISTORY: 1,
  });
  assert.deepEqual(result.evidence.missingSources, []);
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.dashboardGetOnly, true);
  assert.equal(result.scope.socketRequestForced, false);
  assert.equal(result.scope.pontyBuyForced, false);
  assert.equal(result.scope.tradeMutationForced, false);
  assert.equal(result.scope.mutationDispatched, false);
});

test("Market Intelligence live evidence is PARTIAL when a source is absent", () => {
  const result = evaluateMarketIntelligence(
    character("My_Merchant", {
      market_intelligence_runtime: projection({
        includePonty: false,
      }),
    }),
  );

  assert.equal(result.outcome, "PARTIAL");
  assert.equal(
    result.reason,
    "MARKET_INTELLIGENCE_LIVE_PARTIAL_SOURCE_COVERAGE",
  );
  assert.deepEqual(result.evidence.missingSources, ["PONTY"]);
  assert.equal(result.evidence.metricsValid, true);
  assert.equal(result.evidence.policyValid, true);
  assert.equal(result.scope.mutationDispatched, false);
});

test("Market Intelligence live evidence fails on inconsistent metrics", () => {
  const result = evaluateMarketIntelligence(
    character("My_Merchant", {
      market_intelligence_runtime: projection({
        summaryOverride: {
          observations: 99,
        },
        aggregateOverride: {
          volatility: -1,
        },
      }),
    }),
  );

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MARKET_INTELLIGENCE_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.summaryMatches, false);
  assert.equal(result.evidence.aggregatesValid, false);
  assert.equal(result.evidence.metricsValid, false);
});

test("Market Intelligence evidence preserves null item levels", () => {
  const evidence = marketIntelligenceEvidence(character());

  assert.equal(evidence.observationsValid, true);
  assert.equal(evidence.aggregatesValid, true);
});

test("Market Intelligence compact output shows source coverage and no mutation", () => {
  const output = formatCompactResult(evaluateMarketIntelligence(character()));

  assert.match(output, /Market Intelligence Live Preflight/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /LIVE_VISIBLE=1 \| PONTY=1 \| LOCAL_HISTORY=1/);
  assert.match(output, /Metrics valid: yes/);
  assert.match(output, /Read-only policy: yes/);
  assert.match(output, /Dashboard GET only: yes/);
  assert.match(output, /Mutation dispatched: no/);
  assert.doesNotMatch(output, /Exact guarded mutation command/);
});

test("Market Intelligence compact PARTIAL output names missing sources", () => {
  const output = formatCompactResult(
    evaluateMarketIntelligence(
      character("My_Merchant", {
        market_intelligence_runtime: projection({
          includePonty: false,
        }),
      }),
    ),
  );

  assert.match(output, /Outcome: PARTIAL/);
  assert.match(output, /Missing sources: PONTY/);
  assert.match(output, /Mutation dispatched: no/);
});

test("Market Intelligence CLI defaults to compact output", () => {
  assert.deepEqual(parseCliArgs(["My_Merchant"]), {
    requestedCharacter: "My_Merchant",
    verbose: false,
    clearScreen: true,
  });
  assert.deepEqual(parseCliArgs(["My_Merchant", "--verbose", "--no-clear"]), {
    requestedCharacter: "My_Merchant",
    verbose: true,
    clearScreen: false,
  });
});

test("Market Intelligence character selection prefers connected owned projection", () => {
  const selected = selectMarketIntelligenceCharacter({
    characters: [
      character("Offline", {
        connected: false,
      }),
      character("My_Merchant"),
    ],
  });

  assert.equal(selected.name, "My_Merchant");
  assert.equal(
    selectMarketIntelligenceCharacter(
      {
        characters: [character("My_Merchant")],
      },
      "My_Merchant",
    ).name,
    "My_Merchant",
  );
});

test("Market Intelligence wait survives dashboard-ready before projection-ready", async () => {
  const pending = character("My_Merchant", {
    market_intelligence_runtime: null,
  });
  const ready = character("My_Merchant");
  let reads = 0;

  const selected = await waitForMarketIntelligenceCharacter("My_Merchant", {
    initialState: {
      characters: [pending],
    },
    readStateImpl: async () => {
      reads += 1;
      return {
        characters: [ready],
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

  assert.equal(selected.name, "My_Merchant");
  assert.equal(reads, 1);
});

test("Market Intelligence live launcher is GET-only and dashboard exposes projection", () => {
  const launcher = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "scripts",
      "run_market_intelligence_live_e2e.js",
    ),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(
    dashboard,
    /market_intelligence_runtime:\s*charBlock\.market_intelligence_runtime/,
  );
  assert.match(launcher, /fetch\(baseUrl \+ "\/headless\/api\/state"/);
  assert.doesNotMatch(launcher, /method:\s*"POST"/);
  assert.doesNotMatch(launcher, /ActionBoundary/);
  assert.doesNotMatch(launcher, /socket\.emit/);
  assert.doesNotMatch(launcher, /pontyBuy/);
  assert.doesNotMatch(launcher, /tradeList/);
  assert.doesNotMatch(launcher, /tradeUnlist/);
});

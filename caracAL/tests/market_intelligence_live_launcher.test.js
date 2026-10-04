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
  runMarketIntelligenceSupervisorLiveTest,
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
    market_intelligence_runtime: Object.prototype.hasOwnProperty.call(
      options,
      "market_intelligence_runtime",
    )
      ? options.market_intelligence_runtime
      : projection(),
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

test("Market Intelligence live evidence is WATCH when a source is absent", () => {
  const result = evaluateMarketIntelligence(
    character("My_Merchant", {
      market_intelligence_runtime: projection({
        includePonty: false,
      }),
    }),
  );

  assert.equal(result.outcome, "WATCH");
  assert.equal(
    result.reason,
    "MARKET_INTELLIGENCE_LIVE_SOURCE_COVERAGE_PENDING",
  );
  assert.deepEqual(result.evidence.missingSources, ["PONTY"]);
  assert.equal(result.evidence.metricsValid, true);
  assert.equal(result.evidence.policyValid, true);
  assert.equal(result.scope.mutationDispatched, false);
});

test("Market Intelligence live evidence is WATCH when projection is safely EMPTY", () => {
  const result = evaluateMarketIntelligence(
    character("My_Merchant", {
      market_intelligence_runtime: {
        timestamp: 1000,
        state: "EMPTY",
        reason: "MARKET_INTELLIGENCE_NO_SAMPLES",
        observations: [],
        aggregates: [],
        summary: {
          observations: 0,
          aggregates: 0,
          liveVisible: 0,
          ponty: 0,
          localHistory: 0,
        },
        policy: policy(),
      },
    }),
  );

  assert.equal(result.outcome, "WATCH");
  assert.equal(result.evidence.projectionEmpty, true);
  assert.equal(result.evidence.projectionConsistent, true);
  assert.deepEqual(result.evidence.missingSources, [
    "LIVE_VISIBLE",
    "PONTY",
    "LOCAL_HISTORY",
  ]);
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

  assert.match(output, /Market Intelligence Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /LIVE_VISIBLE=1 \| PONTY=1 \| LOCAL_HISTORY=1/);
  assert.match(output, /Metrics valid: yes/);
  assert.match(output, /Market read-only: yes/);
  assert.match(output, /Dashboard GET only: yes/);
  assert.match(output, /Movement probe dispatched: no/);
  assert.match(output, /Ponty read request dispatched: no/);
  assert.match(output, /Value mutation dispatched: no/);
  assert.doesNotMatch(output, /Exact guarded mutation command/);
});

test("Market Intelligence compact WATCH output names missing sources", () => {
  const output = formatCompactResult(
    evaluateMarketIntelligence(
      character("My_Merchant", {
        market_intelligence_runtime: projection({
          includePonty: false,
        }),
      }),
    ),
  );

  assert.match(output, /Outcome: WATCH/);
  assert.match(output, /WATCH sources: PONTY/);
  assert.match(output, /Value mutation dispatched: no/);
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

  const offlineOnly = selectMarketIntelligenceCharacter({
    characters: [
      character("Offline", {
        connected: false,
        market_intelligence_runtime: null,
      }),
    ],
  });
  assert.equal(offlineOnly.name, "Offline");
  assert.equal(offlineOnly.connected, false);
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

test("Market Intelligence supervisor bootstrap uses only the dedicated read-only endpoint", async () => {
  const calls = [];
  const payload = await runMarketIntelligenceSupervisorLiveTest(
    "My_Merchant",
    5500,
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({
            ok: true,
            result: {
              outcome: "PASS",
              projection: projection(),
            },
          }),
        };
      },
    },
  );

  assert.equal(payload.result.outcome, "PASS");
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /\/headless\/api\/characters\/My_Merchant\/tests\/market-intelligence$/,
  );
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { sampleMs: 5500 });
});

test("Market Intelligence live launcher bootstraps only through paused read-only supervisor path", () => {
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
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const boundary = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "action-boundary.lib.ts",
    ),
    "utf8",
  );

  assert.match(
    dashboard,
    /market_intelligence_runtime:\s*charBlock\.market_intelligence_runtime/,
  );
  assert.match(launcher, /fetch\(baseUrl \+ "\/headless\/api\/state"/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/market-intelligence/,
  );
  assert.match(launcher, /method:\s*"POST"/);
  assert.match(
    coordinator,
    /verification_runtime_state:\s*DESIRED_RUNTIME_STATES\.PAUSED/,
  );
  assert.match(
    coordinator,
    /runtimeStateDuringTest:\s*DESIRED_RUNTIME_STATES\.PAUSED/,
  );
  assert.match(coordinator, /market_intelligence_source_probe/);
  assert.match(thread, /case "market_intelligence_source_probe"/);

  const probeStart = kernel.indexOf(
    "async runMarketIntelligenceSourceProbe(",
  );
  const probeEnd = kernel.indexOf(
    "async executeEconomyPrebuffNext(",
    probeStart,
  );
  assert.ok(probeStart >= 0);
  assert.ok(probeEnd > probeStart);
  const probeBlock = kernel.slice(probeStart, probeEnd);

  assert.match(probeBlock, /runtimeState\(\) !== "PAUSED"/);
  assert.match(probeBlock, /destination: "secondhands"/);
  assert.match(probeBlock, /requestPontySnapshot/);
  assert.match(probeBlock, /valueMutationAllowed: false/);
  assert.match(probeBlock, /pontyBuyAllowed: false/);
  assert.match(probeBlock, /tradeMutationAllowed: false/);
  assert.match(probeBlock, /bankMutationAllowed: false/);
  assert.match(probeBlock, /blindRetryAllowed: false/);
  assert.doesNotMatch(probeBlock, /\.pontyBuy\s*\(/);
  assert.doesNotMatch(probeBlock, /tradeList/);
  assert.doesNotMatch(probeBlock, /tradeUnlist/);
  assert.doesNotMatch(probeBlock, /"sbuy"/);

  const snapshotStart = boundary.indexOf(
    "requestPontySnapshot(request: BoundaryRequest)",
  );
  const snapshotEnd = boundary.indexOf("pontyBuy(request:", snapshotStart);
  assert.ok(snapshotStart >= 0);
  assert.ok(snapshotEnd > snapshotStart);
  const snapshotBlock = boundary.slice(snapshotStart, snapshotEnd);

  assert.match(snapshotBlock, /PONTY_SNAPSHOT_REQUEST/);
  assert.match(snapshotBlock, /valueMutation: false/);
  assert.match(snapshotBlock, /readOnly: true/);
  assert.doesNotMatch(snapshotBlock, /sbuy/);

  assert.doesNotMatch(launcher, /ActionBoundary/);
  assert.doesNotMatch(launcher, /socket\.emit/);
  assert.doesNotMatch(launcher, /pontyBuy\s*\(/);
  assert.doesNotMatch(launcher, /tradeList/);
  assert.doesNotMatch(launcher, /tradeUnlist/);
});

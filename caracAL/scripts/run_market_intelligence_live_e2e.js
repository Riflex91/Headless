"use strict";

const {
  ensureDashboardAvailable,
  startManagedRuntime,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = String(
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924",
).replace(/\/$/, "");

const MARKET_SOURCES = ["LIVE_VISIBLE", "PONTY", "LOCAL_HISTORY"];
const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"];

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload.message ||
        payload.error ||
        "HTTP " + response.status + " from " + response.url,
    );
  }
  return payload;
}

async function readState() {
  return readJson(
    await fetch(baseUrl + "/headless/api/state", {
      cache: "no-store",
    }),
  );
}

function parseCliArgs(argv = process.argv.slice(2)) {
  let requestedCharacter = null;
  let verbose = false;
  let clearScreen = true;

  for (const arg of argv) {
    if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--no-clear") {
      clearScreen = false;
    } else if (!arg.startsWith("--") && requestedCharacter === null) {
      requestedCharacter = arg;
    }
  }

  return {
    requestedCharacter,
    verbose,
    clearScreen,
  };
}

function hasProjection(character) {
  const projection = record(character?.market_intelligence_runtime);
  return projection.state === "READY" || projection.state === "EMPTY";
}

function selectMarketIntelligenceCharacter(snapshot, requested = null) {
  const characters = array(snapshot?.characters);

  if (requested) {
    return (
      characters.find((character) => character?.name === requested) || null
    );
  }

  const owned = characters.filter(
    (character) => character?.account_owned === true,
  );
  const connectedOwned = owned.filter(
    (character) => character?.connected === true,
  );

  return (
    connectedOwned.find((character) => hasProjection(character)) ||
    connectedOwned[0] ||
    owned.find((character) => character?.enabled === true) ||
    owned[0] ||
    null
  );
}

async function waitForMarketIntelligenceCharacter(
  requested = null,
  {
    initialState = null,
    readStateImpl = readState,
    timeoutMs = Number(
      process.env.CARACAL_MARKET_INTELLIGENCE_LIVE_TIMEOUT_MS || 30000,
    ),
    pollMs = Number(
      process.env.CARACAL_MARKET_INTELLIGENCE_LIVE_POLL_MS || 500,
    ),
    now = Date.now,
    sleepImpl = sleep,
  } = {},
) {
  const deadline = now() + timeoutMs;
  let state = initialState;

  while (now() < deadline) {
    if (!state) state = await readStateImpl();

    const selected = selectMarketIntelligenceCharacter(state, requested);
    if (
      selected?.account_owned === true &&
      selected?.connected === true &&
      hasProjection(selected)
    ) {
      return selected;
    }

    await sleepImpl(pollMs);
    state = await readStateImpl();
  }

  const target = requested ? " for " + requested : "";
  throw new Error(
    "Timed out waiting for a connected account-owned Market Intelligence projection" +
      target,
  );
}

function validLevel(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

function validNullableText(value) {
  return value === null || (typeof value === "string" && value.length > 0);
}

function observationValid(observation) {
  const source = record(observation);
  return (
    typeof source.itemName === "string" &&
    source.itemName.length > 0 &&
    validLevel(source.level) &&
    finite(source.price) &&
    source.price > 0 &&
    finite(source.quantity) &&
    source.quantity > 0 &&
    validNullableText(source.server) &&
    validNullableText(source.seller) &&
    finite(source.timestamp) &&
    source.timestamp >= 0 &&
    MARKET_SOURCES.includes(source.source) &&
    !!source.metadata &&
    typeof source.metadata === "object" &&
    !Array.isArray(source.metadata)
  );
}

function aggregateValid(aggregate) {
  const source = record(aggregate);
  const band = record(source.priceBand);
  const sources = array(source.sources);
  return (
    typeof source.itemName === "string" &&
    source.itemName.length > 0 &&
    validLevel(source.level) &&
    validNullableText(source.server) &&
    finite(source.medianPrice) &&
    source.medianPrice > 0 &&
    finite(band.min) &&
    band.min > 0 &&
    finite(band.max) &&
    band.max >= band.min &&
    finite(source.volatility) &&
    source.volatility >= 0 &&
    Number.isInteger(source.samples) &&
    source.samples > 0 &&
    finite(source.ageMs) &&
    source.ageMs >= 0 &&
    CONFIDENCE_LEVELS.includes(source.confidence) &&
    sources.length > 0 &&
    sources.every((entry) => MARKET_SOURCES.includes(entry))
  );
}

function marketIntelligenceEvidence(character) {
  const projection = record(character?.market_intelligence_runtime);
  const observations = array(projection.observations);
  const aggregates = array(projection.aggregates);
  const summary = record(projection.summary);
  const policy = record(projection.policy);
  const confidence = record(policy.confidence);

  const observedSources = {
    LIVE_VISIBLE: observations.filter(
      (observation) => observation?.source === "LIVE_VISIBLE",
    ).length,
    PONTY: observations.filter((observation) => observation?.source === "PONTY")
      .length,
    LOCAL_HISTORY: observations.filter(
      (observation) => observation?.source === "LOCAL_HISTORY",
    ).length,
  };
  const missingSources = MARKET_SOURCES.filter(
    (source) => observedSources[source] <= 0,
  );

  const summaryMatches =
    summary.observations === observations.length &&
    summary.aggregates === aggregates.length &&
    summary.liveVisible === observedSources.LIVE_VISIBLE &&
    summary.ponty === observedSources.PONTY &&
    summary.localHistory === observedSources.LOCAL_HISTORY;

  const policyValid =
    policy.readOnly === true &&
    policy.liveVisibleSellOnly === true &&
    policy.giveawaysExcluded === true &&
    policy.priceBand === "OBSERVED_MIN_MAX" &&
    policy.volatility === "RELATIVE_RANGE_OVER_MEDIAN" &&
    typeof confidence.low === "string" &&
    Number.isInteger(record(confidence.medium).minSamples) &&
    finite(record(confidence.medium).maxAgeMs) &&
    Number.isInteger(record(confidence.high).minSamples) &&
    finite(record(confidence.high).maxAgeMs);

  const observationsValid = observations.every(observationValid);
  const aggregatesValid = aggregates.every(aggregateValid);
  const projectionReady =
    projection.state === "READY" &&
    projection.reason === "MARKET_INTELLIGENCE_READY" &&
    observations.length > 0 &&
    aggregates.length > 0;
  const projectionEmpty =
    projection.state === "EMPTY" &&
    projection.reason === "MARKET_INTELLIGENCE_NO_SAMPLES" &&
    observations.length === 0 &&
    aggregates.length === 0;
  const projectionConsistent =
    (projectionReady || projectionEmpty) &&
    summaryMatches &&
    observationsValid &&
    aggregatesValid;
  const metricsValid =
    projectionReady && summaryMatches && observationsValid && aggregatesValid;

  return {
    projectionVisible:
      projection.state === "READY" || projection.state === "EMPTY",
    projectionReady,
    projectionEmpty,
    projectionConsistent,
    state: projection.state || "MISSING",
    reason: projection.reason || null,
    observations: observations.length,
    aggregates: aggregates.length,
    observedSources,
    missingSources,
    allSourcesObserved: missingSources.length === 0,
    summaryMatches,
    observationsValid,
    aggregatesValid,
    metricsValid,
    policyValid,
  };
}

function evaluateMarketIntelligence(character) {
  const evidence = marketIntelligenceEvidence(character);
  const complete =
    evidence.projectionReady &&
    evidence.metricsValid &&
    evidence.policyValid &&
    evidence.allSourcesObserved;

  const watch =
    !complete &&
    evidence.projectionConsistent &&
    evidence.policyValid;

  return {
    outcome: complete ? "PASS" : watch ? "WATCH" : "FAIL",
    reason: complete
      ? "MARKET_INTELLIGENCE_LIVE_E2E_CONFIRMED"
      : watch
      ? "MARKET_INTELLIGENCE_LIVE_SOURCE_COVERAGE_PENDING"
      : "MARKET_INTELLIGENCE_LIVE_EVIDENCE_INCOMPLETE",
    character: character?.name || null,
    realm: character?.realm || null,
    marketIntelligence: character?.market_intelligence_runtime || null,
    evidence,
    scope: {
      readOnly: true,
      dashboardGetOnly: true,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: false,
      equipmentMutationForced: false,
      socketRequestForced: false,
      pontyBuyForced: false,
      tradeMutationForced: false,
      mutationDispatched: false,
    },
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const sources = record(evidence.observedSources);
  const missingSources = array(evidence.missingSources);
  const scope = record(result?.scope);

  const lines = [
    "Market Intelligence Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "Character: " + (result?.character || "UNKNOWN"),
    "Realm: " + (result?.realm || "UNKNOWN"),
    "State: " + (evidence.state || "MISSING"),
    "Observations: " + String(evidence.observations ?? 0),
    "Aggregates: " + String(evidence.aggregates ?? 0),
    "Sources: LIVE_VISIBLE=" +
      String(sources.LIVE_VISIBLE ?? 0) +
      " | PONTY=" +
      String(sources.PONTY ?? 0) +
      " | LOCAL_HISTORY=" +
      String(sources.LOCAL_HISTORY ?? 0),
    "Metrics valid: " + (evidence.metricsValid === true ? "yes" : "no"),
    "Read-only: " +
      (scope.readOnly === true && evidence.policyValid === true ? "yes" : "no"),
    "Dashboard GET only: " + (scope.dashboardGetOnly === true ? "yes" : "no"),
    "Mutation dispatched: " +
      (scope.mutationDispatched === true ? "yes" : "no"),
  ];

  if (scope.bootstrapUsed === true) {
    lines.push(
      "Bootstrap runtime: " + (scope.runtimeStateDuringTest || "UNKNOWN"),
    );
  }

  if (missingSources.length > 0) {
    lines.push("WATCH sources: " + missingSources.join(", "));
  }

  return lines.join("\n") + "\n";
}

async function runMarketIntelligenceSupervisorLiveTest(
  characterName,
  sampleMs = Number(
    process.env.CARACAL_MARKET_INTELLIGENCE_LIVE_SETTLE_MS || 5500,
  ),
  { fetchImpl = fetch } = {},
) {
  return readJson(
    await fetchImpl(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(characterName) +
        "/tests/market-intelligence",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleMs }),
      },
    ),
  );
}

function clearInteractiveTerminal() {
  if (process.stdout.isTTY) {
    process.stdout.write("\u001b[2J\u001b[H");
  }
}

async function main() {
  const { requestedCharacter, verbose, clearScreen } = parseCliArgs();
  const dashboard = await ensureDashboardAvailable(
    readState,
    verbose
      ? {}
      : {
          quiet: true,
          startRuntime: () =>
            startManagedRuntime({
              stdio: ["ignore", "ignore", "ignore"],
              windowsHide: true,
            }),
        },
  );
  const managedRuntime = dashboard.runtime;
  let result = null;

  try {
    const selected = selectMarketIntelligenceCharacter(
      dashboard.state,
      requestedCharacter,
    );
    if (!selected) {
      const target = requestedCharacter
        ? ": " + requestedCharacter
        : "";
      throw new Error("No account-owned character available" + target);
    }
    if (selected.account_owned !== true) {
      throw new Error(
        "Market Intelligence live test requires an account-owned character: " +
          selected.name,
      );
    }

    if (selected.connected === true && hasProjection(selected)) {
      await sleep(
        Number(process.env.CARACAL_MARKET_INTELLIGENCE_LIVE_SETTLE_MS || 5500),
      );
      const state = await readState();
      const current = array(state.characters).find(
        (character) => character?.name === selected.name,
      );
      if (!current) {
        throw new Error(
          "Character disappeared from dashboard state: " + selected.name,
        );
      }
      result = evaluateMarketIntelligence(current);
    } else {
      const payload = await runMarketIntelligenceSupervisorLiveTest(
        selected.name,
      );
      const supervisor = record(payload.result);
      const projection = record(supervisor.projection);
      result = evaluateMarketIntelligence({
        name: supervisor.character || selected.name,
        realm: supervisor.realm || selected.realm || null,
        account_owned: true,
        connected: true,
        market_intelligence_runtime: projection,
      });
      result.scope = {
        ...result.scope,
        ...record(supervisor.scope),
        dashboardGetOnly: false,
        bootstrapUsed: true,
      };
      result.cleanup = record(supervisor.cleanup);
    }
  } finally {
    if (managedRuntime) {
      if (verbose) {
        process.stdout.write("Stopping temporary caracAL runtime\n");
      }
      await stopManagedRuntime(managedRuntime);
    }
  }

  if (!result) {
    throw new Error("Market Intelligence live preflight returned no result");
  }

  if (verbose) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (clearScreen) clearInteractiveTerminal();
    process.stdout.write(formatCompactResult(result));
  }

  if (result.outcome !== "PASS") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  aggregateValid,
  evaluateMarketIntelligence,
  formatCompactResult,
  marketIntelligenceEvidence,
  observationValid,
  parseCliArgs,
  readState,
  runMarketIntelligenceSupervisorLiveTest,
  selectMarketIntelligenceCharacter,
  waitForMarketIntelligenceCharacter,
};

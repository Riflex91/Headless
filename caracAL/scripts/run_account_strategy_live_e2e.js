"use strict";

const {
  ensureDashboardAvailable,
  startManagedRuntime,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

const CAPABILITIES = Object.freeze([
  "TANK",
  "HEALER",
  "DPS",
  "AOE",
  "RANGED",
  "MELEE",
  "SUPPORT",
  "ECONOMY",
  "LOGISTICS",
]);

function observerRuntimeEnv(env = process.env) {
  return {
    ...env,
    CARACAL_OBSERVER_ONLY: "1",
  };
}

function startObserverRuntime() {
  return startManagedRuntime({
    env: observerRuntimeEnv(),
  });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  const normalized = finite(value);
  return normalized !== null && Number.isInteger(normalized) && normalized >= 0
    ? normalized
    : null;
}

function nullableTextValid(value) {
  return value === null || value === undefined || text(value) !== null;
}

function nullableNonNegativeValid(value) {
  return (
    value === null ||
    value === undefined ||
    (finite(value) !== null && finite(value) >= 0)
  );
}

function historyEntryValid(entry) {
  const row = record(entry);
  return (
    nullableTextValid(row.farmKey) &&
    (row.startedAt === null ||
      row.startedAt === undefined ||
      finite(row.startedAt) !== null) &&
    (row.endedAt === null ||
      row.endedAt === undefined ||
      finite(row.endedAt) !== null) &&
    row.stats &&
    typeof row.stats === "object" &&
    !Array.isArray(row.stats)
  );
}

function profileEvidence(profile) {
  const source = record(profile);
  const gear = record(source.gear);
  const stats = record(source.stats);
  const training = record(source.training);
  const completeness = record(source.profileCompleteness);
  const capabilities = array(source.capabilities);
  const history = array(source.history);

  const nameValid = text(source.name) !== null;
  const classValid = text(source.class) !== null;
  const levelValid =
    source.level === null ||
    source.level === undefined ||
    nonNegativeInteger(source.level) !== null;
  const gearValid =
    source.gear &&
    typeof source.gear === "object" &&
    !Array.isArray(source.gear) &&
    gear.equipment &&
    typeof gear.equipment === "object" &&
    !Array.isArray(gear.equipment);
  const statsValid =
    source.stats &&
    typeof source.stats === "object" &&
    !Array.isArray(source.stats) &&
    Object.values(stats).every((value) => finite(value) !== null);
  const capabilitiesValid =
    capabilities.length === new Set(capabilities).size &&
    capabilities.every((capability) => CAPABILITIES.includes(capability));
  const trainingValid =
    source.training &&
    typeof source.training === "object" &&
    !Array.isArray(source.training) &&
    typeof training.active === "boolean" &&
    text(training.state) !== null &&
    nullableTextValid(training.farmKey) &&
    nullableTextValid(training.monster) &&
    nullableTextValid(training.map) &&
    (training.score === null ||
      training.score === undefined ||
      finite(training.score) !== null);
  const onlineValid = typeof source.online === "boolean";
  const mapValid = nullableTextValid(source.map);
  const goldValid = nullableNonNegativeValid(source.gold);
  const historyValid =
    history.length <= 10 && history.every((entry) => historyEntryValid(entry));
  const completenessValid = [
    "class",
    "level",
    "gear",
    "stats",
    "training",
    "map",
    "gold",
    "history",
  ].every((key) => typeof completeness[key] === "boolean");

  const liveProfileComplete =
    source.online !== true ||
    (nonNegativeInteger(source.level) !== null &&
      text(source.map) !== null &&
      finite(source.gold) !== null &&
      finite(source.gold) >= 0 &&
      Object.keys(stats).length > 0);

  return {
    name: text(source.name),
    complete:
      nameValid &&
      classValid &&
      levelValid &&
      gearValid &&
      statsValid &&
      capabilitiesValid &&
      trainingValid &&
      onlineValid &&
      mapValid &&
      goldValid &&
      historyValid &&
      completenessValid,
    liveProfileComplete,
    capabilities,
    online: source.online === true,
    levelVisible: nonNegativeInteger(source.level) !== null,
    historyVisible: history.length > 0,
  };
}

function capabilityCounts(profileChecks) {
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [
      capability,
      profileChecks.filter((profile) =>
        profile.capabilities.includes(capability),
      ).length,
    ]),
  );
}

function accountStrategyEvidence(snapshot) {
  const strategy = record(snapshot?.account_strategy);
  const profiles = array(strategy.profiles);
  const checks = profiles.map(profileEvidence);
  const summary = record(strategy.summary);
  const expectedCharacters = nonNegativeInteger(strategy.expectedCharacters);
  const uniqueNames =
    checks.every((check) => check.name !== null) &&
    new Set(checks.map((check) => check.name)).size === checks.length;
  const expectedCapabilityCounts = capabilityCounts(checks);
  const observedCapabilityCounts = record(summary.capabilities);

  const capabilitySummaryValid = CAPABILITIES.every(
    (capability) =>
      nonNegativeInteger(observedCapabilityCounts[capability]) ===
      expectedCapabilityCounts[capability],
  );
  const onlineProfiles = checks.filter((check) => check.online).length;
  const liveLevelProfiles = checks.filter((check) => check.levelVisible).length;
  const historyProfiles = checks.filter((check) => check.historyVisible).length;

  const summaryValid =
    nonNegativeInteger(summary.accountOwnedCharacters) === profiles.length &&
    nonNegativeInteger(summary.onlineCharacters) === onlineProfiles &&
    nonNegativeInteger(summary.liveLevelProfiles) === liveLevelProfiles &&
    nonNegativeInteger(summary.historyProfiles) === historyProfiles &&
    capabilitySummaryValid;

  const profileCountValid =
    expectedCharacters === 8 &&
    profiles.length === expectedCharacters &&
    uniqueNames;
  const fieldsValid = checks.every((check) => check.complete);
  const liveProfilesValid = checks.every((check) => check.liveProfileComplete);
  const ready =
    strategy.state === "READY" &&
    strategy.reason === "ACCOUNT_STRATEGY_PROFILES_READY";
  const readOnly = strategy.readOnly === true;

  const structuralComplete =
    ready && readOnly && profileCountValid && fieldsValid && summaryValid;

  const complete =
    structuralComplete && onlineProfiles > 0 && liveProfilesValid;

  return {
    state: strategy.state || null,
    reason: strategy.reason || null,
    expectedCharacters: expectedCharacters ?? 0,
    profiles: profiles.length,
    onlineProfiles,
    liveLevelProfiles,
    historyProfiles,
    readOnly,
    profileCountValid,
    fieldsValid,
    capabilitySummaryValid,
    summaryValid,
    liveProfilesValid,
    structuralComplete,
    complete,
    incompleteLiveProfiles: checks
      .filter((check) => check.online && !check.liveProfileComplete)
      .map((check) => check.name)
      .filter(Boolean),
  };
}

function evaluateAccountStrategy(snapshot) {
  const evidence = accountStrategyEvidence(snapshot);
  const watch =
    evidence.structuralComplete === true &&
    (evidence.onlineProfiles === 0 || evidence.liveProfilesValid !== true);

  return {
    outcome: evidence.complete ? "PASS" : watch ? "WATCH" : "FAIL",
    reason: evidence.complete
      ? "ACCOUNT_STRATEGY_LIVE_E2E_CONFIRMED"
      : watch
      ? "ACCOUNT_STRATEGY_LIVE_PROFILE_COVERAGE_PENDING"
      : "ACCOUNT_STRATEGY_LIVE_EVIDENCE_INCOMPLETE",
    evidence,
    scope: {
      readOnly: true,
      dashboardGetOnly: true,
      mutationDispatched: false,
      lifecycleMutationDispatched: false,
      gameplayMutationDispatched: false,
      valueMutationDispatched: false,
    },
  };
}

function formatCompactResult(result) {
  const evidence = record(result?.evidence);
  const scope = record(result?.scope);
  const lines = [
    "Account Strategy Live E2E",
    "Outcome: " + (result?.outcome || "UNKNOWN"),
    "Reason: " + (result?.reason || "UNKNOWN"),
    "State: " + (evidence.state || "MISSING"),
    "Profiles: " +
      String(evidence.profiles ?? 0) +
      "/" +
      String(evidence.expectedCharacters ?? 8),
    "Online profiles: " + String(evidence.onlineProfiles ?? 0),
    "Live level profiles: " + String(evidence.liveLevelProfiles ?? 0),
    "History profiles: " + String(evidence.historyProfiles ?? 0),
    "Required fields valid: " + (evidence.fieldsValid === true ? "yes" : "no"),
    "Capabilities valid: " +
      (evidence.capabilitySummaryValid === true ? "yes" : "no"),
    "Summary valid: " + (evidence.summaryValid === true ? "yes" : "no"),
    "Live profiles valid: " +
      (evidence.liveProfilesValid === true ? "yes" : "no"),
    "Read-only: " +
      (scope.readOnly === true && evidence.readOnly === true ? "yes" : "no"),
    "Dashboard GET only: " + (scope.dashboardGetOnly === true ? "yes" : "no"),
    "Mutation dispatched: " +
      (scope.mutationDispatched === true ? "yes" : "no"),
    "Observer-only bootstrap: " +
      (scope.observerOnlyBootstrap === true ? "yes" : "no"),
  ];

  const incomplete = array(evidence.incompleteLiveProfiles);
  if (incomplete.length > 0) {
    lines.push("WATCH profiles: " + incomplete.join(", "));
  }

  return lines.join("\n") + "\n";
}

async function readState({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(baseUrl + "/headless/api/state", {
    method: "GET",
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      body?.message ||
        body?.error ||
        `HTTP ${response.status} from caracAL dashboard`,
    );
  }
  return body;
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const dashboard = await ensureDashboardAvailable(readState, {
    startRuntime: startObserverRuntime,
  });
  const managedRuntime = dashboard.runtime;

  try {
    if (dashboard.startedRuntime) {
      process.stdout.write(
        "caracAL dashboard was not running; using temporary observer-only supervisor\n",
      );
    }

    const result = evaluateAccountStrategy(dashboard.state);
    result.scope = {
      ...record(result.scope),
      observerOnlyBootstrap: dashboard.startedRuntime === true,
    };

    if (verbose) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(formatCompactResult(result));
    }

    if (result.outcome !== "PASS") {
      process.exitCode = 1;
    }
  } finally {
    if (managedRuntime) {
      await stopManagedRuntime(managedRuntime);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CAPABILITIES,
  accountStrategyEvidence,
  capabilityCounts,
  evaluateAccountStrategy,
  formatCompactResult,
  historyEntryValid,
  observerRuntimeEnv,
  profileEvidence,
  readState,
  startObserverRuntime,
};

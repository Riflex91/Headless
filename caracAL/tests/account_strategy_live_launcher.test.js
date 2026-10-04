"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CAPABILITIES,
  accountStrategyEvidence,
  evaluateAccountStrategy,
  formatCompactResult,
  observerRuntimeEnv,
  profileEvidence,
  runAccountStrategySupervisorLiveTest,
  selectAccountStrategyProbeCharacter,
} = require("../scripts/run_account_strategy_live_e2e");

const ROSTER = [
  ["My_Ranger1", "ranger", ["DPS", "AOE", "RANGED"]],
  ["My_Ranger2", "ranger", ["DPS", "AOE", "RANGED"]],
  ["My_Ranger3", "ranger", ["DPS", "AOE", "RANGED"]],
  ["My_Merchant", "merchant", ["SUPPORT", "ECONOMY", "LOGISTICS"]],
  ["My_Mage", "mage", ["DPS", "AOE", "RANGED", "SUPPORT"]],
  ["My_Priest", "priest", ["HEALER", "RANGED", "SUPPORT"]],
  ["My_Warrior", "warrior", ["TANK", "DPS", "AOE", "MELEE"]],
  ["My_Rogue", "rogue", ["DPS", "MELEE"]],
];

function profile(name, characterClass, capabilities, { online = false } = {}) {
  return {
    name,
    class: characterClass,
    level: online ? 77 : null,
    gear: {
      equipment: online
        ? {
            mainhand: {
              name: "test_weapon",
              level: 1,
            },
          }
        : {},
      scoringState: online ? "READY" : null,
      scoringTimestamp: online ? 1000 : null,
      futureGearState: online ? "READY" : null,
      sourceReservations: [],
      targetReservations: [],
    },
    stats: online
      ? {
          hp: 1000,
          max_hp: 1000,
          attack: 500,
          armor: 200,
        }
      : {},
    capabilities,
    training: {
      state: online ? "READY" : "UNKNOWN",
      active: online,
      farmKey: online ? "bee@main:0" : null,
      monster: online ? "bee" : null,
      map: online ? "main" : null,
      score: online ? 0.8 : null,
    },
    online,
    map: online ? "main" : null,
    gold: online ? 123456 : null,
    history: online
      ? [
          {
            farmKey: "bee@main:0",
            startedAt: 100,
            endedAt: 200,
            stats: {
              xpPerHour: 10000,
            },
          },
        ]
      : [],
    realm: "EUII",
    desiredRuntimeState: online ? "RUNNING" : "STOPPED",
    profileCompleteness: {
      class: true,
      level: online,
      gear: online,
      stats: online,
      training: online,
      map: online,
      gold: online,
      history: online,
    },
  };
}

function capabilitySummary(profiles) {
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [
      capability,
      profiles.filter((entry) => entry.capabilities.includes(capability))
        .length,
    ]),
  );
}

function snapshot({
  onlineNames = ["My_Merchant"],
  profilesOverride = null,
} = {}) {
  const profiles =
    profilesOverride ||
    ROSTER.map(([name, characterClass, capabilities]) =>
      profile(name, characterClass, capabilities, {
        online: onlineNames.includes(name),
      }),
    );

  return {
    account_strategy: {
      timestamp: 1000,
      state: profiles.length === 8 ? "READY" : "PARTIAL",
      reason:
        profiles.length === 8
          ? "ACCOUNT_STRATEGY_PROFILES_READY"
          : "ACCOUNT_STRATEGY_PROFILES_PARTIAL",
      readOnly: true,
      expectedCharacters: 8,
      profiles,
      summary: {
        accountOwnedCharacters: profiles.length,
        onlineCharacters: profiles.filter((entry) => entry.online).length,
        liveLevelProfiles: profiles.filter((entry) => entry.level !== null)
          .length,
        historyProfiles: profiles.filter((entry) => entry.history.length > 0)
          .length,
        capabilities: capabilitySummary(profiles),
      },
    },
  };
}

test("Account Strategy live E2E passes on 8/8 structurally valid profiles with live coverage", () => {
  const result = evaluateAccountStrategy(
    snapshot({
      onlineNames: ["My_Merchant", "My_Ranger1"],
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "ACCOUNT_STRATEGY_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.profiles, 8);
  assert.equal(result.evidence.expectedCharacters, 8);
  assert.equal(result.evidence.onlineProfiles, 2);
  assert.equal(result.evidence.profileCountValid, true);
  assert.equal(result.evidence.fieldsValid, true);
  assert.equal(result.evidence.capabilitySummaryValid, true);
  assert.equal(result.evidence.summaryValid, true);
  assert.equal(result.evidence.liveProfilesValid, true);
  assert.equal(result.scope.dashboardGetOnly, true);
  assert.equal(result.scope.mutationDispatched, false);
});

test("Account Strategy live E2E returns WATCH when 8/8 profiles exist but none are live", () => {
  const result = evaluateAccountStrategy(snapshot({ onlineNames: [] }));

  assert.equal(result.outcome, "WATCH");
  assert.equal(result.reason, "ACCOUNT_STRATEGY_LIVE_PROFILE_COVERAGE_PENDING");
  assert.equal(result.evidence.structuralComplete, true);
  assert.equal(result.evidence.onlineProfiles, 0);
});

test("Account Strategy live E2E fails when the account roster is incomplete", () => {
  const incompleteProfiles = ROSTER.slice(0, 7).map(
    ([name, characterClass, capabilities]) =>
      profile(name, characterClass, capabilities),
  );
  const result = evaluateAccountStrategy(
    snapshot({
      profilesOverride: incompleteProfiles,
      onlineNames: [],
    }),
  );

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "ACCOUNT_STRATEGY_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.profileCountValid, false);
});

test("Account Strategy live E2E fails on inconsistent capability summary", () => {
  const source = snapshot({
    onlineNames: ["My_Merchant"],
  });
  source.account_strategy.summary.capabilities.ECONOMY = 99;

  const evidence = accountStrategyEvidence(source);
  assert.equal(evidence.capabilitySummaryValid, false);
  assert.equal(evidence.summaryValid, false);
  assert.equal(evaluateAccountStrategy(source).outcome, "FAIL");
});

test("Account Strategy profile evidence rejects malformed mandatory fields", () => {
  const source = profile("My_Ranger1", "ranger", ["DPS", "AOE", "RANGED"], {
    online: true,
  });
  source.training.active = "yes";
  source.capabilities.push("INVALID");

  const evidence = profileEvidence(source);
  assert.equal(evidence.complete, false);
});

test("Account Strategy compact output exposes read-only GET-only safety scope", () => {
  const output = formatCompactResult(
    evaluateAccountStrategy(
      snapshot({
        onlineNames: ["My_Merchant"],
      }),
    ),
  );

  assert.match(output, /Account Strategy Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /Profiles: 8\/8/);
  assert.match(output, /Required fields valid: yes/);
  assert.match(output, /Capabilities valid: yes/);
  assert.match(output, /Summary valid: yes/);
  assert.match(output, /Read-only: yes/);
  assert.match(output, /Dashboard GET only: yes/);
  assert.match(output, /Lifecycle bootstrap dispatched: no/);
  assert.match(output, /Gameplay mutation dispatched: no/);
  assert.match(output, /Value mutation dispatched: no/);
});

test("Account Strategy profile probe prefers My_Merchant and supports explicit target", () => {
  const dashboard = {
    characters: ROSTER.map(([name, characterClass]) => ({
      name,
      account_owned: true,
      ctype: characterClass,
      connected: false,
      enabled: false,
    })),
  };

  assert.equal(
    selectAccountStrategyProbeCharacter(dashboard).name,
    "My_Merchant",
  );
  assert.equal(
    selectAccountStrategyProbeCharacter(dashboard, "My_Ranger2").name,
    "My_Ranger2",
  );
  assert.throws(
    () => selectAccountStrategyProbeCharacter(dashboard, "Not_Owned"),
    /Unknown account-owned character/,
  );
});

test("Account Strategy supervisor profile probe uses only the dedicated local test POST", async () => {
  const calls = [];
  const payload = {
    result: {
      outcome: "PASS",
      strategy: snapshot({ onlineNames: ["My_Merchant"] }).account_strategy,
    },
  };

  const result = await runAccountStrategySupervisorLiveTest(
    "My_Merchant",
    900,
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          async text() {
            return JSON.stringify(payload);
          },
        };
      },
    },
  );

  assert.deepEqual(result, payload);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /\/characters\/My_Merchant\/tests\/account-strategy$/,
  );
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { sampleMs: 900 });
});

test("Account Strategy compact output exposes PAUSED profile-probe lifecycle separately", () => {
  const result = evaluateAccountStrategy(
    snapshot({ onlineNames: ["My_Merchant"] }),
  );
  result.profileProbeCharacter = "My_Merchant";
  result.scope = {
    ...result.scope,
    dashboardGetOnly: false,
    observerOnlyBootstrap: true,
    profileProbeUsed: true,
    runtimeStateDuringTest: "PAUSED",
    lifecycleMutationDispatched: true,
    gameplayMutationDispatched: false,
    valueMutationDispatched: false,
  };
  result.cleanup = {
    runtimeStateRestored: true,
  };

  const output = formatCompactResult(result);
  assert.match(output, /Dashboard GET only: no/);
  assert.match(output, /Lifecycle bootstrap dispatched: yes/);
  assert.match(output, /Gameplay mutation dispatched: no/);
  assert.match(output, /Value mutation dispatched: no/);
  assert.match(output, /Profile probe character: My_Merchant/);
  assert.match(output, /Profile probe runtime: PAUSED/);
  assert.match(output, /Runtime state restored: yes/);
});

test("Account Strategy observer bootstrap forces observer-only supervisor mode", () => {
  const env = observerRuntimeEnv({
    TEST_ENV: "kept",
    CARACAL_OBSERVER_ONLY: "0",
  });

  assert.equal(env.TEST_ENV, "kept");
  assert.equal(env.CARACAL_OBSERVER_ONLY, "1");
});

test("Account Strategy live launcher uses GET for observation and only dedicated profile-probe POST", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_account_strategy_live_e2e.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(source, /\/headless\/api\/state/);
  assert.match(source, /method:\s*"GET"/);
  assert.match(source, /ensureDashboardAvailable/);
  assert.match(source, /CARACAL_OBSERVER_ONLY:\s*"1"/);
  assert.match(source, /\/tests\/account-strategy/);
  assert.match(source, /method:\s*"POST"/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /run.*LiveTest/);
  assert.doesNotMatch(source, /socket\.emit/);
  assert.doesNotMatch(source, /desired_runtime_state/);

  assert.match(coordinator, /process\.env\.CARACAL_OBSERVER_ONLY\s*===\s*"1"/);
  assert.match(coordinator, /const startup_chars = observer_only\s*\? \[\]/);
  assert.match(coordinator, /observer_only,/);
  assert.match(coordinator, /async function run_account_strategy_live_test/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/account-strategy/,
  );
  assert.match(dashboard, /runAccountStrategyLiveTest/);
  assert.match(
    coordinator,
    /desired_runtime_state = DESIRED_RUNTIME_STATES\.PAUSED/,
  );
  assert.match(coordinator, /gameplayMutationDispatched: false/);
  assert.match(coordinator, /valueMutationDispatched: false/);
  assert.match(
    coordinator,
    /account_gear_reservation_live_test_active\s*\|\|\s*account_strategy_live_test_active/,
  );
  assert.match(coordinator, /runtimeStateRestored/);
});

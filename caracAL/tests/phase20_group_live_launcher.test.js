"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  evaluatePhase20GroupSupervisorResult,
  formatCompactResult,
  runPhase20GroupSupervisorLiveTest,
} = require("../scripts/run_phase20_group_live_e2e");

function passingPayload(overrides = {}) {
  const farmers = ["My_Mage", "My_Priest", "My_Ranger1"];
  const runtimeSources = [
    ...farmers.map((name) => ({
      name,
      connected: true,
      lifecycleState: "ONLINE",
      desiredRuntimeState: "RUNNING",
      typescriptFile: "bot/main.js",
      lifecycleOnlyProbe: false,
      normalRuntime: true,
    })),
    {
      name: "My_Merchant",
      connected: true,
      lifecycleState: "ONLINE",
      desiredRuntimeState: "RUNNING",
      typescriptFile: "bot/main.js",
      lifecycleOnlyProbe: false,
      normalRuntime: true,
    },
  ];
  const groupResults = [
    ["My_Mage", "leader"],
    ["My_Priest", "follower"],
    ["My_Ranger1", "follower"],
  ].map(([character, role]) => ({
    character,
    role,
    outcome: "PASS",
    reason: "GROUP_LIVE_E2E_CONFIRMED",
    configuredMembers: [...farmers],
    observedMembers: [...farmers],
    roleProjected: true,
    leaderProjected: true,
    initialPartyRestored: true,
  }));

  return {
    result: {
      testId: "phase20-integration-live-1",
      phase: "20.0b1",
      outcome: "PASS",
      reason: "PHASE20_GROUP_TRIO_CONFIRMED",
      evidence: {
        merchant: "My_Merchant",
        farmers,
        selectedCharacters: [...farmers, "My_Merchant"],
        allOnline: true,
        allRunning: true,
        normalRuntimeAll: true,
        runtimeSources,
        activeCharacters: 4,
        maxOnlineCharacters: 4,
        slotLimitValid: true,
        group: {
          leader: "My_Mage",
          followers: ["My_Priest", "My_Ranger1"],
          members: [...farmers],
          baselineGroupFormed: false,
          leaderRunning: true,
          results: groupResults,
          trioFormed: true,
        },
      },
      scope: {
        normalRuntime: true,
        lifecycleOnlyProbe: false,
        lifecycleMutationDispatched: true,
        gameplayMutationForced: false,
        valueMutationForced: false,
        automaticLogisticsDispatchSuppressed: true,
        groupFormationRequired: true,
        combatEvidenceRequired: false,
        logisticsEvidenceRequired: false,
      },
      cleanup: {
        runtimeStateRestored: true,
        originallyRunning: ["My_Merchant"],
        restoredRunning: ["My_Merchant"],
      },
      ...overrides,
    },
  };
}

test("Phase 20.0b1 launcher accepts exact 3+1 runtime and trio evidence", () => {
  const result = evaluatePhase20GroupSupervisorResult(passingPayload());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "PHASE20_GROUP_TRIO_CONFIRMED");
  assert.equal(result.identityValid, true);
  assert.equal(result.runtimeValid, true);
  assert.equal(result.groupIdentityValid, true);
  assert.equal(result.groupEvidenceValid, true);
  assert.equal(result.scopeValid, true);
  assert.equal(result.cleanupValid, true);
});

test("Phase 20.0b1 launcher rejects missing third Farmer evidence", () => {
  const payload = passingPayload();
  payload.result.evidence.group.results =
    payload.result.evidence.group.results.slice(0, 2);

  const result = evaluatePhase20GroupSupervisorResult(payload);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.groupEvidenceValid, false);
});

test("Phase 20.0b1 launcher rejects partial party projection", () => {
  const payload = passingPayload();
  payload.result.evidence.group.results[1].observedMembers = [
    "My_Mage",
    "My_Priest",
  ];

  const result = evaluatePhase20GroupSupervisorResult(payload);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.groupEvidenceValid, false);
});

test("Phase 20.0b1 launcher rejects broadened mutation scope", () => {
  const payload = passingPayload();
  payload.result.scope.combatEvidenceRequired = true;

  const result = evaluatePhase20GroupSupervisorResult(payload);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.scopeValid, false);
});

test("Phase 20.0b1 compact output exposes trio and Merchant coexistence", () => {
  const output = formatCompactResult(
    evaluatePhase20GroupSupervisorResult(passingPayload()),
  );

  assert.match(output, /Phase 20\.0b1 3-Farmer Group Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /Merchant online alongside trio: yes/);
  assert.match(output, /Three-farmer party formed: yes/);
  assert.match(output, /My_Mage=PASS/);
  assert.match(output, /Combat evidence required in this slice: no/);
  assert.match(output, /Runtime state restored: yes/);
});

test("Phase 20.0b1 launcher uses only dedicated integration Group POST", async () => {
  const calls = [];
  const payload = passingPayload();

  const result = await runPhase20GroupSupervisorLiveTest({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(payload);
        },
      };
    },
  });

  assert.deepEqual(result, payload);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /\/headless\/api\/tests\/phase20-integration\/group$/,
  );
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
});

test("Phase 20.0b1 source reuses Group live controller path for three Farmers", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const groupRunner = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "group-live-test.lib.ts",
    ),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(
    dashboard,
    /\/headless\/api\/tests\/phase20-integration\/group/,
  );
  assert.match(
    coordinator,
    /run_group_live_test\(leader,[\s\S]*members:\s*combat_names/,
  );
  assert.match(
    coordinator,
    /followers\.map\([\s\S]*run_group_live_test\(follower/,
  );
  assert.match(groupRunner, /members:\s*expectedMembers/);
  assert.match(groupRunner, /groupFormed\(this\.deps\.party\(\), expectedMembers\)/);
  assert.match(groupRunner, /combatMutationForced:\s*false/);
});

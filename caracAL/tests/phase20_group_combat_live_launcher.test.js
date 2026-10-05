"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  evaluatePhase20GroupCombatResult,
  formatCompactResult,
} = require("../scripts/run_phase20_group_combat_live_e2e");
const {
  runPhase20IntegrationSupervisorLiveTest,
} = require("../scripts/run_phase20_integration_live_e2e");

function passingPayload(overrides = {}) {
  return {
    result: {
      testId: "phase20-integration-live-1",
      phase: "20.0b",
      outcome: "PASS",
      reason: "PHASE20_INTEGRATION_GROUP_COMBAT_CONFIRMED",
      evidence: {
        merchant: "My_Merchant",
        farmers: ["My_Ranger1", "My_Ranger2", "My_Ranger3"],
        selectedCharacters: [
          "My_Ranger1",
          "My_Ranger2",
          "My_Ranger3",
          "My_Merchant",
        ],
        allOnline: true,
        allRunning: true,
        normalRuntimeAll: true,
        activeCharacters: 4,
        maxOnlineCharacters: 4,
        slotLimitValid: true,
        runtimeSources: [
          "My_Ranger1",
          "My_Ranger2",
          "My_Ranger3",
          "My_Merchant",
        ].map((name) => ({
          name,
          connected: true,
          lifecycleState: "ONLINE",
          desiredRuntimeState: "RUNNING",
          typescriptFile: "bot/main.js",
          lifecycleOnlyProbe: false,
          normalRuntime: true,
        })),
        groupCombat: {
          apply: { ok: true },
          observed: true,
          partyFormed: true,
          leader: "My_Ranger1",
          confirmedAttackCount: 6,
          attackCounts: {
            My_Ranger1: 2,
            My_Ranger2: 2,
            My_Ranger3: 2,
          },
          unknownAttackCount: 0,
          unknownMovementCount: 0,
          focusObserved: {
            My_Ranger2: true,
            My_Ranger3: true,
          },
          movementOwners: {
            My_Ranger1: "CombatController",
            My_Ranger2: "GroupCombatController",
            My_Ranger3: null,
          },
          movementOwnerValid: true,
          merchantOnlineDuringCombat: true,
        },
      },
      scope: {
        normalRuntime: true,
        lifecycleOnlyProbe: false,
        lifecycleMutationDispatched: true,
        gameplayMutationForced: true,
        valueMutationForced: false,
        automaticLogisticsDispatchSuppressed: true,
        combatEvidenceRequired: true,
        logisticsEvidenceRequired: false,
      },
      cleanup: {
        runtimeStateRestored: true,
        groupProbeCleared: true,
        originallyRunning: ["My_Merchant"],
        restoredRunning: ["My_Merchant"],
      },
      ...overrides,
    },
  };
}

test("Phase 20.0b accepts complete 3-farmer group-combat evidence", () => {
  const result = evaluatePhase20GroupCombatResult(passingPayload());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.identityValid, true);
  assert.equal(result.runtimeValid, true);
  assert.equal(result.groupValid, true);
  assert.equal(result.scopeValid, true);
  assert.equal(result.cleanupValid, true);
});

test("Phase 20.0b rejects missing attack evidence and UNKNOWN attack outcome", () => {
  const missing = passingPayload();
  missing.result.evidence.groupCombat.attackCounts.My_Ranger3 = 0;
  missing.result.evidence.groupCombat.confirmedAttackCount = 2;

  let result = evaluatePhase20GroupCombatResult(missing);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.groupValid, false);

  const unknown = passingPayload();
  unknown.result.evidence.groupCombat.unknownAttackCount = 1;

  result = evaluatePhase20GroupCombatResult(unknown);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.groupValid, false);

  const movementUnknown = passingPayload();
  movementUnknown.result.evidence.groupCombat.unknownMovementCount = 1;

  result = evaluatePhase20GroupCombatResult(movementUnknown);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.groupValid, false);
});

test("Phase 20.0b requires party, focus, movement ownership and Merchant continuity", () => {
  const party = passingPayload();
  party.result.evidence.groupCombat.partyFormed = false;
  assert.equal(evaluatePhase20GroupCombatResult(party).outcome, "FAIL");

  const focus = passingPayload();
  focus.result.evidence.groupCombat.focusObserved.My_Ranger2 = false;
  assert.equal(evaluatePhase20GroupCombatResult(focus).outcome, "FAIL");

  const movement = passingPayload();
  movement.result.evidence.groupCombat.movementOwnerValid = false;
  assert.equal(evaluatePhase20GroupCombatResult(movement).outcome, "FAIL");

  const merchant = passingPayload();
  merchant.result.evidence.groupCombat.merchantOnlineDuringCombat = false;
  assert.equal(evaluatePhase20GroupCombatResult(merchant).outcome, "FAIL");
});

test("Phase 20.0b requires group override cleanup and full runtime restore", () => {
  const payload = passingPayload();
  payload.result.cleanup.groupProbeCleared = false;

  const result = evaluatePhase20GroupCombatResult(payload);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.cleanupValid, false);
});

test("Phase 20.0b compact output exposes party/combat safety evidence", () => {
  const output = formatCompactResult(
    evaluatePhase20GroupCombatResult(passingPayload()),
  );

  assert.match(output, /Phase 20\.0b 3-Farmer Group Combat Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /Party formed: yes/);
  assert.match(output, /Confirmed attacks: 6/);
  assert.match(output, /Unknown attacks: 0/);
  assert.match(output, /Unknown movement outcomes: 0/);
  assert.match(output, /Movement ownership valid: yes/);
  assert.match(output, /Merchant stayed online: yes/);
  assert.match(output, /Group probe cleared: yes/);
});

test("staged Phase 20 integration request sends 20.0b body", async () => {
  const calls = [];

  await runPhase20IntegrationSupervisorLiveTest({
    stage: "20.0b",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(passingPayload());
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { stage: "20.0b" });
});

test("Phase 20.0b source reuses existing runtime controllers and ActionBoundary", () => {
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
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(kernel, /runPhase20GroupProbe/);
  assert.match(kernel, /clearPhase20GroupProbe/);
  assert.match(kernel, /this\.movement\.smart/);
  assert.match(kernel, /this\.groupCombat\.setConfigOverride/);
  assert.match(kernel, /this\.combat\.setConfigOverride/);
  assert.match(kernel, /options\.potionRecovery === true/);
  assert.match(kernel, /: \{ enabled: false \}/);
  assert.match(kernel, /this\.actions\.partyLeave/);

  assert.match(thread, /phase20_group_probe_apply/);
  assert.match(thread, /phase20_group_probe_clear/);

  assert.match(coordinator, /phase20_group_combat_evidence/);
  assert.match(
    coordinator,
    /phase20_apply_group_probe\([\s\S]*stage === "20\.0c"/,
  );
  assert.match(coordinator, /ACTION_CONFIRMED/);
  assert.match(coordinator, /ACTION_UNKNOWN/);
  assert.match(coordinator, /confirmedAttackCount/);
  assert.match(coordinator, /merchantOnlineDuringCombat/);
  assert.match(coordinator, /PHASE20_INTEGRATION_GROUP_COMBAT_CONFIRMED/);
});

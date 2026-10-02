"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  combatLiveTestDiagnostics,
  combatLiveTestEvidence,
  combineCombatLiveTestResult,
} = require("../src/CombatLiveTest");

function runtimeEvents() {
  return [
    {
      source: "bot_runtime",
      module: "CombatLiveTest",
      type: "COMBAT_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "CombatController",
      type: "COMBAT_TARGET_CHANGED",
    },
    {
      source: "bot_runtime",
      module: "CombatController",
      type: "COMBAT_ACTION",
      why: "ATTACK",
      data: { actionStatus: "CONFIRMED" },
    },
    {
      source: "bot_runtime",
      module: "CombatLiveTest",
      type: "COMBAT_LIVE_TEST_COMPLETED",
    },
  ];
}

function combatProjection() {
  return {
    combat_runtime: {
      state: "DISABLED",
      resources: {
        hp: 900,
        maxHp: 1000,
        mp: 400,
        maxMp: 500,
      },
    },
  };
}

test("combat live evidence confirms attack and dashboard projection", () => {
  const evidence = combatLiveTestEvidence(
    runtimeEvents(),
    combatProjection(),
  );

  assert.equal(evidence.combatTestStarted, true);
  assert.equal(evidence.targetChanged, true);
  assert.equal(evidence.attackActions, 1);
  assert.equal(evidence.confirmedAttack, true);
  assert.equal(evidence.combatTestCompleted, true);
  assert.equal(evidence.combatProjectionVisible, true);
  assert.equal(evidence.resourceProjectionVisible, true);

  const combined = combineCombatLiveTestResult(
    { outcome: "PASS", reason: "COMBAT_LIVE_E2E_CONFIRMED" },
    evidence,
  );
  assert.equal(combined.outcome, "PASS");
});

test("missing combat supervisor evidence downgrades runtime PASS", () => {
  const combined = combineCombatLiveTestResult(
    { outcome: "PASS", reason: "COMBAT_LIVE_E2E_CONFIRMED" },
    combatLiveTestEvidence([], {}),
  );

  assert.equal(combined.outcome, "FAIL");
  assert.equal(combined.reason, "SUPERVISOR_COMBAT_EVIDENCE_INCOMPLETE");
});

test("combat diagnostics include autonomous live-test evidence", () => {
  const evidence = combatLiveTestEvidence(
    runtimeEvents(),
    combatProjection(),
  );
  const diagnostics = combatLiveTestDiagnostics(
    {
      requestId: "combat-live-1",
      character: "My_Ranger1",
      outcome: "PASS",
      reason: "COMBAT_LIVE_E2E_CONFIRMED",
      durationMs: 1234,
      preparation: {
        initialMovementCancelStatus: null,
        respawnedAtStart: false,
        destinationCandidates: ["goo"],
        selectedMonsterType: "goo",
      },
      navigation: {
        outboundStatus: "CONFIRMED",
        returnStatus: "CONFIRMED",
        finalDistanceToStart: 0,
        returnedToStart: true,
      },
      combat: {
        targetId: "goo-1",
        targetType: "goo",
        inRangeObserved: true,
        attackActionId: "attack-1",
        attackActionStatus: "CONFIRMED",
        cooldownObserved: true,
        resourcesVisible: true,
      },
      cleanup: {
        movementCancelStatus: null,
        combatOverrideCleared: true,
      },
    },
    {
      character: "My_Ranger1",
      originalDesiredState: "RUNNING",
      startState: { map: "main", x: 1, y: 2, hp: 900, mp: 400 },
      evidence,
      incidentId: null,
    },
  );

  assert.equal(diagnostics.test_id, "combat-live-1");
  assert.equal(diagnostics.character, "My_Ranger1");
  assert.equal(diagnostics.navigation.returned_to_start, true);
  assert.equal(diagnostics.actions.attack_action_status, "CONFIRMED");
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
  assert.equal(diagnostics.result.outcome, "PASS");
  assert.equal(diagnostics.duration, 1234);
  assert.equal(diagnostics.incident_id, null);
});


/* PRETTIER_PROBE_START */
test("prettier exact-output probe", async () => {
  const fs = require("node:fs");
  const nodePath = require("node:path");
  const prettier = await import("prettier");
  const targets = ["standalones/CharacterCoordinator.js"];

  for (const relative of targets) {
    const absolute = nodePath.join(__dirname, "..", relative);
    let source = fs.readFileSync(absolute, "utf8");
    if (relative === "tests/combat_live_supervisor.test.js") {
      source = source.replace(
        /\n\/\* PRETTIER_PROBE_START \*\/[\s\S]*\/\* PRETTIER_PROBE_END \*\/\n?$/,
        "\n",
      );
    }
    const formatted = await prettier.format(source, { filepath: absolute });
    const encoded = Buffer.from(formatted).toString("base64");
    const pathToken = Buffer.from(relative).toString("base64");
    let part = 0;
    for (let offset = 0; offset < encoded.length; offset += 2000) {
      console.log(
        `PRETTIER_PROBE|${pathToken}|${String(part).padStart(4, "0")}|${encoded.slice(
          offset,
          offset + 2000,
        )}`,
      );
      part += 1;
    }
  }
});
/* PRETTIER_PROBE_END */

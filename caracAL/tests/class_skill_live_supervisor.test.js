"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classSkillLiveTestDiagnostics,
  classSkillLiveTestEvidence,
  combineClassSkillLiveTestResult,
} = require("../src/ClassSkillLiveTest");

function events() {
  return [
    {
      source: "bot_runtime",
      module: "ClassSkillLiveTest",
      type: "CLASS_SKILL_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "RangerSkillController",
      type: "CLASS_SKILL_ACTION",
      data: {
        skill: "track",
        actionStatus: "CONFIRMED",
      },
    },
    {
      source: "bot_runtime",
      module: "ClassSkillLiveTest",
      type: "CLASS_SKILL_LIVE_TEST_COMPLETED",
    },
  ];
}

function projection() {
  return {
    class_skill_runtime: {
      className: "ranger",
      module: "RangerSkillController",
      state: "USING",
      reason: "CLASS_SKILL_DISPATCHED",
      lastAction: {
        id: "skill-1",
        status: "CONFIRMED",
        skill: "track",
      },
    },
  };
}

test("class skill supervisor evidence confirms Ranger track action", () => {
  const evidence = classSkillLiveTestEvidence(events(), projection());

  assert.equal(evidence.classSkillTestStarted, true);
  assert.equal(evidence.actionEvents, 1);
  assert.equal(evidence.confirmedTrack, true);
  assert.equal(evidence.classSkillTestCompleted, true);
  assert.equal(evidence.classSkillProjectionVisible, true);
  assert.equal(evidence.confirmedActionProjection, true);

  const combined = combineClassSkillLiveTestResult(
    {
      outcome: "PASS",
      reason: "CLASS_SKILL_LIVE_E2E_CONFIRMED",
    },
    evidence,
  );
  assert.equal(combined.outcome, "PASS");
});

test("missing class skill evidence downgrades runtime PASS", () => {
  const combined = combineClassSkillLiveTestResult(
    {
      outcome: "PASS",
      reason: "CLASS_SKILL_LIVE_E2E_CONFIRMED",
    },
    classSkillLiveTestEvidence([], {}),
  );

  assert.equal(combined.outcome, "FAIL");
  assert.equal(
    combined.reason,
    "SUPERVISOR_CLASS_SKILL_EVIDENCE_INCOMPLETE",
  );
});

test("class skill diagnostics include roadmap-required evidence", () => {
  const evidence = classSkillLiveTestEvidence(events(), projection());
  const diagnostics = classSkillLiveTestDiagnostics(
    {
      requestId: "class-skill-live-1",
      character: "My_Ranger1",
      outcome: "PASS",
      reason: "CLASS_SKILL_LIVE_E2E_CONFIRMED",
      durationMs: 120,
      start: {
        ctype: "ranger",
        map: "main",
        x: 1,
        y: 2,
        hp: 1000,
        mp: 500,
      },
      preparation: {
        respawnedAtStart: false,
        selectedSkill: "track",
        skillMp: 80,
        initialCooldownMs: 0,
      },
      classSkill: {
        module: "RangerSkillController",
        selectedSkill: "track",
        actionId: "skill-1",
        actionStatus: "CONFIRMED",
        cooldownObserved: true,
        mpCostObserved: true,
        resourceTelemetryVisible: true,
        projectionVisible: true,
      },
      scope: {
        testedClass: "ranger",
        safeSkill: "track",
        consumableMutationForced: false,
        combatMutationForced: false,
      },
      cleanup: {
        classSkillOverrideCleared: true,
        combatOverrideCleared: true,
      },
    },
    {
      character: "My_Ranger1",
      originalDesiredState: "RUNNING",
      evidence,
      incidentId: null,
    },
  );

  assert.equal(diagnostics.test_id, "class-skill-live-1");
  assert.equal(diagnostics.character, "My_Ranger1");
  assert.equal(diagnostics.navigation.required, false);
  assert.equal(diagnostics.actions.skill, "track");
  assert.equal(diagnostics.actions.action_status, "CONFIRMED");
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
  assert.equal(diagnostics.result.outcome, "PASS");
  assert.equal(diagnostics.incident_id, null);
});


/* CLASS_SKILL_PRETTIER_PROBE_START */
test("class skill prettier exact-output probe", async () => {
  const fs = require("node:fs");
  const nodePath = require("node:path");
  const prettier = await import("prettier");
  const targets = [
    "src/ClassSkillLiveTest.js",
    "standalones/CharacterCoordinator.js",
    "tests/class_skill_live_supervisor.test.js",
  ];

  for (const relative of targets) {
    const absolute = nodePath.join(__dirname, "..", relative);
    let source = fs.readFileSync(absolute, "utf8");
    if (relative === "tests/class_skill_live_supervisor.test.js") {
      source = source.replace(
        /\n\/\* CLASS_SKILL_PRETTIER_PROBE_START \*\/[\s\S]*\/\* CLASS_SKILL_PRETTIER_PROBE_END \*\/\n?$/,
        "\n",
      );
    }
    const formatted = await prettier.format(source, { filepath: absolute });
    const encoded = Buffer.from(formatted, "utf8").toString("base64");
    const pathToken = Buffer.from(relative, "utf8").toString("base64");
    let part = 0;
    for (let offset = 0; offset < encoded.length; offset += 6000) {
      console.log(
        `CLASS_SKILL_PRETTIER|${pathToken}|${String(part).padStart(
          4,
          "0",
        )}|${encoded.slice(offset, offset + 6000)}`,
      );
      part += 1;
    }
  }
});
/* CLASS_SKILL_PRETTIER_PROBE_END */

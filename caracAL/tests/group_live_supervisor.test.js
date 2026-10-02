"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineGroupLiveTestResult,
  groupLiveTestDiagnostics,
  groupLiveTestEvidence,
} = require("../src/GroupLiveTest");

function events() {
  return [
    {
      source: "bot_runtime",
      module: "GroupLiveTest",
      type: "GROUP_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "GroupCombatController",
      type: "GROUP_COMBAT_ACTION",
      why: "PARTY_INVITE",
      data: {
        groupCombat: {
          role: "LEADER",
          leader: "Leader",
          partyMembers: ["Leader"],
        },
      },
    },
    {
      source: "bot_runtime",
      module: "GroupLiveTest",
      type: "GROUP_LIVE_TEST_COMPLETED",
    },
  ];
}

function block() {
  return {
    group_combat_runtime: {
      role: "LEADER",
      leader: "Leader",
      partyMembers: ["Follower", "Leader"],
    },
  };
}

test("group supervisor evidence confirms runtime party formation", () => {
  const evidence = groupLiveTestEvidence(events(), block());
  assert.equal(evidence.groupTestStarted, true);
  assert.equal(evidence.groupTestCompleted, true);
  assert.equal(evidence.partyActions, 1);
  assert.equal(evidence.groupProjectionVisible, true);

  const combined = combineGroupLiveTestResult(
    {
      outcome: "PASS",
      reason: "GROUP_LIVE_E2E_CONFIRMED",
      preparation: { initialPairFormed: false },
    },
    evidence,
  );
  assert.equal(combined.outcome, "PASS");
});

test("group supervisor diagnostics expose autonomous cleanup", () => {
  const evidence = groupLiveTestEvidence(events(), block());
  const diagnostics = groupLiveTestDiagnostics(
    {
      requestId: "group-live-1",
      character: "Leader",
      role: "leader",
      leader: "Leader",
      peer: "Follower",
      outcome: "PASS",
      reason: "GROUP_LIVE_E2E_CONFIRMED",
      durationMs: 123,
      party: {
        formed: true,
        roleProjected: true,
        leaderProjected: true,
        partyActionObserved: true,
        lastActionId: "party-1",
        lastActionStatus: "DISPATCHED",
        lastActionKind: "PARTY_INVITE",
      },
      cleanup: { initialPartyRestored: true },
      scope: {
        combatMutationForced: false,
        aoeMutationForced: false,
        healingMutationForced: false,
      },
    },
    {
      character: "Leader",
      originalDesiredState: "STOPPED",
      evidence,
      incidentId: null,
    },
  );

  assert.equal(diagnostics.test_id, "group-live-1");
  assert.equal(diagnostics.observed.pair_formed, true);
  assert.equal(diagnostics.observed.initial_party_restored, true);
  assert.equal(diagnostics.result.outcome, "PASS");
});


test("group supervisor uses a group-specific runtime readiness error", () => {
  const coordinator = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "standalones",
      "CharacterCoordinator.js",
    ),
    "utf8",
  );

  assert.match(coordinator, /function wait_for_group_live_test_runtime/);
  assert.match(coordinator, /GROUP_LIVE_TEST_RUNTIME_TIMEOUT/);
  assert.match(
    coordinator,
    /run_group_live_test[\s\S]*await wait_for_group_live_test_runtime\(char_name\)/,
  );
});


/* GROUP_BOOTSTRAP_PRETTIER_PROBE_START */
test("group bootstrap exact prettier output probe", async () => {
  const fs = require("node:fs");
  const nodePath = require("node:path");
  const prettier = await import("prettier");
  const targets = [
    "scripts/run_group_live_e2e.js",
    "tests/group_live_launcher.test.js",
    "tests/group_live_supervisor.test.js",
  ];

  for (const relative of targets) {
    const absolute = nodePath.join(__dirname, "..", relative);
    const original = fs.readFileSync(absolute, "utf8");
    const formatted = await prettier.format(original, { filepath: absolute });
    const pathToken = Buffer.from(relative, "utf8").toString("base64");
    const encoded = Buffer.from(formatted, "utf8").toString("base64");

    for (
      let offset = 0, part = 0;
      offset < encoded.length;
      offset += 600, part += 1
    ) {
      console.log(
        "GROUP_BOOTSTRAP_PRETTIER|" +
          pathToken +
          "|" +
          String(part).padStart(3, "0") +
          "|" +
          encoded.slice(offset, offset + 600),
      );
    }
    console.log(
      "GROUP_BOOTSTRAP_PRETTIER_LENGTH|" +
        pathToken +
        "|" +
        String(formatted.length),
    );
  }
});
/* GROUP_BOOTSTRAP_PRETTIER_PROBE_END */

"use strict";

const assert = require("node:assert/strict");
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


/* PHASE8_PRETTIER_PROBE_START */
test("phase8 prettier exact-output probe", async () => {
  const fs = require("node:fs");
  const nodePath = require("node:path");
  const prettier = await import("prettier");
  const targets = ["standalones/CharacterCoordinator.js"];

  for (const relative of targets) {
    const absolute = nodePath.join(__dirname, "..", relative);
    const source = fs.readFileSync(absolute, "utf8");
    const formatted = await prettier.format(source, { filepath: absolute });
    const encoded = Buffer.from(formatted, "utf8").toString("base64");
    const pathToken = Buffer.from(relative, "utf8").toString("base64");
    let part = 0;
    for (let offset = 0; offset < encoded.length; offset += 800) {
      console.log(
        "PHASE8_PRETTIER|" +
          pathToken +
          "|" +
          String(part).padStart(4, "0") +
          "|" +
          encoded.slice(offset, offset + 800),
      );
      part += 1;
    }
  }
});
/* PHASE8_PRETTIER_PROBE_END */

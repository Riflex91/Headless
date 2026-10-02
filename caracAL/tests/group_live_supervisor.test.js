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
test("phase8 coordinator prettier diff probe", async () => {
  const fs = require("node:fs");
  const nodePath = require("node:path");
  const prettier = await import("prettier");
  const relative = "standalones/CharacterCoordinator.js";
  const absolute = nodePath.join(__dirname, "..", relative);
  const original = fs.readFileSync(absolute, "utf8");
  const formatted = await prettier.format(original, { filepath: absolute });
  const a = original.replace(/\r\n/g, "\n").split("\n");
  const b = formatted.replace(/\r\n/g, "\n").split("\n");
  const hunks = [];
  let i = 0;
  let j = 0;
  const anchorMatch = (ai, bj) => {
    if (a[ai] !== b[bj]) return false;
    let matches = 0;
    for (let k = 0; k < 4 && ai + k < a.length && bj + k < b.length; k += 1) {
      if (a[ai + k] !== b[bj + k]) break;
      matches += 1;
    }
    return matches >= 2 || ai === a.length - 1 || bj === b.length - 1;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    let best = null;
    for (let di = 0; di <= 120 && i + di < a.length; di += 1) {
      for (let dj = 0; dj <= 120 && j + dj < b.length; dj += 1) {
        if (di === 0 && dj === 0) continue;
        if (!anchorMatch(i + di, j + dj)) continue;
        const score = di + dj;
        if (!best || score < best.score) {
          best = { di, dj, score };
        }
      }
    }
    if (!best) {
      hunks.push({ start: i, end: a.length, replacement: b.slice(j) });
      i = a.length;
      j = b.length;
      break;
    }
    hunks.push({
      start: i,
      end: i + best.di,
      replacement: b.slice(j, j + best.dj),
    });
    i += best.di;
    j += best.dj;
  }
  const compact = hunks.filter(
    (hunk) => hunk.start !== hunk.end || hunk.replacement.length > 0,
  );
  compact.forEach((hunk, index) => {
    const encoded = Buffer.from(
      JSON.stringify({
        start: hunk.start,
        end: hunk.end,
        replacement: hunk.replacement,
      }),
      "utf8",
    ).toString("base64");
    for (let offset = 0, part = 0; offset < encoded.length; offset += 600, part += 1) {
      console.log(
        "PHASE8_HUNK|" +
          String(index).padStart(3, "0") +
          "|" +
          String(part).padStart(3, "0") +
          "|" +
          encoded.slice(offset, offset + 600),
      );
    }
  });
  console.log("PHASE8_HUNK_COUNT|" + compact.length);
});
/* PHASE8_PRETTIER_PROBE_END */

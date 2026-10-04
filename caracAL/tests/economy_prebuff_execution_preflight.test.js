"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeCandidate,
} = require("../scripts/run_economy_prebuff_execution_preflight");

function result({
  riskState = "READY",
  unknown = 0,
  selected = {
    kind: "UPGRADE",
    name: "helmet",
    currentLevel: 1,
    targetLevel: 2,
    itemSlots: [2],
    expectedDeltaGold: 100,
    successProbability: 0.9,
    failureLossGold: 50,
    decision: "ALLOW",
  },
  prebuffState = "READY",
  selectedSkill = "massproductionpp",
} = {}) {
  return {
    outcome: "PASS",
    after: {
      riskPolicy: {
        state: riskState,
        reason:
          riskState === "READY"
            ? "RISK_POLICY_CANDIDATE_ALLOWED"
            : "RISK_POLICY_NO_ESTIMATES",
        selected,
        summary: {
          unknown,
        },
      },
      economyPrebuff: {
        state: prebuffState,
        reason:
          prebuffState === "READY"
            ? "ECONOMY_PREBUFF_READY"
            : "ECONOMY_PREBUFF_NO_ECONOMY_SELECTION",
        selectedSkill,
        demand: {
          kind: selected?.kind || null,
          name: selected?.name || null,
          unknown,
        },
      },
    },
  };
}

test("preflight emits exact guarded upgrade command for READY candidate", () => {
  const preflight = normalizeCandidate(result(), "My_Merchant");

  assert.equal(preflight.outcome, "READY");
  assert.equal(
    preflight.reason,
    "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_READY",
  );
  assert.deepEqual(preflight.candidate.slots, [2]);
  assert.equal(preflight.candidate.kind, "UPGRADE");
  assert.equal(preflight.candidate.name, "helmet");
  assert.equal(preflight.selectedSkill, "massproductionpp");
  assert.equal(
    preflight.command,
    "npm run test:live:economy-prebuff-execution -- My_Merchant UPGRADE helmet 2",
  );
  assert.deepEqual(preflight.scope, {
    readOnly: true,
    mutationDispatched: false,
  });
});

test("preflight emits exact guarded compound command with sorted slots", () => {
  const preflight = normalizeCandidate(
    result({
      selected: {
        kind: "COMPOUND",
        name: "ringsj",
        currentLevel: 1,
        targetLevel: 2,
        itemSlots: [5, 3, 4],
        expectedDeltaGold: 25,
        successProbability: 0.8,
        failureLossGold: 20,
        decision: "ALLOW",
      },
      selectedSkill: "massproduction",
    }),
    "My_Merchant",
  );

  assert.equal(preflight.outcome, "READY");
  assert.deepEqual(preflight.candidate.slots, [3, 4, 5]);
  assert.equal(
    preflight.command,
    "npm run test:live:economy-prebuff-execution -- My_Merchant COMPOUND ringsj 3,4,5",
  );
});

test("preflight refuses UNKNOWN and emits no mutation command", () => {
  const preflight = normalizeCandidate(
    result({
      riskState: "PARTIAL",
      unknown: 1,
      selected: null,
      prebuffState: "BLOCKED",
      selectedSkill: null,
    }),
    "My_Merchant",
  );

  assert.equal(preflight.outcome, "NO_CANDIDATE");
  assert.equal(
    preflight.reason,
    "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_UNKNOWN",
  );
  assert.equal(preflight.command, null);
  assert.equal(preflight.scope.mutationDispatched, false);
});

test("preflight refuses malformed slot cardinality and stale Prebuff demand", () => {
  const invalidSlots = normalizeCandidate(
    result({
      selected: {
        kind: "COMPOUND",
        name: "ringsj",
        itemSlots: [3, 4],
        decision: "ALLOW",
      },
      selectedSkill: "massproduction",
    }),
    "My_Merchant",
  );
  const stalePrebuff = result();
  stalePrebuff.after.economyPrebuff.demand.name = "different";

  assert.equal(invalidSlots.outcome, "NO_CANDIDATE");
  assert.equal(invalidSlots.command, null);
  assert.equal(
    normalizeCandidate(stalePrebuff, "My_Merchant").outcome,
    "NO_CANDIDATE",
  );
});

test("preflight source remains on read-only Gear Scoring supervisor", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "scripts",
      "run_economy_prebuff_execution_preflight.js",
    ),
    "utf8",
  );

  assert.match(source, /runGearScoringSupervisorLiveTest/);
  assert.match(source, /scope:\s*\{\s*readOnly: true/);
  assert.match(source, /mutationDispatched: false/);
  assert.doesNotMatch(source, /economy-prebuff-execution",/);
  assert.doesNotMatch(source, /executeNext/);
  assert.doesNotMatch(source, /useSkill/);
});

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
  assert.equal(preflight.reason, "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_READY");
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
  assert.equal(preflight.reason, "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_UNKNOWN");
  assert.equal(preflight.command, null);
  assert.equal(preflight.scope.mutationDispatched, false);
});

test("preflight explains an empty upstream candidate chain without mutation", () => {
  const snapshot = result({
    riskState: "EMPTY",
    selected: null,
    prebuffState: "IDLE",
    selectedSkill: null,
  });
  snapshot.after.inventoryIntelligence = {
    state: "READY",
    reason: "INVENTORY_INTELLIGENCE_READY",
    summary: {
      totalItems: 2,
      dispositions: {
        UPGRADE: 0,
        COMPOUND: 0,
        GEAR: 1,
        CONSUMABLE: 1,
      },
    },
    entries: [
      {
        slot: 4,
        name: "helmet",
        level: 1,
        disposition: "GEAR",
        protected: false,
        protections: [],
        why: "GEAR via Adventure Land item metadata",
      },
    ],
  };
  snapshot.after.upgrade = {
    state: "EMPTY",
    reason: "UPGRADE_NO_ELIGIBLE_CANDIDATE",
    summary: {
      upgradeDispositionItems: 0,
      eligibleCandidates: 0,
    },
    decisions: [],
  };
  snapshot.after.compound = {
    state: "EMPTY",
    reason: "COMPOUND_NO_ELIGIBLE_CANDIDATE",
    summary: {
      compoundDispositionItems: 0,
      eligibleCandidates: 0,
    },
    decisions: [],
  };
  snapshot.after.expectedValue = {
    state: "EMPTY",
    reason: "EXPECTED_VALUE_NO_CANDIDATES",
    summary: {
      upgradeCandidates: 0,
      compoundCandidates: 0,
      evaluated: 0,
      unknown: 0,
    },
  };

  const preflight = normalizeCandidate(snapshot, "My_Merchant");

  assert.equal(preflight.outcome, "NO_CANDIDATE");
  assert.equal(preflight.command, null);
  assert.equal(
    preflight.diagnostics.expectedValue.reason,
    "EXPECTED_VALUE_NO_CANDIDATES",
  );
  assert.equal(
    preflight.diagnostics.inventoryIntelligence.summary.dispositions.UPGRADE,
    0,
  );
  assert.equal(
    preflight.diagnostics.inventoryIntelligence.entries[0].disposition,
    "GEAR",
  );
  assert.equal(preflight.diagnostics.upgrade.summary.eligibleCandidates, 0);
  assert.equal(preflight.diagnostics.compound.summary.eligibleCandidates, 0);
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
  assert.match(source, /inventoryIntelligence/);
  assert.match(source, /expectedValue/);
  assert.match(source, /diagnostics/);
  assert.doesNotMatch(source, /economy-prebuff-execution",/);
  assert.doesNotMatch(source, /executeNext/);
  assert.doesNotMatch(source, /useSkill/);
});

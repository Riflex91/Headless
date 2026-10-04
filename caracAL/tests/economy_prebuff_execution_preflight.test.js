"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  formatCompactResult,
  normalizeCandidate,
  normalizeVerificationPolicyPreflight,
  parseCliArgs,
  verificationPolicyCandidates,
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

test("preflight CLI defaults to compact output and supports explicit verbose mode", () => {
  assert.deepEqual(parseCliArgs(["My_Merchant"]), {
    requestedCharacter: "My_Merchant",
    verbose: false,
    clearScreen: true,
  });
  assert.deepEqual(parseCliArgs(["My_Merchant", "--verbose", "--no-clear"]), {
    requestedCharacter: "My_Merchant",
    verbose: true,
    clearScreen: false,
  });
});

test("compact preflight output keeps only decision-critical fields", () => {
  const preflight = normalizeCandidate(result(), "My_Merchant");
  const output = formatCompactResult(preflight);

  assert.match(output, /Economy Prebuff Execution Preflight/);
  assert.match(output, /Outcome: READY/);
  assert.match(output, /Risk Policy: READY/);
  assert.match(output, /Prebuff: READY/);
  assert.match(output, /Selected skill: massproductionpp/);
  assert.match(output, /Candidate: UPGRADE helmet \[2\]/);
  assert.match(output, /Mutation dispatched: no/);
  assert.match(output, /Exact guarded mutation command:/);
  assert.doesNotMatch(output, /inventoryIntelligence/);
  assert.doesNotMatch(output, /"diagnostics"/);
});

test("compact blocked preflight summarizes verification attempts one line each", () => {
  const output = formatCompactResult({
    outcome: "NO_CANDIDATE",
    reason: "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_POLICY_NOT_READY",
    character: "My_Merchant",
    riskPolicyState: "EMPTY",
    riskPolicyReason: "RISK_POLICY_NO_ESTIMATES",
    prebuffState: "IDLE",
    prebuffReason: "ECONOMY_PREBUFF_NO_ECONOMY_SELECTION",
    selectedSkill: null,
    candidate: null,
    command: null,
    scope: {
      readOnly: true,
      mutationDispatched: false,
    },
    verificationPolicyAttempts: [
      {
        candidate: {
          kind: "UPGRADE",
          name: "shoes",
          slots: [16],
        },
        riskPolicyState: "READY",
        riskPolicyReason: "RISK_POLICY_CANDIDATE_ALLOWED",
        prebuffState: "BLOCKED",
        prebuffReason: "ECONOMY_PREBUFF_SKILL_NOT_READY",
      },
    ],
  });

  assert.match(output, /Verification attempts: 1/);
  assert.match(
    output,
    /UPGRADE shoes \[16\]: risk=READY \(RISK_POLICY_CANDIDATE_ALLOWED\); prebuff=BLOCKED/,
  );
  assert.doesNotMatch(output, /\{\s*"candidate"/);
});

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

test("preflight discovers only exact policy-missing verification candidates", () => {
  const snapshot = result({
    riskState: "EMPTY",
    selected: null,
    prebuffState: "IDLE",
    selectedSkill: null,
  });
  snapshot.after.upgrade = {
    state: "EMPTY",
    reason: "UPGRADE_NO_ELIGIBLE_CANDIDATE",
    decisions: [
      {
        itemSlot: 2,
        name: "helmet",
        protections: [],
        reason: "UPGRADE_MAX_LEVEL_POLICY_MISSING",
      },
      {
        itemSlot: 19,
        name: "gloves",
        protections: ["FUTURE_GEAR"],
        reason: "UPGRADE_MAX_LEVEL_POLICY_MISSING",
      },
    ],
  };
  snapshot.after.compound = {
    state: "EMPTY",
    reason: "COMPOUND_NO_ELIGIBLE_CANDIDATE",
    decisions: [
      {
        itemSlots: [5],
        name: "hpamulet",
        protections: [],
        reason: "COMPOUND_TRIPLE_MISSING",
      },
    ],
  };

  assert.deepEqual(verificationPolicyCandidates(snapshot), [
    {
      kind: "UPGRADE",
      name: "helmet",
      slots: [2],
    },
  ]);
});

test("temporary verification policy emits command only after read-only coupled confirmation", () => {
  const expected = {
    kind: "UPGRADE",
    name: "helmet",
    slots: [2],
  };
  const diagnostics = {
    upgrade: {
      state: "EMPTY",
      reason: "UPGRADE_NO_ELIGIBLE_CANDIDATE",
    },
  };
  const source = {
    outcome: "PASS",
    scope: {
      readOnly: true,
      prebuffMutationForced: false,
      valueMutationForced: false,
    },
    cleanup: {
      equipmentBaselineRestored: true,
      runtimeStateRestored: true,
    },
    coupledExecution: {
      outcome: "PASS",
      reason: "ECONOMY_PREBUFF_EXECUTION_LIVE_PREFLIGHT_CONFIRMED",
      execution: null,
      before: {
        riskPolicy: {
          state: "READY",
          reason: "RISK_POLICY_CANDIDATE_ALLOWED",
          selected: {
            kind: "UPGRADE",
            name: "helmet",
            currentLevel: 1,
            targetLevel: 2,
            itemSlots: [2],
            expectedDeltaGold: 25,
            successProbability: 0.8,
            failureLossGold: 10,
            decision: "ALLOW",
          },
          summary: {
            unknown: 0,
          },
        },
        economyPrebuff: {
          state: "READY",
          reason: "ECONOMY_PREBUFF_READY",
          selectedSkill: "massproductionpp",
          demand: {
            kind: "UPGRADE",
            name: "helmet",
            unknown: 0,
          },
        },
      },
      scope: {
        readOnly: true,
      },
      cleanup: {
        verificationPolicyConfigOverrideCleared: true,
        verificationPolicyPlanningRestored: true,
        prebuffVerificationConfigOverrideCleared: true,
        prebuffVerificationPlanningRestored: true,
      },
    },
  };

  const preflight = normalizeVerificationPolicyPreflight(
    source,
    "My_Merchant",
    expected,
    diagnostics,
  );

  assert.equal(preflight.outcome, "READY");
  assert.equal(preflight.verificationPolicy.temporary, true);
  assert.equal(preflight.verificationPolicy.cleanupConfirmed, true);
  assert.equal(preflight.verificationPolicy.temporaryPrebuffSkills, true);
  assert.equal(preflight.verificationPolicy.prebuffCleanupConfirmed, true);
  assert.equal(
    preflight.command,
    "npm run test:live:economy-prebuff-execution -- My_Merchant UPGRADE helmet 2",
  );

  source.coupledExecution.cleanup.verificationPolicyPlanningRestored = false;
  assert.equal(
    normalizeVerificationPolicyPreflight(
      source,
      "My_Merchant",
      expected,
      diagnostics,
    ).outcome,
    "NO_CANDIDATE",
  );

  source.coupledExecution.cleanup.verificationPolicyPlanningRestored = true;
  source.coupledExecution.cleanup.prebuffVerificationConfigOverrideCleared = false;
  assert.equal(
    normalizeVerificationPolicyPreflight(
      source,
      "My_Merchant",
      expected,
      diagnostics,
    ).outcome,
    "NO_CANDIDATE",
  );
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
  assert.match(source, /stdio: \["ignore", "ignore", "ignore"\]/);
  assert.match(source, /formatCompactResult/);
  assert.match(source, /--verbose/);
  assert.match(source, /scope:\s*\{\s*readOnly: true/);
  assert.match(source, /mutationDispatched: false/);
  assert.match(source, /inventoryIntelligence/);
  assert.match(source, /expectedValue/);
  assert.match(source, /diagnostics/);
  assert.match(source, /preflightOnly: true/);
  assert.match(source, /verificationPolicyCandidates/);
  assert.doesNotMatch(source, /executeNext/);
  assert.doesNotMatch(source, /useSkill/);
});

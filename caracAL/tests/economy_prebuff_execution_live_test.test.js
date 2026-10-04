"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadRunner() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-prebuff-execution-live-test.lib.ts",
    ),
  );
}

function risk(kind = "UPGRADE") {
  return {
    timestamp: 1,
    enabled: true,
    state: "READY",
    reason: "RISK_POLICY_CANDIDATE_ALLOWED",
    policy: {
      minExpectedDeltaGold: 0,
      minSuccessProbability: 0,
      maxInputValueGold: null,
      maxFailureLossGold: null,
      allowedKinds: ["UPGRADE", "COMPOUND"],
      unknownAlwaysBlocked: true,
    },
    selected: {
      kind,
      name: kind === "UPGRADE" ? "helmet" : "ringsj",
      currentLevel: 1,
      targetLevel: 2,
      itemSlots: kind === "UPGRADE" ? [2] : [3, 4, 5],
      expectedDeltaGold: 1,
      successProbability: 1,
      inputValueGold: 1,
      failureOutcomeValueGold: 0,
      failureLossGold: 1,
      decision: "ALLOW",
      reason: "RISK_POLICY_ALLOWED",
    },
    decisions: [],
    summary: {
      estimates: 1,
      allowed: 1,
      blocked: 0,
      unknown: 0,
      upgradeAllowed: kind === "UPGRADE" ? 1 : 0,
      compoundAllowed: kind === "COMPOUND" ? 1 : 0,
      selectedKind: kind,
      selectedName: kind === "UPGRADE" ? "helmet" : "ringsj",
      selectedExpectedDeltaGold: 1,
    },
  };
}

function prebuff(kind = "UPGRADE") {
  return {
    timestamp: 1,
    enabled: true,
    state: "READY",
    reason: "ECONOMY_PREBUFF_READY",
    characterClass: "merchant",
    demand: {
      kind,
      name: kind === "UPGRADE" ? "helmet" : "ringsj",
      riskPolicyState: "READY",
      unknown: 0,
    },
    selectedSkill: kind === "UPGRADE" ? "massproductionpp" : "massproduction",
    candidates: [],
    policy: {
      preferEnhanced: true,
      buffLifetimeMs: 10000,
      upgradeCompoundSkills: ["massproductionpp", "massproduction"],
      exchangeSkills: ["massexchangepp", "massexchange"],
      exchangeDemandSupported: false,
      arbiterLaneActivationEnabled: false,
      executionEnabled: false,
      valueMutationForced: false,
      sourceRepository: "kaansoral/adventureland_mongodb",
      sourceCommit: "c0f405fd356d99d762ad44644ebfdbab8b4d12e4",
    },
  };
}

function arbiter(enforcementEnabled = false) {
  return {
    timestamp: 1,
    enabled: true,
    state: "IDLE",
    reason: "ECONOMY_ARBITER_IDLE",
    selected: null,
    lanes: [],
    summary: { active: 0, blocked: 0, unknown: 0 },
    policy: {
      laneOrder: [],
      unknownBlocksLowerPriority: true,
      safetyBlocksLowerPriority: true,
      backgroundDynamicScoring: false,
      enforcementEnabled,
      executionEnabled: false,
      valueMutationForced: false,
    },
  };
}

function execution(kind = "UPGRADE") {
  return {
    timestamp: 2,
    state: "CONFIRMED",
    reason: "ECONOMY_PREBUFF_COUPLED_EXECUTION_CONFIRMED",
    busy: false,
    correlationId: "coupled-1",
    activeLane: null,
    kind,
    name: kind === "UPGRADE" ? "helmet" : "ringsj",
    selectedSkill: kind === "UPGRADE" ? "massproductionpp" : "massproduction",
    prebuffAction: {
      id: "skill-1",
      status: "CONFIRMED",
      why: "ECONOMY_PREBUFF_COUPLED_EXECUTION",
      error: null,
    },
    economyAction: {
      id: "economy-1",
      status: "CONFIRMED",
      why: "ECONOMY_ACTION",
      error: null,
    },
    unknownStage: null,
    policy: {
      explicitOneShot: true,
      arbiterEnforcementRequired: true,
      prebuffMustConfirmBeforeEconomy: true,
      revalidateAfterPrebuff: true,
      maxValueMutations: 1,
      blindRetryAllowed: false,
      supportedKinds: ["UPGRADE", "COMPOUND"],
      exchangeSupported: false,
    },
  };
}

function setup({
  kind = "UPGRADE",
  selectedRisk = risk(kind),
  prebuffStatus = prebuff(kind),
  executionStatus = execution(kind),
  mutateInventory = true,
} = {}) {
  const { EconomyPrebuffExecutionLiveTestRunner } = loadRunner();
  let currentRisk = selectedRisk;
  let currentPrebuff = prebuffStatus;
  let currentArbiter = arbiter(false);
  let inventory = [
    { slot: 2, item: { name: "helmet", level: 1 } },
    { slot: 3, item: { name: "ringsj", level: 1 } },
    { slot: 4, item: { name: "ringsj", level: 1 } },
    { slot: 5, item: { name: "ringsj", level: 1 } },
  ];
  let override = null;
  let executeCalls = 0;
  let refreshCalls = 0;
  let now = 1000;

  const runner = new EconomyPrebuffExecutionLiveTestRunner({
    game: {
      inventory: () =>
        inventory.map((entry) => ({
          slot: entry.slot,
          item: entry.item ? { ...entry.item } : null,
        })),
    },
    refreshPlanning() {
      refreshCalls += 1;
    },
    riskPolicy: {
      status: () => currentRisk,
    },
    prebuff: {
      status: () => currentPrebuff,
    },
    arbiter: {
      status: () => currentArbiter,
      tick() {
        currentArbiter = arbiter(
          override?.economyArbiter?.enforcementEnabled === true,
        );
        return currentArbiter;
      },
      setConfigOverride(value) {
        override = value;
      },
      clearConfigOverride() {
        override = null;
      },
    },
    execution: {
      status: () => executionStatus,
      async executeNext() {
        executeCalls += 1;
        if (mutateInventory && executionStatus.state === "CONFIRMED") {
          inventory = inventory.map((entry) =>
            entry.slot === (kind === "UPGRADE" ? 2 : 3)
              ? {
                  ...entry,
                  item: {
                    ...entry.item,
                    level: Number(entry.item?.level || 0) + 1,
                  },
                }
              : entry,
          );
        }
        return executionStatus;
      },
    },
    characterName: () => "My_Merchant",
    now: () => {
      now += 100;
      return now;
    },
    sleep: async () => {},
  });

  return {
    runner,
    counts: () => ({ executeCalls, refreshCalls }),
    setRisk(value) {
      currentRisk = value;
    },
    setPrebuff(value) {
      currentPrebuff = value;
    },
  };
}

test("coupled live runner confirms expected upgrade and one observed mutation", async () => {
  const s = setup();

  const result = await s.runner.run({
    requestId: "live-1",
    expectedKind: "UPGRADE",
    expectedName: "helmet",
    expectedSlots: [2],
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.expectedCandidateMatched, true);
  assert.equal(result.evidence.arbiterEnforcementObserved, true);
  assert.equal(result.evidence.prebuffActionConfirmed, true);
  assert.equal(result.evidence.economyActionConfirmed, true);
  assert.equal(result.evidence.inventoryMutationObserved, true);
  assert.equal(result.scope.maxValueMutations, 1);
  assert.equal(result.scope.blindRetryAllowed, false);
  assert.equal(result.cleanup.arbiterConfigOverrideCleared, true);
  assert.equal(result.cleanup.arbiterEnforcementRestored, true);
  assert.equal(s.counts().executeCalls, 1);
});

test("coupled live runner confirms read-only preflight without arbiter or mutation", async () => {
  const s = setup();

  const result = await s.runner.run({
    requestId: "preflight-1",
    expectedKind: "UPGRADE",
    expectedName: "helmet",
    expectedSlots: [2],
    preflightOnly: true,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_PREFLIGHT_CONFIRMED",
  );
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.irreversibleMutation, false);
  assert.equal(result.scope.prebuffMutationAllowed, false);
  assert.equal(result.scope.upgradeMutationAllowed, false);
  assert.equal(result.scope.compoundMutationAllowed, false);
  assert.equal(result.scope.mutationScope, "read-only-coupled-preflight");
  assert.equal(result.execution, null);
  assert.equal(result.evidence.riskPolicyReady, true);
  assert.equal(result.evidence.expectedCandidateMatched, true);
  assert.equal(result.evidence.prebuffReady, true);
  assert.equal(result.evidence.arbiterEnforcementObserved, false);
  assert.equal(result.evidence.inventoryMutationObserved, false);
  assert.equal(s.counts().executeCalls, 0);
});

test("coupled live runner rejects an unexpected risk candidate before execution", async () => {
  const s = setup();

  const result = await s.runner.run({
    expectedKind: "UPGRADE",
    expectedName: "helmet",
    expectedSlots: [7],
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_PREFLIGHT_BLOCKED",
  );
  assert.equal(result.evidence.expectedCandidateMatched, false);
  assert.equal(s.counts().executeCalls, 0);
});

test("coupled live runner rejects invalid slot cardinality before execution", async () => {
  const s = setup({ kind: "COMPOUND" });

  const result = await s.runner.run({
    expectedKind: "COMPOUND",
    expectedName: "ringsj",
    expectedSlots: [3, 4],
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_EXPECTATION_INVALID",
  );
  assert.equal(s.counts().executeCalls, 0);
});

test("coupled live runner preserves UNKNOWN as terminal without retry", async () => {
  const unknown = {
    ...execution(),
    state: "UNKNOWN_HOLD",
    reason: "ECONOMY_PREBUFF_ECONOMY_OUTCOME_UNKNOWN",
    activeLane: "ECONOMY",
    economyAction: {
      id: "economy-unknown",
      status: "UNKNOWN",
      why: "UPGRADE_POLICY_SELECTED",
      error: "outcome uncertain",
    },
    unknownStage: "ECONOMY",
  };
  const s = setup({ executionStatus: unknown, mutateInventory: false });

  const result = await s.runner.run({
    expectedKind: "UPGRADE",
    expectedName: "helmet",
    expectedSlots: [2],
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY",
  );
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(s.counts().executeCalls, 1);
});

test("confirmed coupled action without observed inventory change is TIMEOUT", async () => {
  const s = setup({ mutateInventory: false });

  const result = await s.runner.run({
    expectedKind: "UPGRADE",
    expectedName: "helmet",
    expectedSlots: [2],
    settleTimeoutMs: 500,
    settlePollMs: 100,
  });

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(
    result.reason,
    "ECONOMY_PREBUFF_EXECUTION_LIVE_CONFIRMED_BUT_MUTATION_NOT_OBSERVED",
  );
  assert.equal(result.evidence.inventoryMutationObserved, false);
  assert.equal(s.counts().executeCalls, 1);
});

test("slot normalization is exact for upgrade and compound expectations", () => {
  const { normalizeEconomyPrebuffExecutionSlots } = loadRunner();

  assert.deepEqual(normalizeEconomyPrebuffExecutionSlots("UPGRADE", [2]), [2]);
  assert.deepEqual(
    normalizeEconomyPrebuffExecutionSlots("COMPOUND", [5, 3, 4]),
    [3, 4, 5],
  );
  assert.equal(normalizeEconomyPrebuffExecutionSlots("UPGRADE", [2, 3]), null);
  assert.equal(
    normalizeEconomyPrebuffExecutionSlots("COMPOUND", [3, 3, 4]),
    null,
  );
});

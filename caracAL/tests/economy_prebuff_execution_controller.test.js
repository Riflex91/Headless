"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadController() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-prebuff-execution-controller.lib.ts",
    ),
  ).EconomyPrebuffExecutionController;
}

function riskSelection(kind = "UPGRADE") {
  return {
    kind,
    name: kind === "UPGRADE" ? "helmet" : "ringsj",
    currentLevel: 1,
    targetLevel: 2,
    itemSlots: kind === "UPGRADE" ? [2] : [3, 4, 5],
    expectedDeltaGold: 100,
    successProbability: 0.9,
    inputValueGold: 1000,
    failureOutcomeValueGold: 500,
    failureLossGold: 500,
    decision: "ALLOW",
    reason: "RISK_POLICY_ALLOWED",
  };
}

function riskStatus(selected = riskSelection()) {
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
    selected,
    decisions: selected ? [selected] : [],
    summary: {
      estimates: selected ? 1 : 0,
      allowed: selected ? 1 : 0,
      blocked: 0,
      unknown: 0,
      upgradeAllowed: selected?.kind === "UPGRADE" ? 1 : 0,
      compoundAllowed: selected?.kind === "COMPOUND" ? 1 : 0,
      selectedKind: selected?.kind || null,
      selectedName: selected?.name || null,
      selectedExpectedDeltaGold: selected?.expectedDeltaGold || null,
    },
  };
}

function prebuffStatus(kind = "UPGRADE") {
  const selected = riskSelection(kind);
  return {
    timestamp: 1,
    enabled: true,
    state: "READY",
    reason: "ECONOMY_PREBUFF_READY",
    characterClass: "merchant",
    demand: {
      kind,
      name: selected.name,
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

function confirmedAction(id, why = "CONFIRMED") {
  return {
    id,
    module: "test",
    action: "TEST",
    why,
    correlationId: "corr",
    createdAt: 1,
    status: "CONFIRMED",
  };
}

function setup(options = {}) {
  const EconomyPrebuffExecutionController = loadController();
  const state = {
    risk: options.risk || riskStatus(),
    prebuff: options.prebuff || prebuffStatus(),
    upgrade: {
      timestamp: 1,
      enabled: true,
      state: "READY",
      reason: "UPGRADE_CANDIDATE_READY",
      executionMode: "EXPLICIT_ONE_SHOT",
      selected: {
        itemSlot: 2,
        name: "helmet",
        currentLevel: 1,
        maxLevel: 7,
        scrollName: "scroll0",
        scrollSlot: 9,
        offeringSlot: null,
        reason: "UPGRADE_POLICY_ELIGIBLE",
      },
      candidates: [],
      decisions: [],
      unknownHold: null,
      lastAction: null,
      summary: {
        upgradeDispositionItems: 1,
        protectedUpgradeItems: 0,
        eligibleCandidates: 1,
        scrollPolicyLevels: 1,
      },
    },
    compound: {
      timestamp: 1,
      enabled: true,
      state: "READY",
      reason: "COMPOUND_CANDIDATE_READY",
      executionMode: "EXPLICIT_ONE_SHOT",
      selected: {
        itemSlots: [3, 4, 5],
        name: "ringsj",
        currentLevel: 1,
        maxLevel: 7,
        itemGrade: 0,
        scrollName: "cscroll0",
        scrollSlot: 10,
        offeringSlot: null,
        reason: "COMPOUND_POLICY_ELIGIBLE",
      },
      candidates: [],
      decisions: [],
      unknownHold: null,
      lastAction: null,
      summary: {
        compoundDispositionItems: 3,
        protectedCompoundItems: 0,
        eligibleCandidates: 1,
        scrollPolicyGrades: 1,
      },
    },
  };

  let refreshes = 0;
  let skillCalls = 0;
  let upgradeCalls = 0;
  let compoundCalls = 0;
  const authorizedLanes = [];
  let arbiterTicks = 0;
  const events = [];

  const controller = new EconomyPrebuffExecutionController(
    () => {
      refreshes += 1;
      options.onRefresh?.(state, refreshes);
    },
    { status: () => state.prebuff },
    { status: () => state.risk },
    {
      tick() {
        arbiterTicks += 1;
      },
      authorize(lane) {
        authorizedLanes.push(lane);
        return options.authorize
          ? options.authorize(lane, authorizedLanes.length)
          : {
              enforced: true,
              allowed: true,
              lane,
              selectedLane: lane,
              state: "READY",
              reason: "ECONOMY_ARBITER_LANE_AUTHORIZED",
            };
      },
    },
    {
      async useSkill(request) {
        skillCalls += 1;
        if (options.useSkill) return options.useSkill(request, skillCalls);
        return confirmedAction("skill-1", request.why);
      },
    },
    {
      status: () => state.upgrade,
      async executeNext() {
        upgradeCalls += 1;
        if (options.executeUpgrade) {
          state.upgrade = await options.executeUpgrade(state, upgradeCalls);
        } else {
          state.upgrade = {
            ...state.upgrade,
            lastAction: {
              id: "upgrade-1",
              status: "CONFIRMED",
              why: "UPGRADE_POLICY_SELECTED",
              error: null,
              itemSlot: 2,
              name: "helmet",
              fromLevel: 1,
              scrollSlot: 9,
              scrollName: "scroll0",
              upgradeSucceeded: true,
            },
          };
        }
        return state.upgrade;
      },
    },
    {
      status: () => state.compound,
      async executeNext() {
        compoundCalls += 1;
        state.compound = {
          ...state.compound,
          lastAction: {
            id: "compound-1",
            status: "CONFIRMED",
            why: "COMPOUND_POLICY_SELECTED",
            error: null,
            itemSlots: [3, 4, 5],
            name: "ringsj",
            fromLevel: 1,
            scrollSlot: 10,
            scrollName: "cscroll0",
            compoundSucceeded: true,
          },
        };
        return state.compound;
      },
    },
    {
      now: () => 1000 + refreshes,
      nextCorrelationId: () => "economy-prebuff-coupled-1",
      onEvent: (event) => events.push(event),
    },
  );

  return {
    controller,
    state,
    events,
    authorizedLanes,
    arbiterTicks: () => arbiterTicks,
    counts: () => ({
      refreshes,
      skillCalls,
      upgradeCalls,
      compoundCalls,
    }),
  };
}

test("coupled executor confirms exactly one prebuff then one upgrade", async () => {
  const s = setup();

  const status = await s.controller.executeNext();

  assert.equal(status.state, "CONFIRMED");
  assert.equal(status.reason, "ECONOMY_PREBUFF_COUPLED_EXECUTION_CONFIRMED");
  assert.equal(status.kind, "UPGRADE");
  assert.equal(status.selectedSkill, "massproductionpp");
  assert.equal(status.prebuffAction.status, "CONFIRMED");
  assert.equal(status.economyAction.status, "CONFIRMED");
  assert.equal(status.activeLane, null);
  assert.deepEqual(s.authorizedLanes, ["ECONOMY_PREBUFF", "ECONOMY"]);
  assert.equal(s.arbiterTicks(), 2);
  assert.deepEqual(s.counts(), {
    refreshes: 2,
    skillCalls: 1,
    upgradeCalls: 1,
    compoundCalls: 0,
  });
  assert.equal(status.policy.maxValueMutations, 1);
  assert.equal(status.policy.blindRetryAllowed, false);
});

test("coupled executor confirms compound without invoking upgrade", async () => {
  const selected = riskSelection("COMPOUND");
  const s = setup({
    risk: riskStatus(selected),
    prebuff: prebuffStatus("COMPOUND"),
  });

  const status = await s.controller.executeNext();

  assert.equal(status.state, "CONFIRMED");
  assert.equal(status.kind, "COMPOUND");
  assert.equal(status.economyAction.id, "compound-1");
  assert.deepEqual(s.counts(), {
    refreshes: 2,
    skillCalls: 1,
    upgradeCalls: 0,
    compoundCalls: 1,
  });
});

test("UNKNOWN prebuff is held and never blindly retried", async () => {
  const s = setup({
    useSkill(request) {
      return {
        ...confirmedAction("skill-unknown", request.why),
        status: "UNKNOWN",
        error: "socket outcome uncertain",
      };
    },
  });

  let status = await s.controller.executeNext();
  assert.equal(status.state, "UNKNOWN_HOLD");
  assert.equal(status.unknownStage, "PREBUFF");
  assert.equal(status.activeLane, "ECONOMY_PREBUFF");
  assert.deepEqual(s.counts(), {
    refreshes: 1,
    skillCalls: 1,
    upgradeCalls: 0,
    compoundCalls: 0,
  });

  status = await s.controller.executeNext();
  assert.equal(status.state, "UNKNOWN_HOLD");
  assert.deepEqual(s.counts(), {
    refreshes: 1,
    skillCalls: 1,
    upgradeCalls: 0,
    compoundCalls: 0,
  });
});

test("post-prebuff Risk Policy drift blocks the value mutation", async () => {
  const s = setup({
    onRefresh(state, count) {
      if (count === 2) {
        state.risk = {
          ...riskStatus(null),
          state: "BLOCKED",
          reason: "RISK_POLICY_ALL_CANDIDATES_BLOCKED",
        };
      }
    },
  });

  const status = await s.controller.executeNext();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_PREBUFF_REVALIDATION_FAILED");
  assert.deepEqual(s.counts(), {
    refreshes: 2,
    skillCalls: 1,
    upgradeCalls: 0,
    compoundCalls: 0,
  });
});

test("Arbiter enforcement is required before any prebuff dispatch", async () => {
  const s = setup({
    authorize(lane) {
      return {
        enforced: false,
        allowed: true,
        lane,
        selectedLane: lane,
        state: "READY",
        reason: "ECONOMY_ARBITER_ENFORCEMENT_DISABLED",
      };
    },
  });

  const status = await s.controller.executeNext();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_PREBUFF_ARBITER_ENFORCEMENT_REQUIRED");
  assert.deepEqual(s.counts(), {
    refreshes: 1,
    skillCalls: 0,
    upgradeCalls: 0,
    compoundCalls: 0,
  });
});

test("higher-priority Arbiter lane blocks before the prebuff action", async () => {
  const s = setup({
    authorize(lane) {
      return {
        enforced: true,
        allowed: false,
        lane,
        selectedLane: "MERRIT",
        state: "READY",
        reason: "ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED",
      };
    },
  });

  const status = await s.controller.executeNext();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED");
  assert.equal(s.counts().skillCalls, 0);
});

test("UNKNOWN economy outcome is held and never causes a second value mutation", async () => {
  const s = setup({
    async executeUpgrade(state) {
      return {
        ...state.upgrade,
        state: "UNKNOWN_HOLD",
        reason: "UPGRADE_UNKNOWN_HOLD_ACTIVE",
        lastAction: {
          id: "upgrade-unknown",
          status: "UNKNOWN",
          why: "UPGRADE_POLICY_SELECTED",
          error: "outcome uncertain",
          itemSlot: 2,
          name: "helmet",
          fromLevel: 1,
          scrollSlot: 9,
          scrollName: "scroll0",
          upgradeSucceeded: null,
        },
      };
    },
  });

  let status = await s.controller.executeNext();
  assert.equal(status.state, "UNKNOWN_HOLD");
  assert.equal(status.unknownStage, "ECONOMY");
  assert.equal(status.activeLane, "ECONOMY");
  assert.equal(s.counts().upgradeCalls, 1);

  status = await s.controller.executeNext();
  assert.equal(status.state, "UNKNOWN_HOLD");
  assert.equal(s.counts().skillCalls, 1);
  assert.equal(s.counts().upgradeCalls, 1);
});

test("candidate mismatch blocks before consuming the one-shot buff", async () => {
  const s = setup();
  s.state.upgrade = {
    ...s.state.upgrade,
    selected: {
      ...s.state.upgrade.selected,
      itemSlot: 7,
    },
  };

  const status = await s.controller.executeNext();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_PREBUFF_CANDIDATE_MISMATCH");
  assert.equal(s.counts().skillCalls, 0);
  assert.equal(s.counts().upgradeCalls, 0);
});

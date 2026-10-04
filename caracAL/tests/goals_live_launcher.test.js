"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GOAL_TYPES,
  evaluateGoals,
  formatCompactResult,
  goalEvidence,
  goalsEvidence,
  observerRuntimeEnv,
  readState,
} = require("../scripts/run_goals_live_e2e");

function summaryFor(goals) {
  return {
    total: goals.length,
    active: goals.filter((goal) => goal.status === "ACTIVE").length,
    planned: goals.filter((goal) => goal.state === "PLANNED").length,
    blocked: goals.filter((goal) => goal.state === "BLOCKED").length,
    complete: goals.filter((goal) => goal.state === "COMPLETE").length,
    paused: goals.filter((goal) => goal.state === "PAUSED").length,
    cancelled: goals.filter((goal) => goal.state === "CANCELLED").length,
    invalid: goals.filter((goal) => goal.state === "INVALID").length,
    byType: Object.fromEntries(
      GOAL_TYPES.map((type) => [
        type,
        goals.filter((goal) => goal.type === type).length,
      ]),
    ),
  };
}

function policy() {
  return {
    intentExecutionSeparated: true,
    manualStopRespected: true,
    fullAutonomyHandoffOnly: true,
    directGameplayMutationAllowed: false,
    directValueMutationAllowed: false,
    directLifecycleMutationAllowed: false,
  };
}

function goal(overrides = {}) {
  return {
    goalId: "farm-gem0",
    characterName: null,
    status: "ACTIVE",
    type: "FARM_ITEM",
    priority: 90,
    target: {
      itemName: "gem0",
      quantity: 10,
      characterName: null,
    },
    metadata: {},
    updatedAt: 1000,
    state: "PLANNED",
    reason: "GOAL_PLAN_READY",
    readOnly: true,
    executionEnabled: false,
    preconditions: [
      {
        ready: true,
        code: "NO_FIXED_CHARACTER",
        detail: null,
      },
    ],
    progress: {
      state: "IN_PROGRESS",
      current: 3,
      target: 10,
      ratio: 0.3,
    },
    completion: {
      met: false,
      source: null,
      criteria: [
        {
          id: "ITEM_QUANTITY",
          description: "Own 10 x gem0",
          status: "UNMET",
          observed: 3,
          target: 10,
        },
      ],
    },
    tasks: [
      {
        taskId: "farm-gem0:1",
        kind: "VERIFY_INVENTORY",
        subsystem: "InventoryIntelligence",
        description: "Measure account inventory for gem0",
        status: "PLANNED",
        executionAllowed: false,
        mutationDispatched: false,
      },
      {
        taskId: "farm-gem0:2",
        kind: "SELECT_FARM_TARGET",
        subsystem: "FarmIntelligence",
        description: "Select farming opportunity for gem0",
        status: "PLANNED",
        executionAllowed: false,
        mutationDispatched: false,
      },
    ],
    errors: [],
    ...overrides,
  };
}

function snapshot(goals = []) {
  const invalid = goals.some((entry) => entry.state === "INVALID");
  return {
    goals: {
      timestamp: 123456,
      state: goals.length === 0 ? "EMPTY" : invalid ? "PARTIAL" : "READY",
      reason:
        goals.length === 0
          ? "GOALS_EMPTY"
          : invalid
            ? "GOALS_PARTIAL_INVALID"
            : "GOAL_PLANS_READY",
      readOnly: true,
      executionEnabled: false,
      gameplayMutationDispatched: false,
      valueMutationDispatched: false,
      lifecycleMutationDispatched: false,
      goals,
      summary: summaryFor(goals),
      policy: policy(),
    },
  };
}

test("Goals live E2E accepts a structurally safe EMPTY projection", () => {
  const result = evaluateGoals(snapshot());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GOALS_LIVE_E2E_CONFIRMED");
  assert.equal(result.evidence.state, "EMPTY");
  assert.equal(result.evidence.goals, 0);
  assert.equal(result.evidence.emptyIsValid, true);
  assert.equal(result.evidence.summaryValid, true);
  assert.equal(result.evidence.safetyValid, true);
  assert.equal(result.scope.dashboardGetOnly, true);
  assert.equal(result.scope.mutationDispatched, false);
});

test("Goals live E2E validates populated read-only Goal plans", () => {
  const goals = [
    goal(),
    goal({
      goalId: "boss-dragold",
      type: "PREPARE_BOSS",
      priority: 70,
      state: "BLOCKED",
      reason: "PHASE20_ENCOUNTER_PLANNING_DEFERRED",
      progress: {
        state: "UNKNOWN",
        current: null,
        target: 1,
        ratio: null,
      },
      completion: {
        met: false,
        source: null,
        criteria: [
          {
            id: "ROSTER_CAPABILITIES",
            description: "Account satisfies declared capability requirements",
            status: "MET",
            observed: { missingCapabilities: [] },
            target: ["DPS"],
          },
          {
            id: "ENCOUNTER_PLAN",
            description: "Phase 20 encounter plan exists",
            status: "UNKNOWN",
            observed: null,
            target: "dragold",
          },
        ],
      },
      tasks: [
        {
          taskId: "boss-dragold:1",
          kind: "ASSESS_BOSS_ROSTER",
          subsystem: "AccountStrategy",
          description: "Assess account roster for dragold",
          status: "BLOCKED",
          executionAllowed: false,
          mutationDispatched: false,
        },
      ],
    }),
  ];

  const evidence = goalsEvidence(snapshot(goals));

  assert.equal(evidence.state, "READY");
  assert.equal(evidence.goals, 2);
  assert.equal(evidence.active, 2);
  assert.equal(evidence.planned, 1);
  assert.equal(evidence.blocked, 1);
  assert.equal(evidence.goalStructureValid, true);
  assert.equal(evidence.byTypeValid, true);
  assert.equal(evidence.summaryValid, true);
  assert.equal(evidence.safetyValid, true);
  assert.equal(evidence.complete, true);
});

test("Goals live E2E rejects any direct execution or mutation permission", () => {
  const source = snapshot([goal()]);
  source.goals.executionEnabled = true;
  source.goals.policy.directGameplayMutationAllowed = true;

  const result = evaluateGoals(source);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "GOALS_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.safetyValid, false);
});

test("Goal evidence rejects task dispatch or malformed completion evidence", () => {
  const source = goal();
  source.tasks[0].mutationDispatched = true;
  source.completion.criteria[0].status = "DONE";

  const evidence = goalEvidence(source);

  assert.equal(evidence.valid, false);
  assert.equal(evidence.completionValid, false);
  assert.equal(evidence.tasksValid, false);
  assert.equal(evidence.directExecutionBlocked, false);
});

test("Goals live E2E rejects inconsistent summary counts", () => {
  const source = snapshot([goal()]);
  source.goals.summary.planned = 99;

  const evidence = goalsEvidence(source);

  assert.equal(evidence.summaryValid, false);
  assert.equal(evidence.complete, false);
  assert.equal(evaluateGoals(source).outcome, "FAIL");
});

test("Goals compact output exposes read-only no-mutation scope", () => {
  const output = formatCompactResult(evaluateGoals(snapshot([goal()])));

  assert.match(output, /Goals Live E2E/);
  assert.match(output, /Outcome: PASS/);
  assert.match(output, /State: READY/);
  assert.match(output, /Goals: 1/);
  assert.match(output, /Goal structure valid: yes/);
  assert.match(output, /Summary valid: yes/);
  assert.match(output, /Safety policy valid: yes/);
  assert.match(output, /Read-only: yes/);
  assert.match(output, /Dashboard GET only: yes/);
  assert.match(output, /Lifecycle mutation dispatched: no/);
  assert.match(output, /Gameplay mutation dispatched: no/);
  assert.match(output, /Value mutation dispatched: no/);
});

test("Goals observer bootstrap forces zero-character supervisor mode", () => {
  const env = observerRuntimeEnv({
    TEST_ENV: "kept",
    CARACAL_OBSERVER_ONLY: "0",
  });

  assert.equal(env.TEST_ENV, "kept");
  assert.equal(env.CARACAL_OBSERVER_ONLY, "1");
});

test("Goals live state reader performs GET only", async () => {
  const calls = [];
  const expected = snapshot();

  const observed = await readState({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return expected;
        },
      };
    },
  });

  assert.deepEqual(observed, expected);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/headless\/api\/state$/);
  assert.equal(calls[0].options.method, "GET");
});

test("Goals live launcher has no POST, control or gameplay mutation path", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_goals_live_e2e.js"),
    "utf8",
  );

  assert.match(source, /\/headless\/api\/state/);
  assert.match(source, /method:\s*"GET"/);
  assert.match(source, /ensureDashboardAvailable/);
  assert.match(source, /CARACAL_OBSERVER_ONLY:\s*"1"/);
  assert.doesNotMatch(source, /method:\s*"POST"/);
  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /desired_runtime_state/);
  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /socket\.emit/);
});

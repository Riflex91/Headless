"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

const {
  GoalAdapterDispatchSupervisor,
  requestFingerprint,
  resultRequiresUnknownHold,
} = require("../src/GoalAdapterDispatchSupervisor");

function adapterRequest(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "goal-1",
    taskId: "goal-1:3",
    kind: "FARM_ITEM",
    bridge: "MaterialGatheringTaskRunner",
    runtimeMethod: "runMaterialGatherTask",
    characterName: "My_Ranger1",
    arguments: {
      itemName: "spidersilk",
      quantity: 2,
      monsterType: "spider",
      recipient: "My_Merchant",
      recipientPosition: { map: "main", x: 10, y: 20 },
    },
    dispatchAllowed: false,
    dispatchImplemented: false,
    ...overrides,
  };
}

function executionDecision(overrides = {}) {
  return {
    enabled: true,
    state: "READY",
    reason: "GOAL_EXECUTION_ADAPTER_DISPATCH_READY",
    dispatchAllowed: true,
    dispatchImplemented: false,
    mutationDispatched: false,
    action: {
      type: "GOAL_HANDOFF",
      goalId: "goal-1",
      taskId: "goal-1:3",
      kind: "FARM_ITEM",
      requiresAdapterDispatcher: true,
    },
    ...overrides,
  };
}

function adapterPlan(request = adapterRequest(), overrides = {}) {
  return {
    state: "READY",
    reason: "GOAL_ADAPTER_FARM_REQUEST_READY",
    dispatchAllowed: false,
    dispatchImplemented: false,
    requestDispatched: false,
    mutationDispatched: false,
    request,
    ...overrides,
  };
}

function preflightResult(request = adapterRequest(), overrides = {}) {
  return {
    requestId: "preflight-1",
    outcome: "PASS",
    reason: "GOAL_ADAPTER_PREFLIGHT_FARM_CONFIRMED",
    goalId: request.goalId,
    taskId: request.taskId,
    kind: request.kind,
    character: {
      name: request.characterName,
      ctype: "ranger",
    },
    evidence: {},
    scope: {
      readOnly: true,
      ipcResponseOnly: true,
      gameplayMutationDispatched: false,
      valueMutationDispatched: false,
      lifecycleMutationDispatched: false,
      blindRetryAllowed: false,
    },
    cleanup: {
      farmOverrideCleared: true,
    },
    ...overrides,
  };
}

function dispatchResult(request = adapterRequest(), overrides = {}) {
  return {
    requestId: "dispatch-1",
    outcome: "PASS",
    reason: "GOAL_ADAPTER_DISPATCH_FARM_CONFIRMED",
    goalId: request.goalId,
    taskId: request.taskId,
    kind: request.kind,
    preflight: preflightResult(request),
    execution: {},
    scope: {
      authorized: true,
      preflightRequired: true,
      maxExecutionInvocations: 1,
      blindRetryUsed: false,
      mutationPathInvoked: true,
    },
    cleanup: {
      craftOverrideCleared: true,
      craftPlanningRefreshed: false,
    },
    ...overrides,
  };
}

function setup({
  decision = executionDecision(),
  request = adapterRequest(),
  plan = null,
  preflight = null,
  character = {
    account_owned: true,
    instance: { pid: 1 },
    connected: true,
    bot_runtime_started_at: 123,
  },
  sendResult = true,
  initialUnknownHold = null,
} = {}) {
  const state = {
    decision,
    request,
    plan: plan || adapterPlan(request),
  };
  const sent = [];
  const emitted = [];
  const holds = [];
  const persistedResults = [];
  const preflights = [];
  const timers = new Map();
  let timerSequence = 0;

  const supervisor = new GoalAdapterDispatchSupervisor({
    getExecutionDecision: () => state.decision,
    getAdapterPlan: () => state.plan,
    runPreflight: async (input) => {
      preflights.push(input);
      return (
        preflight || {
          requestId: "supervisor-preflight-1",
          characterName: input.characterName,
          result: preflightResult(input.request),
          error: null,
          scope: {
            readOnly: true,
            retryUsed: false,
            lifecycleMutationDispatched: false,
            gameplayMutationDispatched: false,
            valueMutationDispatched: false,
          },
        }
      );
    },
    getCharacter: (name) => (name === "My_Ranger1" ? character : null),
    send: (target, message) => {
      sent.push({ target, message });
      return sendResult;
    },
    emit: (event, characterName, details) => {
      emitted.push({ event, characterName, details });
    },
    initialUnknownHold,
    persistUnknownHold: async (hold) => {
      holds.push(hold);
    },
    persistLastResult: async (result) => {
      persistedResults.push(result);
    },
    timeoutMs: 5000,
    now: () => 1000,
    setTimer: (fn, ms) => {
      timerSequence += 1;
      timers.set(timerSequence, { fn, ms });
      return timerSequence;
    },
    clearTimer: (id) => timers.delete(id),
  });

  return {
    supervisor,
    state,
    sent,
    emitted,
    holds,
    persistedResults,
    preflights,
    timers,
  };
}

async function start(supervisor, input = {}) {
  const pending = supervisor.run({
    expectedGoalId: "goal-1",
    expectedTaskId: "goal-1:3",
    ...input,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { pending };
}

test("request fingerprint is stable across key ordering", () => {
  const a = adapterRequest();
  const b = {
    taskId: a.taskId,
    goalId: a.goalId,
    arguments: {
      quantity: 2,
      itemName: "spidersilk",
      recipientPosition: { y: 20, x: 10, map: "main" },
      recipient: "My_Merchant",
      monsterType: "spider",
    },
    dispatchImplemented: false,
    characterName: "My_Ranger1",
    kind: "FARM_ITEM",
    dispatchAllowed: false,
    runtimeMethod: "runMaterialGatherTask",
    bridge: "MaterialGatheringTaskRunner",
    type: "GOAL_RUNTIME_METHOD",
    version: 1,
  };

  assert.equal(requestFingerprint(a), requestFingerprint(b));
});

test("disabled execution and stale identity block before preflight", async () => {
  const disabled = setup({
    decision: executionDecision({
      enabled: false,
      state: "DISABLED",
      dispatchAllowed: false,
    }),
  });

  await assert.rejects(
    () =>
      disabled.supervisor.run({
        expectedGoalId: "goal-1",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_EXECUTION_DISABLED",
  );
  assert.deepEqual(disabled.preflights, []);
  assert.deepEqual(disabled.sent, []);

  const stale = setup();
  await assert.rejects(
    () =>
      stale.supervisor.run({
        expectedGoalId: "other",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_STALE_IDENTITY",
  );
  assert.deepEqual(stale.preflights, []);
  assert.deepEqual(stale.sent, []);
});

test("explicit target runtime character is required", async () => {
  const request = adapterRequest({ characterName: null });
  const s = setup({
    request,
    plan: adapterPlan(request),
  });

  await assert.rejects(
    () =>
      s.supervisor.run({
        expectedGoalId: "goal-1",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_CHARACTER_REQUIRED",
  );
  assert.equal(s.sent.length, 0);
});

test("supervisor preflight must PASS exact identity before dispatch", async () => {
  const request = adapterRequest();
  const blocked = setup({
    request,
    preflight: {
      requestId: "preflight-1",
      characterName: "My_Ranger1",
      result: preflightResult(request, {
        outcome: "BLOCKED",
        reason: "TEST_BLOCKED",
      }),
      error: null,
    },
  });

  await assert.rejects(
    () =>
      blocked.supervisor.run({
        expectedGoalId: "goal-1",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_PREFLIGHT_NOT_CONFIRMED",
  );
  assert.equal(blocked.preflights.length, 1);
  assert.equal(blocked.sent.length, 0);
});

test("request drift after preflight blocks before dispatch", async () => {
  const s = setup();
  let reads = 0;
  const original = s.supervisor.getAdapterPlan;
  s.supervisor.getAdapterPlan = () => {
    reads += 1;
    if (reads < 2) return original();
    return adapterPlan(
      adapterRequest({
        arguments: {
          ...adapterRequest().arguments,
          quantity: 3,
        },
      }),
    );
  };

  await assert.rejects(
    () =>
      s.supervisor.run({
        expectedGoalId: "goal-1",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_REQUEST_DRIFT",
  );
  assert.equal(s.preflights.length, 1);
  assert.equal(s.sent.length, 0);
});

test("confirmed preflight sends exactly one authorized runtime dispatch", async () => {
  const s = setup();
  const { pending: promise } = await start(s.supervisor);

  assert.equal(s.preflights.length, 1);
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.sent[0].message, {
    type: "goal_adapter_dispatch",
    request_id: "goal-adapter-dispatch-1000-1",
    request: adapterRequest(),
    authorization: {
      goal_execution_enabled: true,
      one_shot: true,
      preflight_required: true,
    },
  });
  assert.equal(s.supervisor.snapshot().pending, 1);
  assert.equal(s.supervisor.snapshot().retryEnabled, false);
  assert.equal(s.supervisor.snapshot().automaticReconcileEnabled, false);

  const handled = await s.supervisor.handleResult("My_Ranger1", {
    type: "goal_adapter_dispatch_result",
    request_id: "goal-adapter-dispatch-1000-1",
    result: dispatchResult(),
  });
  assert.equal(handled, true);

  const response = await promise;
  assert.equal(response.result.outcome, "PASS");
  assert.equal(response.scope.explicitOneShot, true);
  assert.equal(response.scope.preflightVerified, true);
  assert.equal(response.scope.retryUsed, false);
  assert.equal(response.scope.unknownHoldActive, false);
  assert.equal(s.persistedResults.length, 1);
});

test("UNKNOWN result persists hold and blocks an exact retry", async () => {
  const s = setup();
  const { pending: promise } = await start(s.supervisor);

  await s.supervisor.handleResult("My_Ranger1", {
    type: "goal_adapter_dispatch_result",
    request_id: "goal-adapter-dispatch-1000-1",
    result: dispatchResult(adapterRequest(), {
      outcome: "UNKNOWN",
      reason: "GOAL_ADAPTER_DISPATCH_CRAFT_UNKNOWN",
    }),
  });

  const response = await promise;
  assert.equal(response.result.outcome, "UNKNOWN");
  assert.equal(response.scope.unknownHoldActive, true);
  assert.equal(s.holds.at(-1).active, true);

  await assert.rejects(
    () =>
      s.supervisor.run({
        expectedGoalId: "goal-1",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_UNKNOWN_HOLD_ACTIVE",
  );
  assert.equal(s.sent.length, 1);
});

test("persisted UNKNOWN hold survives supervisor recreation", async () => {
  const request = adapterRequest();
  const hold = {
    active: true,
    requestId: "old-dispatch",
    goalId: request.goalId,
    taskId: request.taskId,
    kind: request.kind,
    characterName: request.characterName,
    requestFingerprint: requestFingerprint(request),
    reason: "GOAL_ADAPTER_DISPATCH_TIMEOUT_OUTCOME_UNKNOWN",
  };
  const s = setup({ initialUnknownHold: hold });

  assert.equal(s.supervisor.snapshot().unknownHold.requestId, "old-dispatch");
  await assert.rejects(
    () =>
      s.supervisor.run({
        expectedGoalId: "goal-1",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_UNKNOWN_HOLD_ACTIVE",
  );
  assert.equal(s.sent.length, 0);
});

test("a different current request supersedes the old unknown hold", async () => {
  const oldRequest = adapterRequest();
  const newRequest = adapterRequest({
    arguments: {
      ...oldRequest.arguments,
      quantity: 3,
    },
  });
  const s = setup({
    request: newRequest,
    plan: adapterPlan(newRequest),
    initialUnknownHold: {
      active: true,
      requestId: "old-dispatch",
      goalId: oldRequest.goalId,
      taskId: oldRequest.taskId,
      kind: oldRequest.kind,
      characterName: oldRequest.characterName,
      requestFingerprint: requestFingerprint(oldRequest),
      reason: "GOAL_ADAPTER_DISPATCH_TIMEOUT_OUTCOME_UNKNOWN",
    },
  });

  const { pending: promise } = await start(s.supervisor);
  assert.equal(s.holds[0].active, false);
  assert.equal(
    s.holds[0].reason,
    "GOAL_ADAPTER_DISPATCH_HOLD_SUPERSEDED",
  );
  assert.equal(s.sent.length, 1);

  await s.supervisor.handleResult("My_Ranger1", {
    request_id: "goal-adapter-dispatch-1000-1",
    result: dispatchResult(newRequest),
  });
  await promise;
});

test("dispatch timeout persists unknown hold before rejecting", async () => {
  const s = setup();
  const { pending: promise } = await start(s.supervisor);
  const [timer] = [...s.timers.values()];

  timer.fn();

  await assert.rejects(
    () => promise,
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_OUTCOME_UNKNOWN",
  );
  assert.equal(s.holds.at(-1).active, true);
  assert.equal(
    s.holds.at(-1).reason,
    "GOAL_ADAPTER_DISPATCH_TIMEOUT_OUTCOME_UNKNOWN",
  );
  assert.equal(s.supervisor.snapshot().pending, 0);
  assert.notEqual(s.supervisor.snapshot().unknownHold, null);
});

test("runtime result error is treated as unknown and persisted", async () => {
  const s = setup();
  const { pending: promise } = await start(s.supervisor);

  await s.supervisor.handleResult("My_Ranger1", {
    request_id: "goal-adapter-dispatch-1000-1",
    error: "socket closed",
  });

  await assert.rejects(
    () => promise,
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_OUTCOME_UNKNOWN",
  );
  assert.equal(s.holds.at(-1).active, true);
  assert.equal(
    s.holds.at(-1).reason,
    "GOAL_ADAPTER_DISPATCH_RUNTIME_RESULT_ERROR",
  );
});

test("FAIL after mutation path requires unknown hold", () => {
  assert.equal(
    resultRequiresUnknownHold(
      dispatchResult(adapterRequest(), {
        outcome: "FAIL",
        scope: {
          authorized: true,
          preflightRequired: true,
          maxExecutionInvocations: 1,
          blindRetryUsed: false,
          mutationPathInvoked: true,
        },
      }),
    ),
    true,
  );
  assert.equal(
    resultRequiresUnknownHold(
      dispatchResult(adapterRequest(), {
        outcome: "BLOCKED",
        scope: {
          mutationPathInvoked: false,
        },
      }),
    ),
    false,
  );
});

test("only one dispatch can be in flight globally", async () => {
  const s = setup();
  const { pending: first } = await start(s.supervisor);

  await assert.rejects(
    () =>
      s.supervisor.run({
        expectedGoalId: "goal-1",
        expectedTaskId: "goal-1:3",
      }),
    (error) => error.code === "GOAL_ADAPTER_DISPATCH_ALREADY_RUNNING",
  );
  assert.equal(s.sent.length, 1);

  await s.supervisor.handleResult("My_Ranger1", {
    request_id: "goal-adapter-dispatch-1000-1",
    result: dispatchResult(),
  });
  await first;
});

test("Coordinator and dashboard expose only current-plan explicit one-shot dispatch", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(coordinator, /GoalAdapterDispatchSupervisor/);
  assert.match(
    coordinator,
    /getGoalDispatchState:\s*\(\)\s*=>\s*\n?\s*goal_adapter_dispatch_supervisor\.snapshot\(\)/,
  );
  assert.match(
    coordinator,
    /runGoalAdapterDispatch:\s*\(\{ expectedGoalId, expectedTaskId \}\)\s*=>/,
  );
  assert.match(coordinator, /case "goal_adapter_dispatch_result"/);
  assert.match(coordinator, /dispatch_unknown_hold/);
  assert.match(coordinator, /dispatch_last_result/);
  assert.match(
    coordinator,
    /goal_adapter_dispatch_supervisor\.cancelAll/,
  );
  assert.match(
    coordinator,
    /goal_execution_automatic_reconcile_enabled:\s*false/,
  );
  assert.doesNotMatch(coordinator, /function reconcile_goal_execution/);

  assert.match(dashboard, /"\/headless\/api\/goals\/adapter-dispatch"/);
  const routeStart = dashboard.indexOf(
    '"/headless/api/goals/adapter-dispatch"',
  );
  const routeEnd = dashboard.indexOf(
    'router.get("/headless/api/characters/:name/config"',
    routeStart,
  );
  assert.ok(routeStart >= 0);
  assert.ok(routeEnd > routeStart);
  const route = dashboard.slice(routeStart, routeEnd);
  assert.match(route, /expectedGoalId:\s*req\.body\?\.expectedGoalId/);
  assert.match(route, /expectedTaskId:\s*req\.body\?\.expectedTaskId/);
  assert.doesNotMatch(route, /req\.body\?\.request/);
  assert.doesNotMatch(route, /characterName:\s*req\.body/);
});

test("dispatch supervisor contains no lifecycle control or retry loop", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalAdapterDispatchSupervisor.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /controlRotation/);
  assert.doesNotMatch(source, /restart_character/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /while\s*\(/);
  assert.doesNotMatch(source, /goal_adapter_dispatch[^\n]*retry/i);
  assert.match(source, /automaticReconcileEnabled: false/);
  assert.match(source, /retryEnabled: false/);
});

test("temporary Phase 19.10 formatter probe", async () => {
  const targets = [
    path.join(__dirname, "..", "src", "GoalAdapter.js"),
    path.join(__dirname, "..", "src", "GoalAdapterDispatchSupervisor.js"),
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    path.join(__dirname, "goal_adapter_dispatch_supervisor.test.js"),
  ];

  for (const target of targets) {
    const source = fs.readFileSync(target, "utf8");
    const formatted = await prettier.format(source, { filepath: target });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase19-10-prettier-"));
    const temp = path.join(tempDir, path.basename(target));

    try {
      fs.writeFileSync(temp, formatted);
      let diff = "";
      try {
        childProcess.execFileSync("diff", ["-u", target, temp], {
          encoding: "utf8",
        });
      } catch (error) {
        diff = String(error.stdout || "");
      }
      console.log("PHASE19_10_PRETTIER_DIFF", path.basename(target));
      console.log(diff || "NO_DIFF");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

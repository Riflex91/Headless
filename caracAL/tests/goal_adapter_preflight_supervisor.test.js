"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

const {
  GoalAdapterPreflightSupervisor,
  runtimeReady,
} = require("../src/GoalAdapterPreflightSupervisor");

function request(overrides = {}) {
  return {
    version: 1,
    type: "GOAL_RUNTIME_METHOD",
    goalId: "farm-gem0",
    taskId: "farm-gem0:3",
    kind: "FARM_ITEM",
    characterName: "My_Ranger1",
    dispatchAllowed: false,
    dispatchImplemented: false,
    ...overrides,
  };
}

function setup({
  character = {
    account_owned: true,
    instance: { pid: 1 },
    connected: true,
    bot_runtime_started_at: 123,
  },
  sendResult = true,
} = {}) {
  const sent = [];
  const emitted = [];
  const timers = new Map();
  let timerSequence = 0;

  const supervisor = new GoalAdapterPreflightSupervisor({
    getCharacter: (name) => (name === "My_Ranger1" ? character : null),
    send: (target, message) => {
      sent.push({ target, message });
      return sendResult;
    },
    emit: (event, characterName, details) => {
      emitted.push({ event, characterName, details });
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

  return { supervisor, sent, emitted, timers };
}

test("runtimeReady requires an account-owned connected started runtime", () => {
  assert.equal(
    runtimeReady({
      account_owned: true,
      instance: {},
      connected: true,
      bot_runtime_started_at: 1,
    }),
    true,
  );
  assert.equal(
    runtimeReady({
      account_owned: true,
      instance: {},
      connected: false,
      bot_runtime_started_at: 1,
    }),
    false,
  );
  assert.equal(
    runtimeReady({
      account_owned: false,
      instance: {},
      connected: true,
      bot_runtime_started_at: 1,
    }),
    false,
  );
});

test("supervisor rejects missing, foreign and non-running targets without IPC", async () => {
  const missing = setup();
  await assert.rejects(
    () =>
      missing.supervisor.run(
        "Unknown",
        request({ characterName: null }),
      ),
    (error) => error.code === "GOAL_ADAPTER_PREFLIGHT_CHARACTER_NOT_FOUND",
  );
  assert.equal(missing.sent.length, 0);

  const foreign = setup({
    character: {
      account_owned: false,
      instance: {},
      connected: true,
      bot_runtime_started_at: 1,
    },
  });
  await assert.rejects(
    () => foreign.supervisor.run("My_Ranger1", request()),
    (error) =>
      error.code === "GOAL_ADAPTER_PREFLIGHT_ACCOUNT_CHARACTER_REQUIRED",
  );
  assert.equal(foreign.sent.length, 0);

  const stopped = setup({
    character: {
      account_owned: true,
      instance: null,
      connected: false,
      bot_runtime_started_at: null,
    },
  });
  await assert.rejects(
    () => stopped.supervisor.run("My_Ranger1", request()),
    (error) => error.code === "GOAL_ADAPTER_PREFLIGHT_RUNTIME_NOT_READY",
  );
  assert.equal(stopped.sent.length, 0);
});

test("supervisor rejects dispatch-enabled and mismatched adapter requests", async () => {
  const setupResult = setup();

  await assert.rejects(
    () =>
      setupResult.supervisor.run(
        "My_Ranger1",
        request({ dispatchAllowed: true }),
      ),
    (error) =>
      error.code === "GOAL_ADAPTER_PREFLIGHT_DISPATCH_BOUNDARY_INVALID",
  );

  await assert.rejects(
    () =>
      setupResult.supervisor.run(
        "My_Ranger1",
        request({ characterName: "My_Ranger2" }),
      ),
    (error) => error.code === "GOAL_ADAPTER_PREFLIGHT_CHARACTER_MISMATCH",
  );

  assert.equal(setupResult.sent.length, 0);
});

test("supervisor sends exactly one correlated read-only preflight request", async () => {
  const setupResult = setup();
  const promise = setupResult.supervisor.run("My_Ranger1", request());

  assert.equal(setupResult.sent.length, 1);
  assert.deepEqual(setupResult.sent[0].message, {
    type: "goal_adapter_preflight",
    request_id: "goal-adapter-preflight-1000-1",
    request: request(),
  });
  assert.equal(setupResult.supervisor.snapshot().pending, 1);
  assert.equal(setupResult.supervisor.snapshot().retryEnabled, false);
  assert.equal(setupResult.supervisor.snapshot().runtimeStartAllowed, false);

  const handled = setupResult.supervisor.handleResult("My_Ranger1", {
    type: "goal_adapter_preflight_result",
    request_id: "goal-adapter-preflight-1000-1",
    result: {
      outcome: "PASS",
      reason: "GOAL_ADAPTER_PREFLIGHT_FARM_CONFIRMED",
    },
  });
  assert.equal(handled, true);

  const response = await promise;
  assert.equal(response.result.outcome, "PASS");
  assert.equal(response.error, null);
  assert.equal(response.scope.readOnly, true);
  assert.equal(response.scope.retryUsed, false);
  assert.equal(response.scope.gameplayMutationDispatched, false);
  assert.equal(setupResult.supervisor.snapshot().pending, 0);
});

test("stale and wrong-character responses are ignored", async () => {
  const setupResult = setup();
  const promise = setupResult.supervisor.run("My_Ranger1", request());

  assert.equal(
    setupResult.supervisor.handleResult("My_Ranger1", {
      request_id: "unknown",
      result: { outcome: "PASS" },
    }),
    false,
  );
  assert.equal(
    setupResult.supervisor.handleResult("My_Ranger2", {
      request_id: "goal-adapter-preflight-1000-1",
      result: { outcome: "PASS" },
    }),
    false,
  );
  assert.equal(setupResult.supervisor.snapshot().pending, 1);

  setupResult.supervisor.handleResult("My_Ranger1", {
    request_id: "goal-adapter-preflight-1000-1",
    result: { outcome: "BLOCKED", reason: "TEST" },
  });
  await promise;
});

test("send failure cleans pending state without retry", async () => {
  const setupResult = setup({ sendResult: false });

  await assert.rejects(
    () => setupResult.supervisor.run("My_Ranger1", request()),
    (error) => error.code === "GOAL_ADAPTER_PREFLIGHT_SEND_FAILED",
  );

  assert.equal(setupResult.sent.length, 1);
  assert.equal(setupResult.supervisor.snapshot().pending, 0);
  assert.equal(setupResult.timers.size, 0);
});

test("timeout rejects once and clears correlation state", async () => {
  const setupResult = setup();
  const promise = setupResult.supervisor.run("My_Ranger1", request());
  const [timer] = [...setupResult.timers.values()];

  timer.fn();

  await assert.rejects(
    () => promise,
    (error) => error.code === "GOAL_ADAPTER_PREFLIGHT_TIMEOUT",
  );
  assert.equal(setupResult.supervisor.snapshot().pending, 0);
  assert.equal(
    setupResult.emitted.some(
      (event) => event.event === "GOAL_ADAPTER_PREFLIGHT_TIMEOUT",
    ),
    true,
  );
});

test("one character cannot have concurrent preflight requests", async () => {
  const setupResult = setup();
  const first = setupResult.supervisor.run("My_Ranger1", request());

  await assert.rejects(
    () => setupResult.supervisor.run("My_Ranger1", request()),
    (error) => error.code === "GOAL_ADAPTER_PREFLIGHT_ALREADY_RUNNING",
  );
  assert.equal(setupResult.sent.length, 1);

  setupResult.supervisor.handleResult("My_Ranger1", {
    request_id: "goal-adapter-preflight-1000-1",
    result: { outcome: "PASS" },
  });
  await first;
});

test("Coordinator and dashboard expose only the read-only Goal adapter preflight path", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.match(coordinator, /GoalAdapterPreflightSupervisor/);
  assert.match(
    coordinator,
    /runGoalAdapterPreflight:\s*\(\{ characterName, request \}\)\s*=>/,
  );
  assert.match(
    coordinator,
    /case "goal_adapter_preflight_result"/,
  );
  assert.match(
    coordinator,
    /goal_adapter_preflight_supervisor\.cancelAll/,
  );
  assert.match(
    coordinator,
    /goal_adapter_preflight_supervisor\.snapshot\(\)\.pending > 0/,
  );
  assert.doesNotMatch(coordinator, /dispatch_goal_adapter/);
  assert.doesNotMatch(coordinator, /reconcile_goal_adapter/);

  assert.match(dashboard, /"\/headless\/api\/goals\/adapter-preflight"/);
  assert.match(dashboard, /runGoalAdapterPreflight/);
  assert.doesNotMatch(
    dashboard,
    /"\/headless\/api\/goals\/adapter-dispatch"/,
  );
});

test("supervisor client contains no lifecycle or gameplay execution dependency", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "GoalAdapterPreflightSupervisor.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /controlCharacter/);
  assert.doesNotMatch(source, /restart_character/);
  assert.doesNotMatch(source, /start_char/);
  assert.doesNotMatch(source, /ActionBoundary/);
  assert.doesNotMatch(source, /runMaterialGatherTask/);
  assert.doesNotMatch(source, /executeCraftNext/);
  assert.doesNotMatch(source, /setInterval/);
});

test("temporary Phase 19.8 formatter probe", async () => {
  const targets = [
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    path.join(__dirname, "goal_adapter_preflight_supervisor.test.js"),
  ];

  for (const target of targets) {
    const source = fs.readFileSync(target, "utf8");
    const formatted = await prettier.format(source, { filepath: target });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase19-8-prettier-"));
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
      console.log("PHASE19_8_PRETTIER_DIFF", path.basename(target));
      console.log(diff || "NO_DIFF");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

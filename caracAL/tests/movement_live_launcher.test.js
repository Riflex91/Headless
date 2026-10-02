"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ensureDashboardAvailable,
  isConnectionFailure,
  selectMovementLiveTestCharacter,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

test("movement live character selection skips disabled combat characters when an enabled one exists", () => {
  const selected = selectMovementLiveTestCharacter({
    characters: [
      {
        name: "My_Mage",
        ctype: "mage",
        account_owned: true,
        enabled: false,
        connected: false,
        lifecycle_state: "STOPPED",
        desired_runtime_state: "STOPPED",
      },
      {
        name: "My_Ranger1",
        ctype: "ranger",
        account_owned: true,
        enabled: true,
        connected: false,
        lifecycle_state: "STARTING",
        desired_runtime_state: "RUNNING",
      },
    ],
  });

  assert.equal(selected.name, "My_Ranger1");
});

test("movement live character selection prefers an online combat character", () => {
  const selected = selectMovementLiveTestCharacter({
    characters: [
      {
        name: "My_Ranger1",
        ctype: "ranger",
        account_owned: true,
        enabled: true,
        connected: false,
        lifecycle_state: "STARTING",
        desired_runtime_state: "RUNNING",
      },
      {
        name: "My_Ranger2",
        ctype: "ranger",
        account_owned: true,
        enabled: true,
        connected: true,
        lifecycle_state: "ONLINE",
        desired_runtime_state: "RUNNING",
      },
    ],
  });

  assert.equal(selected.name, "My_Ranger2");
});

test("movement live character selection honors an explicit requested character", () => {
  const selected = selectMovementLiveTestCharacter(
    {
      characters: [
        {
          name: "My_Ranger1",
          ctype: "ranger",
          account_owned: true,
          enabled: true,
          connected: true,
          lifecycle_state: "ONLINE",
          desired_runtime_state: "RUNNING",
        },
        {
          name: "My_Mage",
          ctype: "mage",
          account_owned: true,
          enabled: false,
          connected: false,
          lifecycle_state: "STOPPED",
          desired_runtime_state: "STOPPED",
        },
      ],
    },
    "My_Mage",
  );

  assert.equal(selected.name, "My_Mage");
});

test("movement live launcher reuses an existing dashboard", async () => {
  let starts = 0;
  const state = { characters: [{ name: "My_Ranger1" }] };

  const result = await ensureDashboardAvailable(async () => state, {
    startRuntime() {
      starts += 1;
      throw new Error("should not start");
    },
  });

  assert.equal(starts, 0);
  assert.equal(result.startedRuntime, false);
  assert.equal(result.runtime, null);
  assert.equal(result.state, state);
});

test("movement live launcher starts caracAL when dashboard is unreachable", async () => {
  let probes = 0;
  let starts = 0;
  const runtime = {
    pid: 123,
    exitCode: null,
    signalCode: null,
  };

  const result = await ensureDashboardAvailable(
    async () => {
      probes += 1;
      if (probes < 3) {
        const error = new TypeError("fetch failed");
        error.cause = { code: "ECONNREFUSED" };
        throw error;
      }
      return { characters: [] };
    },
    {
      startRuntime() {
        starts += 1;
        return runtime;
      },
      timeoutMs: 1000,
      pollMs: 0,
    },
  );

  assert.equal(starts, 1);
  assert.equal(result.startedRuntime, true);
  assert.equal(result.runtime, runtime);
  assert.deepEqual(result.state, { characters: [] });
});

test("movement live launcher does not hide non-connection dashboard errors", async () => {
  let starts = 0;

  await assert.rejects(
    () =>
      ensureDashboardAvailable(
        async () => {
          throw new Error("HTTP 500 from dashboard");
        },
        {
          startRuntime() {
            starts += 1;
            return null;
          },
        },
      ),
    /HTTP 500/,
  );

  assert.equal(starts, 0);
});

test("Windows cleanup terminates only the managed process tree", async () => {
  const runtime = {
    pid: 456,
    exitCode: null,
    signalCode: null,
  };
  const calls = [];

  await stopManagedRuntime(runtime, {
    platform: "win32",
    forceTimeoutMs: 10,
    async runProcessImpl(command, args) {
      calls.push({ command, args });
      runtime.exitCode = 0;
      return true;
    },
  });

  assert.deepEqual(calls, [
    {
      command: "taskkill",
      args: ["/PID", "456", "/T", "/F"],
    },
  ]);
});

test("connection failure detection recognizes fetch and socket errors", () => {
  assert.equal(isConnectionFailure(new TypeError("fetch failed")), true);
  assert.equal(isConnectionFailure({ code: "ECONNREFUSED" }), true);
  assert.equal(isConnectionFailure(new Error("HTTP 503")), false);
});

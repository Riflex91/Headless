"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      fileName,
    ),
  );
}

test("EventBus emits versioned events to listeners and sink", () => {
  const { EventBus, RUNTIME_EVENT_VERSION } = coreModule("event-bus.lib.ts");
  const seen = [];
  const sink = [];
  let now = 1000;
  let sequence = 0;

  const bus = new EventBus({
    sink: (event) => sink.push(event),
    now: () => now,
    nextId: () => `test-${++sequence}`,
  });

  const unsubscribe = bus.on("DECISION", (event) => seen.push(event));
  bus.on("*", (event) => seen.push({ wildcard: event.id }));

  const event = bus.emit({
    module: "Planner",
    type: "DECISION",
    why: "BEST_SCORE",
    correlationId: "C-1",
    data: { score: 42 },
  });

  assert.equal(event.version, RUNTIME_EVENT_VERSION);
  assert.equal(event.id, "test-1");
  assert.equal(event.timestamp, 1000);
  assert.equal(event.module, "Planner");
  assert.equal(event.type, "DECISION");
  assert.equal(event.why, "BEST_SCORE");
  assert.deepEqual(event.data, { score: 42 });
  assert.equal(seen.length, 2);
  assert.equal(sink.length, 1);
  assert.equal(bus.listenerCount(), 2);

  unsubscribe();
  assert.equal(bus.listenerCount("DECISION"), 0);

  now = 2000;
  bus.emit({ module: "Planner", type: "OTHER" });
  assert.equal(sink[1].timestamp, 2000);
});

test("EventBus isolates listener failures from runtime flow", () => {
  const { EventBus } = coreModule("event-bus.lib.ts");
  const sink = [];
  const originalError = console.error;
  console.error = () => {};

  try {
    const bus = new EventBus({
      sink: (event) => sink.push(event),
      now: () => 1,
      nextId: () => "E-1",
    });
    bus.on("X", () => {
      throw new Error("observer failed");
    });

    assert.doesNotThrow(() =>
      bus.emit({ module: "Test", type: "X", why: "TEST" }),
    );
    assert.equal(sink.length, 1);
  } finally {
    console.error = originalError;
  }
});

test("Scheduler respects pause state and priority", async () => {
  const { Scheduler } = coreModule("scheduler.lib.ts");
  let now = 1000;
  let runtimeState = "RUNNING";
  const order = [];
  const events = [];

  const scheduler = new Scheduler({
    now: () => now,
    getRuntimeState: () => runtimeState,
    onEvent: (event) => events.push(event),
  });

  scheduler.register({
    id: "low",
    intervalMs: 100,
    priority: 1,
    tick: async () => {
      order.push("low");
    },
  });
  scheduler.register({
    id: "high",
    intervalMs: 100,
    priority: 10,
    tick: async () => {
      order.push("high");
    },
  });
  scheduler.register({
    id: "paused-health",
    intervalMs: 100,
    priority: -1,
    runWhenPaused: true,
    tick: async () => {
      order.push("paused-health");
    },
  });

  await scheduler.tickOnce();
  assert.deepEqual(order, ["high", "low", "paused-health"]);

  runtimeState = "PAUSED";
  now = 1100;
  order.length = 0;
  await scheduler.tickOnce();
  assert.deepEqual(order, ["paused-health"]);

  const pauseSkips = events.filter(
    (event) =>
      event.type === "JOB_SKIPPED" &&
      event.reason === "RUNTIME_PAUSED",
  );
  assert.equal(pauseSkips.length, 2);
});

test("Scheduler catches job failures and continues with later jobs", async () => {
  const { Scheduler } = coreModule("scheduler.lib.ts");
  const events = [];
  const order = [];

  const scheduler = new Scheduler({
    now: () => 5000,
    onEvent: (event) => events.push(event),
  });

  scheduler.register({
    id: "bad",
    intervalMs: 100,
    priority: 10,
    tick: () => {
      order.push("bad");
      throw new Error("boom");
    },
  });
  scheduler.register({
    id: "good",
    intervalMs: 100,
    priority: 1,
    tick: () => {
      order.push("good");
    },
  });

  await scheduler.tickOnce();

  assert.deepEqual(order, ["bad", "good"]);
  assert.equal(
    events.some(
      (event) =>
        event.type === "JOB_FAILED" &&
        event.jobId === "bad" &&
        event.error === "boom",
    ),
    true,
  );
  assert.equal(
    events.some(
      (event) =>
        event.type === "JOB_COMPLETED" && event.jobId === "good",
    ),
    true,
  );
});

test("ModuleRegistry starts dependencies first and stops in reverse order", async () => {
  const { ModuleRegistry } = coreModule("module-registry.lib.ts");
  const calls = [];

  const registry = new ModuleRegistry();
  registry.register({
    id: "consumer",
    dependsOn: ["base"],
    start: () => calls.push("start-consumer"),
    stop: () => calls.push("stop-consumer"),
  });
  registry.register({
    id: "base",
    start: () => calls.push("start-base"),
    stop: () => calls.push("stop-base"),
  });

  await registry.startAll();
  assert.deepEqual(calls, ["start-base", "start-consumer"]);

  await registry.stopAll("TEST");
  assert.deepEqual(calls, [
    "start-base",
    "start-consumer",
    "stop-consumer",
    "stop-base",
  ]);

  assert.deepEqual(
    registry.list().map((entry) => [entry.id, entry.state]),
    [
      ["base", "STOPPED"],
      ["consumer", "STOPPED"],
    ],
  );
});

test("ModuleRegistry rolls back already-started modules on failure", async () => {
  const { ModuleRegistry } = coreModule("module-registry.lib.ts");
  const calls = [];
  const registry = new ModuleRegistry();

  registry.register({
    id: "a-base",
    start: () => calls.push("start-base"),
    stop: (reason) => calls.push(`stop-base:${reason}`),
  });
  registry.register({
    id: "b-fail",
    dependsOn: ["a-base"],
    start: () => {
      calls.push("start-fail");
      throw new Error("cannot start");
    },
    stop: () => calls.push("stop-fail"),
  });

  await assert.rejects(registry.startAll(), /cannot start/);
  assert.deepEqual(calls, [
    "start-base",
    "start-fail",
    "stop-base:START_FAILURE_ROLLBACK",
  ]);
  assert.equal(
    registry.list().find((entry) => entry.id === "b-fail").state,
    "ERROR",
  );
});

test("ModuleRegistry rejects missing and cyclic dependencies", async () => {
  const { ModuleRegistry } = coreModule("module-registry.lib.ts");

  const missing = new ModuleRegistry();
  missing.register({
    id: "consumer",
    dependsOn: ["missing"],
    start() {},
    stop() {},
  });
  await assert.rejects(missing.startAll(), /requires missing module/);

  const cycle = new ModuleRegistry();
  cycle.register({
    id: "a",
    dependsOn: ["b"],
    start() {},
    stop() {},
  });
  cycle.register({
    id: "b",
    dependsOn: ["a"],
    start() {},
    stop() {},
  });
  await assert.rejects(cycle.startAll(), /dependency cycle/);
});

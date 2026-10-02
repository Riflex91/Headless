"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", fileName),
  );
}

function actionRecord(id, status) {
  return {
    id,
    module: "Movement",
    action: "MOVE",
    why: "TEST",
    correlationId: `C-${id}`,
    createdAt: 1,
    status,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function baseActions(overrides = {}) {
  return {
    directMove() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove(actionId) {
      return actionRecord(actionId, "REJECTED");
    },
    settleMove(actionId) {
      return actionRecord(actionId, "DISPATCHED");
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
    ...overrides,
  };
}

test("safe point store validates, captures, snapshots, and clears points", () => {
  const { MovementSafePointStore } = coreModule("movement-safety.lib.ts");
  let now = 100;
  const store = new MovementSafePointStore(() => now);

  const manual = store.set(
    { map: " main ", x: 10, y: 20, tolerance: 4 },
    " TEST ",
  );
  assert.deepEqual(manual, {
    map: "main",
    x: 10,
    y: 20,
    tolerance: 4,
    source: "TEST",
    capturedAt: 100,
  });

  const snapshot = store.get();
  snapshot.x = 999;
  assert.equal(store.get().x, 10);

  now = 200;
  const captured = store.capture(
    { map: "winterland", x: 30, y: 40, moving: false },
    6,
  );
  assert.deepEqual(captured, {
    map: "winterland",
    x: 30,
    y: 40,
    tolerance: 6,
    source: "CURRENT_POSITION",
    capturedAt: 200,
  });

  const cleared = store.clear();
  assert.equal(cleared.map, "winterland");
  assert.equal(store.get(), null);

  assert.throws(
    () => store.set({ map: "", x: 1, y: 2 }),
    /invalid movement safe point/,
  );
  assert.throws(
    () => store.set({ map: "main", x: Number.NaN, y: 2 }),
    /invalid movement safe point/,
  );
  assert.throws(
    () =>
      store.capture({
        map: "main",
        x: null,
        y: 2,
        moving: false,
      }),
    /cannot capture safe point from unknown position/,
  );
});

test("stuck detector waits for timeout, resets on progress, and resumes", () => {
  const { MovementStuckDetector } = coreModule("movement-safety.lib.ts");
  let now = 0;
  const detector = new MovementStuckDetector({
    now: () => now,
    timeoutMs: 1000,
    minProgressDistance: 5,
  });

  detector.reset("MOVE:1", {
    map: "main",
    x: 0,
    y: 0,
    moving: true,
  });

  now = 999;
  assert.equal(
    detector.observe("MOVE:1", {
      map: "main",
      x: 0,
      y: 0,
      moving: true,
    }).transition,
    null,
  );

  now = 1000;
  const stuck = detector.observe("MOVE:1", {
    map: "main",
    x: 0,
    y: 0,
    moving: true,
  });
  assert.equal(stuck.transition, "STUCK");
  assert.equal(stuck.status.stuck, true);
  assert.equal(stuck.status.stuckSince, 1000);

  now = 1100;
  assert.equal(
    detector.observe("MOVE:1", {
      map: "main",
      x: 3,
      y: 0,
      moving: true,
    }).transition,
    null,
  );

  now = 1200;
  const resumed = detector.observe("MOVE:1", {
    map: "main",
    x: 10,
    y: 0,
    moving: true,
  });
  assert.equal(resumed.transition, "RESUMED");
  assert.equal(resumed.status.stuck, false);
  assert.equal(resumed.status.lastProgressAt, 1200);
});

test("map changes count as progress and a new command resets stuck state", () => {
  const { MovementStuckDetector } = coreModule("movement-safety.lib.ts");
  let now = 0;
  const detector = new MovementStuckDetector({
    now: () => now,
    timeoutMs: 500,
    minProgressDistance: 5,
  });

  detector.reset("MOVE:1", {
    map: "main",
    x: 0,
    y: 0,
    moving: true,
  });
  now = 500;
  const mapProgress = detector.observe("MOVE:1", {
    map: "winterland",
    x: 0,
    y: 0,
    moving: true,
  });
  assert.equal(mapProgress.transition, null);
  assert.equal(mapProgress.status.stuck, false);
  assert.equal(mapProgress.status.lastProgressAt, 500);

  now = 1000;
  const stuck = detector.observe("MOVE:1", {
    map: "winterland",
    x: 0,
    y: 0,
    moving: true,
  });
  assert.equal(stuck.transition, "STUCK");

  const reset = detector.observe("MOVE:2", {
    map: "winterland",
    x: 0,
    y: 0,
    moving: true,
  });
  assert.equal(reset.transition, null);
  assert.equal(reset.status.commandKey, "MOVE:2");
  assert.equal(reset.status.stuck, false);
  assert.equal(reset.status.stuckSince, null);
});

test("stuck status snapshots are isolated", () => {
  const { MovementStuckDetector } = coreModule("movement-safety.lib.ts");
  const detector = new MovementStuckDetector({ now: () => 10 });
  detector.reset("MOVE:1", {
    map: "main",
    x: 1,
    y: 2,
    moving: true,
  });

  const status = detector.status();
  status.lastPosition.x = 999;

  assert.equal(detector.status().lastPosition.x, 1);
});

test("controller rejects return without safe point and invalid capture", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const movement = new MovementController(baseActions(), {
    position: () => ({ map: null, x: null, y: null, moving: false }),
  });

  await assert.rejects(
    () =>
      movement.returnToSafePoint({
        owner: "Return",
        module: "Return",
        why: "GO_SAFE",
      }),
    /movement safe point is not configured/,
  );
  assert.throws(
    () => movement.captureSafePoint(),
    /cannot capture safe point from unknown position/,
  );
});

test("return dispatches smart move and exposes RETURN before settlement", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const pending = deferred();
  const calls = [];
  const events = [];
  const movement = new MovementController(
    baseActions({
      smartMove(request) {
        calls.push(request);
        return pending.promise;
      },
    }),
    { onEvent: (event) => events.push(event) },
  );

  movement.setSafePoint(
    { map: "winterland", x: 100, y: 200, tolerance: 7 },
    "TEST",
  );
  const promise = movement.returnToSafePoint({
    owner: "Return",
    module: "Safety",
    why: "RETURN_SAFE",
    correlationId: "RET-1",
  });

  assert.equal(movement.status().mode, "RETURN");
  assert.equal(movement.status().owner, "Return");
  assert.deepEqual(calls[0].destination, {
    map: "winterland",
    x: 100,
    y: 200,
  });
  assert.equal(
    events.some((event) => event.type === "MOVEMENT_RETURN_STARTED"),
    true,
  );

  pending.resolve(actionRecord("S-1", "CONFIRMED"));
  const record = await promise;
  assert.equal(record.status, "CONFIRMED");
  assert.equal(movement.status().mode, "IDLE");
  assert.equal(movement.status().owner, null);
});

test("fast confirmed return still emits RETURN before command settlement", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const events = [];
  const movement = new MovementController(
    baseActions({
      async smartMove() {
        return actionRecord("S-1", "CONFIRMED");
      },
    }),
    { onEvent: (event) => events.push(event) },
  );

  movement.setSafePoint({ map: "main", x: 5, y: 6 });
  const promise = movement.returnToSafePoint({
    owner: "Return",
    module: "Safety",
    why: "RETURN_SAFE",
  });

  assert.equal(movement.status().mode, "RETURN");
  await promise;

  const returnIndex = events.findIndex(
    (event) => event.type === "MOVEMENT_RETURN_STARTED",
  );
  const settledIndex = events.findIndex(
    (event) =>
      event.type === "MOVEMENT_COMMAND_SETTLED" &&
      event.commandType === "SMART",
  );
  assert.equal(returnIndex >= 0, true);
  assert.equal(settledIndex > returnIndex, true);
});

test("UNKNOWN return conservatively retains ownership and active command", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const movement = new MovementController(
    baseActions({
      async smartMove() {
        return actionRecord("S-1", "UNKNOWN");
      },
    }),
  );
  movement.setSafePoint({ map: "main", x: 5, y: 6 });

  const record = await movement.returnToSafePoint({
    owner: "Return",
    module: "Safety",
    why: "RETURN_SAFE",
  });

  assert.equal(record.status, "UNKNOWN");
  assert.equal(movement.status().owner, "Return");
  assert.equal(movement.status().mode, "UNKNOWN");
  assert.equal(movement.status().active.type, "SMART");
});

test("PATH transitions to STUCK and resumes back to PATH", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  let now = 0;
  const position = { map: "main", x: 0, y: 0, moving: true };
  const movement = new MovementController(baseActions(), {
    now: () => now,
    position: () => ({ ...position }),
    stuckTimeoutMs: 500,
    stuckProgressDistance: 5,
  });

  movement.path({
    owner: "Farm",
    module: "Farm",
    why: "PATROL",
    waypoints: [{ x: 100, y: 0 }],
  });
  assert.equal(movement.status().mode, "PATH");

  now = 500;
  movement.observe();
  assert.equal(movement.status().mode, "STUCK");
  assert.equal(movement.status().stuck.stuck, true);

  position.x = 10;
  now = 600;
  movement.observe();
  assert.equal(movement.status().mode, "PATH");
  assert.equal(movement.status().stuck.stuck, false);
});

test("RETURN transitions to STUCK and resumes back to RETURN", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  let now = 0;
  const position = { map: "main", x: 0, y: 0, moving: true };
  const pending = deferred();
  const movement = new MovementController(
    baseActions({
      smartMove() {
        return pending.promise;
      },
    }),
    {
      now: () => now,
      position: () => ({ ...position }),
      stuckTimeoutMs: 500,
      stuckProgressDistance: 5,
    },
  );

  movement.setSafePoint({ map: "main", x: 100, y: 0 });
  const promise = movement.returnToSafePoint({
    owner: "Return",
    module: "Safety",
    why: "RETURN_SAFE",
  });
  assert.equal(movement.status().mode, "RETURN");

  now = 500;
  movement.observe();
  assert.equal(movement.status().mode, "STUCK");

  position.x = 10;
  now = 600;
  movement.observe();
  assert.equal(movement.status().mode, "RETURN");

  pending.resolve(actionRecord("S-1", "CONFIRMED"));
  await promise;
  assert.equal(movement.status().mode, "IDLE");
});

test("settled direct command cannot emit a stale STUCK transition", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  let now = 0;
  const events = [];
  const movement = new MovementController(
    baseActions({
      settleMove(actionId) {
        return actionRecord(actionId, "CONFIRMED");
      },
    }),
    {
      now: () => now,
      position: () => ({ map: "main", x: 0, y: 0, moving: false }),
      stuckTimeoutMs: 500,
      onEvent: (event) => events.push(event),
    },
  );

  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "MOVE",
    x: 10,
    y: 20,
  });

  now = 500;
  const record = movement.observe();
  assert.equal(record.status, "CONFIRMED");
  assert.equal(movement.status().mode, "IDLE");
  assert.equal(
    events.some((event) => event.type === "MOVEMENT_STUCK"),
    false,
  );
});

test("confirmed cancel clears stuck detector and active movement", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  let now = 0;
  const movement = new MovementController(baseActions(), {
    now: () => now,
    position: () => ({ map: "main", x: 0, y: 0, moving: true }),
    stuckTimeoutMs: 500,
  });

  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "MOVE",
    x: 100,
    y: 0,
  });
  now = 500;
  movement.observe();
  assert.equal(movement.status().mode, "STUCK");

  const cancelled = await movement.cancel({
    owner: "Farm",
    module: "Safety",
    why: "CANCEL_STUCK",
  });
  assert.equal(cancelled.status, "CONFIRMED");
  assert.equal(movement.status().mode, "IDLE");
  assert.equal(movement.status().owner, null);
  assert.equal(movement.status().active, null);
  assert.deepEqual(movement.status().stuck, {
    commandKey: null,
    stuck: false,
    stuckSince: null,
    lastProgressAt: null,
    lastPosition: null,
  });
});

test("position source failures do not crash movement observation", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const movement = new MovementController(baseActions(), {
    position: () => {
      throw new Error("position unavailable");
    },
  });

  assert.doesNotThrow(() =>
    movement.direct({
      owner: "Farm",
      module: "Farm",
      why: "MOVE",
      x: 10,
      y: 20,
    }),
  );
  assert.doesNotThrow(() => movement.observe());
  assert.equal(movement.status().mode, "DIRECT");
});

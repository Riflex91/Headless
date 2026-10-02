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

function makeActions() {
  const dispatched = [];
  const settlement = new Map();
  const cancelled = [];

  return {
    dispatched,
    settlement,
    cancelled,
    actions: {
      directMove(request) {
        const id = `D-${dispatched.length + 1}`;
        dispatched.push({ id, request: { ...request } });
        return actionRecord(id, "DISPATCHED");
      },
      cancelDirectMove(actionId, reason) {
        cancelled.push([actionId, reason]);
        settlement.set(actionId, "REJECTED");
        return actionRecord(actionId, "REJECTED");
      },
      settleMove(actionId, tolerance) {
        const status = settlement.get(actionId) || "DISPATCHED";
        const record = actionRecord(actionId, status);
        record.evidence = { tolerance };
        return record;
      },
      async smartMove() {
        return actionRecord("S-1", "CONFIRMED");
      },
      async cancelMovement() {
        return actionRecord("C-1", "CONFIRMED");
      },
    },
  };
}

test("movement path dispatches waypoints in order and retains ownership until completion", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const setup = makeActions();
  const movement = new MovementController(setup.actions);

  const first = movement.path({
    owner: "Farm",
    module: "Farm",
    why: "PATROL_ROUTE",
    waypoints: [
      { x: 10, y: 20, tolerance: 3 },
      { x: 30, y: 40, tolerance: 8 },
    ],
  });

  assert.equal(first.id, "D-1");
  assert.equal(movement.status().owner, "Farm");
  assert.equal(movement.status().path.index, 0);
  assert.equal(movement.status().path.total, 2);
  assert.deepEqual(
    setup.dispatched.map((entry) => [entry.request.x, entry.request.y]),
    [[10, 20]],
  );

  setup.settlement.set("D-1", "CONFIRMED");
  const firstSettled = movement.observe();
  assert.equal(firstSettled.status, "CONFIRMED");
  assert.equal(firstSettled.evidence.tolerance, 3);
  assert.equal(movement.status().owner, "Farm");
  assert.equal(movement.status().path.index, 1);
  assert.deepEqual(
    setup.dispatched.map((entry) => [entry.request.x, entry.request.y]),
    [
      [10, 20],
      [30, 40],
    ],
  );

  setup.settlement.set("D-2", "CONFIRMED");
  const completed = movement.observe();
  assert.equal(completed.status, "CONFIRMED");
  assert.equal(completed.evidence.tolerance, 8);
  assert.equal(movement.status().owner, null);
  assert.equal(movement.status().mode, "IDLE");
  assert.equal(movement.status().path, null);
  assert.equal(movement.status().active, null);
});

test("movement path exposes isolated planned waypoints and destination", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const setup = makeActions();
  const movement = new MovementController(setup.actions);

  movement.path({
    owner: "Travel",
    module: "Travel",
    why: "ROUTE",
    waypoints: [
      { map: "main", x: 10, y: 20 },
      { map: "main", x: 30, y: 40 },
    ],
  });

  const status = movement.status();
  status.path.waypoints[0].x = 999;
  status.path.destination.x = 999;

  assert.equal(movement.status().path.waypoints[0].x, 10);
  assert.deepEqual(movement.status().path.destination, {
    map: "main",
    x: 30,
    y: 40,
  });
});

test("movement path anti-pingpong rejection releases newly acquired ownership", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const { MovementPathError } = coreModule("movement-path.lib.ts");
  const setup = makeActions();
  const movement = new MovementController(setup.actions);

  assert.throws(
    () =>
      movement.path({
        owner: "Farm",
        module: "Farm",
        why: "BAD_ROUTE",
        waypoints: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 0 },
        ],
      }),
    (error) =>
      error instanceof MovementPathError &&
      error.code === "MOVEMENT_PATH_PINGPONG",
  );

  assert.equal(movement.status().owner, null);
  assert.equal(movement.status().path, null);
  assert.equal(setup.dispatched.length, 0);
});

test("explicit backtrack path bypasses anti-pingpong for intentional returns", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const setup = makeActions();
  const movement = new MovementController(setup.actions);

  const result = movement.path({
    owner: "Return",
    module: "Return",
    why: "RETURN_ROUTE",
    allowBacktrack: true,
    waypoints: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ],
  });

  assert.equal(result.status, "DISPATCHED");
  assert.equal(movement.status().path.allowBacktrack, true);
});

test("confirmed cancel clears active path and closes current direct move", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const setup = makeActions();
  const movement = new MovementController(setup.actions);

  movement.path({
    owner: "Farm",
    module: "Farm",
    why: "PATROL",
    waypoints: [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ],
  });

  const cancelled = await movement.cancel({
    owner: "Farm",
    module: "Farm",
    why: "STOP_PATROL",
  });

  assert.equal(cancelled.status, "CONFIRMED");
  assert.deepEqual(setup.cancelled, [["D-1", "MOVE_CANCELLED"]]);
  assert.equal(movement.status().path, null);
  assert.equal(movement.status().owner, null);
  assert.equal(movement.status().active, null);
});

test("UNKNOWN waypoint settlement retains path and ownership", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const setup = makeActions();
  const movement = new MovementController(setup.actions);

  movement.path({
    owner: "Farm",
    module: "Farm",
    why: "PATROL",
    waypoints: [{ x: 10, y: 20 }],
  });
  setup.settlement.set("D-1", "UNKNOWN");

  const result = movement.observe();

  assert.equal(result.status, "UNKNOWN");
  assert.equal(movement.status().owner, "Farm");
  assert.equal(movement.status().mode, "UNKNOWN");
  assert.equal(movement.status().path.index, 0);
  assert.equal(movement.status().active.actionId, "D-1");
});

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

test("path planner normalizes consecutive duplicate waypoints", () => {
  const { MovementPathPlanner } = coreModule("movement-path.lib.ts");
  const planner = new MovementPathPlanner({
    now: () => 1000,
    antiPingPongDistance: 5,
  });

  const status = planner.start({
    owner: "Farm",
    waypoints: [
      { x: 10, y: 20 },
      { x: 12, y: 22 },
      { x: 100, y: 200, tolerance: 8 },
    ],
  });

  assert.equal(status.id, 1);
  assert.equal(status.total, 2);
  assert.deepEqual(status.waypoints, [
    { x: 10, y: 20 },
    { x: 100, y: 200, tolerance: 8 },
  ]);
  assert.deepEqual(status.destination, {
    x: 100,
    y: 200,
    tolerance: 8,
  });
});

test("path planner rejects static A-B-A pingpong", () => {
  const { MovementPathPlanner, MovementPathError } = coreModule(
    "movement-path.lib.ts",
  );
  const planner = new MovementPathPlanner({ antiPingPongDistance: 5 });

  assert.throws(
    () =>
      planner.start({
        owner: "Farm",
        waypoints: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 2, y: 1 },
        ],
      }),
    (error) =>
      error instanceof MovementPathError &&
      error.code === "MOVEMENT_PATH_PINGPONG",
  );
  assert.equal(planner.status(), null);
});

test("path planner permits intentional backtracking when explicitly enabled", () => {
  const { MovementPathPlanner } = coreModule("movement-path.lib.ts");
  const planner = new MovementPathPlanner({ antiPingPongDistance: 5 });

  const status = planner.start({
    owner: "Return",
    allowBacktrack: true,
    waypoints: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ],
  });

  assert.equal(status.allowBacktrack, true);
  assert.equal(status.total, 3);
});

test("settled waypoint history prevents immediate cross-plan pingpong", () => {
  const { MovementPathPlanner, MovementPathError } = coreModule(
    "movement-path.lib.ts",
  );
  const planner = new MovementPathPlanner({ antiPingPongDistance: 5 });

  planner.start({
    owner: "Farm",
    waypoints: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  });
  const first = planner.settleCurrent();
  assert.equal(first.completed, false);
  const second = planner.settleCurrent();
  assert.equal(second.completed, true);
  assert.equal(planner.status(), null);

  assert.throws(
    () =>
      planner.start({
        owner: "Farm",
        waypoints: [{ x: 1, y: 1 }],
      }),
    (error) =>
      error instanceof MovementPathError &&
      error.code === "MOVEMENT_PATH_PINGPONG",
  );

  const intentional = planner.start({
    owner: "Return",
    allowBacktrack: true,
    waypoints: [{ x: 1, y: 1 }],
  });
  assert.equal(intentional.total, 1);
});

test("path planner advances current waypoint and clears itself at completion", () => {
  const { MovementPathPlanner } = coreModule("movement-path.lib.ts");
  const planner = new MovementPathPlanner();

  planner.start({
    owner: "Travel",
    waypoints: [
      { map: "main", x: 10, y: 20 },
      { map: "main", x: 30, y: 40 },
    ],
  });

  assert.deepEqual(planner.current(), { map: "main", x: 10, y: 20 });
  const first = planner.settleCurrent();
  assert.equal(first.completed, false);
  assert.equal(first.waypointIndex, 0);
  assert.deepEqual(first.next, { map: "main", x: 30, y: 40 });

  const second = planner.settleCurrent();
  assert.equal(second.completed, true);
  assert.equal(second.waypointIndex, 1);
  assert.equal(second.next, null);
  assert.equal(planner.status(), null);
});

test("path planner status returns isolated waypoint snapshots", () => {
  const { MovementPathPlanner } = coreModule("movement-path.lib.ts");
  const planner = new MovementPathPlanner();

  planner.start({
    owner: "Travel",
    waypoints: [{ x: 10, y: 20 }],
  });

  const status = planner.status();
  status.waypoints[0].x = 999;
  status.remaining[0].y = 999;
  status.destination.x = 999;
  status.current.x = 999;

  assert.deepEqual(planner.current(), { x: 10, y: 20 });
});

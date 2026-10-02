"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  availableMaps,
  characterGeometry,
  computeBounds,
  filterTrail,
  plannedPath,
} = require("../dashboard/movement-map");

function characterFixture() {
  return {
    name: "My_Ranger1",
    game: {
      map: "main",
      x: 100,
      y: 200,
      heading: 45,
      target: { x: 130, y: 230 },
      planned_path: [
        { map: "main", x: 150, y: 250 },
        { map: "cave", x: 20, y: 30, transport: true },
      ],
      planned_destination: {
        map: "main",
        x: 300,
        y: 400,
      },
    },
    movement_trail: [
      { timestamp: 1000, map: "main", x: 80, y: 180 },
      { timestamp: 2000, map: "main", x: 90, y: 190 },
      { timestamp: 2500, map: "cave", x: 10, y: 10 },
    ],
  };
}

test("movement map exposes active maps only", () => {
  assert.deepEqual(
    availableMaps([
      characterFixture(),
      { game: { map: "cave" } },
      { game: null },
    ]),
    ["cave", "main"],
  );
});

test("trail filtering respects map and time window", () => {
  const character = characterFixture();
  assert.deepEqual(filterTrail(character, "main", 1500), [
    { timestamp: 2000, map: "main", x: 90, y: 190 },
  ]);
});

test("planned path starts at the current position and stays on selected map", () => {
  const path = plannedPath(characterFixture(), "main");
  assert.deepEqual(path, [
    { map: "main", x: 100, y: 200 },
    { map: "main", x: 150, y: 250 },
    { map: "main", x: 300, y: 400 },
  ]);
});



test("runtime controller waypoints override smart plot and inherit the selected map", () => {
  const character = characterFixture();
  character.game.runtime_planned_path = [
    { map: null, x: 120, y: 220 },
    { map: "main", x: 180, y: 280 },
  ];
  character.game.runtime_planned_destination = {
    map: "main",
    x: 180,
    y: 280,
  };

  assert.deepEqual(plannedPath(character, "main"), [
    { map: "main", x: 100, y: 200 },
    { map: "main", x: 120, y: 220 },
    { map: "main", x: 180, y: 280 },
  ]);
});

test("character geometry exposes safe point for map rendering", () => {
  const character = characterFixture();
  character.game.safe_point = {
    map: "main",
    x: 25,
    y: 35,
    source: "CURRENT_POSITION",
  };

  const geometry = characterGeometry(character, "main", 0);

  assert.deepEqual(geometry.safePoint, { x: 25, y: 35 });
  const bounds = computeBounds([geometry]);
  assert.equal(bounds.minX < 25, true);
  assert.equal(bounds.minY < 35, true);
});

test("character geometry contains trail plan target and heading", () => {
  const geometry = characterGeometry(characterFixture(), "main", 0);

  assert.deepEqual(geometry.current, { x: 100, y: 200 });
  assert.deepEqual(geometry.target, { x: 130, y: 230 });
  assert.equal(geometry.heading, 45);
  assert.equal(geometry.trail.length, 2);
  assert.equal(geometry.plan.length, 3);
});

test("computed bounds provide stable minimum viewport size", () => {
  const geometry = characterGeometry(characterFixture(), "main", 0);
  const bounds = computeBounds([geometry]);

  assert.ok(bounds);
  assert.equal(bounds.width >= 500, true);
  assert.equal(bounds.height >= 500, true);
  assert.equal(bounds.minX < 80, true);
  assert.equal(bounds.minY < 180, true);
});

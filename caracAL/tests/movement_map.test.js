"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  availableMaps,
  characterGeometry,
  computeBounds,
  filterTrail,
  nearbyEntities,
  plannedPath,
  pointInBounds,
  sceneNpcs,
} = require("../dashboard/movement-map");
const {
  collectSceneAssetFiles,
  placementIntersectsBounds,
} = require("../dashboard/map-background");
const {
  publicMapScene,
  publicNearbyEntities,
} = require("../src/DashboardMapTelemetry");

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

test("computed bounds expand to include nearby live entities", () => {
  const geometry = characterGeometry(characterFixture(), "main", 0);
  const bounds = computeBounds([geometry], [{ x: 900, y: 200 }]);

  assert.ok(bounds);
  assert.equal(bounds.minX <= 80, true);
  assert.equal(bounds.minX + bounds.width >= 900, true);
});

test("nearby entity overlay deduplicates observations from multiple characters", () => {
  const characters = [
    {
      game: {
        map: "main",
        nearby_entities: [
          {
            id: "goo-1",
            kind: "monster",
            name: "Green Goo",
            x: 110,
            y: 210,
            distance: 20,
          },
        ],
      },
    },
    {
      game: {
        map: "main",
        nearby_entities: [
          {
            id: "goo-1",
            kind: "monster",
            name: "Green Goo",
            x: 110.2,
            y: 209.8,
            distance: 12,
          },
        ],
      },
    },
  ];

  const result = nearbyEntities(characters, "main");
  assert.equal(result.length, 1);
  assert.equal(result[0].distance, 12);
});

test("scene NPCs and bounds filtering support dashboard overlays", () => {
  assert.deepEqual(
    sceneNpcs({
      npcs: [{ id: "pots", name: "Pots", x: 25, y: 35 }],
    }),
    [{ id: "pots", name: "Pots", x: 25, y: 35, kind: "npc" }],
  );
  assert.equal(
    pointInBounds(
      { x: 25, y: 35 },
      { minX: 0, minY: 0, width: 100, height: 100 },
    ),
    true,
  );
});

test("map background keeps only visible placements and unique original assets", () => {
  const scene = {
    tiles: [
      {
        file: "/images/tiles/map/custom.png?v=17",
        width: 32,
        height: 32,
      },
      {
        file: "/images/tiles/map/custom.png?v=17",
        width: 16,
        height: 16,
      },
    ],
  };

  assert.deepEqual(collectSceneAssetFiles(scene), [
    "/images/tiles/map/custom.png?v=17",
  ]);
  assert.equal(
    placementIntersectsBounds(scene, [0, 10, 20], {
      minX: 0,
      minY: 0,
      width: 100,
      height: 100,
    }),
    true,
  );
  assert.equal(
    placementIntersectsBounds(scene, [0, 300, 400], {
      minX: 0,
      minY: 0,
      width: 100,
      height: 100,
    }),
    false,
  );
});

test("map telemetry projects original tiles, static NPCs and nearby live monsters", () => {
  const game = {
    current_map: "main",
    character: {
      name: "My_Ranger1",
      map: "main",
      x: 100,
      y: 200,
    },
    G: {
      geometry: {
        main: {
          min_x: -500,
          min_y: -400,
          max_x: 900,
          max_y: 800,
          default: 0,
          tiles: [["outside", 0, 0, 32, 32]],
          placements: [[0, -100, -100, 100, 100]],
        },
      },
      tilesets: {
        outside: {
          file: "/images/tiles/map/outside.png?v=7",
        },
      },
      maps: {
        main: {
          name: "Town",
          npcs: [{ id: "pots", name: "Pots", position: [112, 40] }],
        },
      },
      npcs: {
        pots: { name: "Pots" },
      },
      monsters: {
        goo: { name: "Green Goo" },
      },
    },
    entities: {
      one: {
        id: "goo-1",
        mtype: "goo",
        x: 130,
        y: 220,
        hp: 80,
        max_hp: 100,
      },
      far: {
        id: "goo-far",
        mtype: "goo",
        x: 5000,
        y: 5000,
      },
    },
  };

  const scene = publicMapScene(game);
  assert.equal(scene.map, "main");
  assert.equal(scene.tiles[0].file, "/images/tiles/map/outside.png?v=7");
  assert.deepEqual(scene.npcs[0], {
    id: "pots",
    name: "Pots",
    x: 112,
    y: 40,
  });

  const entities = publicNearbyEntities(game);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].kind, "monster");
  assert.equal(entities[0].name, "Green Goo");
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  build_stat_beat,
  public_item,
  public_item_icon,
  public_smart_plot,
} = require("../monitoring_util");
const { publicLiveState } = require("../src/HeadlessDashboard");
const {
  TRAIL_RETENTION_MS,
  deriveHeading,
  updateCharacterLiveState,
  updateCharacterMovementRuntime,
} = require("../src/LiveState");

test("stat beat exposes safe live character, inventory and equipment state", () => {
  const game = {
    character: {
      name: "My_Ranger1",
      ctype: "ranger",
      map: "main",
      real_x: 100,
      real_y: 200,
      moving: true,
      going_x: 140,
      going_y: 220,
      hp: 900,
      max_hp: 1000,
      mp: 450,
      max_mp: 500,
      level: 42,
      xp: 123,
      max_xp: 999,
      gold: 123456,
      party: "My_Ranger1",
      isize: 42,
      esize: 5,
      target: "monster-1",
      items: [
        {
          name: "hpot1",
          q: 123,
          locked: true,
          secret: "must-not-leak",
        },
        null,
      ],
      slots: {
        mainhand: {
          name: "bow",
          level: 8,
          locked: true,
          internal: "must-not-leak",
        },
      },
    },
    entities: {
      "monster-1": {
        name: "Target",
        mtype: "goo",
        real_x: 130,
        real_y: 205,
        hp: 500,
        max_hp: 800,
        target: "My_Ranger1",
      },
    },
    current_map: "main",
    current_status: "Code Active",
    smart: {
      moving: true,
      searching: false,
      map: "main",
      x: 300,
      y: 400,
      plot: [
        { map: "main", x: 150, y: 250 },
        { map: "main", x: 300, y: 400 },
      ],
    },
    caracAL: {
      map_enabled: () => false,
    },
  };

  const beat = build_stat_beat(game);

  assert.equal(beat.name, "My_Ranger1");
  assert.equal(beat.ctype, "ranger");
  assert.equal(beat.map, "main");
  assert.equal(beat.x, 100);
  assert.equal(beat.y, 200);
  assert.equal(beat.going_x, 140);
  assert.equal(beat.going_y, 220);
  assert.deepEqual(beat.items[0], {
    name: "hpot1",
    q: 123,
    locked: true,
  });
  assert.deepEqual(beat.slots.mainhand, {
    name: "bow",
    level: 8,
    locked: true,
  });
  assert.equal(JSON.stringify(beat).includes("must-not-leak"), false);
  assert.equal(beat.target.mtype, "goo");
  assert.equal(beat.target.x, 130);
  assert.equal(beat.movement_state, "SMART_MOVING");
  assert.equal(beat.planned_path.length, 2);
  assert.deepEqual(beat.planned_destination, {
    map: "main",
    x: 300,
    y: 400,
    searching: false,
  });
});

test("smart_move projection exposes only route geometry", () => {
  const plot = public_smart_plot({
    plot: [
      {
        map: "main",
        x: 10,
        y: 20,
        transport: false,
        secret: "must-not-leak",
      },
      {
        map: "cave",
        x: 30,
        y: 40,
        transport: true,
        s: 2,
      },
    ],
  });

  assert.deepEqual(plot, [
    {
      map: "main",
      x: 10,
      y: 20,
      transport: false,
      town: false,
      spawn: null,
    },
    {
      map: "cave",
      x: 30,
      y: 40,
      transport: true,
      town: false,
      spawn: 2,
    },
  ]);
  assert.equal(JSON.stringify(plot).includes("must-not-leak"), false);
});

test("item icon projection follows Adventure Land sprite metadata", () => {
  const gameData = {
    items: {
      hpot1: {
        name: "HP Potion",
        type: "pot",
        skin: "hpot1",
      },
    },
    positions: {
      hpot1: ["", 2, 3],
    },
    imagesets: {
      pack_20: {
        file: "/images/tiles/items/pack_20vt8.png",
        size: 20,
        rows: 64,
        columns: 16,
      },
    },
  };

  assert.deepEqual(public_item_icon("hpot1", gameData), {
    skin: "hpot1",
    file: "/images/tiles/items/pack_20vt8.png",
    x: 2,
    y: 3,
    size: 20,
    rows: 64,
    columns: 16,
  });

  assert.deepEqual(public_item({ name: "hpot1", q: 25 }, gameData), {
    name: "hpot1",
    q: 25,
    display_name: "HP Potion",
    item_type: "pot",
    icon: {
      skin: "hpot1",
      file: "/images/tiles/items/pack_20vt8.png",
      x: 2,
      y: 3,
      size: 20,
      rows: 64,
      columns: 16,
    },
  });
});

test("public item projection excludes unknown runtime fields", () => {
  assert.deepEqual(
    public_item({
      name: "ring",
      level: 3,
      q: 1,
      p: "shiny",
      random_internal_field: "hidden",
    }),
    {
      name: "ring",
      level: 3,
      q: 1,
      p: "shiny",
    },
  );
});

test("movement heading is derived from actual displacement", () => {
  assert.equal(Math.round(deriveHeading({ x: 0, y: 0 }, { x: 10, y: 0 })), 0);
  assert.equal(Math.round(deriveHeading({ x: 0, y: 0 }, { x: 0, y: 10 })), 90);
  assert.equal(
    Math.round(deriveHeading({ x: 0, y: 0 }, { x: -10, y: 0 })),
    180,
  );
});

test("live state records actual trail and current movement destination", () => {
  const block = {};

  updateCharacterLiveState(
    block,
    {
      type: "stat_beat",
      map: "main",
      x: 10,
      y: 20,
      moving: true,
      going_x: 50,
      going_y: 60,
      items: [],
      slots: {},
    },
    10000,
  );
  updateCharacterLiveState(
    block,
    {
      type: "stat_beat",
      map: "main",
      x: 20,
      y: 20,
      moving: true,
      going_x: 50,
      going_y: 60,
      items: [],
      slots: {},
    },
    10500,
  );

  assert.equal(block.live_state.type, undefined);
  assert.equal(block.live_state.movement_destination.x, 50);
  assert.equal(Math.round(block.live_state.heading), 0);
  assert.equal(block.movement_trail.length, 2);
});

test("movement trail is pruned to five minutes", () => {
  const block = {
    movement_trail: [
      {
        timestamp: 1000,
        map: "main",
        x: 0,
        y: 0,
        heading: 0,
      },
    ],
  };
  const now = 1000 + TRAIL_RETENTION_MS + 1;

  updateCharacterLiveState(
    block,
    {
      map: "main",
      x: 10,
      y: 0,
      moving: false,
      items: [],
      slots: {},
    },
    now,
  );

  assert.equal(
    block.movement_trail.some((point) => point.timestamp === 1000),
    false,
  );
});

test("dashboard live-state projection rejects unrelated fields", () => {
  const live = publicLiveState({
    map: "main",
    x: 1,
    y: 2,
    hp: 100,
    items: [{ name: "hpot1" }],
    slots: { mainhand: { name: "bow" } },
    session: "must-not-leak",
    arbitrary_private_field: "must-not-leak",
  });

  assert.equal(live.map, "main");
  assert.equal(live.x, 1);
  assert.equal(live.items[0].name, "hpot1");
  assert.equal(JSON.stringify(live).includes("must-not-leak"), false);
});


test("runtime movement telemetry survives stat beats and exposes controller plan", () => {
  const block = {};

  updateCharacterMovementRuntime(
    block,
    {
      owner: "Farm",
      mode: "PATH",
      path: {
        id: 3,
        owner: "Farm",
        startedAt: 9000,
        index: 1,
        total: 3,
        current: { x: 50, y: 60, tolerance: 4 },
        destination: { map: "main", x: 90, y: 100 },
        remaining: [
          { x: 50, y: 60, tolerance: 4 },
          { map: "main", x: 90, y: 100 },
        ],
      },
      safePoint: {
        map: "main",
        x: 10,
        y: 20,
        tolerance: 5,
        source: "CURRENT_POSITION",
        capturedAt: 8000,
      },
      stuck: {
        commandKey: "Farm:7",
        stuck: true,
        stuckSince: 9800,
        lastProgressAt: 9200,
        lastPosition: { map: "main", x: 40, y: 50, moving: true },
      },
      active: {
        id: 7,
        type: "DIRECT",
        owner: "Farm",
        module: "Farm",
        reason: "PATROL_ROUTE:WAYPOINT_2",
        correlationId: "PATH-3",
        startedAt: 9100,
        actionId: "A-7",
        target: { x: 50, y: 60 },
      },
    },
    {
      timestamp: 10000,
      eventType: "MOVEMENT_STUCK",
      eventReason: null,
    },
  );

  updateCharacterLiveState(
    block,
    {
      type: "stat_beat",
      map: "main",
      x: 40,
      y: 50,
      moving: false,
      planned_path: [],
      planned_destination: null,
      items: [],
      slots: {},
    },
    10100,
  );

  assert.equal(block.live_state.movement_mode, "PATH");
  assert.equal(block.live_state.movement_owner, "Farm");
  assert.equal(
    block.live_state.movement_reason,
    "PATROL_ROUTE:WAYPOINT_2",
  );
  assert.equal(block.live_state.movement_command.actionId, "A-7");
  assert.equal(block.live_state.movement_stuck.stuck, true);
  assert.equal(block.live_state.safe_point.source, "CURRENT_POSITION");
  assert.deepEqual(block.live_state.runtime_planned_path, [
    { map: "main", x: 50, y: 60, tolerance: 4 },
    { map: "main", x: 90, y: 100 },
  ]);
  assert.deepEqual(block.live_state.runtime_planned_destination, {
    map: "main",
    x: 90,
    y: 100,
  });

  updateCharacterLiveState(
    block,
    {
      type: "stat_beat",
      map: "main",
      x: 42,
      y: 50,
      moving: true,
      items: [],
      slots: {},
    },
    10200,
  );

  assert.equal(block.live_state.movement_owner, "Farm");
  assert.equal(block.live_state.movement_mode, "PATH");
  assert.equal(block.live_state.movement_stuck.stuck, true);
});

test("dashboard projection includes movement telemetry without arbitrary fields", () => {
  const live = publicLiveState({
    map: "main",
    x: 1,
    y: 2,
    movement_mode: "RETURN",
    movement_owner: "Safety",
    movement_reason: "RETURN_SAFE",
    movement_command: { id: 4, type: "SMART" },
    movement_stuck: { stuck: false },
    runtime_planned_path: [{ map: "main", x: 10, y: 20 }],
    runtime_planned_destination: { map: "main", x: 30, y: 40 },
    safe_point: { map: "main", x: 30, y: 40 },
    movement_runtime: {
      owner: "Safety",
      mode: "RETURN",
      arbitrary_private_field: "nested-value-is-runtime-sanitized-upstream",
    },
    unrelated_secret: "must-not-leak",
  });

  assert.equal(live.movement_mode, "RETURN");
  assert.equal(live.movement_owner, "Safety");
  assert.equal(live.movement_reason, "RETURN_SAFE");
  assert.equal(live.runtime_planned_path.length, 1);
  assert.equal(live.safe_point.x, 30);
  assert.equal(JSON.stringify(live).includes("must-not-leak"), false);
});

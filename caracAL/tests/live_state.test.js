"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { build_stat_beat, public_item } = require("../monitoring_util");
const { publicLiveState } = require("../src/HeadlessDashboard");
const {
  TRAIL_RETENTION_MS,
  deriveHeading,
  updateCharacterLiveState,
} = require("../src/LiveState");

test(
  "stat beat exposes safe live character, inventory and equipment state",
  () => {
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
  },
);

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
  assert.equal(
    Math.round(deriveHeading({ x: 0, y: 0 }, { x: 0, y: 10 })),
    90,
  );
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

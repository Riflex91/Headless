"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { selectGroupPair } = require("../scripts/run_group_live_e2e");

test("group launcher selects two owned non-merchants and prefers idle pair", () => {
  const pair = selectGroupPair({
    characters: [
      {
        name: "Busy",
        ctype: "ranger",
        account_owned: true,
        connected: true,
        desired_runtime_state: "RUNNING",
      },
      {
        name: "IdleA",
        ctype: "ranger",
        account_owned: true,
        connected: false,
        desired_runtime_state: "STOPPED",
      },
      {
        name: "IdleB",
        ctype: "warrior",
        account_owned: true,
        connected: false,
        desired_runtime_state: "STOPPED",
      },
      {
        name: "Merchant",
        ctype: "merchant",
        account_owned: true,
        connected: false,
      },
    ],
  });

  assert.equal(pair.leader.name, "IdleA");
  assert.equal(pair.follower.name, "IdleB");
});

test("group launcher respects explicit distinct pair", () => {
  const pair = selectGroupPair(
    {
      characters: [
        { name: "A", ctype: "ranger", account_owned: true },
        { name: "B", ctype: "warrior", account_owned: true },
      ],
    },
    "B",
    "A",
  );

  assert.equal(pair.leader.name, "B");
  assert.equal(pair.follower.name, "A");
});

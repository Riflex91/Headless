"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { selectRanger } = require("../scripts/run_class_skill_live_e2e");

test("class skill launcher prefers an online owned Ranger", () => {
  const ranger = selectRanger({
    characters: [
      {
        name: "Warrior",
        ctype: "warrior",
        account_owned: true,
        connected: true,
        lifecycle_state: "ONLINE",
      },
      {
        name: "RangerOffline",
        ctype: "ranger",
        account_owned: true,
        connected: false,
        enabled: true,
      },
      {
        name: "RangerOnline",
        ctype: "ranger",
        account_owned: true,
        connected: true,
        lifecycle_state: "ONLINE",
      },
    ],
  });

  assert.equal(ranger.name, "RangerOnline");
});

test("class skill launcher rejects requested non-ranger", () => {
  assert.throws(
    () =>
      selectRanger(
        {
          characters: [
            {
              name: "Warrior",
              ctype: "warrior",
              account_owned: true,
            },
          ],
        },
        "Warrior",
      ),
    /requires a Ranger/,
  );
});

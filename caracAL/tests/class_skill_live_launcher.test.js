"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseArguments,
  selectMerchant,
  selectRanger,
} = require("../scripts/run_class_skill_live_e2e");

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

test("class skill launcher selects an owned Merchant for Merchant mode", () => {
  const merchant = selectMerchant({
    characters: [
      {
        name: "My_Merchant",
        ctype: "merchant",
        account_owned: true,
        connected: true,
        lifecycle_state: "ONLINE",
      },
      {
        name: "My_Ranger1",
        ctype: "ranger",
        account_owned: true,
        connected: true,
        lifecycle_state: "ONLINE",
      },
    ],
  });

  assert.equal(merchant.name, "My_Merchant");
});

test(
  "class skill launcher parses Merchant live mode without platform-specific env syntax",
  () => {
    assert.deepEqual(parseArguments(["--merchant"]), {
      ctype: "merchant",
      requested: null,
    });
    assert.deepEqual(parseArguments(["--merchant", "My_Merchant"]), {
      ctype: "merchant",
      requested: "My_Merchant",
    });
  },
);

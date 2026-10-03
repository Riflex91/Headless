"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function loadPlanner() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "compound-gather-plan.lib.ts",
    ),
  ).planCompoundGatherTarget;
}

test("Compound gather planner selects a compoundable direct monster drop", () => {
  const planCompoundGatherTarget = loadPlanner();
  const game = {
    gameData() {
      return {
        items: {
          ring: { type: "ring", compound: { dex: 1 } },
          junk: { type: "material" },
        },
        monsters: {
          goo: {
            hp: 100,
            drop: [
              [0.5, "junk"],
              [0.2, "ring"],
            ],
          },
        },
      };
    },
    itemGrade(item) {
      return item.name === "ring" ? 0 : null;
    },
  };

  const result = planCompoundGatherTarget(game);

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "COMPOUND_GATHER_TARGET_SELECTED");
  assert.equal(result.selected.itemName, "ring");
  assert.equal(result.selected.monsterType, "goo");
  assert.equal(result.selected.itemGrade, 0);
  assert.equal(result.selected.scrollName, "cscroll0");
  assert.equal(result.selected.dropChance, 0.2);
});

test("Compound gather planner resolves named drop tables", () => {
  const planCompoundGatherTarget = loadPlanner();
  const game = {
    gameData() {
      return {
        items: {
          earring: { type: "earring", compound: { int: 1 } },
        },
        drops: {
          accessory_drop: [[0.25, "earring"]],
        },
        monsters: {
          bee: {
            hp: 50,
            drop: [[0.5, "accessory_drop"]],
          },
        },
      };
    },
    itemGrade() {
      return 0;
    },
  };

  const result = planCompoundGatherTarget(game);

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.itemName, "earring");
  assert.equal(result.selected.monsterType, "bee");
  assert.equal(result.selected.dropChance, 0.125);
});

test("Compound gather planner prefers better expected farming yield", () => {
  const planCompoundGatherTarget = loadPlanner();
  const game = {
    gameData() {
      return {
        items: {
          ring: { compound: { dex: 1 } },
          earring: { compound: { int: 1 } },
        },
        monsters: {
          slow: {
            hp: 1000,
            drop: [[0.5, "ring"]],
          },
          fast: {
            hp: 100,
            drop: [[0.2, "earring"]],
          },
        },
      };
    },
    itemGrade() {
      return 0;
    },
  };

  const result = planCompoundGatherTarget(game);

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.itemName, "earring");
  assert.equal(result.selected.monsterType, "fast");
});

test("Compound gather planner refuses unknown item grades", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          ring: { compound: { dex: 1 } },
        },
        monsters: {
          goo: {
            hp: 100,
            drop: [[1, "ring"]],
          },
        },
      };
    },
    itemGrade() {
      return null;
    },
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "COMPOUND_GATHER_TARGET_NOT_FOUND");
  assert.equal(result.selected, null);
});

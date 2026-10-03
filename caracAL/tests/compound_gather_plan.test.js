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

test("Compound gather planner reads real G.drops.monsters shape", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          intearring: {
            type: "earring",
            compound: { int: 2 },
          },
          firestaff: {
            type: "staff",
            upgrade: { attack: 1 },
          },
        },
        monsters: {
          mvampire: {
            hp: 240000,
          },
        },
        drops: {
          monsters: {
            mvampire: [
              [0.1, "intearring"],
              [0.05, "firestaff"],
            ],
          },
        },
      };
    },
    itemGrade(item) {
      return item.name === "intearring" ? 0 : null;
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "COMPOUND_GATHER_TARGET_SELECTED");
  assert.equal(result.selected.itemName, "intearring");
  assert.equal(result.selected.monsterType, "mvampire");
  assert.equal(result.selected.dropChance, 0.1);
  assert.equal(result.selected.scrollName, "cscroll0");
});

test("Compound gather planner resolves open tables from G.drops.monsters", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          hpamulet: {
            type: "amulet",
            compound: { hp: 20 },
          },
          junk1: { type: "material" },
          junk2: { type: "material" },
        },
        monsters: {
          fvampire: {
            hp: 120000,
          },
        },
        drops: {
          monsters: {
            fvampire: [[0.3, "open", "statamulet"]],
          },
          statamulet: [
            [1, "hpamulet"],
            [1, "junk1"],
            [2, "junk2"],
          ],
        },
      };
    },
    itemGrade(item) {
      return item.name === "hpamulet" ? 0 : null;
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.itemName, "hpamulet");
  assert.equal(result.selected.monsterType, "fvampire");
  assert.equal(result.selected.dropChance, 0.075);
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

test("Compound gather planner accepts object-mapped monster drops", () => {
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
            drop: {
              ring: 0.4,
            },
          },
        },
      };
    },
    itemGrade() {
      return 0;
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.itemName, "ring");
  assert.equal(result.selected.dropChance, 0.4);
});

test("Compound gather planner ignores drop metadata after direct item name", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          direct: { compound: { dex: 1 } },
          metadata_item: { compound: { int: 1 } },
        },
        monsters: {
          goo: {
            hp: 100,
          },
        },
        drops: {
          monsters: {
            goo: [[0.5, "direct", 1, "metadata_item"]],
          },
        },
      };
    },
    itemGrade() {
      return 0;
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.itemName, "direct");
  assert.equal(
    result.candidates.some((entry) => entry.itemName === "metadata_item"),
    false,
  );
});

test("Compound gather planner excludes non-regular special spawns when map spawns exist", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          rare_ring: { compound: { dex: 1 } },
          farm_ring: { compound: { dex: 1 } },
        },
        monsters: {
          cutebee: { hp: 300 },
          bat: { hp: 9600 },
        },
        maps: {
          cave: {
            monsters: [
              {
                type: "bat",
                count: 4,
              },
            ],
          },
        },
        drops: {
          monsters: {
            cutebee: [[1, "rare_ring"]],
            bat: [[0.004, "farm_ring"]],
          },
        },
      };
    },
    itemGrade() {
      return 0;
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.monsterType, "bat");
  assert.equal(result.selected.itemName, "farm_ring");
  assert.equal(
    result.candidates.some((entry) => entry.monsterType === "cutebee"),
    false,
  );
});

test("Compound gather planner prefers an existing Merchant inventory triple", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          amulet: { type: "amulet", compound: { int: 1 } },
          ring: { type: "ring", compound: { dex: 1 } },
        },
        monsters: {
          goo: {
            hp: 100,
            drop: [[1, "ring"]],
          },
        },
      };
    },
    inventory() {
      return [
        { slot: 1, item: { name: "amulet", level: 2 } },
        { slot: 4, item: { name: "amulet", level: 2 } },
        { slot: 7, item: { name: "amulet", level: 2 } },
        { slot: 12, item: { name: "cscroll0", q: 40 } },
      ];
    },
    itemGrade(item) {
      return item.name === "amulet" ? 0 : 0;
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.source, "MERCHANT_INVENTORY");
  assert.equal(result.selected.itemName, "amulet");
  assert.equal(result.selected.itemLevel, 2);
  assert.deepEqual(result.selected.itemSlots, [1, 4, 7]);
  assert.equal(result.selected.monsterType, null);
  assert.equal(result.selected.scrollName, "cscroll0");
  assert.deepEqual(result.selected.scrollSlots, [12]);
  assert.equal(result.selected.scrollQuantity, 40);
});

test("Compound gather planner falls back to monster farming without a full inventory triple", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          amulet: { type: "amulet", compound: { int: 1 } },
          ring: { type: "ring", compound: { dex: 1 } },
        },
        monsters: {
          goo: {
            hp: 100,
            drop: [[1, "ring"]],
          },
        },
      };
    },
    inventory() {
      return [
        { slot: 1, item: { name: "amulet", level: 2 } },
        { slot: 4, item: { name: "amulet", level: 2 } },
      ];
    },
    itemGrade() {
      return 0;
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.selected.source, "MONSTER_DROP");
  assert.equal(result.selected.itemName, "ring");
  assert.equal(result.selected.itemLevel, 0);
  assert.deepEqual(result.selected.itemSlots, []);
  assert.equal(result.selected.monsterType, "goo");
});

test("Compound gather planner reports observer position from runtime snapshot", () => {
  const planCompoundGatherTarget = loadPlanner();
  const result = planCompoundGatherTarget({
    gameData() {
      return {
        items: {
          ring: { compound: { dex: 1 } },
        },
        monsters: {
          goo: { hp: 100, drop: [[1, "ring"]] },
        },
      };
    },
    itemGrade() {
      return 0;
    },
    character() {
      return {
        map: "main",
        x: 123,
        y: -45,
      };
    },
  });

  assert.deepEqual(result.observerPosition, {
    map: "main",
    x: 123,
    y: -45,
  });
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

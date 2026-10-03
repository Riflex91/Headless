"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

function gameData() {
  return {
    items: {
      staff: { name: "Staff" },
      spidersilk: { name: "Spider Silk" },
      essenceoffire: { name: "Essence of Fire" },
      rod: { name: "Rod" },
      firestaff: { name: "Fire Staff" },
    },
    monsters: {
      spider: { hp: 120 },
      phoenix: { hp: 40000 },
    },
    drops: {
      monsters: {
        spider: [[1, "spidersilk"]],
        phoenix: [[0.05, "essenceoffire"]],
      },
    },
    maps: {
      main: {
        monsters: [{ type: "spider" }, { type: "phoenix" }],
      },
    },
  };
}

function craftStatus() {
  return {
    timestamp: 1000,
    enabled: true,
    state: "EMPTY",
    reason: "CRAFT_NO_ELIGIBLE_CANDIDATE",
    executionMode: "EXPLICIT_ONE_SHOT",
    selected: null,
    candidates: [],
    decisions: [
      {
        recipe: "rod",
        cost: 100,
        requirements: [
          { quantity: 1, name: "staff", level: null },
          { quantity: 1, name: "spidersilk", level: null },
        ],
        itemSlots: [39],
        eligible: false,
        reason: "CRAFT_INGREDIENTS_INSUFFICIENT",
      },
      {
        recipe: "firestaff",
        cost: 20000,
        requirements: [
          { quantity: 1, name: "staff", level: null },
          { quantity: 1, name: "essenceoffire", level: null },
        ],
        itemSlots: [39],
        eligible: false,
        reason: "CRAFT_INGREDIENTS_INSUFFICIENT",
      },
    ],
    unknownHold: null,
    lastAction: null,
    summary: {
      configuredRecipes: 2,
      eligibleCandidates: 0,
      protectedIngredients: 0,
      insufficientIngredients: 2,
      insufficientGoldRecipes: 0,
    },
  };
}

test("Craft material planner chooses the cheapest near-ready gatherable recipe", () => {
  const { planCraftMaterialPreparation } = core(
    "craft-material-preparation-plan.lib.ts",
  );

  const result = planCraftMaterialPreparation(gameData(), craftStatus());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_MATERIAL_TARGET_SELECTED");
  assert.equal(result.selected.recipe, "rod");
  assert.deepEqual(result.selected.existingItemSlots, [39]);
  assert.deepEqual(result.selected.missingRequirement, {
    quantity: 1,
    name: "spidersilk",
    level: null,
  });
  assert.equal(result.selected.source.monsterType, "spider");
  assert.equal(result.selected.source.itemName, "spidersilk");
  assert.equal(result.selected.source.dropChance, 1);
});

test("Craft material planner carries the runtime observer position", () => {
  const { planCraftMaterialPreparation } = core(
    "craft-material-preparation-plan.lib.ts",
  );

  const result = planCraftMaterialPreparation(gameData(), craftStatus(), {
    recipe: "rod",
    observerPosition: { map: "main", x: -25, y: -478 },
  });

  assert.deepEqual(result.observerPosition, {
    map: "main",
    x: -25,
    y: -478,
  });
  assert.equal(result.selected.sourcePolicy.safe, true);
  assert.deepEqual(result.selected.sourcePolicy.spawnMaps, ["main"]);
  assert.equal(result.selected.sourcePolicy.expectedKills, 1);
  assert.equal(result.selected.sourcePolicy.expectedMonsterHp, 120);
});

test("Craft material planner rejects boss and statistically excessive sources", () => {
  const { planCraftMaterialPreparation } = core(
    "craft-material-preparation-plan.lib.ts",
  );
  const data = gameData();
  data.monsters = {
    spider: { hp: 18000, attack: 80 },
    spiderbl: {
      hp: 4500000,
      attack: 1200,
      stationary: true,
      respawn: -1,
    },
  };
  data.drops.monsters = {
    spider: [[0.001, "spidersilk"]],
    spiderbl: [[1, "spidersilk"]],
  };
  data.maps = {
    main: { monsters: [{ type: "spider" }] },
    spider_instance: {
      instance: true,
      monsters: [{ type: "spiderbl" }],
    },
  };

  const result = planCraftMaterialPreparation(data, craftStatus(), {
    recipe: "rod",
    observerPosition: { map: "main", x: 1, y: 2 },
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CRAFT_MATERIAL_SAFE_SOURCE_NOT_FOUND");
  assert.equal(result.selected, null);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejectedSources.length, 2);

  const normalSpider = result.rejectedSources.find(
    (entry) => entry.source.monsterType === "spider",
  );
  const blackSpider = result.rejectedSources.find(
    (entry) => entry.source.monsterType === "spiderbl",
  );
  assert.ok(normalSpider);
  assert.ok(blackSpider);
  assert.equal(normalSpider.sourcePolicy.expectedKills, 1000);
  assert.ok(
    normalSpider.sourcePolicy.reasons.includes(
      "EXPECTED_KILLS_OUT_OF_POLICY",
    ),
  );
  assert.ok(
    normalSpider.sourcePolicy.reasons.includes(
      "EXPECTED_MONSTER_HP_OUT_OF_POLICY",
    ),
  );
  assert.ok(
    blackSpider.sourcePolicy.reasons.includes("NO_SAFE_REGULAR_SPAWN"),
  );
  assert.ok(
    blackSpider.sourcePolicy.reasons.includes("MONSTER_HP_OUT_OF_POLICY"),
  );
  assert.ok(
    blackSpider.sourcePolicy.reasons.includes(
      "MONSTER_ATTACK_OUT_OF_POLICY",
    ),
  );
  assert.ok(
    blackSpider.sourcePolicy.reasons.includes(
      "STATIONARY_MONSTER_BLOCKED",
    ),
  );
});

test("Craft material planner honors an explicit recipe", () => {
  const { planCraftMaterialPreparation } = core(
    "craft-material-preparation-plan.lib.ts",
  );

  const result = planCraftMaterialPreparation(gameData(), craftStatus(), {
    recipe: "firestaff",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.requestedRecipe, "firestaff");
  assert.equal(result.selected.recipe, "firestaff");
  assert.equal(result.selected.missingRequirement.name, "essenceoffire");
  assert.equal(result.selected.source.monsterType, "phoenix");
});

test("Craft material planner rejects recipes missing more than one trailing ingredient", () => {
  const { planCraftMaterialPreparation } = core(
    "craft-material-preparation-plan.lib.ts",
  );
  const status = craftStatus();
  status.decisions = [
    {
      recipe: "rod",
      cost: 100,
      requirements: [
        { quantity: 1, name: "staff", level: null },
        { quantity: 1, name: "spidersilk", level: null },
      ],
      itemSlots: [],
      eligible: false,
      reason: "CRAFT_INGREDIENTS_INSUFFICIENT",
    },
  ];

  const result = planCraftMaterialPreparation(gameData(), status);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CRAFT_MATERIAL_TARGET_NOT_FOUND");
  assert.equal(result.selected, null);
});

test("Craft material planner does not gather upgraded recipe ingredients", () => {
  const { planCraftMaterialPreparation } = core(
    "craft-material-preparation-plan.lib.ts",
  );
  const status = craftStatus();
  status.decisions = [
    {
      recipe: "rod",
      cost: 100,
      requirements: [
        { quantity: 1, name: "staff", level: null },
        { quantity: 1, name: "spidersilk", level: 2 },
      ],
      itemSlots: [39],
      eligible: false,
      reason: "CRAFT_INGREDIENTS_INSUFFICIENT",
    },
  ];

  const result = planCraftMaterialPreparation(gameData(), status);

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.selected, null);
});

test("Craft material planner reports explicit recipe already ready without gathering", () => {
  const { planCraftMaterialPreparation } = core(
    "craft-material-preparation-plan.lib.ts",
  );
  const status = craftStatus();
  status.state = "READY";
  status.selected = {
    recipe: "rod",
    cost: 100,
    requirements: [
      { quantity: 1, name: "staff", level: null },
      { quantity: 1, name: "spidersilk", level: null },
    ],
    itemSlots: [39, 40],
    reason: "CRAFT_POLICY_ELIGIBLE",
  };
  status.candidates = [status.selected];

  const result = planCraftMaterialPreparation(gameData(), status, {
    recipe: "rod",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CRAFT_MATERIAL_RECIPE_ALREADY_READY");
  assert.equal(result.selected, null);
});

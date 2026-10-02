"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const {
  SKILLS_BY_CLASS,
  collectConfig,
  getPath,
  renderConfigForm,
  schemaForClass,
} = require("../dashboard/config-form");

test("config form schema exposes current class skills and roadmap sections", () => {
  const ranger = schemaForClass("ranger");
  const ids = ranger.map((section) => section.id);

  for (const id of [
    "combat",
    "resources",
    "party",
    "class-skills",
    "supply",
    "farming",
    "inventory",
    "gear",
  ]) {
    assert.equal(ids.includes(id), true);
  }
  assert.equal(SKILLS_BY_CLASS.ranger.includes("track"), true);
  assert.equal(
    schemaForClass("merchant").some((section) => section.id === "merchant"),
    true,
  );
});

test("config form edits known fields while preserving unknown config", () => {
  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector("#root");
  const base = {
    combat: { enabled: false },
    classSkills: {
      ranger: {
        enabled: false,
        skills: { track: { enabled: false, priority: 1 } },
      },
    },
    customFutureBlock: { preserve: true },
  };

  renderConfigForm({
    container: root,
    config: base,
    ctype: "ranger",
    characterNames: ["Alpha", "Beta"],
  });

  root.querySelector('[data-config-path="combat.enabled"]').checked = true;
  root.querySelector(
    '[data-config-path="classSkills.ranger.enabled"]',
  ).checked = true;
  root.querySelector(
    '[data-config-path="classSkills.ranger.skills.track.enabled"]',
  ).checked = true;
  root.querySelector('[data-config-path="groupCombat.leader"]').value = "Alpha";
  root.querySelector('[data-config-path="farming.enabled"]').checked = true;
  root.querySelector('[data-config-path="farming.goalMonster"]').value = "goo";
  root.querySelector('[data-config-path="farming.preferredMonsters"]').value =
    "goo, bee";
  root.querySelector('[data-config-path="farming.weights.observed"]').value =
    "2";

  const config = collectConfig({ container: root, baseConfig: base });
  assert.equal(getPath(config, "combat.enabled"), true);
  assert.equal(getPath(config, "classSkills.ranger.enabled"), true);
  assert.equal(
    getPath(config, "classSkills.ranger.skills.track.enabled"),
    true,
  );
  assert.equal(getPath(config, "groupCombat.leader"), "Alpha");
  assert.equal(getPath(config, "farming.enabled"), true);
  assert.equal(getPath(config, "farming.goalMonster"), "goo");
  assert.deepEqual(getPath(config, "farming.preferredMonsters"), ["goo", "bee"]);
  assert.equal(getPath(config, "farming.weights.observed"), 2);
  assert.deepEqual(config.customFutureBlock, { preserve: true });
});

test("config form validates JSON-backed roadmap sections", () => {
  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector("#root");

  renderConfigForm({ container: root, config: {}, ctype: "merchant" });
  const supply = root.querySelector('[data-config-json-path="supply"]');
  supply.value = '{"potions":{"target":200}}';

  const config = collectConfig({ container: root });
  assert.deepEqual(config.supply, { potions: { target: 200 } });

  supply.value = "{broken";
  assert.throws(
    () => collectConfig({ container: root }),
    /supply: ungültiges JSON/,
  );
});

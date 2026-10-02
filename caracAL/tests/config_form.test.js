"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const {
  createEditor,
  deletePath,
  getPath,
  schemaForCharacter,
  setPath,
} = require("../dashboard/config-form");

test("config path helpers preserve unrelated nested values", () => {
  const config = {
    combat: { enabled: false, existing: 7 },
    future: { keep: true },
  };

  setPath(config, "combat.targetMaxDistance", 900);
  setPath(config, "groupCombat.tether.soft", 180);
  deletePath(config, "combat.enabled");

  assert.equal(getPath(config, "combat.targetMaxDistance"), 900);
  assert.equal(getPath(config, "groupCombat.tether.soft"), 180);
  assert.equal(config.combat.existing, 7);
  assert.equal(config.future.keep, true);
  assert.equal(config.combat.enabled, undefined);
});

test("ranger schema exposes class skills and common config sections", () => {
  const schema = schemaForCharacter({ ctype: "ranger" });
  const ids = schema.map((section) => section.id);

  for (const id of [
    "combat",
    "farming",
    "potions-supply",
    "party",
    "inventory-gear",
    "safety",
    "class-skills",
    "raw-json",
  ]) {
    assert.equal(ids.includes(id), true);
  }

  const skills = schema.find((section) => section.id === "class-skills");
  const paths = skills.fields.map((field) => field.path);
  assert.equal(paths.includes("classSkills.ranger.enabled"), true);
  assert.equal(
    paths.includes("classSkills.ranger.skills.supershot.enabled"),
    true,
  );
  assert.equal(
    paths.includes("classSkills.ranger.skills.track.priority"),
    true,
  );
});

test("merchant schema exposes dedicated merchant tabs", () => {
  const ids = schemaForCharacter({ ctype: "merchant" }).map(
    (section) => section.id,
  );

  assert.equal(ids.includes("merchant-core"), true);
  assert.equal(ids.includes("merchant-supply"), true);
  assert.equal(ids.includes("merchant-bank-exchange"), true);
  assert.equal(ids.includes("merchant-production"), true);
});

test("editor updates values without discarding unknown config", () => {
  const dom = new JSDOM("<div id='root'></div>");
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    const root = document.querySelector("#root");
    const editor = createEditor({
      container: root,
      character: { name: "Ranger", ctype: "ranger" },
      config: {
        combat: { enabled: false },
        future: { preserve: "yes" },
      },
    });

    const enabled = root.querySelector(
      '[data-config-path="combat.enabled"]',
    );
    enabled.checked = true;
    enabled.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const distance = root.querySelector(
      '[data-config-path="combat.targetMaxDistance"]',
    );
    distance.value = "950";
    distance.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const config = editor.getConfig();
    assert.equal(config.combat.enabled, true);
    assert.equal(config.combat.targetMaxDistance, 950);
    assert.equal(config.future.preserve, "yes");
  } finally {
    global.document = previousDocument;
    dom.window.close();
  }
});

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

  const config = collectConfig({ container: root, baseConfig: base });
  assert.equal(getPath(config, "combat.enabled"), true);
  assert.equal(getPath(config, "classSkills.ranger.enabled"), true);
  assert.equal(
    getPath(config, "classSkills.ranger.skills.track.enabled"),
    true,
  );
  assert.equal(getPath(config, "groupCombat.leader"), "Alpha");
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


/* CONFIG_PRETTIER_PROBE_START */
test("config UI prettier diff probe", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const nodePath = require("node:path");
  const { execFileSync } = require("node:child_process");
  const prettier = await import("prettier");
  const targets = [
    "dashboard/app.js",
    "dashboard/config-form.js",
    "dashboard/styles.css",
    "src/HeadlessDashboard.js",
  ];

  for (const relative of targets) {
    const absolute = nodePath.join(__dirname, "..", relative);
    const original = fs.readFileSync(absolute, "utf8");
    const formatted = await prettier.format(original, { filepath: absolute });
    const tempDir = fs.mkdtempSync(
      nodePath.join(os.tmpdir(), "config-prettier-"),
    );
    const before = nodePath.join(tempDir, "before");
    const after = nodePath.join(tempDir, "after");
    fs.writeFileSync(before, original, "utf8");
    fs.writeFileSync(after, formatted, "utf8");

    let diff = "";
    try {
      execFileSync(
        "git",
        ["diff", "--no-index", "--unified=4", "--", before, after],
        { encoding: "utf8" },
      );
    } catch (error) {
      diff = String(error.stdout || "");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const pathToken = Buffer.from(relative, "utf8").toString("base64");
    const encoded = Buffer.from(diff, "utf8").toString("base64");
    for (
      let offset = 0, part = 0;
      offset < encoded.length;
      offset += 600, part += 1
    ) {
      console.log(
        "CONFIG_PRETTIER_DIFF|" +
          pathToken +
          "|" +
          String(part).padStart(3, "0") +
          "|" +
          encoded.slice(offset, offset + 600),
      );
    }
    console.log(
      "CONFIG_PRETTIER_LENGTH|" + pathToken + "|" + String(diff.length),
    );
  }
});
/* CONFIG_PRETTIER_PROBE_END */

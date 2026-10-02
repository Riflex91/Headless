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

/* CONFIG_UI_PRETTIER_PROBE_START */
test("config ui prettier diff probe", async () => {
  const fs = require("node:fs");
  const nodePath = require("node:path");
  const prettier = await import("prettier");
  const targets = [
    "dashboard/app.js",
    "dashboard/config-form.js",
    "dashboard/styles.css",
    "tests/config_form.test.js",
    "tests/config_push_integration.test.js",
    "tests/headless_dashboard.test.js",
  ];

  const anchorMatch = (left, right, ai, bj) => {
    if (left[ai] !== right[bj]) return false;
    let matches = 0;
    for (
      let k = 0;
      k < 4 && ai + k < left.length && bj + k < right.length;
      k += 1
    ) {
      if (left[ai + k] !== right[bj + k]) break;
      matches += 1;
    }
    return matches >= 2 || ai === left.length - 1 || bj === right.length - 1;
  };

  for (const relative of targets) {
    const absolute = nodePath.join(__dirname, "..", relative);
    let original = fs.readFileSync(absolute, "utf8");
    if (relative === "tests/config_form.test.js") {
      original = original.replace(
        /\n\/\* CONFIG_UI_PRETTIER_PROBE_START \*\/[\s\S]*\/\* CONFIG_UI_PRETTIER_PROBE_END \*\/\n?$/,
        "\n",
      );
    }
    const formatted = await prettier.format(original, { filepath: absolute });
    const left = original.replace(/\r\n/g, "\n").split("\n");
    const right = formatted.replace(/\r\n/g, "\n").split("\n");
    const hunks = [];
    let i = 0;
    let j = 0;

    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        i += 1;
        j += 1;
        continue;
      }

      let best = null;
      for (let di = 0; di <= 100 && i + di < left.length; di += 1) {
        for (let dj = 0; dj <= 100 && j + dj < right.length; dj += 1) {
          if (di === 0 && dj === 0) continue;
          if (!anchorMatch(left, right, i + di, j + dj)) continue;
          const score = di + dj;
          if (!best || score < best.score) best = { di, dj, score };
        }
      }

      if (!best) {
        hunks.push({
          start: i,
          end: left.length,
          replacement: right.slice(j),
        });
        i = left.length;
        j = right.length;
        break;
      }

      hunks.push({
        start: i,
        end: i + best.di,
        replacement: right.slice(j, j + best.dj),
      });
      i += best.di;
      j += best.dj;
    }

    const compact = hunks.filter(
      (hunk) => hunk.start !== hunk.end || hunk.replacement.length > 0,
    );
    const pathToken = Buffer.from(relative, "utf8").toString("base64");
    compact.forEach((hunk, index) => {
      const encoded = Buffer.from(JSON.stringify(hunk), "utf8").toString(
        "base64",
      );
      for (
        let offset = 0, part = 0;
        offset < encoded.length;
        offset += 500, part += 1
      ) {
        console.log(
          "CONFIG_UI_HUNK|" +
            pathToken +
            "|" +
            String(index).padStart(3, "0") +
            "|" +
            String(part).padStart(3, "0") +
            "|" +
            encoded.slice(offset, offset + 500),
        );
      }
    });
    console.log(
      "CONFIG_UI_HUNK_COUNT|" + pathToken + "|" + String(compact.length),
    );
  }
});
/* CONFIG_UI_PRETTIER_PROBE_END */


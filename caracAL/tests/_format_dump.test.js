"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

const FILES = [
  "scripts/run_compound_prepare.js",
  "src/HeadlessDashboard.js",
  "standalones/CharacterCoordinator.js",
  "tests/compound_controller.test.js",
  "tests/compound_prepare_launcher.test.js",
];

test("temporary Prettier 3.0.3 format dump", async () => {
  const root = path.join(__dirname, "..");
  for (const relative of FILES) {
    const full = path.join(root, relative);
    const source = fs.readFileSync(full, "utf8");
    const formatted = await prettier.format(source, {
      filepath: full,
    });
    if (formatted === source) continue;
    process.stdout.write(
      "PRETTIER_FORMATTED:" +
        relative +
        ":" +
        Buffer.from(formatted, "utf8").toString("base64") +
        "\n",
    );
  }
});

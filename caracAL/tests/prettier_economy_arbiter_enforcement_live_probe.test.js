"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

test("print exact Prettier output for Economy Arbiter enforcement live files", async () => {
  for (const relative of [
    "../standalones/CharacterCoordinator.js",
    "economy_arbiter_enforcement_live_launcher.test.js",
  ]) {
    const file = path.join(__dirname, relative);
    const source = fs.readFileSync(file, "utf8");
    const formatted = await prettier.format(source, { filepath: file });
    console.log(
      `PRETTIER_PROBE ${path.basename(file)} ${Buffer.from(formatted).toString("base64")}`,
    );
  }
});

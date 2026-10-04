"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

test("print exact Prettier output for enforcement tests", async () => {
  for (const name of [
    "action_ledger.test.js",
    "economy_arbiter_controller.test.js",
  ]) {
    const file = path.join(__dirname, name);
    const source = fs.readFileSync(file, "utf8");
    const formatted = await prettier.format(source, { filepath: file });
    console.log(
      `PRETTIER_PROBE ${name} ${Buffer.from(formatted).toString("base64")}`,
    );
  }
});

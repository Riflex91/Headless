"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints canonical farm live formatting", async () => {
  const prettier = require("prettier");
  for (const relative of [
    "../src/FarmLiveTest.js",
    "../standalones/CharacterCoordinator.js",
    "farm_live_test.test.js",
  ]) {
    const target = path.join(__dirname, relative);
    const source = fs.readFileSync(target, "utf8");
    const formatted = await prettier.format(source, { filepath: target });
    console.log(
      "PRETTIER_PROBE_BASE64:" +
        relative +
        ":" +
        Buffer.from(formatted, "utf8").toString("base64"),
    );
  }
});

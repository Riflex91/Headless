"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

test("print exact Prettier output for coupled Economy Prebuff live runner test", async () => {
  const file = path.join(
    __dirname,
    "economy_prebuff_execution_live_test.test.js",
  );
  const source = fs.readFileSync(file, "utf8");
  const formatted = await prettier.format(source, { filepath: file });
  console.log(
    "PRETTIER_PROBE economy_prebuff_execution_live_test.test.js " +
      Buffer.from(formatted).toString("base64"),
  );
});

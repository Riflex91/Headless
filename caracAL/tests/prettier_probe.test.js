"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints canonical farm intelligence test formatting", async () => {
  const prettier = require("prettier");
  const target = path.join(
    __dirname,
    "farm_intelligence_controller.test.js",
  );
  const source = fs.readFileSync(target, "utf8");
  const formatted = await prettier.format(source, { filepath: target });
  console.log(
    "PRETTIER_PROBE_BASE64=" +
      Buffer.from(formatted, "utf8").toString("base64"),
  );
});

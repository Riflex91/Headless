"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

test("temporary prettier output probe", async () => {
  for (const relative of [
    "scripts/run_economy_arbiter_live_e2e.js",
    "tests/economy_arbiter_live_launcher.test.js",
  ]) {
    const filename = path.join(__dirname, "..", relative);
    const source = fs.readFileSync(filename, "utf8");
    const formatted = await prettier.format(source, { filepath: filename });
    process.stdout.write(
      "PRETTIER_PROBE_BEGIN " +
        relative +
        "\n" +
        Buffer.from(formatted, "utf8").toString("base64") +
        "\nPRETTIER_PROBE_END " +
        relative +
        "\n",
    );
  }
});

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const prettier = require("prettier");

const targets = [
  "scripts/run_phase20_merchant_logistics_live_e2e.js",
  "standalones/CharacterCoordinator.js",
  "tests/phase20_merchant_logistics_live_launcher.test.js",
];

(async () => {
  for (const target of targets) {
    const source = fs.readFileSync(target, "utf8");
    const formatted = await prettier.format(source, {
      parser: "babel",
    });
    const tmp = path.join(
      os.tmpdir(),
      "phase20-prettier-" + path.basename(target),
    );
    fs.writeFileSync(tmp, formatted, "utf8");
    const diff = childProcess.spawnSync("diff", ["-u", target, tmp], {
      encoding: "utf8",
    });
    process.stdout.write("\n=== PRETTIER DIFF: " + target + " ===\n");
    process.stdout.write(diff.stdout || "(already formatted)\n");
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const prettier = require("prettier");

async function main() {
  for (const relative of [
    "standalones/CharacterCoordinator.js",
    "tests/logistics_claim_executor.test.js",
    "tests/material_gathering_task.test.js",
    "tests/merchant_fishing_controller.test.js",
  ]) {
    const absolute = path.join(__dirname, "..", relative);
    const source = fs.readFileSync(absolute, "utf8");
    const formatted = await prettier.format(source, { filepath: absolute });
    process.stdout.write("\n=== PRETTIER:" + relative + " ===\n");
    process.stdout.write(formatted);
    process.stdout.write("=== END PRETTIER:" + relative + " ===\n");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

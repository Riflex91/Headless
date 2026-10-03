"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const prettier = require("prettier");

const FILES = [
  "scripts/run_compound_live_e2e.js",
  "standalones/CharacterCoordinator.js",
  "tests/compound_live_test.test.js",
];

test("temporary chunked Prettier patch dump", async () => {
  const root = path.join(__dirname, "..");
  for (const relative of FILES) {
    const full = path.join(root, relative);
    const source = fs.readFileSync(full, "utf8");
    const formatted = await prettier.format(source, { filepath: full });
    if (formatted === source) continue;

    const temp = path.join(
      os.tmpdir(),
      relative.replace(/[\\/]/g, "_") + ".formatted",
    );
    fs.writeFileSync(temp, formatted, "utf8");
    const diffResult = spawnSync(
      "diff",
      ["-u", "--label", relative, "--label", relative, full, temp],
      { encoding: "utf8" },
    );
    if (![0, 1].includes(diffResult.status)) {
      throw new Error(diffResult.stderr || "diff failed");
    }

    const encoded = Buffer.from(diffResult.stdout, "utf8").toString("base64");
    const size = 1800;
    const total = Math.ceil(encoded.length / size);
    for (let index = 0; index < total; index += 1) {
      process.stdout.write(
        "PRETTIER_PATCH_CHUNK:" +
          relative +
          ":" +
          index +
          ":" +
          total +
          ":" +
          encoded.slice(index * size, (index + 1) * size) +
          "\n",
      );
    }
  }
});

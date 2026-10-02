"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("prints prettier diffs for farm live files", async () => {
  const prettier = require("prettier");
  const files = [
    "src/FarmIntelligenceLiveTest.js",
    "src/HeadlessDashboard.js",
    "standalones/CharacterCoordinator.js",
    "tests/farm_intelligence_live_supervisor.test.js",
    "tests/farm_intelligence_live_test.test.js",
  ];
  let diff = "";

  for (const relative of files) {
    const sourcePath = path.join(__dirname, "..", relative);
    const source = fs.readFileSync(sourcePath, "utf8");
    const formatted = await prettier.format(source, {
      filepath: sourcePath,
    });
    if (source === formatted) continue;

    const tempPath = path.join(
      os.tmpdir(),
      "caracal-prettier-" + relative.replace(/[\\/]/g, "_"),
    );
    fs.writeFileSync(tempPath, formatted, "utf8");
    try {
      childProcess.execFileSync("diff", ["-u", sourcePath, tempPath], {
        encoding: "utf8",
      });
    } catch (error) {
      diff += String(error.stdout || "");
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  console.log(
    "PRETTIER_DIFF_BASE64=" +
      Buffer.from(diff, "utf8").toString("base64"),
  );
});

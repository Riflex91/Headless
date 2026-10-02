"use strict";

const childProcess = require("node:child_process");

const files = [
  "src/LogisticsLiveTest.js",
  "standalones/CharacterCoordinator.js",
  "tests/logistics_live_supervisor.test.js",
];

childProcess.execFileSync(
  process.execPath,
  ["node_modules/prettier/bin/prettier.cjs", "--write", ...files],
  {
    cwd: process.cwd(),
    stdio: "inherit",
  },
);

const diff = childProcess.execFileSync("git", ["diff", "--", ...files], {
  cwd: process.cwd(),
  encoding: "utf8",
});

process.stdout.write("PRETTIER_PROBE_DIFF_START\n");
process.stdout.write(diff);
process.stdout.write("PRETTIER_PROBE_DIFF_END\n");

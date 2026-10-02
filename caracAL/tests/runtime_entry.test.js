"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("bot main entrypoint stays role-neutral and mutation-free", () => {
  const main = fs.readFileSync(
    path.join(__dirname, "..", "TYPECODE", "bot", "main.ts"),
    "utf8",
  );
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const source = `${main}\n${kernel}`;

  assert.match(main, /bootRuntime/);

  for (const forbidden of [
    /\battack\s*\(/,
    /\bsmart_move\s*\(/,
    /\bbuy\s*\(/,
    /\bsell\s*\(/,
    /\bsend_item\s*\(/,
    /\bsend_gold\s*\(/,
    /\bupgrade\s*\(/,
    /\bcompound\s*\(/,
    /\bexchange\s*\(/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("webpack keeps shared bot libraries out of direct entrypoints", () => {
  const webpackConfig = fs.readFileSync(
    path.join(__dirname, "..", "webpack.config.js"),
    "utf8",
  );

  assert.match(webpackConfig, /TYPECODE\/\*\*\/\*\.ts/);
  assert.match(webpackConfig, /ignore:\s*"\*\*\/\*\.lib\.ts"/);
});

test("runtime kernel emits periodic health without gameplay work", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /RUNTIME_STATUS/);
  assert.match(kernel, /PERIODIC_RUNTIME_HEALTH/);
  assert.match(kernel, /runtimeState/);
  assert.match(kernel, /codeRevision/);
  assert.match(kernel, /configRevision/);
  assert.match(kernel, /sourceRevision/);
  assert.match(kernel, /emergencyStop/);
  assert.match(kernel, /actionLedger/);
  assert.match(kernel, /recentActions/);
  assert.match(kernel, /schedulerJobs/);
});

test("CharacterThread exposes supervisor-assigned revisions", () => {
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.match(thread, /extensions\.code_revision/);
  assert.match(thread, /extensions\.config_revision/);
  assert.match(thread, /extensions\.source_revision/);
});

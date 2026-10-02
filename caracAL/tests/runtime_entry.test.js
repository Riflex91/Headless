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

test("runtime feature code cannot call Adventure Land mutations directly", () => {
  const botRoot = path.join(__dirname, "..", "TYPECODE", "bot");
  const mutationBoundary = path.join(botRoot, "core", "action-boundary.lib.ts");
  const mutationCalls = [
    "move",
    "smart_move",
    "attack",
    "use_skill",
    "loot",
    "buy",
    "sell",
    "send_item",
    "send_gold",
    "bank_store",
    "bank_retrieve",
    "bank_deposit",
    "bank_withdraw",
    "equip",
    "unequip",
    "upgrade",
    "compound",
    "exchange",
    "craft",
    "party_invite",
    "party_accept",
    "party_leave",
  ];

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".ts") || fullPath === mutationBoundary) {
        continue;
      }

      const source = fs.readFileSync(fullPath, "utf8");
      for (const mutation of mutationCalls) {
        const directCall = new RegExp(`\\b${mutation}\\s*\\(`);
        assert.doesNotMatch(
          source,
          directCall,
          `${path.relative(
            botRoot,
            fullPath,
          )} must route ${mutation} through ActionBoundary`,
        );
      }
    }
  };

  visit(botRoot);
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
  assert.match(kernel, /gameAdapterReads/);
  assert.match(kernel, /actionBoundaryMutations/);
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

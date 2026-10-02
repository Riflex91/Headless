"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("config push is wired through supervisor character IPC and runtime status", () => {
  const root = path.join(__dirname, "..");
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(root, "src", "CharacterThread.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const runtimeKernel = fs.readFileSync(
    path.join(root, "TYPECODE", "bot", "core", "runtime-kernel.lib.ts"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(coordinator));
  assert.doesNotThrow(() => new Function(thread));

  assert.match(coordinator, /CharacterConfigService/);
  assert.match(coordinator, /control_character_config/);
  assert.match(coordinator, /CHARACTER_CONFIG_PUSH_REQUESTED/);
  assert.match(coordinator, /CHARACTER_CONFIG_APPLIED/);
  assert.match(coordinator, /CHARACTER_CONFIG_REJECTED/);
  assert.match(coordinator, /CHARACTER_CONFIG_PUSH_TIMEOUT/);
  assert.match(coordinator, /SYNC_CONFIG_AFTER_CONNECT/);
  assert.match(coordinator, /character_config_revision/);

  assert.match(thread, /prepareConfigPush/);
  assert.match(thread, /case "config_push"/);
  assert.match(thread, /type: "config_applied"/);
  assert.match(thread, /type: "config_rejected"/);
  assert.match(thread, /extensions\.config/);
  assert.match(thread, /extensions\.runtime_config_revision/);

  assert.match(dashboard, /\/headless\/api\/characters\/:name\/config/);
  assert.match(dashboard, /runtime_config_revision/);
  assert.match(dashboard, /config_push_status/);

  assert.match(runtimeKernel, /runtimeConfigRevision/);
});

test("config editor read endpoint keeps live push restart-free", () => {
  const root = path.join(__dirname, "..");
  const coordinator = fs.readFileSync(
    path.join(root, "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(root, "src", "HeadlessDashboard.js"),
    "utf8",
  );

  assert.equal(coordinator.includes("read_character_config"), true);
  assert.equal(
    dashboard.includes('router.get("/headless/api/characters/:name/config"'),
    true,
  );

  const start = coordinator.indexOf(
    "async function control_character_config(char_name, config)",
  );
  const end = coordinator.indexOf("async function control_rotation", start);
  const updateBlock = coordinator.slice(start, end);
  assert.equal(updateBlock.includes('type: "config_push"'), true);
  assert.equal(updateBlock.includes("restart_character"), false);
  assert.equal(updateBlock.includes("softkill_block"), false);
});

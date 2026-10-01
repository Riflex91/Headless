"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  LIFECYCLE_STATES,
  computeRestartDelay,
  countActiveCharacters,
  getInitialStartupCharacters,
  isHeartbeatStale,
  readLifecyclePolicy,
} = require("../src/CharacterLifecyclePolicy");
const { make_cfg_string } = require("../src/ConfigUtil");

test("lifecycle policy defaults to the four-character local limit", () => {
  assert.deepEqual(readLifecyclePolicy({}), {
    maxOnlineCharacters: 4,
    startupStaggerMs: 1500,
    restartBaseMs: 2000,
    restartMaxMs: 60000,
    restartResetMs: 60000,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 20000,
    watchdogIntervalMs: 5000,
  });
});

test("configured online character count is hard-capped at four", () => {
  assert.equal(
    readLifecyclePolicy({
      lifecycle: { max_online_characters: 8 },
    }).maxOnlineCharacters,
    4,
  );
  assert.equal(
    readLifecyclePolicy({
      lifecycle: { max_online_characters: 2 },
    }).maxOnlineCharacters,
    2,
  );
});

test("restart backoff grows exponentially and is capped", () => {
  const policy = readLifecyclePolicy({
    lifecycle: {
      restart_base_ms: 1000,
      restart_max_ms: 5000,
    },
  });
  assert.equal(computeRestartDelay(1, policy), 1000);
  assert.equal(computeRestartDelay(2, policy), 2000);
  assert.equal(computeRestartDelay(3, policy), 4000);
  assert.equal(computeRestartDelay(4, policy), 5000);
  assert.equal(computeRestartDelay(99, policy), 5000);
});

test("heartbeat staleness is deterministic", () => {
  const now = 100000;
  assert.equal(isHeartbeatStale(85000, now, 20000), false);
  assert.equal(isHeartbeatStale(79999, now, 20000), true);
  assert.equal(isHeartbeatStale(0, now, 20000), false);
});

test("startup selection schedules at most four enabled characters", () => {
  const characters = {
    A: { enabled: true },
    B: { enabled: true },
    C: { enabled: false },
    D: { enabled: true },
    E: { enabled: true },
    F: { enabled: true },
  };
  assert.deepEqual(getInitialStartupCharacters(characters, 4), [
    "A",
    "B",
    "D",
    "E",
  ]);
});

test("active count includes processes and lifecycle states that own a slot", () => {
  assert.equal(
    countActiveCharacters({
      A: { instance: {} },
      B: { lifecycle_state: LIFECYCLE_STATES.CONNECTING },
      C: { lifecycle_state: LIFECYCLE_STATES.ONLINE },
      D: { lifecycle_state: LIFECYCLE_STATES.STOPPED },
      E: { lifecycle_state: LIFECYCLE_STATES.BACKOFF },
    }),
    3,
  );
});

test("generated config includes lifecycle hardening defaults", () => {
  const generated = make_cfg_string({});
  assert.match(generated, /max_online_characters:\s+4/);
  assert.match(generated, /startup_stagger_ms:\s+1500/);
  assert.match(generated, /restart_base_ms:\s+2000/);
  assert.match(generated, /restart_max_ms:\s+60000/);
  assert.match(generated, /restart_reset_ms:\s+60000/);
  assert.match(generated, /heartbeat_interval_ms:\s+5000/);
  assert.match(generated, /heartbeat_timeout_ms:\s+20000/);
  assert.match(generated, /watchdog_interval_ms:\s+5000/);
});

test("CharacterCoordinator remains syntactically valid", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  assert.doesNotThrow(() => new Function(coordinator));
  assert.match(coordinator, /CHARACTER_HEARTBEAT_TIMEOUT/);
});

test("CharacterThread heartbeat code remains syntactically valid", () => {
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  assert.doesNotThrow(() => new Function(thread));
  assert.match(thread, /type: "heartbeat"/);
  assert.match(thread, /heartbeat_interval_ms/);
});

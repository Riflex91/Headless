"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CONTROL_ACTIONS,
  DESIRED_RUNTIME_STATES,
  canRestartCharacter,
  desiredStateForAction,
  normalizeControlAction,
} = require("../src/CharacterControl");

test("control actions normalize deterministically", () => {
  assert.equal(normalizeControlAction("START"), CONTROL_ACTIONS.START);
  assert.equal(normalizeControlAction(" pause "), CONTROL_ACTIONS.PAUSE);
  assert.equal(normalizeControlAction("stop"), CONTROL_ACTIONS.STOP);
  assert.equal(normalizeControlAction("restart"), CONTROL_ACTIONS.RESTART);
  assert.equal(normalizeControlAction(undefined), null);
});

test("control actions map to desired runtime states", () => {
  assert.equal(
    desiredStateForAction(CONTROL_ACTIONS.START),
    DESIRED_RUNTIME_STATES.RUNNING,
  );
  assert.equal(
    desiredStateForAction(CONTROL_ACTIONS.PAUSE),
    DESIRED_RUNTIME_STATES.PAUSED,
  );
  assert.equal(
    desiredStateForAction(CONTROL_ACTIONS.STOP),
    DESIRED_RUNTIME_STATES.STOPPED,
  );
  assert.equal(desiredStateForAction(CONTROL_ACTIONS.RESTART), null);
});

test("restart eligibility is limited to active non-stopping characters", () => {
  const base = {
    instance: { pid: 1234 },
    enabled: true,
    desired_runtime_state: DESIRED_RUNTIME_STATES.RUNNING,
    lifecycle_state: "ONLINE",
  };

  assert.equal(canRestartCharacter(base), true);
  assert.equal(
    canRestartCharacter({
      ...base,
      desired_runtime_state: DESIRED_RUNTIME_STATES.PAUSED,
      lifecycle_state: "PAUSED",
    }),
    true,
  );
  assert.equal(canRestartCharacter({ ...base, instance: null }), false);
  assert.equal(canRestartCharacter({ ...base, enabled: false }), false);
  assert.equal(
    canRestartCharacter({
      ...base,
      desired_runtime_state: DESIRED_RUNTIME_STATES.STOPPED,
    }),
    false,
  );
  assert.equal(
    canRestartCharacter({ ...base, lifecycle_state: "STOPPING" }),
    false,
  );
});

test("coordinator owns desired runtime state transitions", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(coordinator, /desired_runtime_state/);
  assert.match(coordinator, /CHARACTER_CONTROL_REQUESTED/);
  assert.match(coordinator, /CHARACTER_CONTROL_APPLIED/);
  assert.match(coordinator, /CHARACTER_SLOT_LIMIT/);
  assert.match(coordinator, /CHARACTER_NOT_RESTARTABLE/);
  assert.match(coordinator, /controlled_restart/);
  assert.match(coordinator, /127\.0\.0\.1/);
});

test("CharacterThread acknowledges runtime control", () => {
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.match(thread, /runtime_control/);
  assert.match(thread, /runtime_state_applied/);
  assert.match(thread, /extensions\.runtime_state/);
});

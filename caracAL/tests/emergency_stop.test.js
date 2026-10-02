"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { EmergencyStopState } = require("../src/EmergencyStopState");

test("emergency stop activates clears and increments revisions", () => {
  let now = 1000;
  const state = new EmergencyStopState({ now: () => now });

  assert.deepEqual(state.snapshot(), {
    active: false,
    reason: null,
    activated_at: null,
    cleared_at: null,
    revision: 0,
  });

  const active = state.activate("MANUAL_TEST");
  assert.deepEqual(active, {
    active: true,
    reason: "MANUAL_TEST",
    activated_at: 1000,
    cleared_at: null,
    revision: 1,
  });

  now = 2000;
  const cleared = state.clear("TEST_CLEAR");
  assert.deepEqual(cleared, {
    active: false,
    reason: "TEST_CLEAR",
    activated_at: 1000,
    cleared_at: 2000,
    revision: 2,
  });
});

test("repeating identical active state is idempotent", () => {
  let now = 1000;
  const state = new EmergencyStopState({ now: () => now });

  state.activate("SAME");
  now = 2000;
  const repeated = state.activate("SAME");

  assert.equal(repeated.revision, 1);
  assert.equal(repeated.activated_at, 1000);
});

test("clearing an already clear stop does not change revision", () => {
  const state = new EmergencyStopState({ now: () => 1000 });
  assert.equal(state.clear("NOOP").revision, 0);
});

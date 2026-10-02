"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { DESIRED_RUNTIME_STATES } = require("../src/CharacterControl");
const { createRotationPlan } = require("../src/CharacterRotation");

function activeCharacter(overrides = {}) {
  return {
    enabled: true,
    desired_runtime_state: DESIRED_RUNTIME_STATES.RUNNING,
    lifecycle_state: "ONLINE",
    instance: { pid: 1234 },
    account_owned: true,
    ...overrides,
  };
}

function stoppedCharacter(overrides = {}) {
  return {
    enabled: false,
    desired_runtime_state: DESIRED_RUNTIME_STATES.STOPPED,
    lifecycle_state: "STOPPED",
    instance: null,
    account_owned: true,
    ...overrides,
  };
}

test("rotation plans an explicit active-to-stopped slot swap", () => {
  const characters = {
    My_Ranger1: activeCharacter(),
    My_Mage: stoppedCharacter(),
  };

  assert.deepEqual(
    createRotationPlan(characters, {
      stopCharacter: "My_Ranger1",
      startCharacter: "My_Mage",
    }),
    {
      start_character: "My_Mage",
      stop_character: "My_Ranger1",
      source_desired_state: DESIRED_RUNTIME_STATES.RUNNING,
      target_desired_state: DESIRED_RUNTIME_STATES.RUNNING,
    },
  );
});

test("rotation never chooses a source implicitly", () => {
  const characters = {
    My_Merchant: activeCharacter(),
    My_Ranger1: activeCharacter(),
    My_Mage: stoppedCharacter(),
  };

  assert.throws(
    () =>
      createRotationPlan(characters, {
        startCharacter: "My_Mage",
      }),
    (error) => error.code === "ROTATION_CHARACTERS_REQUIRED",
  );
});

test("rotation rejects inactive or overlapping source transitions", () => {
  assert.throws(
    () =>
      createRotationPlan(
        {
          My_Ranger1: activeCharacter({ instance: null }),
          My_Mage: stoppedCharacter(),
        },
        {
          stopCharacter: "My_Ranger1",
          startCharacter: "My_Mage",
        },
      ),
    (error) => error.code === "ROTATION_SOURCE_NOT_ACTIVE",
  );

  assert.throws(
    () =>
      createRotationPlan(
        {
          My_Ranger1: activeCharacter({
            rotation_replacement: "My_Priest",
          }),
          My_Mage: stoppedCharacter(),
        },
        {
          stopCharacter: "My_Ranger1",
          startCharacter: "My_Mage",
        },
      ),
    (error) => error.code === "ROTATION_SOURCE_NOT_ACTIVE",
  );
});

test("rotation target must be owned and fully stopped", () => {
  const source = activeCharacter();

  assert.throws(
    () =>
      createRotationPlan(
        {
          My_Ranger1: source,
          External: stoppedCharacter({ account_owned: false }),
        },
        {
          stopCharacter: "My_Ranger1",
          startCharacter: "External",
        },
      ),
    (error) => error.code === "ROTATION_TARGET_NOT_OWNED",
  );

  assert.throws(
    () =>
      createRotationPlan(
        {
          My_Ranger1: source,
          My_Mage: stoppedCharacter({
            enabled: true,
            desired_runtime_state: DESIRED_RUNTIME_STATES.RUNNING,
          }),
        },
        {
          stopCharacter: "My_Ranger1",
          startCharacter: "My_Mage",
        },
      ),
    (error) => error.code === "ROTATION_TARGET_NOT_STOPPED",
  );
});

test("rotation source and target must be distinct known characters", () => {
  const characters = {
    My_Ranger1: activeCharacter(),
    My_Mage: stoppedCharacter(),
  };

  assert.throws(
    () =>
      createRotationPlan(characters, {
        stopCharacter: "My_Ranger1",
        startCharacter: "My_Ranger1",
      }),
    (error) => error.code === "ROTATION_SAME_CHARACTER",
  );

  assert.throws(
    () =>
      createRotationPlan(characters, {
        stopCharacter: "My_Ranger1",
        startCharacter: "Missing",
      }),
    (error) => error.code === "ROTATION_TARGET_NOT_FOUND",
  );
});

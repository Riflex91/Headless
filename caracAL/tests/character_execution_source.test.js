"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
  resolveCharacterExecutionSource,
} = require("../src/CharacterExecutionSource");

test("movement live override wins over normal CODE and TYPECODE settings", () => {
  assert.deepEqual(
    resolveCharacterExecutionSource(
      {
        script: "aio.js",
        typescript: "character/custom.js",
        movement_live_test_typescript_override:
          MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
      },
      true,
    ),
    {
      mode: "TYPECODE_OVERRIDE",
      scriptFile: "aio.js",
      typescriptFile: "bot/main.js",
    },
  );
});

test("normal TYPECODE character source is preserved outside live tests", () => {
  assert.deepEqual(
    resolveCharacterExecutionSource(
      {
        script: "aio.js",
        typescript: "character/custom.js",
      },
      true,
    ),
    {
      mode: "TYPECODE",
      scriptFile: "aio.js",
      typescriptFile: "character/custom.js",
    },
  );
});

test("normal CODE source remains unchanged when TYPECODE is disabled", () => {
  assert.deepEqual(
    resolveCharacterExecutionSource(
      {
        script: "aio.js",
        typescript: "character/custom.js",
      },
      false,
    ),
    {
      mode: "CODE",
      scriptFile: "aio.js",
      typescriptFile: null,
    },
  );
});

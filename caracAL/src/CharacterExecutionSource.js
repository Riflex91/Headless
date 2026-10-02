"use strict";

const MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE = "bot/main.js";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveCharacterExecutionSource(charBlock = {}, enableTypecode = false) {
  const override = nonEmptyString(
    charBlock.movement_live_test_typescript_override,
  );
  if (override) {
    return {
      mode: "TYPECODE_OVERRIDE",
      scriptFile: nonEmptyString(charBlock.script),
      typescriptFile: override,
    };
  }

  const typescript = enableTypecode
    ? nonEmptyString(charBlock.typescript)
    : null;
  if (typescript) {
    return {
      mode: "TYPECODE",
      scriptFile: nonEmptyString(charBlock.script),
      typescriptFile: typescript,
    };
  }

  return {
    mode: "CODE",
    scriptFile: nonEmptyString(charBlock.script),
    typescriptFile: null,
  };
}

module.exports = {
  MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE,
  resolveCharacterExecutionSource,
};

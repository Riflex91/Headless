"use strict";

const { DESIRED_RUNTIME_STATES } = require("./CharacterControl");

function rotationError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizedCharacterName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createRotationPlan(
  characterManage,
  { startCharacter, stopCharacter } = {},
) {
  const startName = normalizedCharacterName(startCharacter);
  const stopName = normalizedCharacterName(stopCharacter);

  if (!startName || !stopName) {
    throw rotationError(
      "ROTATION_CHARACTERS_REQUIRED",
      "Rotation requires startCharacter and stopCharacter",
      400,
    );
  }
  if (startName === stopName) {
    throw rotationError(
      "ROTATION_SAME_CHARACTER",
      "Rotation source and target must be different characters",
      400,
    );
  }

  const target = characterManage?.[startName];
  const source = characterManage?.[stopName];

  if (!target) {
    throw rotationError(
      "ROTATION_TARGET_NOT_FOUND",
      `Unknown rotation target: ${startName}`,
      404,
    );
  }
  if (!source) {
    throw rotationError(
      "ROTATION_SOURCE_NOT_FOUND",
      `Unknown rotation source: ${stopName}`,
      404,
    );
  }
  if (target.account_owned !== true) {
    throw rotationError(
      "ROTATION_TARGET_NOT_OWNED",
      `Rotation target is not an owned account character: ${startName}`,
      409,
    );
  }
  if (
    !source.instance ||
    !source.enabled ||
    source.desired_runtime_state === DESIRED_RUNTIME_STATES.STOPPED ||
    source.lifecycle_state === "STOPPING" ||
    source.rotation_replacement
  ) {
    throw rotationError(
      "ROTATION_SOURCE_NOT_ACTIVE",
      `Rotation source is not available for rotation: ${stopName}`,
      409,
    );
  }
  if (target.instance) {
    throw rotationError(
      "ROTATION_TARGET_ALREADY_ACTIVE",
      `Rotation target is already active: ${startName}`,
      409,
    );
  }
  if (
    target.enabled ||
    target.desired_runtime_state === DESIRED_RUNTIME_STATES.RUNNING ||
    target.desired_runtime_state === DESIRED_RUNTIME_STATES.PAUSED
  ) {
    throw rotationError(
      "ROTATION_TARGET_NOT_STOPPED",
      `Rotation target already has an active desired state: ${startName}`,
      409,
    );
  }

  return {
    start_character: startName,
    stop_character: stopName,
    source_desired_state:
      source.desired_runtime_state || DESIRED_RUNTIME_STATES.RUNNING,
    target_desired_state: DESIRED_RUNTIME_STATES.RUNNING,
  };
}

module.exports = {
  createRotationPlan,
  normalizedCharacterName,
  rotationError,
};

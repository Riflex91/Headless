"use strict";

const DEFAULT_TYPESCRIPT_ENTRY = "bot/main.js";
const DEFAULT_SCRIPT_ENTRY = "caracAL/examples/crabs.js";

function defaultCharacterBlock({
  defaultRealm = null,
  enableTypecode = true,
  typescriptEntry = DEFAULT_TYPESCRIPT_ENTRY,
  scriptEntry = DEFAULT_SCRIPT_ENTRY,
} = {}) {
  return {
    realm: defaultRealm,
    enabled: false,
    version: 0,
    ...(enableTypecode
      ? { typescript: typescriptEntry }
      : { script: scriptEntry }),
  };
}

function registerAccountCharacters(
  configuredCharacters = {},
  ownedCharacters = [],
  options = {},
) {
  const configured =
    configuredCharacters && typeof configuredCharacters === "object"
      ? configuredCharacters
      : {};
  const registry = {};

  for (const [name, block] of Object.entries(configured)) {
    registry[name] = {
      ...(block && typeof block === "object" ? block : {}),
      account_owned: false,
      account_character_type: null,
      registration_source: "CONFIG",
    };
  }

  for (const ownedCharacter of Array.isArray(ownedCharacters)
    ? ownedCharacters
    : []) {
    const name =
      typeof ownedCharacter?.name === "string"
        ? ownedCharacter.name.trim()
        : "";
    if (!name) continue;

    const configuredBlock = registry[name];
    registry[name] = {
      ...(configuredBlock || defaultCharacterBlock(options)),
      account_owned: true,
      account_character_type: ownedCharacter?.type || null,
      registration_source: configuredBlock ? "CONFIG" : "ACCOUNT",
    };
  }

  return registry;
}

module.exports = {
  DEFAULT_SCRIPT_ENTRY,
  DEFAULT_TYPESCRIPT_ENTRY,
  defaultCharacterBlock,
  registerAccountCharacters,
};

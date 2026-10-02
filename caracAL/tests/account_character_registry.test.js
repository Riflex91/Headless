"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_SCRIPT_ENTRY,
  DEFAULT_TYPESCRIPT_ENTRY,
  registerAccountCharacters,
} = require("../src/AccountCharacterRegistry");

const OWNED_CHARACTERS = [
  { name: "My_Ranger1", type: "ranger" },
  { name: "My_Ranger2", type: "ranger" },
  { name: "My_Ranger3", type: "ranger" },
  { name: "My_Merchant", type: "merchant" },
  { name: "My_Mage", type: "mage" },
  { name: "My_Priest", type: "priest" },
  { name: "My_Warrior", type: "warrior" },
  { name: "My_Rogue", type: "rogue" },
];

test("full account roster is registered without auto-starting missing config entries", () => {
  const configured = {
    My_Ranger1: {
      realm: "EUI",
      enabled: true,
      version: 0,
      typescript: "bot/main.js",
    },
    My_Merchant: {
      realm: "EUI",
      enabled: false,
      version: 0,
      typescript: "bot/main.js",
    },
  };
  const original = JSON.parse(JSON.stringify(configured));

  const registry = registerAccountCharacters(configured, OWNED_CHARACTERS, {
    defaultRealm: "EUI",
    enableTypecode: true,
  });

  assert.equal(Object.keys(registry).length, 8);
  assert.deepEqual(configured, original);

  assert.deepEqual(registry.My_Ranger1, {
    realm: "EUI",
    enabled: true,
    version: 0,
    typescript: "bot/main.js",
    account_owned: true,
    account_character_type: "ranger",
    registration_source: "CONFIG",
  });

  assert.deepEqual(registry.My_Mage, {
    realm: "EUI",
    enabled: false,
    version: 0,
    typescript: DEFAULT_TYPESCRIPT_ENTRY,
    account_owned: true,
    account_character_type: "mage",
    registration_source: "ACCOUNT",
  });
});

test("configured characters that are not currently owned remain visible for diagnostics", () => {
  const registry = registerAccountCharacters(
    {
      OldCharacter: {
        realm: "USI",
        enabled: false,
        script: "legacy.js",
      },
    },
    OWNED_CHARACTERS.slice(0, 1),
    {
      defaultRealm: "EUI",
      enableTypecode: true,
    },
  );

  assert.equal(registry.OldCharacter.account_owned, false);
  assert.equal(registry.OldCharacter.registration_source, "CONFIG");
  assert.equal(registry.My_Ranger1.account_owned, true);
  assert.equal(registry.My_Ranger1.registration_source, "ACCOUNT");
});

test("non-TypeScript roster entries receive a safe disabled script default", () => {
  const registry = registerAccountCharacters(
    {},
    [{ name: "My_Warrior", type: "warrior" }],
    {
      defaultRealm: "EUII",
      enableTypecode: false,
    },
  );

  assert.deepEqual(registry.My_Warrior, {
    realm: "EUII",
    enabled: false,
    version: 0,
    script: DEFAULT_SCRIPT_ENTRY,
    account_owned: true,
    account_character_type: "warrior",
    registration_source: "ACCOUNT",
  });
});

test("invalid account entries are ignored", () => {
  const registry = registerAccountCharacters(
    {},
    [null, {}, { name: "   " }, { name: "My_Rogue", type: "rogue" }],
    {
      defaultRealm: "EUI",
      enableTypecode: true,
    },
  );

  assert.deepEqual(Object.keys(registry), ["My_Rogue"]);
});

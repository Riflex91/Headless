"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CharacterConfigService,
  MAX_CHARACTER_CONFIG_BYTES,
  nextCharacterConfigRevision,
  normalizeCharacterConfig,
  prepareConfigPush,
} = require("../src/CharacterConfigService");

test("character config normalization clones JSON and rejects invalid payloads", () => {
  const input = { combat: { enabled: true }, potion_usage: 0.5 };
  const normalized = normalizeCharacterConfig(input);

  assert.deepEqual(normalized, input);
  assert.notEqual(normalized, input);
  assert.throws(
    () => normalizeCharacterConfig(null),
    (error) => error.code === "CHARACTER_CONFIG_INVALID",
  );
  assert.throws(
    () => normalizeCharacterConfig([]),
    (error) => error.code === "CHARACTER_CONFIG_INVALID",
  );

  const oversized = { value: "x".repeat(MAX_CHARACTER_CONFIG_BYTES) };
  assert.throws(
    () => normalizeCharacterConfig(oversized),
    (error) => error.code === "CHARACTER_CONFIG_TOO_LARGE",
  );
});

test("character config revisions advance monotonically", () => {
  assert.equal(nextCharacterConfigRevision(undefined), 1);
  assert.equal(nextCharacterConfigRevision(-1), 1);
  assert.equal(nextCharacterConfigRevision(0), 1);
  assert.equal(nextCharacterConfigRevision(7), 8);
});

test("config push validation is monotonic and idempotent", () => {
  assert.deepEqual(prepareConfigPush(4, 5, { combat: { enabled: true } }), {
    revision: 5,
    config: { combat: { enabled: true } },
    changed: true,
  });
  assert.deepEqual(prepareConfigPush(5, 5, { combat: { enabled: true } }), {
    revision: 5,
    config: { combat: { enabled: true } },
    changed: false,
  });
  assert.throws(
    () => prepareConfigPush(5, 4, {}),
    (error) => error.code === "CHARACTER_CONFIG_REVISION_STALE",
  );
  assert.throws(
    () => prepareConfigPush(5, 5.5, {}),
    (error) => error.code === "CHARACTER_CONFIG_REVISION_INVALID",
  );
});

test("character config service restores persisted config before fallback", () => {
  const persistence = {
    getCharacterConfig(name) {
      assert.equal(name, "My_Ranger1");
      return {
        revision: 4,
        config: { combat: { enabled: true } },
        updated_at: 1234,
      };
    },
  };
  const service = new CharacterConfigService({ persistence });

  assert.deepEqual(
    service.load("My_Ranger1", { combat: { enabled: false } }),
    {
      revision: 4,
      config: { combat: { enabled: true } },
      updated_at: 1234,
      source: "PERSISTED",
    },
  );
});

test("character config service uses config fallback at revision zero", () => {
  const service = new CharacterConfigService({
    persistence: {
      getCharacterConfig() {
        return null;
      },
    },
  });

  assert.deepEqual(service.load("My_Mage", { skills: { burst: true } }), {
    revision: 0,
    config: { skills: { burst: true } },
    updated_at: null,
    source: "CONFIG",
  });
});

test("character config service persists before returning the next revision", async () => {
  const writes = [];
  const service = new CharacterConfigService({
    persistence: {
      getCharacterConfig() {
        return null;
      },
      async saveCharacterConfig(characterName, revision, config) {
        writes.push({ characterName, revision, config });
      },
    },
  });

  const result = await service.store("My_Priest", 9, {
    healing: { threshold: 0.7 },
  });

  assert.deepEqual(writes, [
    {
      characterName: "My_Priest",
      revision: 10,
      config: { healing: { threshold: 0.7 } },
    },
  ]);
  assert.deepEqual(result, {
    revision: 10,
    config: { healing: { threshold: 0.7 } },
  });
});

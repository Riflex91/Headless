"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CHARACTER_CONFIG_SCHEMA_VERSION,
  CharacterConfigService,
  createDefaultCharacterConfig,
  mergeConfigPatch,
  validateCharacterConfig,
} = require("../src/CharacterConfigService");
const { PersistenceService } = require("../src/PersistenceService");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "caracal-config-"));
  const persistence = await PersistenceService.open({
    databasePath: path.join(root, "data", "database", "caracal-bot.db"),
  });
  return { root, persistence };
}

test("class defaults include relevant skill toggles", () => {
  const ranger = createDefaultCharacterConfig("ranger");
  const priest = createDefaultCharacterConfig("priest");
  const merchant = createDefaultCharacterConfig("merchant");

  assert.equal(ranger.schema_version, CHARACTER_CONFIG_SCHEMA_VERSION);
  assert.equal(ranger.skills.enabled["5shot"], true);
  assert.equal(ranger.combat.enabled, true);
  assert.equal(priest.skills.enabled.partyheal, true);
  assert.equal(priest.party.heal_below_pct, 75);

  assert.equal(merchant.combat.enabled, false);
  assert.equal(merchant.farming.enabled, false);
  assert.equal(merchant.party.auto_join, false);
  assert.equal(merchant.skills.enabled.mluck, true);
  assert.equal(merchant.merchant.autonomy.merrit, true);
  assert.equal(merchant.merchant.farmer_service.auto_supply, true);
});

test("known config patches merge without dropping sibling values", () => {
  const base = createDefaultCharacterConfig("ranger");
  const updated = mergeConfigPatch(base, {
    combat: {
      aoe: false,
      retreat_below_hp_pct: 42,
    },
    skills: {
      enabled: {
        "5shot": false,
      },
    },
  });

  assert.equal(updated.combat.aoe, false);
  assert.equal(updated.combat.retreat_below_hp_pct, 42);
  assert.equal(updated.combat.auto_target, true);
  assert.equal(updated.skills.enabled["5shot"], false);
  assert.equal(updated.skills.enabled["3shot"], true);
});

test("unknown config keys and unsafe keys are rejected", () => {
  const base = createDefaultCharacterConfig("ranger");

  assert.throws(
    () => mergeConfigPatch(base, { combat: { magic_option: true } }),
    (error) =>
      error.code === "UNKNOWN_CONFIG_KEY" &&
      error.path === "combat.magic_option",
  );

  const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(
    () => mergeConfigPatch(base, unsafe),
    (error) => error.code === "INVALID_CONFIG_KEY",
  );
  assert.equal({}.polluted, undefined);
});

test("config validation enforces percentages and booleans", () => {
  const invalidPercent = createDefaultCharacterConfig("ranger");
  invalidPercent.potions.hp_use_below_pct = 101;
  assert.throws(
    () => validateCharacterConfig(invalidPercent, "ranger"),
    (error) =>
      error.code === "INVALID_CONFIG_VALUE" &&
      error.path === "potions.hp_use_below_pct",
  );

  const invalidSkill = createDefaultCharacterConfig("ranger");
  invalidSkill.skills.enabled["5shot"] = "yes";
  assert.throws(
    () => validateCharacterConfig(invalidSkill, "ranger"),
    (error) =>
      error.code === "INVALID_CONFIG_VALUE" &&
      error.path === "skills.enabled.5shot",
  );
});

test("merchant config section is mandatory for merchant profiles", () => {
  const merchant = createDefaultCharacterConfig("merchant");
  delete merchant.merchant;

  assert.throws(
    () => validateCharacterConfig(merchant, "merchant"),
    (error) =>
      error.code === "INVALID_CONFIG_VALUE" &&
      error.path === "merchant",
  );
});

test("config service persists revisions and survives reopen", async () => {
  const first = await fixture();
  let reopenedPersistence;

  try {
    const service = new CharacterConfigService({
      persistence: first.persistence,
    });
    const initial = await service.ensure("My_Ranger1", "ranger");

    assert.equal(initial.revision, 1);
    assert.equal(initial.config.skills.enabled["5shot"], true);

    const updated = await service.update(
      "My_Ranger1",
      "ranger",
      {
        skills: { enabled: { "5shot": false } },
        supply: { hp_target: 555 },
      },
      { expectedRevision: 1 },
    );

    assert.equal(updated.revision, 2);
    assert.equal(updated.config.skills.enabled["5shot"], false);
    assert.equal(updated.config.supply.hp_target, 555);

    await first.persistence.close();

    reopenedPersistence = await PersistenceService.open({
      databasePath: path.join(
        first.root,
        "data",
        "database",
        "caracal-bot.db",
      ),
    });
    const reopened = new CharacterConfigService({
      persistence: reopenedPersistence,
    });
    const restored = await reopened.ensure("My_Ranger1", "ranger");

    assert.equal(restored.revision, 2);
    assert.equal(restored.config.skills.enabled["5shot"], false);
    assert.equal(restored.config.supply.hp_target, 555);
  } finally {
    if (!first.persistence.closed) {
      await first.persistence.close();
    }
    await reopenedPersistence?.close();
    await fs.rm(first.root, { recursive: true, force: true });
  }
});

test("config service rejects stale expected revisions", async () => {
  const current = await fixture();

  try {
    const service = new CharacterConfigService({
      persistence: current.persistence,
    });
    await service.ensure("My_Ranger1", "ranger");
    await service.update(
      "My_Ranger1",
      "ranger",
      { combat: { aoe: false } },
      { expectedRevision: 1 },
    );

    await assert.rejects(
      service.update(
        "My_Ranger1",
        "ranger",
        { combat: { aoe: true } },
        { expectedRevision: 1 },
      ),
      (error) =>
        error.code === "CONFIG_REVISION_CONFLICT" &&
        error.statusCode === 409,
    );
  } finally {
    await current.persistence.close();
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

test("schema version cannot be changed by a patch", async () => {
  const current = await fixture();

  try {
    const service = new CharacterConfigService({
      persistence: current.persistence,
    });

    await assert.rejects(
      service.update(
        "My_Ranger1",
        "ranger",
        { schema_version: 99 },
      ),
      (error) =>
        error.code === "CONFIG_SCHEMA_IMMUTABLE" &&
        error.path === "schema_version",
    );
  } finally {
    await current.persistence.close();
    await fs.rm(current.root, { recursive: true, force: true });
  }
});

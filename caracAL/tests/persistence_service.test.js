"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  PersistenceService,
  loadSqlJs,
} = require("../src/PersistenceService");

async function tempDatabase() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "caracal-db-"));
  return {
    root,
    databasePath: path.join(root, "data", "database", "caracal-bot.db"),
  };
}

test("persistence creates a real versioned SQLite database", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 1000,
    });

    assert.equal(service.schemaVersion(), CURRENT_SCHEMA_VERSION);
    assert.deepEqual(service.health(), {
      status: "HEALTHY",
      database_path: fixture.databasePath,
      schema_version: CURRENT_SCHEMA_VERSION,
      current_schema_version: CURRENT_SCHEMA_VERSION,
      flush_count: 1,
      closed: false,
      last_error: null,
    });

    const bytes = await fs.readFile(fixture.databasePath);
    assert.equal(
      bytes.subarray(0, 16).toString("utf8"),
      "SQLite format 3\u0000",
    );
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("persistence survives close and reopen with migrations intact", async () => {
  const fixture = await tempDatabase();
  let first;
  let reopened;

  try {
    let now = 1000;
    first = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => now,
    });

    await first.setMeta("account", {
      active: true,
      session: "must-not-leak",
    });
    await first.saveCharacterProfile("My_Ranger1", {
      ctype: "ranger",
      role: "FARMER",
    });
    await first.saveCharacterConfig("My_Ranger1", 3, {
      combat: { enabled: true },
      auth_token: "must-not-leak",
    });
    await first.saveLifecycleState("My_Ranger1", "RUNNING", "ONLINE");
    await first.saveRevisionState("My_Ranger1", "sha256-code", "cfg-config");

    now = 2000;
    await first.close();
    first = null;

    reopened = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 3000,
    });

    assert.equal(reopened.schemaVersion(), CURRENT_SCHEMA_VERSION);
    assert.deepEqual(reopened.getMeta("account"), {
      active: true,
      session: "[REDACTED]",
    });
    assert.deepEqual(reopened.getCharacterProfile("My_Ranger1"), {
      profile: {
        ctype: "ranger",
        role: "FARMER",
      },
      updated_at: 1000,
    });
    assert.deepEqual(reopened.getCharacterConfig("My_Ranger1"), {
      revision: 3,
      config: {
        auth_token: "[REDACTED]",
        combat: { enabled: true },
      },
      updated_at: 1000,
    });
    assert.deepEqual(reopened.getLifecycleState("My_Ranger1"), {
      desired_state: "RUNNING",
      actual_state: "ONLINE",
      updated_at: 1000,
    });
    assert.deepEqual(reopened.getRevisionState("My_Ranger1"), {
      code_revision: "sha256-code",
      config_revision: "cfg-config",
      updated_at: 1000,
    });
  } finally {
    await first?.close();
    await reopened?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("combined runtime state writes lifecycle and revisions in one flush", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 4000,
    });
    const before = service.health().flush_count;

    await service.saveCharacterRuntimeState("My_Ranger1", {
      desiredState: "PAUSED",
      actualState: "PAUSED",
      codeRevision: "sha256-code",
      configRevision: "cfg-code",
    });

    assert.equal(service.health().flush_count, before + 1);
    assert.deepEqual(service.getLifecycleState("My_Ranger1"), {
      desired_state: "PAUSED",
      actual_state: "PAUSED",
      updated_at: 4000,
    });
    assert.deepEqual(service.getRevisionState("My_Ranger1"), {
      code_revision: "sha256-code",
      config_revision: "cfg-code",
      updated_at: 4000,
    });
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("inventory and equipment snapshots preserve latest slot state", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 5000,
    });

    await service.saveCharacterSnapshot("My_Ranger1", {
      capturedAt: 1000,
      inventory: [{ name: "hpot1", q: 10 }],
      equipment: { mainhand: { name: "bow", level: 7 } },
    });
    await service.saveCharacterSnapshot("My_Ranger1", {
      capturedAt: 2000,
      inventory: [{ name: "hpot1", q: 9 }],
      equipment: { mainhand: { name: "bow", level: 8 } },
    });

    assert.deepEqual(service.getLatestCharacterSnapshot("My_Ranger1"), {
      captured_at: 2000,
      inventory: [{ name: "hpot1", q: 9 }],
      equipment: { mainhand: { name: "bow", level: 8 } },
    });
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("incident index is persistent and character filterable", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 1000,
    });

    await service.indexIncident(
      {
        incident_id: "I-1",
        character: "My_Ranger1",
        severity: "HIGH",
        reason: "ACTION_OUTCOME_UNKNOWN",
        timestamp: 2000,
        token: "must-not-leak",
      },
      "logs/incidents/I-1",
    );
    await service.indexIncident(
      {
        incident_id: "I-2",
        character: "My_Merchant",
        severity: "ERROR",
        reason: "MODULE_FAILED",
        timestamp: 3000,
      },
      "logs/incidents/I-2",
    );

    const ranger = service.listIncidents({
      characterName: "My_Ranger1",
      limit: 10,
    });
    assert.equal(ranger.length, 1);
    assert.equal(ranger[0].incident_id, "I-1");
    assert.equal(ranger[0].metadata.token, "[REDACTED]");

    const all = service.listIncidents({ limit: 10 });
    assert.deepEqual(
      all.map((incident) => incident.incident_id),
      ["I-2", "I-1"],
    );
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed queued mutation rolls back partial SQLite changes", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 6000,
    });

    await assert.rejects(
      service.enqueueMutation(() => {
        service.db.run(
          "INSERT INTO runtime_meta(key, value_json, updated_at) VALUES (?, ?, ?)",
          ["partial", '{"value":1}', 6000],
        );
        throw new Error("forced failure");
      }),
      /forced failure/,
    );

    assert.equal(service.getMeta("partial"), null);
    assert.equal(service.health().status, "ERROR");

    await service.setMeta("recovered", { value: 2 });
    assert.deepEqual(service.getMeta("recovered"), { value: 2 });
    assert.equal(service.health().status, "HEALTHY");
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("persistence health remains readable after close", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 7000,
    });
    await service.close();

    const health = service.health();
    assert.equal(health.status, "CLOSED");
    assert.equal(health.closed, true);
    assert.equal(health.schema_version, CURRENT_SCHEMA_VERSION);
    service = null;
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("queued writes serialize without losing state", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    let now = 1000;
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => now++,
    });

    await Promise.all([
      service.setMeta("one", { value: 1 }),
      service.setMeta("two", { value: 2 }),
      service.saveLifecycleState("My_Ranger1", "RUNNING", "ONLINE"),
      service.saveRevisionState("My_Ranger1", "code", "config"),
    ]);

    assert.deepEqual(service.getMeta("one"), { value: 1 });
    assert.deepEqual(service.getMeta("two"), { value: 2 });
    assert.equal(
      service.getLifecycleState("My_Ranger1").actual_state,
      "ONLINE",
    );
    assert.equal(service.getRevisionState("My_Ranger1").code_revision, "code");
    assert.equal(service.health().flush_count >= 5, true);
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("version 2 databases migrate forward and backfill config revisions", async () => {
  const fixture = await tempDatabase();
  let service;
  let legacyDb;

  try {
    const SQL = await loadSqlJs();
    legacyDb = new SQL.Database();
    legacyDb.run(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);

    for (const migration of MIGRATIONS.filter(
      (candidate) => candidate.version <= 2,
    )) {
      legacyDb.run(migration.sql);
      legacyDb.run(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, 1000 + migration.version],
      );
      legacyDb.run(`PRAGMA user_version = ${migration.version}`);
    }

    legacyDb.run(
      `
        INSERT INTO character_configs(
          character_name,
          revision,
          config_json,
          updated_at
        )
        VALUES (?, ?, ?, ?)
      `,
      ["My_Ranger1", 7, '{"combat":{"enabled":true}}', 2000],
    );

    await fs.mkdir(path.dirname(fixture.databasePath), { recursive: true });
    await fs.writeFile(fixture.databasePath, Buffer.from(legacyDb.export()));
    legacyDb.close();
    legacyDb = null;

    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 3000,
    });

    assert.equal(service.schemaVersion(), CURRENT_SCHEMA_VERSION);
    assert.deepEqual(service.listCharacterConfigRevisions("My_Ranger1"), [
      {
        revision: 7,
        config: { combat: { enabled: true } },
        created_at: 2000,
      },
    ]);
  } finally {
    legacyDb?.close();
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("character config storage keeps immutable revision history", async () => {
  const fixture = await tempDatabase();
  let service;

  try {
    let now = 1000;
    service = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => now,
    });

    await service.saveCharacterConfig("My_Ranger1", 1, {
      combat: { enabled: false },
    });
    now = 2000;
    await service.saveCharacterConfig("My_Ranger1", 2, {
      combat: { enabled: true },
    });
    now = 3000;
    await service.saveCharacterConfig("My_Ranger1", 2, {
      combat: { enabled: false },
    });

    assert.deepEqual(service.getCharacterConfig("My_Ranger1"), {
      revision: 2,
      config: { combat: { enabled: false } },
      updated_at: 3000,
    });
    assert.deepEqual(service.listCharacterConfigRevisions("My_Ranger1"), [
      {
        revision: 2,
        config: { combat: { enabled: true } },
        created_at: 2000,
      },
      {
        revision: 1,
        config: { combat: { enabled: false } },
        created_at: 1000,
      },
    ]);
  } finally {
    await service?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("structured persistence domains survive a restart", async () => {
  const fixture = await tempDatabase();
  let first;
  let reopened;

  try {
    first = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 5000,
    });

    await first.saveStructuredState("account", "rotation", {
      next: "My_Mage",
    });
    await first.saveGoal("goal-1", {
      characterName: "My_Ranger1",
      status: "ACTIVE",
      goal: { type: "FARM_ITEM", item: "gem0" },
    });
    await first.saveCooldown("My_Merchant", "merrit", {
      readyAt: 9000,
      state: { phase: "COOLDOWN" },
    });
    await first.saveEconomyState("account", {
      gold_reserve: 1000000,
    });
    await first.appendMarketObservation({
      itemName: "hpot1",
      level: 0,
      price: 42,
      quantity: 10,
      server: "EU I",
      seller: "Vendor",
      source: "LIVE_VISIBLE",
      observedAt: 6000,
      metadata: { slot: 3 },
    });
    await first.appendPontyObservation({
      itemName: "scroll0",
      price: 12500,
      quantity: 1,
      server: "EU I",
      observedAt: 6100,
    });
    await first.appendMarketObservation({
      itemName: "scroll1",
      price: 5000,
      quantity: 1,
      server: "EU I",
      seller: "Vendor",
      source: "LIVE_VISIBLE",
      observedAt: 6050,
    });
    await first.appendFarmStatistic("My_Ranger1", "goo", {
      startedAt: 1000,
      endedAt: 7000,
      stats: { xp: 1234, gold: 567 },
    });
    await first.appendEncounter({
      encounterKey: "goo",
      characterName: "My_Ranger1",
      startedAt: 7100,
      endedAt: 7200,
      result: "VICTORY",
      data: { kills: 1 },
    });
    await first.saveTestResult("run-1", {
      testId: "restart-state",
      characterName: "My_Ranger1",
      result: "PASS",
      startedAt: 7300,
      endedAt: 7400,
      data: { observed: true },
    });
    await first.recordCodeRevision("sha256-bundle", {
      source_revision: "git-sha",
    });

    await first.close();
    first = null;

    reopened = await PersistenceService.open({
      databasePath: fixture.databasePath,
      now: () => 8000,
    });

    assert.deepEqual(reopened.getStructuredState("account", "rotation"), {
      value: { next: "My_Mage" },
      updated_at: 5000,
    });
    assert.deepEqual(reopened.getGoal("goal-1"), {
      character_name: "My_Ranger1",
      status: "ACTIVE",
      goal: { item: "gem0", type: "FARM_ITEM" },
      updated_at: 5000,
    });
    assert.deepEqual(reopened.getCooldown("My_Merchant", "merrit"), {
      ready_at: 9000,
      state: { phase: "COOLDOWN" },
      updated_at: 5000,
    });
    assert.deepEqual(reopened.getEconomyState("account"), {
      value: { gold_reserve: 1000000 },
      updated_at: 5000,
    });
    assert.deepEqual(reopened.listMarketHistory({ itemName: "hpot1" }), [
      {
        item_name: "hpot1",
        level: 0,
        price: 42,
        quantity: 10,
        server: "EU I",
        seller: "Vendor",
        source: "LIVE_VISIBLE",
        observed_at: 6000,
        metadata: { slot: 3 },
      },
    ]);
    assert.deepEqual(
      reopened.listMarketHistory({ itemName: "scroll1" })[0],
      {
        item_name: "scroll1",
        level: null,
        price: 5000,
        quantity: 1,
        server: "EU I",
        seller: "Vendor",
        source: "LIVE_VISIBLE",
        observed_at: 6050,
        metadata: {},
      },
    );
    assert.deepEqual(
      reopened.listPontyHistory({ itemName: "scroll0" })[0],
      {
        item_name: "scroll0",
        level: null,
        price: 12500,
        quantity: 1,
        server: "EU I",
        observed_at: 6100,
        metadata: {},
      },
    );
    assert.deepEqual(reopened.listFarmStatistics("My_Ranger1")[0], {
      farm_key: "goo",
      sample_started_at: 1000,
      sample_ended_at: 7000,
      stats: { gold: 567, xp: 1234 },
    });
    assert.deepEqual(
      reopened.listEncounterHistory({ encounterKey: "goo" })[0],
      {
        encounter_key: "goo",
        character_name: "My_Ranger1",
        started_at: 7100,
        ended_at: 7200,
        result: "VICTORY",
        encounter: { kills: 1 },
      },
    );
    assert.deepEqual(reopened.getTestResult("run-1"), {
      run_id: "run-1",
      test_id: "restart-state",
      character_name: "My_Ranger1",
      result: "PASS",
      started_at: 7300,
      ended_at: 7400,
      data: { observed: true },
    });
    assert.deepEqual(reopened.listCodeRevisions(), [
      {
        revision: "sha256-bundle",
        installed_at: 5000,
        metadata: { source_revision: "git-sha" },
      },
    ]);
  } finally {
    await first?.close();
    await reopened?.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

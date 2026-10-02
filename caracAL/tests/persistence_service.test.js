"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CURRENT_SCHEMA_VERSION,
  PersistenceService,
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
      database_path: fixture.databasePath,
      schema_version: CURRENT_SCHEMA_VERSION,
      current_schema_version: CURRENT_SCHEMA_VERSION,
      flush_count: 1,
      closed: false,
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

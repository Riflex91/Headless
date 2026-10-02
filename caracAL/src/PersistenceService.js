"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { sanitizeDiagnosticValue } = require("./DiagnosticStore");

const CURRENT_SCHEMA_VERSION = 2;

const MIGRATIONS = [
  {
    version: 1,
    name: "core-character-state",
    sql: `
      CREATE TABLE IF NOT EXISTS runtime_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS character_profiles (
        character_name TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS character_configs (
        character_name TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lifecycle_state (
        character_name TEXT PRIMARY KEY,
        desired_state TEXT NOT NULL,
        actual_state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revision_state (
        character_name TEXT PRIMARY KEY,
        code_revision TEXT,
        config_revision TEXT,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "snapshots-incidents",
    sql: `
      CREATE TABLE IF NOT EXISTS character_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_name TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        inventory_json TEXT NOT NULL,
        equipment_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_character_snapshots_latest
        ON character_snapshots(character_name, captured_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS incident_index (
        incident_id TEXT PRIMARY KEY,
        character_name TEXT,
        severity TEXT NOT NULL,
        reason TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        relative_path TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_incident_index_character_time
        ON incident_index(character_name, timestamp DESC);
    `,
  },
];

function loadSqlJs() {
  const initSqlJs = require("sql.js");
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  return initSqlJs({
    locateFile: (file) =>
      file.endsWith(".wasm") ? wasmPath : path.join(path.dirname(wasmPath), file),
  });
}

function encodeJson(value) {
  return JSON.stringify(sanitizeDiagnosticValue(value));
}

function decodeJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(String(value));
}

async function readExistingDatabase(databasePath) {
  try {
    return await fs.readFile(databasePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function replaceFile(tempPath, databasePath) {
  try {
    await fs.rename(tempPath, databasePath);
  } catch (error) {
    if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error.code)) {
      throw error;
    }

    await fs.rm(databasePath, { force: true });
    await fs.rename(tempPath, databasePath);
  }
}

class PersistenceService {
  static async open({ databasePath, SQL, now } = {}) {
    if (!databasePath) {
      throw new Error("PersistenceService requires databasePath");
    }

    const sqlite = SQL || (await loadSqlJs());
    const existing = await readExistingDatabase(databasePath);
    const db = existing
      ? new sqlite.Database(new Uint8Array(existing))
      : new sqlite.Database();

    const service = new PersistenceService({
      databasePath,
      db,
      now,
    });
    await service.initialize();
    return service;
  }

  constructor({ databasePath, db, now }) {
    this.databasePath = databasePath;
    this.db = db;
    this.now = now || (() => Date.now());
    this.queue = Promise.resolve();
    this.closed = false;
    this.flushCount = 0;
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);

    const applied = new Set(
      this.allRows(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).map((row) => Number(row.version)),
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;

      this.db.run("BEGIN");
      try {
        this.db.run(migration.sql);
        this.db.run(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          [migration.version, migration.name, this.now()],
        );
        this.db.run(`PRAGMA user_version = ${migration.version}`);
        this.db.run("COMMIT");
      } catch (error) {
        try {
          this.db.run("ROLLBACK");
        } catch (_rollbackError) {
          // Preserve the original migration failure.
        }
        throw error;
      }
    }

    await this.flush();
  }

  schemaVersion() {
    const row = this.getRow(
      "SELECT MAX(version) AS version FROM schema_migrations",
    );
    return Number(row?.version || 0);
  }

  health() {
    return {
      database_path: this.databasePath,
      schema_version: this.schemaVersion(),
      current_schema_version: CURRENT_SCHEMA_VERSION,
      flush_count: this.flushCount,
      closed: this.closed,
    };
  }

  async setMeta(key, value) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO runtime_meta(key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `,
        [String(key), encodeJson(value), this.now()],
      );
    });
  }

  getMeta(key) {
    const row = this.getRow(
      "SELECT value_json FROM runtime_meta WHERE key = ?",
      [String(key)],
    );
    return row ? decodeJson(row.value_json) : null;
  }

  async saveCharacterProfile(characterName, profile) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO character_profiles(character_name, profile_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(character_name) DO UPDATE SET
            profile_json = excluded.profile_json,
            updated_at = excluded.updated_at
        `,
        [String(characterName), encodeJson(profile), this.now()],
      );
    });
  }

  getCharacterProfile(characterName) {
    const row = this.getRow(
      `
        SELECT profile_json, updated_at
        FROM character_profiles
        WHERE character_name = ?
      `,
      [String(characterName)],
    );
    if (!row) return null;
    return {
      profile: decodeJson(row.profile_json),
      updated_at: Number(row.updated_at),
    };
  }

  async saveCharacterConfig(characterName, revision, config) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO character_configs(
            character_name,
            revision,
            config_json,
            updated_at
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(character_name) DO UPDATE SET
            revision = excluded.revision,
            config_json = excluded.config_json,
            updated_at = excluded.updated_at
        `,
        [
          String(characterName),
          Number(revision),
          encodeJson(config),
          this.now(),
        ],
      );
    });
  }

  getCharacterConfig(characterName) {
    const row = this.getRow(
      `
        SELECT revision, config_json, updated_at
        FROM character_configs
        WHERE character_name = ?
      `,
      [String(characterName)],
    );
    if (!row) return null;
    return {
      revision: Number(row.revision),
      config: decodeJson(row.config_json),
      updated_at: Number(row.updated_at),
    };
  }

  async saveLifecycleState(characterName, desiredState, actualState) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO lifecycle_state(
            character_name,
            desired_state,
            actual_state,
            updated_at
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(character_name) DO UPDATE SET
            desired_state = excluded.desired_state,
            actual_state = excluded.actual_state,
            updated_at = excluded.updated_at
        `,
        [
          String(characterName),
          String(desiredState),
          String(actualState),
          this.now(),
        ],
      );
    });
  }

  getLifecycleState(characterName) {
    const row = this.getRow(
      `
        SELECT desired_state, actual_state, updated_at
        FROM lifecycle_state
        WHERE character_name = ?
      `,
      [String(characterName)],
    );
    if (!row) return null;
    return {
      desired_state: row.desired_state,
      actual_state: row.actual_state,
      updated_at: Number(row.updated_at),
    };
  }

  async saveRevisionState(characterName, codeRevision, configRevision) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO revision_state(
            character_name,
            code_revision,
            config_revision,
            updated_at
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(character_name) DO UPDATE SET
            code_revision = excluded.code_revision,
            config_revision = excluded.config_revision,
            updated_at = excluded.updated_at
        `,
        [
          String(characterName),
          codeRevision || null,
          configRevision || null,
          this.now(),
        ],
      );
    });
  }

  getRevisionState(characterName) {
    const row = this.getRow(
      `
        SELECT code_revision, config_revision, updated_at
        FROM revision_state
        WHERE character_name = ?
      `,
      [String(characterName)],
    );
    if (!row) return null;
    return {
      code_revision: row.code_revision || null,
      config_revision: row.config_revision || null,
      updated_at: Number(row.updated_at),
    };
  }

  async saveCharacterSnapshot(
    characterName,
    { capturedAt, inventory, equipment } = {},
  ) {
    return this.enqueueMutation(() => {
      const timestamp = Number(capturedAt) || this.now();
      this.db.run(
        `
          INSERT INTO character_snapshots(
            character_name,
            captured_at,
            inventory_json,
            equipment_json
          )
          VALUES (?, ?, ?, ?)
        `,
        [
          String(characterName),
          timestamp,
          encodeJson(inventory || []),
          encodeJson(equipment || {}),
        ],
      );
    });
  }

  getLatestCharacterSnapshot(characterName) {
    const row = this.getRow(
      `
        SELECT captured_at, inventory_json, equipment_json
        FROM character_snapshots
        WHERE character_name = ?
        ORDER BY captured_at DESC, id DESC
        LIMIT 1
      `,
      [String(characterName)],
    );
    if (!row) return null;
    return {
      captured_at: Number(row.captured_at),
      inventory: decodeJson(row.inventory_json),
      equipment: decodeJson(row.equipment_json),
    };
  }

  async indexIncident(incident, relativePath) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO incident_index(
            incident_id,
            character_name,
            severity,
            reason,
            timestamp,
            relative_path,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(incident_id) DO UPDATE SET
            character_name = excluded.character_name,
            severity = excluded.severity,
            reason = excluded.reason,
            timestamp = excluded.timestamp,
            relative_path = excluded.relative_path,
            metadata_json = excluded.metadata_json
        `,
        [
          String(incident.incident_id),
          incident.character || null,
          String(incident.severity || "ERROR"),
          String(incident.reason || "INCIDENT"),
          Number(incident.timestamp) || this.now(),
          String(relativePath),
          encodeJson(incident),
        ],
      );
    });
  }

  listIncidents({ characterName, limit = 50 } = {}) {
    const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const rows = characterName
      ? this.allRows(
          `
            SELECT *
            FROM incident_index
            WHERE character_name = ?
            ORDER BY timestamp DESC
            LIMIT ?
          `,
          [String(characterName), boundedLimit],
        )
      : this.allRows(
          `
            SELECT *
            FROM incident_index
            ORDER BY timestamp DESC
            LIMIT ?
          `,
          [boundedLimit],
        );

    return rows.map((row) => ({
      incident_id: row.incident_id,
      character: row.character_name || null,
      severity: row.severity,
      reason: row.reason,
      timestamp: Number(row.timestamp),
      relative_path: row.relative_path,
      metadata: decodeJson(row.metadata_json),
    }));
  }

  async flush() {
    if (this.closed) {
      throw new Error("PersistenceService is closed");
    }

    const bytes = this.db.export();
    const tempPath = `${this.databasePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, Buffer.from(bytes));
    await replaceFile(tempPath, this.databasePath);
    this.flushCount += 1;
  }

  async close() {
    if (this.closed) return;
    await this.queue;
    await this.flush();
    this.db.close();
    this.closed = true;
  }

  enqueueMutation(mutator) {
    if (this.closed) {
      return Promise.reject(new Error("PersistenceService is closed"));
    }

    const operation = this.queue.then(async () => {
      mutator();
      await this.flush();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  getRow(sql, params = []) {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      if (!statement.step()) return null;
      return statement.getAsObject();
    } finally {
      statement.free();
    }
  }

  allRows(sql, params = []) {
    const statement = this.db.prepare(sql);
    const rows = [];
    try {
      statement.bind(params);
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }
    return rows;
  }
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  PersistenceService,
  decodeJson,
  encodeJson,
  loadSqlJs,
};

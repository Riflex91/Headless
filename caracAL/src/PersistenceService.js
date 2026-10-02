"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const { sanitizeDiagnosticValue } = require("./DiagnosticStore");

const LATEST_SCHEMA_VERSION = 1;

const MIGRATIONS = [
  {
    version: 1,
    name: "initial_persistence",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS character_state (
        character_name TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS config_revisions (
        scope TEXT PRIMARY KEY,
        revision TEXT NOT NULL,
        config_json TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS code_revisions (
        character_name TEXT PRIMARY KEY,
        running_revision TEXT,
        installed_revision TEXT,
        source_revision TEXT,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS incident_index (
        incident_id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        severity TEXT NOT NULL,
        reason TEXT NOT NULL,
        character_name TEXT,
        incident_path TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_incident_index_timestamp
        ON incident_index(timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_incident_index_character_timestamp
        ON incident_index(character_name, timestamp DESC)`,
      `CREATE TABLE IF NOT EXISTS state_kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, key)
      )`,
    ],
  },
];

function jsonStringify(value) {
  return JSON.stringify(sanitizeDiagnosticValue(value));
}

function jsonParse(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

class SqliteConnection {
  constructor(database) {
    this.database = database;
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.database.run(sql, params, function onRun(error) {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          changes: this.changes || 0,
          lastID: this.lastID || 0,
        });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.database.get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.database.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.database.exec(sql, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

class PersistenceService {
  constructor({
    databasePath,
    now,
    sqlite = sqlite3,
  } = {}) {
    if (!databasePath) {
      throw new Error("PersistenceService requires databasePath");
    }

    this.databasePath = databasePath;
    this.now = now || (() => Date.now());
    this.sqlite = sqlite;
    this.database = null;
    this.connection = null;
    this.writeQueue = Promise.resolve();
    this.opened = false;
  }

  async open() {
    if (this.opened) return this;

    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    this.database = await new Promise((resolve, reject) => {
      const database = new this.sqlite.Database(
        this.databasePath,
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(database);
        },
      );
    });
    this.connection = new SqliteConnection(this.database);

    await this.connection.exec("PRAGMA foreign_keys = ON");
    await this.connection.exec("PRAGMA journal_mode = WAL");
    await this.connection.exec("PRAGMA synchronous = NORMAL");
    await this.connection.exec("PRAGMA busy_timeout = 5000");
    await this.applyMigrations();

    this.opened = true;
    return this;
  }

  async close() {
    if (!this.database) return;
    await this.flush();

    const database = this.database;
    this.database = null;
    this.connection = null;
    this.opened = false;

    await new Promise((resolve, reject) => {
      database.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async flush() {
    await this.writeQueue;
  }

  async schemaVersion() {
    this.requireOpen();
    const row = await this.connection.get(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    );
    return Number(row?.version || 0);
  }

  async health() {
    this.requireOpen();
    const [schemaVersion, journalMode, foreignKeys, busyTimeout] =
      await Promise.all([
        this.schemaVersion(),
        this.connection.get("PRAGMA journal_mode"),
        this.connection.get("PRAGMA foreign_keys"),
        this.connection.get("PRAGMA busy_timeout"),
      ]);

    return {
      open: true,
      database_path: this.databasePath,
      schema_version: schemaVersion,
      latest_schema_version: LATEST_SCHEMA_VERSION,
      journal_mode:
        journalMode?.journal_mode || journalMode?.journalMode || null,
      foreign_keys: Number(
        foreignKeys?.foreign_keys ?? foreignKeys?.foreignKeys ?? 0,
      ),
      busy_timeout_ms: Number(
        busyTimeout?.timeout ?? busyTimeout?.busy_timeout ?? 0,
      ),
    };
  }

  async setState(namespace, key, value) {
    return this.enqueueWrite(async (db) => {
      const updatedAt = this.now();
      await db.run(
        `INSERT INTO state_kv(namespace, key, value_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
        [namespace, key, jsonStringify(value), updatedAt],
      );
      return updatedAt;
    });
  }

  async getState(namespace, key) {
    this.requireOpen();
    const row = await this.connection.get(
      `SELECT value_json, updated_at
       FROM state_kv
       WHERE namespace = ? AND key = ?`,
      [namespace, key],
    );
    if (!row) return null;
    return {
      value: jsonParse(row.value_json),
      updated_at: Number(row.updated_at),
    };
  }

  async deleteState(namespace, key) {
    return this.enqueueWrite((db) =>
      db.run(
        "DELETE FROM state_kv WHERE namespace = ? AND key = ?",
        [namespace, key],
      ),
    );
  }

  async saveCharacterState(characterName, state) {
    return this.enqueueWrite(async (db) => {
      const updatedAt = this.now();
      await db.run(
        `INSERT INTO character_state(character_name, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(character_name) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
        [characterName, jsonStringify(state), updatedAt],
      );
      return updatedAt;
    });
  }

  async getCharacterState(characterName) {
    this.requireOpen();
    const row = await this.connection.get(
      `SELECT state_json, updated_at
       FROM character_state
       WHERE character_name = ?`,
      [characterName],
    );
    if (!row) return null;
    return {
      state: jsonParse(row.state_json),
      updated_at: Number(row.updated_at),
    };
  }

  async saveConfigRevision(scope, revision, config = null) {
    return this.enqueueWrite(async (db) => {
      const updatedAt = this.now();
      await db.run(
        `INSERT INTO config_revisions(scope, revision, config_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope) DO UPDATE SET
           revision = excluded.revision,
           config_json = excluded.config_json,
           updated_at = excluded.updated_at`,
        [
          scope,
          revision,
          config === null ? null : jsonStringify(config),
          updatedAt,
        ],
      );
      return updatedAt;
    });
  }

  async getConfigRevision(scope) {
    this.requireOpen();
    const row = await this.connection.get(
      `SELECT revision, config_json, updated_at
       FROM config_revisions
       WHERE scope = ?`,
      [scope],
    );
    if (!row) return null;
    return {
      revision: row.revision,
      config: jsonParse(row.config_json),
      updated_at: Number(row.updated_at),
    };
  }

  async saveCodeRevision(
    characterName,
    {
      runningRevision = null,
      installedRevision = null,
      sourceRevision = null,
      status = "UNKNOWN",
    } = {},
  ) {
    return this.enqueueWrite(async (db) => {
      const updatedAt = this.now();
      await db.run(
        `INSERT INTO code_revisions(
          character_name,
          running_revision,
          installed_revision,
          source_revision,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(character_name) DO UPDATE SET
          running_revision = excluded.running_revision,
          installed_revision = excluded.installed_revision,
          source_revision = excluded.source_revision,
          status = excluded.status,
          updated_at = excluded.updated_at`,
        [
          characterName,
          runningRevision,
          installedRevision,
          sourceRevision,
          status,
          updatedAt,
        ],
      );
      return updatedAt;
    });
  }

  async getCodeRevision(characterName) {
    this.requireOpen();
    const row = await this.connection.get(
      `SELECT
        running_revision,
        installed_revision,
        source_revision,
        status,
        updated_at
       FROM code_revisions
       WHERE character_name = ?`,
      [characterName],
    );
    if (!row) return null;
    return {
      running_revision: row.running_revision,
      installed_revision: row.installed_revision,
      source_revision: row.source_revision,
      status: row.status,
      updated_at: Number(row.updated_at),
    };
  }

  async indexIncident({
    incidentId,
    timestamp,
    severity,
    reason,
    character = null,
    incidentPath,
    summary,
  }) {
    return this.enqueueWrite(async (db) => {
      const createdAt = this.now();
      await db.run(
        `INSERT INTO incident_index(
          incident_id,
          timestamp,
          severity,
          reason,
          character_name,
          incident_path,
          summary_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(incident_id) DO UPDATE SET
          timestamp = excluded.timestamp,
          severity = excluded.severity,
          reason = excluded.reason,
          character_name = excluded.character_name,
          incident_path = excluded.incident_path,
          summary_json = excluded.summary_json`,
        [
          incidentId,
          timestamp,
          severity,
          reason,
          character,
          incidentPath,
          jsonStringify(summary),
          createdAt,
        ],
      );
      return createdAt;
    });
  }

  async listIncidents({ character, limit = 50 } = {}) {
    this.requireOpen();
    const count = Math.max(1, Math.min(1000, Math.trunc(limit) || 50));
    const rows = character
      ? await this.connection.all(
          `SELECT *
           FROM incident_index
           WHERE character_name = ?
           ORDER BY timestamp DESC
           LIMIT ?`,
          [character, count],
        )
      : await this.connection.all(
          `SELECT *
           FROM incident_index
           ORDER BY timestamp DESC
           LIMIT ?`,
          [count],
        );

    return rows.map((row) => ({
      incident_id: row.incident_id,
      timestamp: Number(row.timestamp),
      severity: row.severity,
      reason: row.reason,
      character: row.character_name,
      incident_path: row.incident_path,
      summary: jsonParse(row.summary_json),
      created_at: Number(row.created_at),
    }));
  }

  async transaction(callback) {
    if (typeof callback !== "function") {
      throw new Error("transaction requires callback");
    }

    return this.enqueueWrite(async (db) => {
      await db.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(db);
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async applyMigrations() {
    await this.connection.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )`,
    );

    const current = await this.schemaVersionDirect();
    if (current > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `database schema ${current} is newer than supported ${LATEST_SCHEMA_VERSION}`,
      );
    }

    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;

      await this.connection.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of migration.statements) {
          await this.connection.exec(statement);
        }
        await this.connection.run(
          `INSERT INTO schema_migrations(version, name, applied_at)
           VALUES (?, ?, ?)`,
          [migration.version, migration.name, this.now()],
        );
        await this.connection.exec("COMMIT");
      } catch (error) {
        await this.connection.exec("ROLLBACK");
        throw error;
      }
    }
  }

  async schemaVersionDirect() {
    const row = await this.connection.get(
      "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    );
    return Number(row?.version || 0);
  }

  enqueueWrite(callback) {
    this.requireOpen();
    const run = this.writeQueue.then(() => callback(this.connection));
    this.writeQueue = run.catch(() => {});
    return run;
  }

  requireOpen() {
    if (!this.database || !this.connection) {
      throw new Error("PersistenceService is not open");
    }
  }
}

module.exports = {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  PersistenceService,
  SqliteConnection,
  jsonParse,
  jsonStringify,
};

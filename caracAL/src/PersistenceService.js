"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { sanitizeDiagnosticValue } = require("./DiagnosticStore");

const CURRENT_SCHEMA_VERSION = 3;

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
  {
    version: 3,
    name: "structured-domain-state",
    sql: `
      CREATE TABLE IF NOT EXISTS config_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_name TEXT NOT NULL,
        revision INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(character_name, revision)
      );

      INSERT OR IGNORE INTO config_revisions(
        character_name,
        revision,
        config_json,
        created_at
      )
      SELECT
        character_name,
        revision,
        config_json,
        updated_at
      FROM character_configs;

      CREATE INDEX IF NOT EXISTS idx_config_revisions_character_revision
        ON config_revisions(character_name, revision DESC);

      CREATE TABLE IF NOT EXISTS structured_state (
        namespace TEXT NOT NULL,
        state_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, state_key)
      );

      CREATE TABLE IF NOT EXISTS goals (
        goal_id TEXT PRIMARY KEY,
        character_name TEXT,
        status TEXT NOT NULL,
        goal_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cooldowns (
        owner_key TEXT NOT NULL,
        cooldown_key TEXT NOT NULL,
        ready_at INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(owner_key, cooldown_key)
      );

      CREATE TABLE IF NOT EXISTS economy_state (
        state_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS market_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        level INTEGER,
        price INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        server TEXT,
        seller TEXT,
        source TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_market_history_item_time
        ON market_history(item_name, level, observed_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS ponty_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        level INTEGER,
        price INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        server TEXT,
        observed_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ponty_history_item_time
        ON ponty_history(item_name, level, observed_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS farm_statistics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_name TEXT NOT NULL,
        farm_key TEXT NOT NULL,
        sample_started_at INTEGER NOT NULL,
        sample_ended_at INTEGER NOT NULL,
        stats_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_farm_statistics_character_time
        ON farm_statistics(character_name, sample_ended_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS encounter_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encounter_key TEXT NOT NULL,
        character_name TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        result TEXT,
        encounter_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_encounter_history_key_time
        ON encounter_history(encounter_key, started_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS test_results (
        run_id TEXT PRIMARY KEY,
        test_id TEXT NOT NULL,
        character_name TEXT,
        result TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        result_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_test_results_test_time
        ON test_results(test_id, ended_at DESC);

      CREATE TABLE IF NOT EXISTS code_revisions (
        revision TEXT PRIMARY KEY,
        installed_at INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      );
    `,
  },
];

function loadSqlJs() {
  const initSqlJs = require("sql.js");
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  return initSqlJs({
    locateFile: (file) =>
      file.endsWith(".wasm")
        ? wasmPath
        : path.join(path.dirname(wasmPath), file),
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
    this.lastError = null;
    this.cachedSchemaVersion = 0;
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

    this.cachedSchemaVersion = this.schemaVersion();
    await this.flush();
  }

  schemaVersion() {
    if (this.closed) return this.cachedSchemaVersion;

    const row = this.getRow(
      "SELECT MAX(version) AS version FROM schema_migrations",
    );
    const version = Number(row?.version || 0);
    this.cachedSchemaVersion = version;
    return version;
  }

  health() {
    const schemaVersion = this.schemaVersion();
    const status = this.closed
      ? "CLOSED"
      : this.lastError
      ? "ERROR"
      : schemaVersion === CURRENT_SCHEMA_VERSION
      ? "HEALTHY"
      : "SCHEMA_MISMATCH";

    return {
      status,
      database_path: this.databasePath,
      schema_version: schemaVersion,
      current_schema_version: CURRENT_SCHEMA_VERSION,
      flush_count: this.flushCount,
      closed: this.closed,
      last_error: this.lastError,
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
      const updatedAt = this.now();
      const encodedConfig = encodeJson(config);

      this.db.run(
        `
          INSERT OR IGNORE INTO config_revisions(
            character_name,
            revision,
            config_json,
            created_at
          )
          VALUES (?, ?, ?, ?)
        `,
        [String(characterName), Number(revision), encodedConfig, updatedAt],
      );

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
        [String(characterName), Number(revision), encodedConfig, updatedAt],
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

  async saveCharacterRuntimeState(
    characterName,
    { desiredState, actualState, codeRevision, configRevision } = {},
  ) {
    return this.enqueueMutation(() => {
      const updatedAt = this.now();
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
          updatedAt,
        ],
      );
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
          updatedAt,
        ],
      );
    });
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

  listCharacterConfigRevisions(characterName, { limit = 50 } = {}) {
    const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    return this.allRows(
      `
        SELECT revision, config_json, created_at
        FROM config_revisions
        WHERE character_name = ?
        ORDER BY revision DESC, id DESC
        LIMIT ?
      `,
      [String(characterName), boundedLimit],
    ).map((row) => ({
      revision: Number(row.revision),
      config: decodeJson(row.config_json),
      created_at: Number(row.created_at),
    }));
  }

  async saveStructuredState(namespace, stateKey, value) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO structured_state(namespace, state_key, value_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(namespace, state_key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `,
        [String(namespace), String(stateKey), encodeJson(value), this.now()],
      );
    });
  }

  getStructuredState(namespace, stateKey) {
    const row = this.getRow(
      `
        SELECT value_json, updated_at
        FROM structured_state
        WHERE namespace = ? AND state_key = ?
      `,
      [String(namespace), String(stateKey)],
    );
    if (!row) return null;
    return {
      value: decodeJson(row.value_json),
      updated_at: Number(row.updated_at),
    };
  }

  async saveGoal(goalId, { characterName, status = "ACTIVE", goal } = {}) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO goals(goal_id, character_name, status, goal_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(goal_id) DO UPDATE SET
            character_name = excluded.character_name,
            status = excluded.status,
            goal_json = excluded.goal_json,
            updated_at = excluded.updated_at
        `,
        [
          String(goalId),
          characterName ? String(characterName) : null,
          String(status),
          encodeJson(goal || {}),
          this.now(),
        ],
      );
    });
  }

  getGoal(goalId) {
    const row = this.getRow(
      `
        SELECT character_name, status, goal_json, updated_at
        FROM goals
        WHERE goal_id = ?
      `,
      [String(goalId)],
    );
    if (!row) return null;
    return {
      character_name: row.character_name || null,
      status: row.status,
      goal: decodeJson(row.goal_json),
      updated_at: Number(row.updated_at),
    };
  }

  async saveCooldown(ownerKey, cooldownKey, { readyAt = 0, state = {} } = {}) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO cooldowns(
            owner_key,
            cooldown_key,
            ready_at,
            state_json,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(owner_key, cooldown_key) DO UPDATE SET
            ready_at = excluded.ready_at,
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `,
        [
          String(ownerKey),
          String(cooldownKey),
          Number(readyAt) || 0,
          encodeJson(state),
          this.now(),
        ],
      );
    });
  }

  getCooldown(ownerKey, cooldownKey) {
    const row = this.getRow(
      `
        SELECT ready_at, state_json, updated_at
        FROM cooldowns
        WHERE owner_key = ? AND cooldown_key = ?
      `,
      [String(ownerKey), String(cooldownKey)],
    );
    if (!row) return null;
    return {
      ready_at: Number(row.ready_at),
      state: decodeJson(row.state_json),
      updated_at: Number(row.updated_at),
    };
  }

  async saveEconomyState(stateKey, value) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO economy_state(state_key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(state_key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `,
        [String(stateKey), encodeJson(value), this.now()],
      );
    });
  }

  getEconomyState(stateKey) {
    const row = this.getRow(
      `
        SELECT value_json, updated_at
        FROM economy_state
        WHERE state_key = ?
      `,
      [String(stateKey)],
    );
    if (!row) return null;
    return {
      value: decodeJson(row.value_json),
      updated_at: Number(row.updated_at),
    };
  }

  async appendMarketObservation(observation = {}) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO market_history(
            item_name,
            level,
            price,
            quantity,
            server,
            seller,
            source,
            observed_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          String(observation.itemName || observation.item || ""),
          Number.isFinite(Number(observation.level))
            ? Number(observation.level)
            : null,
          Number(observation.price) || 0,
          Number(observation.quantity) || 0,
          observation.server ? String(observation.server) : null,
          observation.seller ? String(observation.seller) : null,
          String(observation.source || "LOCAL_HISTORY"),
          Number(observation.observedAt) || this.now(),
          encodeJson(observation.metadata || {}),
        ],
      );
    });
  }

  listMarketHistory({ itemName, limit = 100 } = {}) {
    const boundedLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
    const rows = itemName
      ? this.allRows(
          `
            SELECT *
            FROM market_history
            WHERE item_name = ?
            ORDER BY observed_at DESC, id DESC
            LIMIT ?
          `,
          [String(itemName), boundedLimit],
        )
      : this.allRows(
          `
            SELECT *
            FROM market_history
            ORDER BY observed_at DESC, id DESC
            LIMIT ?
          `,
          [boundedLimit],
        );
    return rows.map((row) => ({
      item_name: row.item_name,
      level: row.level === null ? null : Number(row.level),
      price: Number(row.price),
      quantity: Number(row.quantity),
      server: row.server || null,
      seller: row.seller || null,
      source: row.source,
      observed_at: Number(row.observed_at),
      metadata: decodeJson(row.metadata_json),
    }));
  }

  async appendPontyObservation(observation = {}) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO ponty_history(
            item_name,
            level,
            price,
            quantity,
            server,
            observed_at,
            metadata_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          String(observation.itemName || observation.item || ""),
          Number.isFinite(Number(observation.level))
            ? Number(observation.level)
            : null,
          Number(observation.price) || 0,
          Number(observation.quantity) || 0,
          observation.server ? String(observation.server) : null,
          Number(observation.observedAt) || this.now(),
          encodeJson(observation.metadata || {}),
        ],
      );
    });
  }

  listPontyHistory({ itemName, limit = 100 } = {}) {
    const boundedLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
    const rows = itemName
      ? this.allRows(
          `
            SELECT *
            FROM ponty_history
            WHERE item_name = ?
            ORDER BY observed_at DESC, id DESC
            LIMIT ?
          `,
          [String(itemName), boundedLimit],
        )
      : this.allRows(
          `
            SELECT *
            FROM ponty_history
            ORDER BY observed_at DESC, id DESC
            LIMIT ?
          `,
          [boundedLimit],
        );
    return rows.map((row) => ({
      item_name: row.item_name,
      level: row.level === null ? null : Number(row.level),
      price: Number(row.price),
      quantity: Number(row.quantity),
      server: row.server || null,
      observed_at: Number(row.observed_at),
      metadata: decodeJson(row.metadata_json),
    }));
  }

  async appendFarmStatistic(
    characterName,
    farmKey,
    { startedAt, endedAt, stats = {} } = {},
  ) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO farm_statistics(
            character_name,
            farm_key,
            sample_started_at,
            sample_ended_at,
            stats_json
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          String(characterName),
          String(farmKey),
          Number(startedAt) || this.now(),
          Number(endedAt) || this.now(),
          encodeJson(stats),
        ],
      );
    });
  }

  listFarmStatistics(characterName, { limit = 100 } = {}) {
    const boundedLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
    return this.allRows(
      `
        SELECT farm_key, sample_started_at, sample_ended_at, stats_json
        FROM farm_statistics
        WHERE character_name = ?
        ORDER BY sample_ended_at DESC, id DESC
        LIMIT ?
      `,
      [String(characterName), boundedLimit],
    ).map((row) => ({
      farm_key: row.farm_key,
      sample_started_at: Number(row.sample_started_at),
      sample_ended_at: Number(row.sample_ended_at),
      stats: decodeJson(row.stats_json),
    }));
  }

  async appendEncounter(encounter = {}) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO encounter_history(
            encounter_key,
            character_name,
            started_at,
            ended_at,
            result,
            encounter_json
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          String(encounter.encounterKey || encounter.key || ""),
          encounter.characterName || encounter.character
            ? String(encounter.characterName || encounter.character)
            : null,
          Number(encounter.startedAt) || this.now(),
          Number.isFinite(Number(encounter.endedAt))
            ? Number(encounter.endedAt)
            : null,
          encounter.result ? String(encounter.result) : null,
          encodeJson(encounter.data || encounter),
        ],
      );
    });
  }

  listEncounterHistory({ encounterKey, limit = 100 } = {}) {
    const boundedLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
    const rows = encounterKey
      ? this.allRows(
          `
            SELECT *
            FROM encounter_history
            WHERE encounter_key = ?
            ORDER BY started_at DESC, id DESC
            LIMIT ?
          `,
          [String(encounterKey), boundedLimit],
        )
      : this.allRows(
          `
            SELECT *
            FROM encounter_history
            ORDER BY started_at DESC, id DESC
            LIMIT ?
          `,
          [boundedLimit],
        );
    return rows.map((row) => ({
      encounter_key: row.encounter_key,
      character_name: row.character_name || null,
      started_at: Number(row.started_at),
      ended_at: row.ended_at === null ? null : Number(row.ended_at),
      result: row.result || null,
      encounter: decodeJson(row.encounter_json),
    }));
  }

  async saveTestResult(
    runId,
    { testId, characterName, result, startedAt, endedAt, data = {} } = {},
  ) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO test_results(
            run_id,
            test_id,
            character_name,
            result,
            started_at,
            ended_at,
            result_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            test_id = excluded.test_id,
            character_name = excluded.character_name,
            result = excluded.result,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            result_json = excluded.result_json
        `,
        [
          String(runId),
          String(testId || ""),
          characterName ? String(characterName) : null,
          String(result || "UNKNOWN"),
          Number(startedAt) || this.now(),
          Number(endedAt) || this.now(),
          encodeJson(data),
        ],
      );
    });
  }

  getTestResult(runId) {
    const row = this.getRow(
      `
        SELECT *
        FROM test_results
        WHERE run_id = ?
      `,
      [String(runId)],
    );
    if (!row) return null;
    return {
      run_id: row.run_id,
      test_id: row.test_id,
      character_name: row.character_name || null,
      result: row.result,
      started_at: Number(row.started_at),
      ended_at: Number(row.ended_at),
      data: decodeJson(row.result_json),
    };
  }

  async recordCodeRevision(revision, metadata = {}) {
    return this.enqueueMutation(() => {
      this.db.run(
        `
          INSERT INTO code_revisions(revision, installed_at, metadata_json)
          VALUES (?, ?, ?)
          ON CONFLICT(revision) DO UPDATE SET
            metadata_json = excluded.metadata_json
        `,
        [String(revision), this.now(), encodeJson(metadata)],
      );
    });
  }

  listCodeRevisions({ limit = 50 } = {}) {
    const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    return this.allRows(
      `
        SELECT revision, installed_at, metadata_json
        FROM code_revisions
        ORDER BY installed_at DESC
        LIMIT ?
      `,
      [boundedLimit],
    ).map((row) => ({
      revision: row.revision,
      installed_at: Number(row.installed_at),
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
    this.lastError = null;
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
      this.db.run("BEGIN");
      try {
        mutator();
        this.db.run("COMMIT");
      } catch (error) {
        try {
          this.db.run("ROLLBACK");
        } catch (_rollbackError) {
          // Preserve the original mutation failure.
        }
        throw error;
      }
      await this.flush();
    });
    const observed = operation.catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    });
    this.queue = observed.catch(() => {});
    return observed;
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

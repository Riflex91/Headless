"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeDiagnosticValue } = require("./DiagnosticStore");

function hashBytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableNormalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stableNormalize);

  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = stableNormalize(value[key]);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    return result;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  return `[${typeof value}]`;
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function createConfigRevision(config) {
  const sanitized = sanitizeDiagnosticValue(config || {});
  return `cfg-${hashBytes(stableStringify(sanitized)).slice(0, 12)}`;
}

function resolveCharacterScriptPath(rootDir, charBlock, enableTypecode) {
  if (enableTypecode && charBlock?.typescript) {
    return path.join(rootDir, "TYPECODE.out", charBlock.typescript);
  }
  if (charBlock?.script) {
    return path.join(rootDir, "CODE", charBlock.script);
  }
  return null;
}

function readGitRevision(rootDir) {
  try {
    const head = childProcess
      .execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();

    const dirty = childProcess
      .execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();

    return dirty ? `${head}-dirty` : head;
  } catch (_error) {
    return null;
  }
}

class FileRevisionCache {
  constructor({ fsImpl = fs } = {}) {
    this.fs = fsImpl;
    this.cache = new Map();
  }

  revision(filePath) {
    if (!filePath) return null;

    let stat;
    try {
      stat = this.fs.statSync(filePath);
    } catch (_error) {
      this.cache.delete(filePath);
      return null;
    }

    const cached = this.cache.get(filePath);
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size
    ) {
      return cached.revision;
    }

    const content = this.fs.readFileSync(filePath);
    const revision = `sha256-${hashBytes(content).slice(0, 12)}`;
    this.cache.set(filePath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      revision,
    });
    return revision;
  }
}

function revisionStatus({
  runningCodeRevision,
  installedCodeRevision,
  runningConfigRevision,
  installedConfigRevision,
}) {
  if (
    !runningCodeRevision ||
    !installedCodeRevision ||
    !runningConfigRevision ||
    !installedConfigRevision
  ) {
    return "UNKNOWN";
  }

  if (
    runningCodeRevision !== installedCodeRevision ||
    runningConfigRevision !== installedConfigRevision
  ) {
    return "STALE";
  }

  return "HEALTHY";
}

module.exports = {
  FileRevisionCache,
  createConfigRevision,
  readGitRevision,
  resolveCharacterScriptPath,
  revisionStatus,
  stableStringify,
};

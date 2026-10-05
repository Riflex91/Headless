"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { sanitizeDiagnosticValue } = require("./DiagnosticStore");

function utcDateKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid structured log timestamp");
  }
  return date.toISOString().slice(0, 10);
}

function safeFilePart(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
}

class StructuredLogger {
  constructor({ rootDir, now } = {}) {
    if (!rootDir) {
      throw new Error("StructuredLogger requires rootDir");
    }
    this.rootDir = rootDir;
    this.now = now || (() => Date.now());
    this.queue = Promise.resolve();
    this.lastError = null;
    this.readyDirectories = new Set();
  }

  write(event) {
    const sanitized = sanitizeDiagnosticValue({
      timestamp: this.now(),
      ...event,
    });

    this.queue = this.queue
      .then(() => this.writeSanitized(sanitized))
      .catch((error) => {
        this.lastError = error;
      });

    return sanitized;
  }

  async flush() {
    await this.queue;
    if (this.lastError) {
      const error = this.lastError;
      this.lastError = null;
      throw error;
    }
  }

  async ensureDirectory(directory) {
    if (this.readyDirectories.has(directory)) return;
    await fs.mkdir(directory, { recursive: true });
    this.readyDirectories.add(directory);
  }

  async writeSanitized(event) {
    const dateKey = utcDateKey(event.timestamp);
    const runtimeDir = path.join(this.rootDir, "runtime");
    const characterDir = path.join(this.rootDir, "characters");
    const line = `${JSON.stringify(event)}\n`;

    await this.ensureDirectory(runtimeDir);
    await fs.appendFile(
      path.join(runtimeDir, `${dateKey}.jsonl`),
      line,
      "utf8",
    );

    if (event.character) {
      await this.ensureDirectory(characterDir);
      const characterName = safeFilePart(event.character);
      await fs.appendFile(
        path.join(characterDir, `${characterName}-${dateKey}.jsonl`),
        line,
        "utf8",
      );
    }
  }
}

module.exports = {
  StructuredLogger,
  safeFilePart,
  utcDateKey,
};

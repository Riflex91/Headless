"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  eventMatchesCharacter,
  sanitizeDiagnosticValue,
} = require("./DiagnosticStore");
const { safeFilePart } = require("./StructuredLogger");

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

function incidentTriggerReason(event) {
  const type = String(event?.event || event?.type || "");

  if (type === "CHARACTER_HEARTBEAT_TIMEOUT") return "HEARTBEAT_TIMEOUT";
  if (type === "UNEXPECTED_CHARACTER_EXIT") return "UNEXPECTED_PROCESS_EXIT";
  if (type === "RUNTIME_START_FAILED") return "RUNTIME_START_FAILED";
  if (type === "MODULE_FAILED") return "MODULE_FAILED";
  if (type === "JOB_FAILED") return "SCHEDULER_JOB_FAILED";
  if (type === "ACTION_UNKNOWN") return "ACTION_OUTCOME_UNKNOWN";
  return null;
}

function incidentSeverity(event) {
  const type = String(event?.event || event?.type || "");
  if (type === "ACTION_UNKNOWN") return "HIGH";
  if (type === "RUNTIME_START_FAILED") return "HIGH";
  return "ERROR";
}

class IncidentRecorder {
  constructor({
    rootDir,
    diagnosticStore,
    getSnapshot,
    now,
    windowMs = DEFAULT_WINDOW_MS,
  } = {}) {
    if (!rootDir) throw new Error("IncidentRecorder requires rootDir");
    if (!diagnosticStore) {
      throw new Error("IncidentRecorder requires diagnosticStore");
    }

    this.rootDir = rootDir;
    this.diagnosticStore = diagnosticStore;
    this.getSnapshot = getSnapshot || (() => null);
    this.now = now || (() => Date.now());
    this.windowMs = Math.max(1000, Number(windowMs) || DEFAULT_WINDOW_MS);
    this.sequence = 0;
    this.queue = Promise.resolve();
    this.lastError = null;
  }

  maybeCapture(event, extra = {}) {
    const reason = incidentTriggerReason(event);
    if (!reason) return null;
    return this.capture({
      reason,
      severity: incidentSeverity(event),
      event,
      ...extra,
    });
  }

  capture({ reason, severity = "ERROR", event, character, extra } = {}) {
    const timestamp = this.now();
    this.sequence += 1;
    const incidentId = [
      new Date(timestamp).toISOString().replace(/[:.]/g, "-"),
      String(this.sequence).padStart(4, "0"),
      safeFilePart(character || event?.character || "account"),
      safeFilePart(reason || "INCIDENT"),
    ].join("_");

    const summary = {
      incident_id: incidentId,
      timestamp,
      reason: String(reason || "INCIDENT"),
      severity: String(severity || "ERROR"),
      character: character || event?.character || null,
      trigger_event: sanitizeDiagnosticValue(event || null),
    };

    this.queue = this.queue
      .then(() => this.writeIncident(summary, extra))
      .catch((error) => {
        this.lastError = error;
      });

    return summary;
  }

  async flush() {
    await this.queue;
    if (this.lastError) {
      const error = this.lastError;
      this.lastError = null;
      throw error;
    }
  }

  async list({ limit = 50, character } = {}) {
    let entries;
    try {
      entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    const summaries = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const content = await fs.readFile(
          path.join(this.rootDir, entry.name, "incident.json"),
          "utf8",
        );
        const incident = JSON.parse(content);
        if (
          character &&
          incident.character !== character &&
          !eventMatchesCharacter(incident.trigger_event || {}, character)
        ) {
          continue;
        }
        summaries.push(incident);
      } catch (_error) {
        // Ignore incomplete/corrupt incident directories and continue.
      }
    }

    return summaries
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, Math.max(0, Math.trunc(limit)));
  }

  async latest({ character } = {}) {
    const incidents = await this.list({ limit: 1, character });
    return incidents[0] || null;
  }

  async readText(incidentId) {
    const safeId = safeFilePart(incidentId);
    if (!safeId || safeId !== incidentId) {
      const error = new Error("Invalid incident id");
      error.code = "INVALID_INCIDENT_ID";
      error.statusCode = 400;
      throw error;
    }

    const dir = path.join(this.rootDir, safeId);
    const [incident, snapshot, events] = await Promise.all([
      fs.readFile(path.join(dir, "incident.json"), "utf8"),
      fs.readFile(path.join(dir, "snapshot.json"), "utf8"),
      fs.readFile(path.join(dir, "recent-events.jsonl"), "utf8"),
    ]);

    return [
      "=== CARACAL INCIDENT PACKAGE ===",
      "",
      "INCIDENT",
      "--------",
      incident.trim(),
      "",
      "SNAPSHOT",
      "--------",
      snapshot.trim(),
      "",
      "RECENT EVENTS",
      "-------------",
      events.trim(),
      "",
      "=== END INCIDENT PACKAGE ===",
      "",
    ].join("\n");
  }

  async writeIncident(summary, extra) {
    const dir = path.join(this.rootDir, summary.incident_id);
    const since = summary.timestamp - this.windowMs;
    const events = this.diagnosticStore.getEvents({ since });
    const characterEvents = summary.character
      ? events.filter((event) =>
          eventMatchesCharacter(event, summary.character),
        )
      : events;

    const snapshot = sanitizeDiagnosticValue(this.getSnapshot() || null);
    const incident = sanitizeDiagnosticValue({
      ...summary,
      window_ms: this.windowMs,
      event_count: characterEvents.length,
      extra: extra || null,
    });

    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(dir, "incident.json"),
        `${JSON.stringify(incident, null, 2)}\n`,
        "utf8",
      ),
      fs.writeFile(
        path.join(dir, "snapshot.json"),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        "utf8",
      ),
      fs.writeFile(
        path.join(dir, "recent-events.jsonl"),
        characterEvents
          .map((event) => JSON.stringify(sanitizeDiagnosticValue(event)))
          .join("\n") + (characterEvents.length ? "\n" : ""),
        "utf8",
      ),
    ]);
  }
}

module.exports = {
  DEFAULT_WINDOW_MS,
  IncidentRecorder,
  incidentSeverity,
  incidentTriggerReason,
};

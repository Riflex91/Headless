"use strict";

const SENSITIVE_KEY_PATTERN =
  /^(?:auth|authorization|cookie|password|passwd|secret|sess|session|token|user_auth|api_?key)$/i;

function sanitizeString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b\d{4,}-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

function sanitizeDiagnosticValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value !== "object") return value;

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticValue(entry, seen));
  }

  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }
    sanitized[key] = sanitizeDiagnosticValue(entry, seen);
  }
  return sanitized;
}

function eventMatchesCharacter(event, characterName) {
  if (event.character === characterName) return true;

  for (const key of ["characters", "participants", "related_characters"]) {
    if (Array.isArray(event[key]) && event[key].includes(characterName)) {
      return true;
    }
  }
  return false;
}

class DiagnosticEventStore {
  constructor({ maxEvents = 5000 } = {}) {
    this.maxEvents = Math.max(100, Number(maxEvents) || 5000);
    this.events = [];
  }

  append(event) {
    const sanitized = sanitizeDiagnosticValue({
      timestamp: Date.now(),
      ...event,
    });
    this.events.push(sanitized);

    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    return sanitized;
  }

  getEvents({ character, since } = {}) {
    return this.events.filter((event) => {
      if (Number.isFinite(since) && event.timestamp < since) return false;
      if (character && !eventMatchesCharacter(event, character)) return false;
      return true;
    });
  }
}

function formatEvent(event) {
  const timestamp = new Date(event.timestamp).toISOString();
  const type = event.event || event.type || "EVENT";
  const character = event.character || "Supervisor";
  const details = { ...event };
  delete details.timestamp;
  delete details.event;
  delete details.type;
  delete details.character;

  return `${timestamp} [${type}] [${character}] ${JSON.stringify(details)}`;
}

function formatCharacterDiagnostic(characterName, snapshot, events) {
  const character = snapshot.characters.find(
    (candidate) => candidate.name === characterName,
  );

  if (!character) {
    const error = new Error(`Unknown character: ${characterName}`);
    error.code = "CHARACTER_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }

  return [
    "=== CARACAL CHARACTER DIAGNOSTIC ===",
    `Generated: ${new Date().toISOString()}`,
    `Character: ${characterName}`,
    "",
    "CURRENT STATE",
    "-------------",
    JSON.stringify(character, null, 2),
    "",
    "EVENTS",
    "------",
    ...events.map(formatEvent),
    "",
    "=== END CHARACTER DIAGNOSTIC ===",
    "",
  ].join("\n");
}

function formatAccountDiagnostic(snapshot, events) {
  return [
    "=== CARACAL ACCOUNT DIAGNOSTIC ===",
    `Generated: ${new Date().toISOString()}`,
    "",
    "CURRENT STATE",
    "-------------",
    JSON.stringify(snapshot, null, 2),
    "",
    "EVENTS",
    "------",
    ...events.map(formatEvent),
    "",
    "=== END ACCOUNT DIAGNOSTIC ===",
    "",
  ].join("\n");
}

module.exports = {
  DiagnosticEventStore,
  eventMatchesCharacter,
  formatAccountDiagnostic,
  formatCharacterDiagnostic,
  sanitizeDiagnosticValue,
};

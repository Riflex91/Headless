"use strict";

const RUNTIME_EVENT_VERSION = 1;
const MAX_RUNTIME_EVENT_BYTES = 64 * 1024;

function optionalString(value, maxLength) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function jsonSafeData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return undefined;
  }
}

function normalizeRuntimeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  if (event.version !== RUNTIME_EVENT_VERSION) {
    return null;
  }

  const module = optionalString(event.module, 128);
  const type = optionalString(event.type, 128);
  const id = optionalString(event.id, 160);
  const timestamp = Number(event.timestamp);

  if (
    !module ||
    !type ||
    !id ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  ) {
    return null;
  }

  const normalized = {
    version: RUNTIME_EVENT_VERSION,
    id,
    timestamp,
    module,
    type,
  };

  const why = optionalString(event.why, 1024);
  const correlationId = optionalString(event.correlationId, 160);
  const actionId = optionalString(event.actionId, 160);
  const data = jsonSafeData(event.data);

  if (why) normalized.why = why;
  if (correlationId) normalized.correlationId = correlationId;
  if (actionId) normalized.actionId = actionId;
  if (data) normalized.data = data;

  let serialized;
  try {
    serialized = JSON.stringify(normalized);
  } catch (_error) {
    return null;
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_RUNTIME_EVENT_BYTES) {
    return null;
  }

  return normalized;
}

module.exports = {
  MAX_RUNTIME_EVENT_BYTES,
  RUNTIME_EVENT_VERSION,
  normalizeRuntimeEvent,
};

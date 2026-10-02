"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_RUNTIME_EVENT_BYTES,
  RUNTIME_EVENT_VERSION,
  normalizeRuntimeEvent,
} = require("../src/RuntimeEventBridge");

test("runtime event bridge accepts the versioned allowlist", () => {
  const normalized = normalizeRuntimeEvent({
    version: 1,
    id: "E-1",
    timestamp: 12345,
    module: "Planner",
    type: "DECISION",
    why: "BEST_SCORE",
    correlationId: "C-1",
    actionId: "A-1",
    data: {
      score: 12,
      nested: { safe: true },
    },
    arbitrary: "drop-me",
  });

  assert.deepEqual(normalized, {
    version: RUNTIME_EVENT_VERSION,
    id: "E-1",
    timestamp: 12345,
    module: "Planner",
    type: "DECISION",
    why: "BEST_SCORE",
    correlationId: "C-1",
    actionId: "A-1",
    data: {
      score: 12,
      nested: { safe: true },
    },
  });
});

test("runtime event bridge rejects invalid version and required fields", () => {
  assert.equal(normalizeRuntimeEvent(null), null);
  assert.equal(
    normalizeRuntimeEvent({
      version: 2,
      id: "E-1",
      timestamp: 1,
      module: "X",
      type: "Y",
    }),
    null,
  );
  assert.equal(
    normalizeRuntimeEvent({
      version: 1,
      id: "",
      timestamp: 1,
      module: "X",
      type: "Y",
    }),
    null,
  );
  assert.equal(
    normalizeRuntimeEvent({
      version: 1,
      id: "E-1",
      timestamp: 0,
      module: "X",
      type: "Y",
    }),
    null,
  );
});

test("runtime event bridge rejects oversized payloads", () => {
  const event = {
    version: 1,
    id: "E-big",
    timestamp: 123,
    module: "Diagnostics",
    type: "TOO_BIG",
    data: {
      text: "x".repeat(MAX_RUNTIME_EVENT_BYTES),
    },
  };

  assert.equal(normalizeRuntimeEvent(event), null);
});

test("CharacterThread and coordinator both use the runtime event bridge", () => {
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(thread, /normalizeRuntimeEvent/);
  assert.match(thread, /type: "runtime_event"/);
  assert.match(coordinator, /case "runtime_event"/);
  assert.match(coordinator, /emit_runtime_event/);
  assert.match(coordinator, /source: "bot_runtime"/);
});

test("runtime event bridge stays comfortably below IPC limits", () => {
  assert.equal(MAX_RUNTIME_EVENT_BYTES, 64 * 1024);
});

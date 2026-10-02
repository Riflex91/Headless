"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DiagnosticEventStore } = require("../src/DiagnosticStore");
const {
  IncidentRecorder,
  incidentSeverity,
  incidentTriggerReason,
} = require("../src/IncidentRecorder");

test("incident trigger classification covers critical runtime failures", () => {
  assert.equal(
    incidentTriggerReason({ event: "CHARACTER_HEARTBEAT_TIMEOUT" }),
    "HEARTBEAT_TIMEOUT",
  );
  assert.equal(
    incidentTriggerReason({ event: "UNEXPECTED_CHARACTER_EXIT" }),
    "UNEXPECTED_PROCESS_EXIT",
  );
  assert.equal(
    incidentTriggerReason({ type: "RUNTIME_START_FAILED" }),
    "RUNTIME_START_FAILED",
  );
  assert.equal(
    incidentTriggerReason({ type: "MODULE_FAILED" }),
    "MODULE_FAILED",
  );
  assert.equal(
    incidentTriggerReason({ type: "JOB_FAILED" }),
    "SCHEDULER_JOB_FAILED",
  );
  assert.equal(
    incidentTriggerReason({ type: "ACTION_UNKNOWN" }),
    "ACTION_OUTCOME_UNKNOWN",
  );
  assert.equal(incidentTriggerReason({ event: "CHARACTER_STDERR" }), null);

  assert.equal(incidentSeverity({ type: "ACTION_UNKNOWN" }), "HIGH");
  assert.equal(incidentSeverity({ type: "MODULE_FAILED" }), "ERROR");
});

test("incident recorder freezes snapshot and writes sanitized package", async () => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caracal-incident-"),
  );
  const diagnosticStore = new DiagnosticEventStore({ maxEvents: 100 });
  let now = Date.parse("2026-10-02T05:00:00.000Z");
  let snapshot = {
    characters: [
      {
        name: "My_Ranger1",
        game: {
          map: "main",
          hp: 100,
          items: [{ name: "hpot1", q: 10 }],
        },
      },
    ],
    session: "must-not-leak",
  };

  diagnosticStore.append({
    timestamp: now - 1000,
    event: "ACTION_DISPATCHED",
    character: "My_Ranger1",
    actionId: "A-1",
    data: { action: "TEST" },
  });

  const recorder = new IncidentRecorder({
    rootDir,
    diagnosticStore,
    getSnapshot: () => snapshot,
    now: () => now,
  });

  try {
    const summary = recorder.capture({
      reason: "TEST_FAILURE",
      severity: "HIGH",
      event: {
        type: "MODULE_FAILED",
        character: "My_Ranger1",
        actionId: "A-1",
        data: {
          error: "boom",
          stack: "Error: boom\n  at test.js:1:1",
          auth_token: "must-not-leak",
        },
      },
    });

    snapshot = {
      characters: [{ name: "My_Ranger1", game: { hp: 1 } }],
    };
    now += 5000;

    await recorder.flush();

    const dir = path.join(rootDir, summary.incident_id);
    const incidentText = await fs.readFile(
      path.join(dir, "incident.json"),
      "utf8",
    );
    const snapshotText = await fs.readFile(
      path.join(dir, "snapshot.json"),
      "utf8",
    );
    const eventsText = await fs.readFile(
      path.join(dir, "recent-events.jsonl"),
      "utf8",
    );

    assert.match(incidentText, /TEST_FAILURE/);
    assert.match(incidentText, /Error: boom/);
    assert.equal(incidentText.includes("must-not-leak"), false);
    const snapshotJson = JSON.parse(snapshotText);
    assert.equal(snapshotJson.characters[0].game.hp, 100);
    assert.notEqual(snapshotJson.characters[0].game.hp, 1);
    assert.equal(snapshotText.includes("must-not-leak"), false);
    assert.match(eventsText, /ACTION_DISPATCHED/);
    assert.match(eventsText, /A-1/);

    const copied = await recorder.readText(summary.incident_id);
    assert.match(copied, /CARACAL INCIDENT PACKAGE/);
    assert.match(copied, /RECENT EVENTS/);
    assert.match(copied, /My_Ranger1/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("incident recorder lists latest incidents per character", async () => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caracal-incident-list-"),
  );
  const diagnosticStore = new DiagnosticEventStore({ maxEvents: 100 });
  let now = 1000;
  const recorder = new IncidentRecorder({
    rootDir,
    diagnosticStore,
    getSnapshot: () => ({ characters: [] }),
    now: () => now,
  });

  try {
    recorder.capture({
      reason: "FIRST",
      character: "My_Ranger1",
      event: { type: "MODULE_FAILED", character: "My_Ranger1" },
    });
    now = 2000;
    recorder.capture({
      reason: "SECOND",
      character: "My_Merchant",
      event: { type: "JOB_FAILED", character: "My_Merchant" },
    });
    now = 3000;
    recorder.capture({
      reason: "THIRD",
      character: "My_Ranger1",
      event: { type: "ACTION_UNKNOWN", character: "My_Ranger1" },
    });

    await recorder.flush();

    const all = await recorder.list({ limit: 10 });
    assert.deepEqual(
      all.map((incident) => incident.reason),
      ["THIRD", "SECOND", "FIRST"],
    );

    const rangerLatest = await recorder.latest({
      character: "My_Ranger1",
    });
    assert.equal(rangerLatest.reason, "THIRD");

    const merchantLatest = await recorder.latest({
      character: "My_Merchant",
    });
    assert.equal(merchantLatest.reason, "SECOND");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("incident recorder rejects path-like incident ids", async () => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caracal-incident-id-"),
  );
  const recorder = new IncidentRecorder({
    rootDir,
    diagnosticStore: new DiagnosticEventStore(),
  });

  try {
    await assert.rejects(
      recorder.readText("../outside"),
      (error) =>
        error.code === "INVALID_INCIDENT_ID" && error.statusCode === 400,
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  StructuredLogger,
  safeFilePart,
  utcDateKey,
} = require("../src/StructuredLogger");

test("structured logger writes sanitized runtime and character JSONL", async () => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caracal-structured-log-"),
  );
  const timestamp = Date.parse("2026-10-02T05:00:00.000Z");
  const logger = new StructuredLogger({
    rootDir,
    now: () => timestamp,
  });

  try {
    const event = logger.write({
      event: "TEST_EVENT",
      character: "My_Ranger1",
      reason: "test",
      session: "must-not-leak",
      nested: { auth_token: "must-not-leak" },
    });

    assert.equal(event.session, "[REDACTED]");
    assert.equal(event.nested.auth_token, "[REDACTED]");

    await logger.flush();

    const runtimePath = path.join(rootDir, "runtime", "2026-10-02.jsonl");
    const characterPath = path.join(
      rootDir,
      "characters",
      "My_Ranger1-2026-10-02.jsonl",
    );
    const runtime = await fs.readFile(runtimePath, "utf8");
    const character = await fs.readFile(characterPath, "utf8");

    assert.match(runtime, /TEST_EVENT/);
    assert.match(character, /My_Ranger1/);
    assert.equal(runtime.includes("must-not-leak"), false);
    assert.equal(character.includes("must-not-leak"), false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("structured logger keeps account events out of character files", async () => {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caracal-account-log-"),
  );
  const logger = new StructuredLogger({
    rootDir,
    now: () => Date.parse("2026-10-02T05:00:00.000Z"),
  });

  try {
    logger.write({ event: "ACCOUNT_EVENT", character: null });
    await logger.flush();

    const entries = await fs.readdir(rootDir);
    assert.deepEqual(entries, ["runtime"]);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("structured logger path helpers are deterministic and safe", () => {
  assert.equal(
    utcDateKey(Date.parse("2026-10-02T23:59:59.000Z")),
    "2026-10-02",
  );
  assert.equal(safeFilePart("My Ranger/../1"), "My_Ranger_.._1");
});

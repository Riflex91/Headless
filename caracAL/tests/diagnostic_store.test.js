"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DiagnosticEventStore,
  eventMatchesCharacter,
  formatAccountDiagnostic,
  formatCharacterDiagnostic,
  sanitizeDiagnosticValue,
} = require("../src/DiagnosticStore");

test("diagnostic sanitizer removes secret keys and secret-like strings", () => {
  const sanitized = sanitizeDiagnosticValue({
    session: "1234567890-abcdefghijklmnop",
    auth_token: "private-token",
    nested: {
      password_value: "private-password",
      message: "Authorization: Bearer abc.def.ghi",
    },
    safe: "visible",
  });

  assert.equal(sanitized.session, "[REDACTED]");
  assert.equal(sanitized.auth_token, "[REDACTED]");
  assert.equal(sanitized.nested.password_value, "[REDACTED]");
  assert.equal(sanitized.safe, "visible");
  assert.equal(JSON.stringify(sanitized).includes("private-token"), false);
  assert.equal(JSON.stringify(sanitized).includes("private-password"), false);
  assert.equal(JSON.stringify(sanitized).includes("abc.def.ghi"), false);
});

test("diagnostic store associates cross-character events with both characters", () => {
  const store = new DiagnosticEventStore();
  store.append({
    event: "ITEM_TRANSFER",
    character: "My_Merchant",
    related_characters: ["My_Ranger1"],
    item: "hpot1",
  });

  assert.equal(store.getEvents({ character: "My_Merchant" }).length, 1);
  assert.equal(store.getEvents({ character: "My_Ranger1" }).length, 1);
  assert.equal(store.getEvents({ character: "My_Ranger2" }).length, 0);

  assert.equal(eventMatchesCharacter(store.getEvents()[0], "My_Ranger1"), true);
});

test("diagnostic event store respects time filters", () => {
  const store = new DiagnosticEventStore();
  store.events.push(
    { timestamp: 1000, event: "OLD" },
    { timestamp: 2000, event: "NEW" },
  );

  assert.deepEqual(
    store.getEvents({ since: 1500 }).map((event) => event.event),
    ["NEW"],
  );
});

test("character diagnostic contains state and sanitized events", () => {
  const snapshot = {
    characters: [
      {
        name: "My_Ranger1",
        lifecycle_state: "ONLINE",
        desired_runtime_state: "RUNNING",
      },
    ],
  };
  const store = new DiagnosticEventStore();
  store.append({
    event: "TEST_EVENT",
    character: "My_Ranger1",
    session_key: "must-not-appear",
    reason: "test",
  });

  const output = formatCharacterDiagnostic(
    "My_Ranger1",
    snapshot,
    store.getEvents({ character: "My_Ranger1" }),
  );

  assert.match(output, /CARACAL CHARACTER DIAGNOSTIC/);
  assert.match(output, /My_Ranger1/);
  assert.match(output, /TEST_EVENT/);
  assert.equal(output.includes("must-not-appear"), false);
  assert.match(output, /\[REDACTED\]/);
});

test("account diagnostic contains all current characters", () => {
  const snapshot = {
    max_online_characters: 4,
    characters: [
      { name: "My_Ranger1", lifecycle_state: "ONLINE" },
      { name: "My_Merchant", lifecycle_state: "ONLINE" },
    ],
  };

  const output = formatAccountDiagnostic(snapshot, []);
  assert.match(output, /CARACAL ACCOUNT DIAGNOSTIC/);
  assert.match(output, /My_Ranger1/);
  assert.match(output, /My_Merchant/);
});

test("unknown character diagnostic fails explicitly", () => {
  assert.throws(
    () => formatCharacterDiagnostic("Missing", { characters: [] }, []),
    (error) => error.code === "CHARACTER_NOT_FOUND" && error.statusCode === 404,
  );
});

test("CharacterThread does not dump raw process arguments", () => {
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.doesNotMatch(thread, /starting character thread with arguments/);
  assert.doesNotMatch(thread, /console\.debug\([^;]*,\s*msg\.arguments\s*\)/s);
});

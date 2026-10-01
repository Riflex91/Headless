"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildSupervisorSnapshot,
  diagnosticSinceFromQuery,
  encodeSseEvent,
  isLoopbackAddress,
  publicCharacterState,
} = require("../src/HeadlessDashboard");
const { make_cfg_string } = require("../src/ConfigUtil");

test("public character state exposes only dashboard-safe fields", () => {
  const character = publicCharacterState("My_Ranger1", {
    enabled: true,
    connected: true,
    lifecycle_state: "ONLINE",
    desired_runtime_state: "PAUSED",
    realm: "EUII",
    instance: { pid: 12345, secret: "do-not-export" },
    last_heartbeat_at: 123456,
    restart_attempts: 2,
    typescript: "bot/main.js",
    session: "SECRET_SESSION",
    auth: "SECRET_AUTH",
  });

  assert.deepEqual(character, {
    name: "My_Ranger1",
    enabled: true,
    connected: true,
    lifecycle_state: "ONLINE",
    desired_runtime_state: "PAUSED",
    realm: "EUII",
    pid: 12345,
    last_heartbeat_at: 123456,
    restart_attempts: 2,
    script: "bot/main.js",
  });

  const serialized = JSON.stringify(character);
  assert.equal(serialized.includes("SECRET_SESSION"), false);
  assert.equal(serialized.includes("SECRET_AUTH"), false);
  assert.equal(serialized.includes("do-not-export"), false);
});

test("dashboard access accepts loopback addresses only", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.12"), false);
  assert.equal(isLoopbackAddress("10.0.0.2"), false);
});

test("supervisor snapshot counts active lifecycle states", () => {
  const snapshot = buildSupervisorSnapshot(
    {
      My_Ranger1: { lifecycle_state: "ONLINE" },
      My_Ranger2: { lifecycle_state: "CONNECTING" },
      My_Ranger3: { lifecycle_state: "STOPPED" },
      My_Merchant: { lifecycle_state: "PAUSED" },
    },
    { maxOnlineCharacters: 4 },
  );

  assert.equal(snapshot.max_online_characters, 4);
  assert.equal(snapshot.active_characters, 3);
  assert.deepEqual(
    snapshot.characters.map((character) => character.name),
    ["My_Merchant", "My_Ranger1", "My_Ranger2", "My_Ranger3"],
  );
});

test("diagnostic time range query is bounded", () => {
  const before = Date.now();
  const since = diagnosticSinceFromQuery({ minutes: "5" });
  const after = Date.now();

  assert.equal(since <= after - 5 * 60 * 1000, true);
  assert.equal(since >= before - 5 * 60 * 1000, true);
  assert.equal(diagnosticSinceFromQuery({ minutes: "" }), undefined);

  const bounded = diagnosticSinceFromQuery({ minutes: "99999" });
  assert.equal(bounded >= before - 24 * 60 * 60 * 1000, true);
});

test("SSE event encoding is valid and compact", () => {
  const encoded = encodeSseEvent("supervisor", {
    event: "CHARACTER_CONNECTED",
    character: "My_Ranger1",
  });

  assert.equal(encoded.startsWith("event: supervisor\n"), true);
  assert.equal(encoded.endsWith("\n\n"), true);
  assert.match(encoded, /"CHARACTER_CONNECTED"/);
});

test("generated config enables the local dashboard by default", () => {
  const generated = make_cfg_string({});
  assert.match(generated, /enable_headless_dashboard:\s+true/);
});

test("dashboard static assets are present", () => {
  const dashboardDir = path.join(__dirname, "..", "dashboard");

  for (const file of ["index.html", "app.js", "styles.css"]) {
    assert.equal(fs.existsSync(path.join(dashboardDir, file)), true);
  }
});

test("dashboard module and coordinator remain syntactically valid", () => {
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(dashboard));
  assert.doesNotThrow(() => new Function(coordinator));
  assert.match(coordinator, /attachHeadlessDashboard/);
  assert.match(coordinator, /dashboard\?\.publish/);
});

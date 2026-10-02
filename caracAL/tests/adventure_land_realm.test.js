"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeRealmConnection,
  secureSocketAddress,
} = require("../src/AdventureLandRealm");

test("current Adventure Land host/path fields become an absolute secure Node socket URL", () => {
  assert.deepEqual(
    normalizeRealmConnection({
      key: "SR_EUII",
      address: "de.adventure.land",
      path: "/ws2/",
    }),
    {
      address: "https://de.adventure.land",
      path: "/ws2/",
      legacyAddr: "de.adventure.land",
      legacyPort: null,
    },
  );
});

test("already absolute current Adventure Land socket URLs are preserved", () => {
  assert.equal(
    secureSocketAddress("https://cloudflare.adventure.land"),
    "https://cloudflare.adventure.land",
  );
});

test("legacy host-only realms also receive an https scheme", () => {
  assert.equal(
    normalizeRealmConnection({ addr: "de.adventure.land" }).address,
    "https://de.adventure.land",
  );
});

test("legacy Adventure Land realm fields remain supported", () => {
  assert.deepEqual(
    normalizeRealmConnection({
      addr: "eu2.adventure.land",
      port: 2083,
    }),
    {
      address: "https://eu2.adventure.land:2083",
      path: "/socket.io",
      legacyAddr: "eu2.adventure.land",
      legacyPort: 2083,
    },
  );
});

test("character thread exposes both current and legacy socket globals", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.match(source, /game_context\.server_address = serverAddress;/);
  assert.match(source, /game_context\.server_path = serverPath;/);
  assert.match(
    source,
    /game_context\.server_addr = proc_args\.realm_addr \|\| serverAddress;/,
  );
  assert.match(
    source,
    /const serverAddress = proc_args\.realm_address \|\| proc_args\.realm_addr;/,
  );
});

test("coordinator passes current Adventure Land address/path fields", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(source, /realm_address: realm_connection\.address/);
  assert.match(source, /realm_path: realm_connection\.path/);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function characterThreadSource() {
  return fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
}

test("runner initializes current Adventure Land execution globals", () => {
  const source = characterThreadSource();

  assert.match(source, /Place='code'/);
  assert.match(source, /Dev=parent\.Dev/);
  assert.match(source, /Staging=parent\.Staging/);
  assert.match(source, /Prod=parent\.Prod/);
  assert.match(source, /Local=parent\.Local/);
  assert.match(source, /is_code=1/);
});

test("game VM identifies itself as the Adventure Land game context", () => {
  const source = characterThreadSource();

  assert.match(source, /game_context\.Place = "game";/);
});

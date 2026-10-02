"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHtmlVars() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "html_vars.js"),
    "utf8",
  );
  const context = vm.createContext({
    log_flags: {},
    code_logic() {},
  });
  vm.runInContext(source, context);
  return context;
}

test("headless browser globals cover current Adventure Land startup variables", () => {
  const context = loadHtmlVars();

  for (const name of [
    "server_address",
    "server_path",
    "selection_server_explicit",
    "music_volume",
    "sfx_volume",
    "proximity_guides",
    "close_buttons_enabled",
    "Prod",
    "Dev",
    "Local",
    "Staging",
    "is_tauri",
    "url_address",
    "url_path",
    "update_notes_more",
    "last_deploy",
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(context, name),
      `missing browser global: ${name}`,
    );
  }
});

test("headless browser globals keep legacy aliases available", () => {
  const context = loadHtmlVars();

  assert.ok(Object.prototype.hasOwnProperty.call(context, "server_addr"));
  assert.ok(Object.prototype.hasOwnProperty.call(context, "server_port"));
  assert.ok(Object.prototype.hasOwnProperty.call(context, "url_ip"));
  assert.ok(Object.prototype.hasOwnProperty.call(context, "url_port"));
});

test("headless browser environment remains non-local and non-electron", () => {
  const context = loadHtmlVars();

  assert.equal(context.Local, "");
  assert.equal(context.Dev, "");
  assert.equal(context.is_tauri, "");
  assert.equal(context.is_electron, "");
  assert.equal(context.no_html, "bot");
  assert.equal(context.no_graphics, "1");
});

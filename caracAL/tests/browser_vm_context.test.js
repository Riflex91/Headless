"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const { createIsolatedBrowserContext } = require("../src/BrowserVmContext");

function isolatedContext() {
  return createIsolatedBrowserContext(
    "<!DOCTYPE html><html><body></body></html>",
  );
}

test("browser VM contexts have independent JavaScript intrinsics", () => {
  const game = isolatedContext();
  const runner = isolatedContext();
  const defineHashCode = `
    Object.defineProperty(String.prototype, "hashCode", {
      value: function() { return 1; },
      enumerable: false
    });
  `;

  assert.equal(
    vm.runInContext(defineHashCode + '"x".hashCode()', game.context),
    1,
  );
  assert.equal(
    vm.runInContext(defineHashCode + '"x".hashCode()', runner.context),
    1,
  );
});

test("isolated browser prototypes do not modify Node global prototypes", () => {
  const browser = isolatedContext();

  assert.equal(
    vm.runInContext(
      `Object.defineProperty(String.prototype, "__caracal_vm_probe__", {
        value: true,
        enumerable: false
      }); "x".__caracal_vm_probe__;`,
      browser.context,
    ),
    true,
  );

  assert.equal(String.prototype.__caracal_vm_probe__, undefined);
});

test("jsdom DOM remains available inside the isolated VM context", () => {
  const browser = isolatedContext();

  assert.equal(
    vm.runInContext("document.body.tagName", browser.context),
    "BODY",
  );
  assert.equal(browser.context.document, browser.window.document);
});

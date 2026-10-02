"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const { createIsolatedBrowserWindow } = require("../src/BrowserVmContext");

function isolatedContext() {
  const window = createIsolatedBrowserWindow(
    "<!DOCTYPE html><html><body></body></html>",
  );
  window.globalThis = window;
  vm.createContext(window);
  return window;
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

  assert.doesNotThrow(() => vm.runInContext(defineHashCode, game));
  assert.doesNotThrow(() => vm.runInContext(defineHashCode, runner));
  assert.equal(vm.runInContext('"x".hashCode()', game), 1);
  assert.equal(vm.runInContext('"x".hashCode()', runner), 1);
});

test("isolated browser prototypes do not modify Node global prototypes", () => {
  const context = isolatedContext();

  vm.runInContext(
    `Object.defineProperty(String.prototype, "__caracal_vm_probe__", {
      value: true,
      enumerable: false
    });`,
    context,
  );

  assert.equal(String.prototype.__caracal_vm_probe__, undefined);
  assert.equal(vm.runInContext('"x".__caracal_vm_probe__', context), true);
});

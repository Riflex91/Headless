"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const { createIsolatedBrowserContext } = require("../src/BrowserVmContext");
const {
  installCrossRealmClone,
  setAdventureLandAuthCookie,
} = require("../src/AdventureLandVmCompat");

function browser() {
  return createIsolatedBrowserContext(
    "<!DOCTYPE html><html><body></body></html>",
  );
}

test("cross-realm clone accepts foreign plain objects, arrays and dates", () => {
  const source = browser();
  const target = browser();

  target.context.foreign = vm.runInContext(
    `({
      value: 7,
      nested: { ok: true },
      list: [1, 2, 3],
      when: new Date(1234)
    })`,
    source.context,
  );

  installCrossRealmClone(target.context);
  vm.runInContext("var copied = clone(foreign);", target.context);

  assert.equal(vm.runInContext("copied.value", target.context), 7);
  assert.equal(vm.runInContext("copied.nested.ok", target.context), true);
  assert.equal(
    vm.runInContext("Array.isArray(copied.list)", target.context),
    true,
  );
  assert.equal(vm.runInContext("copied.list.length", target.context), 3);
  assert.equal(
    vm.runInContext("copied.when instanceof Date", target.context),
    true,
  );
  assert.equal(vm.runInContext("copied.when.getTime()", target.context), 1234);
  assert.equal(
    vm.runInContext(
      "Object.getPrototypeOf(copied) === Object.prototype",
      target.context,
    ),
    true,
  );
});

test("cross-realm clone preserves circular marker behavior", () => {
  const source = browser();
  const target = browser();

  target.context.foreign = vm.runInContext(
    "var value = { name: 'x' }; value.self = value; value;",
    source.context,
  );

  installCrossRealmClone(target.context);
  assert.equal(
    vm.runInContext("clone(foreign).self", target.context),
    "circular_attribute[clone]",
  );
});

test("Adventure Land auth cookie is stored without exposing it to logs", () => {
  const target = browser();
  const session = "US_example-sessiontoken";

  assert.equal(setAdventureLandAuthCookie(target.context, session), true);
  assert.equal(
    vm.runInContext("document.cookie", target.context),
    `auth=${session}`,
  );
});

test("empty Adventure Land sessions are ignored", () => {
  const target = browser();

  assert.equal(setAdventureLandAuthCookie(target.context, ""), false);
  assert.equal(vm.runInContext("document.cookie", target.context), "");
});

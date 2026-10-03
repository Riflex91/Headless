"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  classifyCompoundUnknown,
  fingerprint,
  normalizedSlots,
  targetSnapshot,
} = require("../scripts/run_compound_reconcile");

function character(items) {
  return {
    game: {
      timestamp: 1000,
      items,
    },
  };
}

const expected = {
  itemName: "hpamulet",
  fromLevel: 0,
  itemSlots: [5, 6, 7],
  scrollName: "cscroll0",
  scrollSlot: 4,
  beforeScrollQuantity: 40,
};

function beforeItems() {
  const items = Array(12).fill(null);
  items[4] = { name: "cscroll0", q: 40 };
  items[5] = { name: "hpamulet", level: 0 };
  items[6] = { name: "hpamulet", level: 0 };
  items[7] = { name: "hpamulet", level: 0 };
  return items;
}

test("Compound UNKNOWN reconcile confirms unchanged state without permitting retry", () => {
  const snapshot = targetSnapshot(character(beforeItems()), [5, 6, 7], 4);
  const result = classifyCompoundUnknown(snapshot, expected);

  assert.equal(result.state, "UNCHANGED");
  assert.equal(result.reason, "COMPOUND_UNKNOWN_RECONCILED_UNCHANGED");
  assert.equal(result.mutationObserved, false);
  assert.equal(result.successObserved, false);
  assert.equal(result.retryAllowed, false);
});

test("Compound UNKNOWN reconcile recognizes an observed +1 success state", () => {
  const items = beforeItems();
  items[4] = { name: "cscroll0", q: 39 };
  items[5] = { name: "hpamulet", level: 1 };
  items[6] = null;
  items[7] = null;

  const snapshot = targetSnapshot(character(items), [5, 6, 7], 4);
  const result = classifyCompoundUnknown(snapshot, expected);

  assert.equal(result.state, "SUCCESS_STATE");
  assert.equal(
    result.reason,
    "COMPOUND_UNKNOWN_RECONCILED_SUCCESS_STATE",
  );
  assert.equal(result.mutationObserved, true);
  assert.equal(result.successObserved, true);
  assert.equal(result.retryAllowed, false);
});

test("Compound UNKNOWN reconcile keeps other changed states conservative", () => {
  const items = beforeItems();
  items[4] = { name: "cscroll0", q: 39 };
  items[5] = null;
  items[6] = null;
  items[7] = null;

  const snapshot = targetSnapshot(character(items), [5, 6, 7], 4);
  const result = classifyCompoundUnknown(snapshot, expected);

  assert.equal(result.state, "MUTATED_OR_AMBIGUOUS");
  assert.equal(result.mutationObserved, true);
  assert.equal(result.successObserved, false);
  assert.equal(result.retryAllowed, false);
});

test("Compound UNKNOWN reconcile fingerprints only the requested target state", () => {
  const first = targetSnapshot(character(beforeItems()), [5, 6, 7], 4);
  const items = beforeItems();
  items[8] = { name: "unrelated" };
  const second = targetSnapshot(character(items), [5, 6, 7], 4);

  assert.equal(fingerprint(first), fingerprint(second));
  assert.deepEqual(normalizedSlots([7, 5, 6]), [5, 6, 7]);
});

test("Compound reconcile launcher is read-only and never calls live Compound endpoint", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_compound_reconcile.js"),
    "utf8",
  );

  assert.match(source, /\/headless\/api\/state/);
  assert.match(source, /\/control/);
  assert.doesNotMatch(source, /\/tests\/compound["']/);
  assert.doesNotMatch(source, /runCompoundLiveTest/);
  assert.match(source, /compoundDispatched: false/);
  assert.match(source, /blindRetryUsed: false/);
});

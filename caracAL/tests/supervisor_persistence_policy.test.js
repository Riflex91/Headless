"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SNAPSHOT_PERSIST_INTERVAL_MS,
  beginSnapshotPersist,
  buildCharacterProfile,
  completeSnapshotPersist,
  failSnapshotPersist,
  restoreDesiredRuntimeState,
  shouldPersistSnapshot,
  snapshotSignature,
} = require("../src/SupervisorPersistencePolicy");

test("persisted desired state restores without trusting actual state", () => {
  const charBlock = {
    enabled: true,
    lifecycle_state: "ONLINE",
  };

  const restored = restoreDesiredRuntimeState(charBlock, {
    desired_state: "PAUSED",
    actual_state: "ONLINE",
  });

  assert.deepEqual(restored, {
    restored: true,
    desired_runtime_state: "PAUSED",
    actual_runtime_state: "STOPPED",
  });
  assert.equal(charBlock.enabled, true);
  assert.equal(charBlock.desired_runtime_state, "PAUSED");
  assert.equal(charBlock.lifecycle_state, "STOPPED");
});

test("persisted STOPPED overrides configured enabled state", () => {
  const charBlock = {
    enabled: true,
  };

  restoreDesiredRuntimeState(charBlock, {
    desired_state: "STOPPED",
    actual_state: "ONLINE",
  });

  assert.equal(charBlock.enabled, false);
  assert.equal(charBlock.desired_runtime_state, "STOPPED");
  assert.equal(charBlock.lifecycle_state, "STOPPED");
});

test("invalid persisted desired state falls back to configured state", () => {
  const enabled = { enabled: true };
  const disabled = { enabled: false };

  assert.equal(
    restoreDesiredRuntimeState(enabled, {
      desired_state: "INVALID",
    }).desired_runtime_state,
    "RUNNING",
  );
  assert.equal(
    restoreDesiredRuntimeState(disabled, null).desired_runtime_state,
    "STOPPED",
  );
});

test("snapshot persistence is change-aware and throttled", () => {
  const charBlock = {};
  const first = snapshotSignature({
    items: [{ name: "hpot1", q: 10 }],
    slots: {},
  });
  const second = snapshotSignature({
    items: [{ name: "hpot1", q: 9 }],
    slots: {},
  });

  assert.equal(
    shouldPersistSnapshot(charBlock, first, 1000),
    true,
  );

  beginSnapshotPersist(charBlock, 1000);
  assert.equal(
    shouldPersistSnapshot(charBlock, first, 1001),
    false,
  );

  completeSnapshotPersist(charBlock, first, 1100);
  assert.equal(
    shouldPersistSnapshot(charBlock, first, 2000),
    false,
  );
  assert.equal(
    shouldPersistSnapshot(charBlock, second, 2000),
    false,
  );
  assert.equal(
    shouldPersistSnapshot(
      charBlock,
      second,
      1000 + SNAPSHOT_PERSIST_INTERVAL_MS,
    ),
    true,
  );

  beginSnapshotPersist(
    charBlock,
    1000 + SNAPSHOT_PERSIST_INTERVAL_MS,
  );
  failSnapshotPersist(charBlock);
  assert.equal(charBlock.snapshot_persist_inflight, false);
  assert.equal(
    charBlock.last_persisted_snapshot_signature,
    first,
  );
});

test("snapshot signature changes for inventory or equipment changes", () => {
  const base = snapshotSignature({
    items: [{ name: "hpot1", q: 10 }],
    slots: { mainhand: { name: "bow", level: 7 } },
  });
  const quantityChanged = snapshotSignature({
    items: [{ name: "hpot1", q: 9 }],
    slots: { mainhand: { name: "bow", level: 7 } },
  });
  const equipmentChanged = snapshotSignature({
    items: [{ name: "hpot1", q: 10 }],
    slots: { mainhand: { name: "bow", level: 8 } },
  });

  assert.notEqual(base, quantityChanged);
  assert.notEqual(base, equipmentChanged);
});

test("character profile keeps only stable supervisor fields", () => {
  const profile = buildCharacterProfile(
    "My_Ranger1",
    {
      realm: "EUII",
      script: "legacy.js",
      typescript: "bot/main.js",
      desired_runtime_state: "RUNNING",
      instance: { pid: 1234 },
      session: "must-not-leak",
    },
    { type: "ranger" },
  );

  assert.deepEqual(profile, {
    character_name: "My_Ranger1",
    ctype: "ranger",
    realm: "EUII",
    script: "legacy.js",
    typescript: "bot/main.js",
    desired_runtime_state: "RUNNING",
  });
  assert.equal(JSON.stringify(profile).includes("must-not-leak"), false);
});

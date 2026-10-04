"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  SNAPSHOT_PERSIST_INTERVAL_MS,
  beginSnapshotPersist,
  buildCharacterProfile,
  completeSnapshotPersist,
  failSnapshotPersist,
  marketObservationSignature,
  restoreDesiredRuntimeState,
  selectNewLiveMarketObservations,
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

  assert.equal(shouldPersistSnapshot(charBlock, first, 1000), true);

  beginSnapshotPersist(charBlock, 1000);
  assert.equal(shouldPersistSnapshot(charBlock, first, 1001), false);

  completeSnapshotPersist(charBlock, first, 1100);
  assert.equal(shouldPersistSnapshot(charBlock, first, 2000), false);
  assert.equal(shouldPersistSnapshot(charBlock, second, 2000), false);
  assert.equal(
    shouldPersistSnapshot(
      charBlock,
      second,
      1000 + SNAPSHOT_PERSIST_INTERVAL_MS,
    ),
    true,
  );

  beginSnapshotPersist(charBlock, 1000 + SNAPSHOT_PERSIST_INTERVAL_MS);
  failSnapshotPersist(charBlock);
  assert.equal(charBlock.snapshot_persist_inflight, false);
  assert.equal(charBlock.last_persisted_snapshot_signature, first);
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

test(
  "live market persistence dedupes unchanged listings but allows reappearance",
  () => {
    const observation = {
      itemName: "gem0",
      level: 1,
      price: 2500,
      quantity: 2,
      server: "EU I",
      seller: "Trader",
      timestamp: 1000,
      source: "LIVE_VISIBLE",
      metadata: {
        merchantId: "M-1",
        slot: "trade2",
        rid: "RID-1",
      },
    };

    const first = selectNewLiveMarketObservations([], [observation]);
    assert.deepEqual(first.observations, [observation]);
    assert.equal(first.signatures.length, 1);

    const unchanged = selectNewLiveMarketObservations(first.signatures, [
      {
        ...observation,
        timestamp: 2000,
      },
    ]);
    assert.deepEqual(unchanged.observations, []);
    assert.deepEqual(unchanged.signatures, first.signatures);

    const disappeared = selectNewLiveMarketObservations(
      unchanged.signatures,
      [],
    );
    assert.deepEqual(disappeared.observations, []);
    assert.deepEqual(disappeared.signatures, []);

    const reappeared = selectNewLiveMarketObservations(
      disappeared.signatures,
      [
        {
          ...observation,
          timestamp: 3000,
        },
      ],
    );
    assert.equal(reappeared.observations.length, 1);
    assert.equal(
      marketObservationSignature(reappeared.observations[0]),
      first.signatures[0],
    );
  },
);

test(
  "live market persistence treats changed price or quantity as new evidence",
  () => {
    const base = {
      itemName: "gem0",
      level: 0,
      price: 100,
      quantity: 1,
      server: "EU I",
      seller: "Trader",
      source: "LIVE_VISIBLE",
      metadata: {
        merchantId: "M-1",
        slot: "trade1",
      },
    };
    const initial = selectNewLiveMarketObservations([], [base]);

    const changed = selectNewLiveMarketObservations(initial.signatures, [
      {
        ...base,
        price: 120,
      },
      {
        ...base,
        quantity: 3,
      },
      {
        ...base,
        source: "LOCAL_HISTORY",
      },
    ]);

    assert.equal(changed.observations.length, 2);
    assert.equal(changed.signatures.length, 2);
    assert.notEqual(changed.signatures[0], initial.signatures[0]);
    assert.notEqual(changed.signatures[1], initial.signatures[0]);
  },
);

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

test("coordinator shutdown preserves persisted desired runtime intent", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const signalStart = coordinator.indexOf('["SIGINT", "SIGTERM", "SIGQUIT"]');
  const initializationStart = coordinator.indexOf(
    "Object.entries(character_manage).forEach",
    signalStart,
  );

  assert.notEqual(signalStart, -1);
  assert.notEqual(initializationStart, -1);

  const signalBlock = coordinator.slice(signalStart, initializationStart);

  assert.doesNotMatch(
    signalBlock,
    /desired_runtime_state\s*=\s*DESIRED_RUNTIME_STATES\.STOPPED/,
  );
  assert.doesNotMatch(signalBlock, /char_block\.enabled\s*=\s*false/);
  assert.match(signalBlock, /softkill_block/);
  assert.match(signalBlock, /persistence\.close/);
});

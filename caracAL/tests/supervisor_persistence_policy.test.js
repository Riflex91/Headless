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
  marketLocalHistorySyncSignature,
  marketObservationSignature,
  restoreDesiredRuntimeState,
  selectMarketLocalHistoryForRuntime,
  selectNewLiveMarketObservations,
  selectNewPontyMarketObservations,
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

test("live market persistence dedupes unchanged listings but allows reappearance", () => {
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

  const disappeared = selectNewLiveMarketObservations(unchanged.signatures, []);
  assert.deepEqual(disappeared.observations, []);
  assert.deepEqual(disappeared.signatures, []);

  const reappeared = selectNewLiveMarketObservations(disappeared.signatures, [
    {
      ...observation,
      timestamp: 3000,
    },
  ]);
  assert.equal(reappeared.observations.length, 1);
  assert.equal(
    marketObservationSignature(reappeared.observations[0]),
    first.signatures[0],
  );
});

test("live market persistence treats changed price or quantity as new evidence", () => {
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
});

test("Ponty market persistence dedupes unchanged snapshots by RID and value", () => {
  const firstObservation = {
    itemName: "sword",
    level: 2,
    price: 1000,
    quantity: 3,
    server: "EU I",
    seller: "Ponty",
    timestamp: 1000,
    source: "PONTY",
    metadata: {
      rid: "RID-SWORD",
      totalPrice: 3000,
      priceBasis: "PONTY_UNIT_PRICE",
    },
  };

  const first = selectNewPontyMarketObservations([], [firstObservation]);
  assert.deepEqual(first.observations, [firstObservation]);
  assert.equal(first.signatures.length, 1);

  const unchanged = selectNewPontyMarketObservations(first.signatures, [
    {
      ...firstObservation,
      timestamp: 5000,
    },
  ]);
  assert.deepEqual(unchanged.observations, []);
  assert.deepEqual(unchanged.signatures, first.signatures);

  const changed = selectNewPontyMarketObservations(first.signatures, [
    {
      ...firstObservation,
      price: 1100,
      timestamp: 6000,
    },
  ]);
  assert.equal(changed.observations.length, 1);
  assert.notDeepEqual(changed.signatures, first.signatures);
});

test("Ponty market persistence ignores non-PONTY market sources", () => {
  const result = selectNewPontyMarketObservations([], [
    {
      itemName: "sword",
      level: 2,
      price: 1000,
      quantity: 1,
      server: "EU I",
      seller: "Trader",
      timestamp: 1000,
      source: "LIVE_VISIBLE",
      metadata: {
        rid: "RID-LIVE",
      },
    },
    {
      itemName: "sword",
      level: 2,
      price: 900,
      quantity: 1,
      server: "EU I",
      seller: "History",
      timestamp: 900,
      source: "LOCAL_HISTORY",
      metadata: {},
    },
  ]);

  assert.deepEqual(result.observations, []);
  assert.deepEqual(result.signatures, []);
});

test("LOCAL_HISTORY selection stays server-bound and excludes active live listings", () => {
  const activeLive = {
    itemName: "gem0",
    level: 1,
    price: 2500,
    quantity: 2,
    server: "EU I",
    seller: "Trader",
    metadata: {
      merchantId: "M-1",
      slot: "trade2",
      rid: "RID-1",
    },
  };
  const history = selectMarketLocalHistoryForRuntime(
    [
      {
        item_name: "gem0",
        level: 1,
        price: 2500,
        quantity: 2,
        server: "EU I",
        seller: "Trader",
        source: "LIVE_VISIBLE",
        observed_at: 3000,
        metadata: {
          merchantId: "M-1",
          slot: "trade2",
          rid: "RID-1",
        },
      },
      {
        item_name: "gem0",
        level: 1,
        price: 2400,
        quantity: 1,
        server: "EU I",
        seller: "Older",
        source: "LIVE_VISIBLE",
        observed_at: 2000,
        metadata: {
          merchantId: "M-2",
          slot: "trade1",
          rid: "RID-2",
        },
      },
      {
        item_name: "gem0",
        level: 1,
        price: 9999,
        quantity: 1,
        server: "US I",
        seller: "OtherRealm",
        source: "LIVE_VISIBLE",
        observed_at: 1000,
        metadata: {},
      },
    ],
    {
      server: "EU I",
      liveSignatures: [marketObservationSignature(activeLive)],
      limit: 250,
    },
  );

  assert.deepEqual(history, [
    {
      itemName: "gem0",
      level: 1,
      price: 2400,
      quantity: 1,
      server: "EU I",
      seller: "Older",
      observedAt: 2000,
      metadata: {
        merchantId: "M-2",
        slot: "trade1",
        rid: "RID-2",
        storedSource: "LIVE_VISIBLE",
      },
    },
  ]);
});

test("market signatures keep null levels distinct from level zero", () => {
  const base = {
    itemName: "scroll0",
    price: 1000,
    quantity: 1,
    server: "EU I",
    seller: "Ponty",
    metadata: {
      rid: "RID-LEVEL",
    },
  };

  assert.notEqual(
    marketObservationSignature({ ...base, level: null }),
    marketObservationSignature({ ...base, level: 0 }),
  );
});

test("LOCAL_HISTORY excludes active Ponty snapshots but keeps older Ponty evidence", () => {
  const activePonty = {
    itemName: "sword",
    level: 2,
    price: 1000,
    quantity: 1,
    server: "EU I",
    seller: "Ponty",
    metadata: {
      rid: "RID-CURRENT",
    },
  };

  const history = selectMarketLocalHistoryForRuntime(
    [
      {
        item_name: "sword",
        level: 2,
        price: 1000,
        quantity: 1,
        server: "EU I",
        seller: "Ponty",
        source: "PONTY",
        observed_at: 5000,
        metadata: {
          rid: "RID-CURRENT",
        },
      },
      {
        item_name: "sword",
        level: 2,
        price: 900,
        quantity: 1,
        server: "EU I",
        seller: "Ponty",
        source: "PONTY",
        observed_at: 4000,
        metadata: {
          rid: "RID-OLDER",
        },
      },
    ],
    {
      server: "EU I",
      pontySignatures: [marketObservationSignature(activePonty)],
      limit: 250,
    },
  );

  assert.deepEqual(history, [
    {
      itemName: "sword",
      level: 2,
      price: 900,
      quantity: 1,
      server: "EU I",
      seller: "Ponty",
      observedAt: 4000,
      metadata: {
        rid: "RID-OLDER",
        storedSource: "PONTY",
      },
    },
  ]);
});

test("LOCAL_HISTORY selection is bounded, normalized, and has a stable sync signature", () => {
  const rows = [
    {
      item_name: "scroll0",
      level: null,
      price: 1000,
      quantity: 1,
      server: "EU I",
      seller: null,
      source: "LIVE_VISIBLE",
      observed_at: 5000,
      metadata: {},
    },
    {
      item_name: "scroll0",
      level: null,
      price: 900,
      quantity: 2,
      server: "EU I",
      seller: "Trader",
      source: "LIVE_VISIBLE",
      observed_at: 4000,
      metadata: {},
    },
    {
      item_name: "",
      price: 1,
      quantity: 1,
      server: "EU I",
    },
  ];

  const selected = selectMarketLocalHistoryForRuntime(rows, {
    server: "EU I",
    limit: 1,
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0], {
    itemName: "scroll0",
    level: null,
    price: 1000,
    quantity: 1,
    server: "EU I",
    seller: null,
    observedAt: 5000,
    metadata: {
      storedSource: "LIVE_VISIBLE",
    },
  });
  assert.equal(
    marketLocalHistorySyncSignature(selected),
    marketLocalHistorySyncSignature(JSON.parse(JSON.stringify(selected))),
  );
  assert.notEqual(
    marketLocalHistorySyncSignature(selected),
    marketLocalHistorySyncSignature([]),
  );
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

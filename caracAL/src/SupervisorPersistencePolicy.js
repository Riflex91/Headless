"use strict";

const crypto = require("node:crypto");
const { DESIRED_RUNTIME_STATES } = require("./CharacterControl");
const { LIFECYCLE_STATES } = require("./CharacterLifecyclePolicy");

const SNAPSHOT_PERSIST_INTERVAL_MS = 15 * 1000;

function restoreDesiredRuntimeState(charBlock, persistedLifecycle) {
  const configuredDesired = charBlock.enabled
    ? DESIRED_RUNTIME_STATES.RUNNING
    : DESIRED_RUNTIME_STATES.STOPPED;
  const persistedDesired = persistedLifecycle?.desired_state;
  const desired = Object.values(DESIRED_RUNTIME_STATES).includes(
    persistedDesired,
  )
    ? persistedDesired
    : configuredDesired;

  charBlock.desired_runtime_state = desired;
  charBlock.enabled = desired !== DESIRED_RUNTIME_STATES.STOPPED;

  // Actual process state is never trusted across a supervisor restart.
  charBlock.lifecycle_state = LIFECYCLE_STATES.STOPPED;

  return {
    restored:
      !!persistedLifecycle && desired === persistedLifecycle.desired_state,
    desired_runtime_state: desired,
    actual_runtime_state: LIFECYCLE_STATES.STOPPED,
  };
}

function snapshotSignature(statBeat) {
  const payload = JSON.stringify([
    Array.isArray(statBeat?.items) ? statBeat.items : [],
    statBeat?.slots && typeof statBeat.slots === "object" ? statBeat.slots : {},
  ]);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function shouldPersistSnapshot(
  charBlock,
  signature,
  now,
  intervalMs = SNAPSHOT_PERSIST_INTERVAL_MS,
) {
  if (charBlock.snapshot_persist_inflight) return false;
  if (charBlock.last_persisted_snapshot_signature === signature) return false;

  const lastAttempt = Number(charBlock.last_snapshot_persist_attempt_at) || 0;
  return lastAttempt === 0 || now - lastAttempt >= intervalMs;
}

function beginSnapshotPersist(charBlock, now) {
  charBlock.snapshot_persist_inflight = true;
  charBlock.last_snapshot_persist_attempt_at = now;
}

function completeSnapshotPersist(charBlock, signature, now) {
  charBlock.snapshot_persist_inflight = false;
  charBlock.last_persisted_snapshot_signature = signature;
  charBlock.last_persisted_snapshot_at = now;
}

function failSnapshotPersist(charBlock) {
  charBlock.snapshot_persist_inflight = false;
}

function marketObservationSignature(observation) {
  const source =
    observation && typeof observation === "object" ? observation : {};
  const metadata =
    source.metadata && typeof source.metadata === "object"
      ? source.metadata
      : {};

  return JSON.stringify([
    source.itemName || source.item_name || source.item || null,
    source.level !== null &&
    source.level !== undefined &&
    Number.isInteger(Number(source.level))
      ? Number(source.level)
      : null,
    Number(source.price) || 0,
    Number(source.quantity) || 0,
    source.server || null,
    source.seller || null,
    metadata.merchantId || null,
    metadata.slot || null,
    metadata.rid || null,
  ]);
}

function selectNewMarketObservationsBySource(
  previousSignatures,
  observations,
  source,
) {
  const previous = new Set(
    Array.isArray(previousSignatures) ? previousSignatures : [],
  );
  const current = new Set();
  const selected = [];

  for (const observation of Array.isArray(observations) ? observations : []) {
    if (
      !observation ||
      typeof observation !== "object" ||
      observation.source !== source
    ) {
      continue;
    }

    const signature = marketObservationSignature(observation);
    if (current.has(signature)) continue;
    current.add(signature);
    if (!previous.has(signature)) selected.push(observation);
  }

  return {
    observations: selected,
    signatures: [...current].sort(),
  };
}

function selectNewLiveMarketObservations(previousSignatures, observations) {
  return selectNewMarketObservationsBySource(
    previousSignatures,
    observations,
    "LIVE_VISIBLE",
  );
}

function selectNewPontyMarketObservations(previousSignatures, observations) {
  return selectNewMarketObservationsBySource(
    previousSignatures,
    observations,
    "PONTY",
  );
}

function marketLocalHistorySyncSignature(observations) {
  const payload = JSON.stringify(
    Array.isArray(observations) ? observations : [],
  );
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function selectMarketLocalHistoryForRuntime(
  rows,
  {
    server = null,
    liveSignatures = [],
    pontySignatures = [],
    limit = 250,
  } = {},
) {
  const normalizedServer =
    typeof server === "string" && server.trim() ? server.trim() : null;
  const activeObservations = new Set([
    ...(Array.isArray(liveSignatures) ? liveSignatures : []),
    ...(Array.isArray(pontySignatures) ? pontySignatures : []),
  ]);
  const boundedLimit = Math.min(
    1000,
    Math.max(1, Math.trunc(Number(limit) || 250)),
  );
  const observations = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;

    const itemName =
      typeof row.itemName === "string" && row.itemName.trim()
        ? row.itemName.trim()
        : typeof row.item_name === "string" && row.item_name.trim()
        ? row.item_name.trim()
        : typeof row.item === "string" && row.item.trim()
        ? row.item.trim()
        : "";
    const price = Number(row.price);
    const quantity = Number(row.quantity);
    const rowServer =
      typeof row.server === "string" && row.server.trim()
        ? row.server.trim()
        : null;
    if (
      !itemName ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      (normalizedServer && rowServer !== normalizedServer)
    ) {
      continue;
    }

    const metadata =
      row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const observation = {
      itemName,
      level:
        row.level !== null &&
        row.level !== undefined &&
        Number.isInteger(Number(row.level)) &&
        Number(row.level) >= 0
          ? Number(row.level)
          : null,
      price,
      quantity,
      server: rowServer,
      seller:
        typeof row.seller === "string" && row.seller.trim()
          ? row.seller.trim()
          : null,
      observedAt:
        Number.isFinite(Number(row.observedAt)) && Number(row.observedAt) >= 0
          ? Number(row.observedAt)
          : Number.isFinite(Number(row.observed_at)) &&
            Number(row.observed_at) >= 0
          ? Number(row.observed_at)
          : Number.isFinite(Number(row.timestamp)) && Number(row.timestamp) >= 0
          ? Number(row.timestamp)
          : 0,
      metadata: {
        ...metadata,
        storedSource:
          typeof row.source === "string" && row.source.trim()
            ? row.source.trim()
            : null,
      },
    };

    if (activeObservations.has(marketObservationSignature(observation))) {
      continue;
    }

    observations.push(observation);
    if (observations.length >= boundedLimit) break;
  }

  return observations;
}

function buildCharacterProfile(
  characterName,
  charBlock,
  ownedCharacter = null,
) {
  return {
    character_name: characterName,
    ctype: ownedCharacter?.type || null,
    realm: charBlock.realm || null,
    script: charBlock.script || null,
    typescript: charBlock.typescript || null,
    desired_runtime_state: charBlock.desired_runtime_state || null,
  };
}

module.exports = {
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
};

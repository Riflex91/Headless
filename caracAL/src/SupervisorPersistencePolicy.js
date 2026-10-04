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
    Number.isInteger(Number(source.level)) ? Number(source.level) : null,
    Number(source.price) || 0,
    Number(source.quantity) || 0,
    source.server || null,
    source.seller || null,
    metadata.merchantId || null,
    metadata.slot || null,
    metadata.rid || null,
  ]);
}

function selectNewLiveMarketObservations(previousSignatures, observations) {
  const previous = new Set(
    Array.isArray(previousSignatures) ? previousSignatures : [],
  );
  const current = new Set();
  const selected = [];

  for (const observation of Array.isArray(observations) ? observations : []) {
    if (
      !observation ||
      typeof observation !== "object" ||
      observation.source !== "LIVE_VISIBLE"
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
  marketObservationSignature,
  restoreDesiredRuntimeState,
  selectNewLiveMarketObservations,
  shouldPersistSnapshot,
  snapshotSignature,
};

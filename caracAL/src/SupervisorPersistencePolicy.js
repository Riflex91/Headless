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
  restoreDesiredRuntimeState,
  shouldPersistSnapshot,
  snapshotSignature,
};

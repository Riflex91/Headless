"use strict";

const LIFECYCLE_STATES = Object.freeze({
  STOPPED: "STOPPED",
  STARTING: "STARTING",
  CONNECTING: "CONNECTING",
  ONLINE: "ONLINE",
  PAUSED: "PAUSED",
  STOPPING: "STOPPING",
  BACKOFF: "BACKOFF",
  SUSPENDED: "SUSPENDED",
  ERROR: "ERROR",
});

const DEFAULT_LIFECYCLE_POLICY = Object.freeze({
  maxOnlineCharacters: 4,
  startupStaggerMs: 1500,
  restartBaseMs: 2000,
  restartMaxMs: 60000,
  restartResetMs: 60000,
});

function toInteger(value, fallback, minimum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.trunc(parsed));
}

function readLifecyclePolicy(cfg = {}) {
  const lifecycle = cfg.lifecycle || {};
  return {
    maxOnlineCharacters: Math.min(
      4,
      toInteger(
        lifecycle.max_online_characters,
        DEFAULT_LIFECYCLE_POLICY.maxOnlineCharacters,
        1,
      ),
    ),
    startupStaggerMs: toInteger(
      lifecycle.startup_stagger_ms,
      DEFAULT_LIFECYCLE_POLICY.startupStaggerMs,
      0,
    ),
    restartBaseMs: toInteger(
      lifecycle.restart_base_ms,
      DEFAULT_LIFECYCLE_POLICY.restartBaseMs,
      100,
    ),
    restartMaxMs: toInteger(
      lifecycle.restart_max_ms,
      DEFAULT_LIFECYCLE_POLICY.restartMaxMs,
      100,
    ),
    restartResetMs: toInteger(
      lifecycle.restart_reset_ms,
      DEFAULT_LIFECYCLE_POLICY.restartResetMs,
      1000,
    ),
  };
}

function computeRestartDelay(attempt, policy = DEFAULT_LIFECYCLE_POLICY) {
  const normalizedAttempt = Math.max(1, Math.trunc(Number(attempt) || 1));
  const raw = policy.restartBaseMs * 2 ** (normalizedAttempt - 1);
  return Math.min(raw, Math.max(policy.restartBaseMs, policy.restartMaxMs));
}

function isProcessActive(charBlock) {
  if (!charBlock) return false;
  if (charBlock.instance) return true;
  return [
    LIFECYCLE_STATES.STARTING,
    LIFECYCLE_STATES.CONNECTING,
    LIFECYCLE_STATES.ONLINE,
    LIFECYCLE_STATES.STOPPING,
  ].includes(charBlock.lifecycle_state);
}

function countActiveCharacters(characterManage) {
  return Object.values(characterManage || {}).filter(isProcessActive).length;
}

function getInitialStartupCharacters(characterManage, maxOnlineCharacters = 4) {
  return Object.entries(characterManage || {})
    .filter(([, block]) => block && block.enabled)
    .map(([name]) => name)
    .slice(0, Math.max(0, maxOnlineCharacters));
}

module.exports = {
  DEFAULT_LIFECYCLE_POLICY,
  LIFECYCLE_STATES,
  computeRestartDelay,
  countActiveCharacters,
  getInitialStartupCharacters,
  isProcessActive,
  readLifecyclePolicy,
};

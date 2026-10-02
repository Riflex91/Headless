"use strict";

const MAX_CHARACTER_CONFIG_BYTES = 64 * 1024;

function configError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeCharacterConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw configError(
      "CHARACTER_CONFIG_INVALID",
      "Character config must be a JSON object",
    );
  }

  let encoded;
  try {
    encoded = JSON.stringify(config);
  } catch (_error) {
    throw configError(
      "CHARACTER_CONFIG_NOT_SERIALIZABLE",
      "Character config must be JSON serializable",
    );
  }

  if (Buffer.byteLength(encoded, "utf8") > MAX_CHARACTER_CONFIG_BYTES) {
    throw configError(
      "CHARACTER_CONFIG_TOO_LARGE",
      `Character config exceeds ${MAX_CHARACTER_CONFIG_BYTES} bytes`,
      413,
    );
  }

  return JSON.parse(encoded);
}

function nextCharacterConfigRevision(currentRevision) {
  const current = Number(currentRevision);
  const normalized =
    Number.isInteger(current) && current >= 0 ? current : 0;
  return normalized + 1;
}

function prepareConfigPush(currentRevision, incomingRevision, config) {
  const current = Number(currentRevision);
  const normalizedCurrent =
    Number.isInteger(current) && current >= 0 ? current : 0;
  const incoming = Number(incomingRevision);

  if (!Number.isInteger(incoming) || incoming < 0) {
    throw configError(
      "CHARACTER_CONFIG_REVISION_INVALID",
      "Character config revision must be a non-negative integer",
    );
  }
  if (incoming < normalizedCurrent) {
    throw configError(
      "CHARACTER_CONFIG_REVISION_STALE",
      `Config revision ${incoming} is older than applied revision ${normalizedCurrent}`,
      409,
    );
  }

  return {
    revision: incoming,
    config: normalizeCharacterConfig(config),
    changed: incoming > normalizedCurrent,
  };
}

class CharacterConfigService {
  constructor({ persistence } = {}) {
    if (!persistence) {
      throw new Error("CharacterConfigService requires persistence");
    }
    this.persistence = persistence;
  }

  load(characterName, fallbackConfig = {}) {
    const persisted = this.persistence.getCharacterConfig(characterName);
    if (persisted) {
      return {
        revision: Number(persisted.revision) || 0,
        config: normalizeCharacterConfig(persisted.config || {}),
        updated_at: Number(persisted.updated_at) || null,
        source: "PERSISTED",
      };
    }

    return {
      revision: 0,
      config: normalizeCharacterConfig(fallbackConfig || {}),
      updated_at: null,
      source: "CONFIG",
    };
  }

  async store(characterName, currentRevision, config) {
    const normalized = normalizeCharacterConfig(config);
    const revision = nextCharacterConfigRevision(currentRevision);
    await this.persistence.saveCharacterConfig(
      characterName,
      revision,
      normalized,
    );

    return {
      revision,
      config: normalized,
    };
  }
}

module.exports = {
  CharacterConfigService,
  MAX_CHARACTER_CONFIG_BYTES,
  configError,
  nextCharacterConfigRevision,
  normalizeCharacterConfig,
  prepareConfigPush,
};

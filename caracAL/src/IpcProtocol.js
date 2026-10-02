"use strict";

const IPC_PROTOCOL_VERSION = 1;
const IPC_PROTOCOL_VERSION_FIELD = "protocol_version";

function versionIpcMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("IPC message must be an object");
  }
  if (typeof message.type !== "string" || !message.type.trim()) {
    throw new TypeError("IPC message requires a non-empty type");
  }

  return {
    ...message,
    type: message.type.trim(),
    [IPC_PROTOCOL_VERSION_FIELD]: IPC_PROTOCOL_VERSION,
  };
}

function createIpcMessage(type, payload = {}) {
  return versionIpcMessage({
    ...payload,
    type,
  });
}

function normalizeIpcMessage(message, { allowLegacy = false } = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return {
      ok: false,
      code: "IPC_MESSAGE_INVALID",
      protocol_version: null,
      message: null,
    };
  }

  if (typeof message.type !== "string" || !message.type.trim()) {
    return {
      ok: false,
      code: "IPC_MESSAGE_TYPE_INVALID",
      protocol_version: message[IPC_PROTOCOL_VERSION_FIELD] ?? null,
      message: null,
    };
  }

  const rawVersion = message[IPC_PROTOCOL_VERSION_FIELD];
  if (rawVersion === undefined || rawVersion === null) {
    if (allowLegacy) {
      return {
        ok: true,
        legacy: true,
        protocol_version: 0,
        message: {
          ...message,
          type: message.type.trim(),
        },
      };
    }

    return {
      ok: false,
      code: "IPC_PROTOCOL_VERSION_REQUIRED",
      protocol_version: null,
      message: null,
    };
  }

  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version !== IPC_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "IPC_PROTOCOL_VERSION_UNSUPPORTED",
      protocol_version: Number.isFinite(version) ? version : null,
      message: null,
    };
  }

  return {
    ok: true,
    legacy: false,
    protocol_version: IPC_PROTOCOL_VERSION,
    message: {
      ...message,
      type: message.type.trim(),
      [IPC_PROTOCOL_VERSION_FIELD]: IPC_PROTOCOL_VERSION,
    },
  };
}

function sendIpcMessage(target, message, callback) {
  if (!target || typeof target.send !== "function") return false;

  const versioned = versionIpcMessage(message);
  target.send(versioned, undefined, undefined, callback);
  return true;
}

module.exports = {
  IPC_PROTOCOL_VERSION,
  IPC_PROTOCOL_VERSION_FIELD,
  createIpcMessage,
  normalizeIpcMessage,
  sendIpcMessage,
  versionIpcMessage,
};

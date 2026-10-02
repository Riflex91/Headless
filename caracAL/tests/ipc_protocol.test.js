"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  IPC_PROTOCOL_VERSION,
  createIpcMessage,
  normalizeIpcMessage,
  sendIpcMessage,
  versionIpcMessage,
} = require("../src/IpcProtocol");

test("IPC messages are stamped with the current protocol version", () => {
  assert.deepEqual(createIpcMessage("heartbeat", { timestamp: 1234 }), {
    timestamp: 1234,
    type: "heartbeat",
    protocol_version: IPC_PROTOCOL_VERSION,
  });

  assert.deepEqual(
    versionIpcMessage({
      type: "runtime_control",
      state: "PAUSED",
      protocol_version: 999,
    }),
    {
      type: "runtime_control",
      state: "PAUSED",
      protocol_version: IPC_PROTOCOL_VERSION,
    },
  );
});

test("IPC normalization accepts current messages and rejects incompatible ones", () => {
  const accepted = normalizeIpcMessage({
    type: "stat_beat",
    protocol_version: IPC_PROTOCOL_VERSION,
    hp: 100,
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.legacy, false);
  assert.equal(accepted.message.type, "stat_beat");
  assert.equal(accepted.message.hp, 100);

  assert.deepEqual(normalizeIpcMessage({ type: "heartbeat" }), {
    ok: false,
    code: "IPC_PROTOCOL_VERSION_REQUIRED",
    protocol_version: null,
    message: null,
  });

  assert.deepEqual(
    normalizeIpcMessage({
      type: "heartbeat",
      protocol_version: IPC_PROTOCOL_VERSION + 1,
    }),
    {
      ok: false,
      code: "IPC_PROTOCOL_VERSION_UNSUPPORTED",
      protocol_version: IPC_PROTOCOL_VERSION + 1,
      message: null,
    },
  );
});

test("legacy IPC can only be accepted when explicitly requested", () => {
  const accepted = normalizeIpcMessage(
    {
      type: "stor",
      op: "init",
    },
    { allowLegacy: true },
  );

  assert.equal(accepted.ok, true);
  assert.equal(accepted.legacy, true);
  assert.equal(accepted.protocol_version, 0);
  assert.equal(accepted.message.type, "stor");
});

test("sendIpcMessage versions the payload before dispatch", () => {
  let received = null;
  let callbackCalled = false;
  const target = {
    send(message, _handle, _options, callback) {
      received = message;
      callback?.(null);
    },
  };

  assert.equal(
    sendIpcMessage(
      target,
      {
        type: "emergency_stop",
        state: { active: true },
      },
      () => {
        callbackCalled = true;
      },
    ),
    true,
  );

  assert.deepEqual(received, {
    type: "emergency_stop",
    state: { active: true },
    protocol_version: IPC_PROTOCOL_VERSION,
  });
  assert.equal(callbackCalled, true);
  assert.equal(sendIpcMessage(null, { type: "heartbeat" }), false);
});

test("invalid IPC messages fail before dispatch", () => {
  assert.throws(() => versionIpcMessage(null), /must be an object/);
  assert.throws(() => versionIpcMessage({}), /non-empty type/);
  assert.deepEqual(normalizeIpcMessage("heartbeat"), {
    ok: false,
    code: "IPC_MESSAGE_INVALID",
    protocol_version: null,
    message: null,
  });
});

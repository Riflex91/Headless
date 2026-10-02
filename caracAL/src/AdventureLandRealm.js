"use strict";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function secureSocketAddress(value, port = null) {
  const address = nonEmptyString(value);
  if (!address) return null;
  if (/^[a-z]+:\/\//i.test(address)) return address;
  return "https://" + address + (port ? ":" + port : "");
}

function normalizeRealmConnection(realm = {}) {
  const currentAddress = nonEmptyString(realm.address);
  const currentPath = nonEmptyString(realm.path);
  const legacyAddr = nonEmptyString(realm.addr);
  const legacyPort = Number.isFinite(Number(realm.port))
    ? Number(realm.port)
    : null;

  const address = currentAddress
    ? secureSocketAddress(currentAddress)
    : secureSocketAddress(legacyAddr, legacyPort);

  return {
    address,
    path: currentPath || "/socket.io",
    legacyAddr: legacyAddr || currentAddress,
    legacyPort,
  };
}

module.exports = {
  normalizeRealmConnection,
  secureSocketAddress,
};

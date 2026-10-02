"use strict";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRealmConnection(realm = {}) {
  const currentAddress = nonEmptyString(realm.address);
  const currentPath = nonEmptyString(realm.path);
  const legacyAddr = nonEmptyString(realm.addr);
  const legacyPort = Number.isFinite(Number(realm.port))
    ? Number(realm.port)
    : null;

  let address = currentAddress;
  if (!address && legacyAddr) {
    if (/^[a-z]+:\/\//i.test(legacyAddr) || !legacyPort) {
      address = legacyAddr;
    } else {
      address = `https://${legacyAddr}:${legacyPort}`;
    }
  }

  return {
    address,
    path: currentPath || "/socket.io",
    legacyAddr: legacyAddr || currentAddress,
    legacyPort,
  };
}

module.exports = {
  normalizeRealmConnection,
};

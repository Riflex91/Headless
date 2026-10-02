"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = String(
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924",
).replace(/\/$/, "");

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload.message ||
        payload.error ||
        "HTTP " + response.status + " from " + response.url,
    );
  }
  return payload;
}

async function readState() {
  return readJson(
    await fetch(baseUrl + "/headless/api/state", {
      cache: "no-store",
    }),
  );
}

function selectLogisticsLiveTestMerchant(snapshot, requested = null) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];

  if (requested) {
    const exact = characters.find((character) => character.name === requested);
    if (!exact) {
      throw new Error("Unknown character in dashboard state: " + requested);
    }
    if (exact.account_owned !== true || exact.ctype !== "merchant") {
      throw new Error(
        "Logistics E2E requires an account-owned merchant: " + requested,
      );
    }
    return exact;
  }

  const merchants = characters.filter(
    (character) =>
      character.account_owned === true && character.ctype === "merchant",
  );
  return (
    merchants.find(
      (character) =>
        character.connected === true && character.lifecycle_state === "ONLINE",
    ) ||
    merchants.find(
      (character) =>
        character.enabled === true &&
        character.desired_runtime_state === "RUNNING",
    ) ||
    merchants.find((character) => character.enabled === true) ||
    merchants[0] ||
    null
  );
}

async function runLogisticsLiveTest(character) {
  return readJson(
    await fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character.name) +
        "/tests/logistics",
      {
        method: "POST",
      },
    ),
  );
}

async function main() {
  const requestedCharacter = process.argv[2] || null;
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "Temporary caracAL runtime is ready at " + baseUrl + "\n"
        : "Using existing caracAL runtime at " + baseUrl + "\n",
    );

    const merchant = selectLogisticsLiveTestMerchant(
      dashboard.state,
      requestedCharacter,
    );
    if (!merchant) {
      throw new Error(
        "An account-owned merchant is required for Merchant Logistics E2E",
      );
    }

    process.stdout.write(
      "Running autonomous non-forcing Merchant Logistics E2E with " +
        merchant.name +
        "\n",
    );

    const payload = await runLogisticsLiveTest(merchant);
    const result = payload.result;
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");

    if (result?.outcome !== "PASS") {
      process.exitCode = result?.outcome === "TIMEOUT" ? 2 : 1;
    }
  } finally {
    if (managedRuntime) {
      process.stdout.write("Stopping temporary caracAL runtime\n");
      await stopManagedRuntime(managedRuntime);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  readState,
  runLogisticsLiveTest,
  selectLogisticsLiveTestMerchant,
};

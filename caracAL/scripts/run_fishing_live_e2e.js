"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const {
  selectMerchantLiveTestCharacter,
} = require("./run_merchant_live_e2e");

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

async function runFishingLiveTest(character) {
  return readJson(
    await fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character.name) +
        "/tests/fishing",
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

    const merchant = selectMerchantLiveTestCharacter(
      dashboard.state,
      requestedCharacter,
    );
    if (!merchant) {
      throw new Error(
        "An account-owned merchant is required for Fishing E2E",
      );
    }

    process.stdout.write(
      "Running Phase 12 Fishing E2E with " + merchant.name + "\n",
    );

    const payload = await runFishingLiveTest(merchant);
    const result = payload.result;
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");

    if (result?.outcome !== "PASS") {
      if (result?.reason === "FISHING_LIVE_COOLDOWN_ACTIVE") {
        process.stdout.write(
          "Fishing skill is on cooldown; rerun after the Adventure Land cooldown expires.\n",
        );
      }
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
  runFishingLiveTest,
};

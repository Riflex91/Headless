"use strict";

const {
  ensureDashboardAvailable,
  selectMovementLiveTestCharacter,
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

async function runFarmLiveTest(character, sampleMs) {
  return readJson(
    await fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character.name) +
        "/tests/farm",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleMs,
        }),
      },
    ),
  );
}

async function main() {
  const requestedCharacter = process.argv[2] || null;
  const sampleMs = Math.max(
    1000,
    Number(process.env.CARACAL_FARM_LIVE_SAMPLE_MS || 1500),
  );
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "Temporary caracAL runtime is ready at " + baseUrl + "\n"
        : "Using existing caracAL runtime at " + baseUrl + "\n",
    );

    const character = selectMovementLiveTestCharacter(
      dashboard.state,
      requestedCharacter,
    );
    if (!character || character.account_owned !== true) {
      throw new Error(
        "An account-owned character is required for Farm Intelligence E2E",
      );
    }
    if (character.ctype === "merchant") {
      throw new Error(
        "Farm Intelligence E2E requires a non-merchant character",
      );
    }

    process.stdout.write(
      "Running autonomous read-only Farm Intelligence E2E with " +
        character.name +
        "\n",
    );

    const payload = await runFarmLiveTest(character, sampleMs);
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
  runFarmLiveTest,
};

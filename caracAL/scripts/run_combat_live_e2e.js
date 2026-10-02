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
        `HTTP ${response.status} from ${response.url}`,
    );
  }
  return payload;
}

async function readState() {
  return readJson(
    await fetch(`${baseUrl}/headless/api/state`, {
      cache: "no-store",
    }),
  );
}

async function main() {
  const requested = process.argv[2] || null;
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    if (dashboard.startedRuntime) {
      process.stdout.write(
        `Temporary caracAL runtime is ready at ${baseUrl}\n`,
      );
    } else {
      process.stdout.write(`Using existing caracAL runtime at ${baseUrl}\n`);
    }

    const character = selectMovementLiveTestCharacter(
      dashboard.state,
      requested,
    );
    if (!character) {
      throw new Error("No combat character is available for the combat live test");
    }
    if (character.ctype === "merchant") {
      throw new Error("Combat live E2E requires a non-merchant character");
    }

    process.stdout.write(
      `Running autonomous combat E2E for ${character.name} via ${baseUrl}\n`,
    );

    const payload = await readJson(
      await fetch(
        `${baseUrl}/headless/api/characters/${encodeURIComponent(
          character.name,
        )}/tests/combat`,
        {
          method: "POST",
        },
      ),
    );

    process.stdout.write(`${JSON.stringify(payload.result, null, 2)}\n`);

    if (payload.result?.outcome !== "PASS") {
      process.exitCode = ["UNKNOWN", "TIMEOUT"].includes(
        payload.result?.outcome,
      )
        ? 2
        : 1;
    }
  } finally {
    if (managedRuntime) {
      process.stdout.write("Stopping temporary caracAL runtime\n");
      await stopManagedRuntime(managedRuntime);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

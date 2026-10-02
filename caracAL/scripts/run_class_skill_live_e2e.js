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

function selectRanger(snapshot, requested = null) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];

  if (requested) {
    const exact = characters.find((character) => character.name === requested);
    if (!exact) {
      throw new Error(`Unknown character in dashboard state: ${requested}`);
    }
    if (exact.ctype !== "ranger") {
      throw new Error("Class-skill live E2E currently requires a Ranger");
    }
    return exact;
  }

  const rangers = characters.filter(
    (character) =>
      character.account_owned === true && character.ctype === "ranger",
  );

  return (
    rangers.find(
      (character) =>
        character.connected === true && character.lifecycle_state === "ONLINE",
    ) ||
    rangers.find(
      (character) =>
        character.enabled === true &&
        character.desired_runtime_state === "RUNNING",
    ) ||
    rangers.find((character) => character.enabled === true) ||
    rangers.find((character) => character.connected === true) ||
    rangers[0] ||
    null
  );
}

async function main() {
  const requested = process.argv[2] || null;
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? `Temporary caracAL runtime is ready at ${baseUrl}\n`
        : `Using existing caracAL runtime at ${baseUrl}\n`,
    );

    const character = selectRanger(dashboard.state, requested);
    if (!character) {
      throw new Error("No Ranger is available for the class-skill live test");
    }

    process.stdout.write(
      `Running autonomous Ranger class-skill E2E for ${character.name} via ${baseUrl}\n`,
    );

    const payload = await readJson(
      await fetch(
        `${baseUrl}/headless/api/characters/${encodeURIComponent(
          character.name,
        )}/tests/class-skill`,
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { selectRanger };

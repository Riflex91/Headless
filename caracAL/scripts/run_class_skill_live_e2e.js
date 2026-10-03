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

function selectClassSkillCharacter(snapshot, requested = null, ctype = "ranger") {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];

  if (!["ranger", "merchant"].includes(ctype)) {
    throw new Error(`Unsupported class-skill live E2E class: ${ctype}`);
  }

  if (requested) {
    const exact = characters.find((character) => character.name === requested);
    if (!exact) {
      throw new Error(`Unknown character in dashboard state: ${requested}`);
    }
    if (exact.ctype !== ctype) {
      throw new Error(
        `Class-skill live E2E currently requires a ${ctype}: ${requested}`,
      );
    }
    return exact;
  }

  const candidates = characters.filter(
    (character) =>
      character.account_owned === true && character.ctype === ctype,
  );

  return (
    candidates.find(
      (character) =>
        character.connected === true && character.lifecycle_state === "ONLINE",
    ) ||
    candidates.find(
      (character) =>
        character.enabled === true &&
        character.desired_runtime_state === "RUNNING",
    ) ||
    candidates.find((character) => character.enabled === true) ||
    candidates.find((character) => character.connected === true) ||
    candidates[0] ||
    null
  );
}

function selectRanger(snapshot, requested = null) {
  return selectClassSkillCharacter(snapshot, requested, "ranger");
}

function selectMerchant(snapshot, requested = null) {
  return selectClassSkillCharacter(snapshot, requested, "merchant");
}

function parseArguments(args = process.argv.slice(2)) {
  const merchant = args[0] === "--merchant";
  return {
    ctype: merchant ? "merchant" : "ranger",
    requested: merchant ? args[1] || null : args[0] || null,
  };
}

async function main() {
  const { ctype, requested } = parseArguments();
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? `Temporary caracAL runtime is ready at ${baseUrl}\n`
        : `Using existing caracAL runtime at ${baseUrl}\n`,
    );

    const character = selectClassSkillCharacter(
      dashboard.state,
      requested,
      ctype,
    );
    if (!character) {
      throw new Error(
        `No ${ctype} is available for the class-skill live test`,
      );
    }

    process.stdout.write(
      `Running autonomous ${ctype} class-skill E2E for ${character.name} via ${baseUrl}\n`,
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

module.exports = {
  parseArguments,
  selectClassSkillCharacter,
  selectMerchant,
  selectRanger,
};

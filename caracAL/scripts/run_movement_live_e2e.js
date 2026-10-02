"use strict";

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

function selectCharacter(snapshot, requested) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];

  if (requested) {
    const exact = characters.find(
      (character) => character.name === requested,
    );
    if (!exact) {
      throw new Error(`Unknown character in dashboard state: ${requested}`);
    }
    return exact;
  }

  return (
    characters.find(
      (character) =>
        character.account_owned === true && character.ctype !== "merchant",
    ) ||
    characters.find((character) => character.account_owned === true) ||
    characters[0] ||
    null
  );
}

async function main() {
  const requested =
    process.argv[2] || process.env.CARACAL_LIVE_TEST_CHARACTER || null;
  const state = await readJson(
    await fetch(`${baseUrl}/headless/api/state`, {
      cache: "no-store",
    }),
  );
  const character = selectCharacter(state, requested);
  if (!character) {
    throw new Error("No character is available for the movement live test");
  }

  process.stdout.write(
    `Running autonomous movement E2E for ${character.name} via ${baseUrl}\n`,
  );

  const payload = await readJson(
    await fetch(
      `${baseUrl}/headless/api/characters/${encodeURIComponent(
        character.name,
      )}/tests/movement`,
      {
        method: "POST",
      },
    ),
  );

  process.stdout.write(`${JSON.stringify(payload.result, null, 2)}\n`);

  if (payload.result?.outcome !== "PASS") {
    process.exitCode =
      ["UNKNOWN", "TIMEOUT"].includes(payload.result?.outcome) ? 2 : 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

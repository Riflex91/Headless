"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = String(
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924",
).replace(/\/$/, "");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizedSlots(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const slots = value.map((slot) => Number(slot));
  if (
    slots.some((slot) => !Number.isInteger(slot) || slot < 0) ||
    new Set(slots).size !== 3
  ) {
    return null;
  }
  return slots.sort((left, right) => left - right);
}

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

async function controlCharacter(character, action) {
  return readJson(
    await fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character) +
        "/control",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    ),
  );
}

function findCharacter(snapshot, name) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];
  return characters.find((entry) => entry?.name === name) || null;
}

function itemSnapshot(items, slot) {
  const raw = Array.isArray(items) ? items[slot] : null;
  const item = record(raw);
  const present = !!raw && typeof item.name === "string";
  const level = Number(item.level);
  const quantity = Number(item.q);
  return {
    slot,
    name: present ? item.name : null,
    level:
      present && Number.isInteger(level) && level >= 0 ? level : present ? 0 : null,
    quantity:
      present && Number.isFinite(quantity) && quantity > 0 ? quantity : present ? 1 : 0,
    property:
      present && typeof item.p === "string" && item.p.length > 0 ? item.p : null,
    present,
  };
}

function targetSnapshot(character, itemSlots, scrollSlot) {
  const items = character?.game?.items;
  return {
    timestamp: character?.game?.timestamp ?? null,
    items: itemSlots.map((slot) => itemSnapshot(items, slot)),
    scroll: itemSnapshot(items, scrollSlot),
  };
}

function fingerprint(snapshot) {
  return JSON.stringify([
    ...snapshot.items.map((item) => [
      item.slot,
      item.name,
      item.level,
      item.quantity,
      item.property,
    ]),
    [
      snapshot.scroll.slot,
      snapshot.scroll.name,
      snapshot.scroll.level,
      snapshot.scroll.quantity,
      snapshot.scroll.property,
    ],
  ]);
}

function classifyCompoundUnknown(snapshot, expected) {
  const items = snapshot.items;
  const scroll = snapshot.scroll;
  const fromLevel = Number(expected.fromLevel);
  const beforeScrollQuantity = Number(expected.beforeScrollQuantity);

  const unchangedItems =
    items.length === 3 &&
    items.every(
      (item) =>
        item.present === true &&
        item.name === expected.itemName &&
        item.level === fromLevel &&
        item.quantity === 1,
    );
  const unchangedScroll =
    scroll.present === true &&
    scroll.name === expected.scrollName &&
    scroll.quantity === beforeScrollQuantity;

  if (unchangedItems && unchangedScroll) {
    return {
      state: "UNCHANGED",
      reason: "COMPOUND_UNKNOWN_RECONCILED_UNCHANGED",
      mutationObserved: false,
      successObserved: false,
      retryAllowed: false,
    };
  }

  const upgraded = items.filter(
    (item) =>
      item.present === true &&
      item.name === expected.itemName &&
      item.level === fromLevel + 1,
  );
  const empty = items.filter((item) => item.present === false);
  const scrollConsumed =
    scroll.present === true &&
    scroll.name === expected.scrollName &&
    scroll.quantity === beforeScrollQuantity - 1;

  if (upgraded.length === 1 && empty.length === 2 && scrollConsumed) {
    return {
      state: "SUCCESS_STATE",
      reason: "COMPOUND_UNKNOWN_RECONCILED_SUCCESS_STATE",
      mutationObserved: true,
      successObserved: true,
      retryAllowed: false,
    };
  }

  return {
    state: "MUTATED_OR_AMBIGUOUS",
    reason: "COMPOUND_UNKNOWN_RECONCILED_MUTATED_OR_AMBIGUOUS",
    mutationObserved: true,
    successObserved: false,
    retryAllowed: false,
  };
}

async function waitForCharacterInventory(
  characterName,
  {
    initialState = null,
    readStateImpl = readState,
    timeoutMs = Number(
      process.env.CARACAL_COMPOUND_RECONCILE_TIMEOUT_MS || 60000,
    ),
    pollMs = Number(
      process.env.CARACAL_COMPOUND_RECONCILE_POLL_MS || 500,
    ),
    now = Date.now,
    sleepImpl = sleep,
  } = {},
) {
  const deadline = now() + timeoutMs;
  let state = initialState;

  while (now() < deadline) {
    if (!state) state = await readStateImpl();
    const character = findCharacter(state, characterName);
    if (
      character?.account_owned === true &&
      character.connected === true &&
      character.lifecycle_state === "ONLINE" &&
      Array.isArray(character?.game?.items)
    ) {
      return { state, character };
    }
    await sleepImpl(pollMs);
    state = await readStateImpl();
  }

  throw new Error(
    "Timed out waiting for read-only inventory snapshot for " + characterName,
  );
}

async function main() {
  const characterName = process.argv[2] || "";
  const itemName = process.argv[3] || "";
  const fromLevel = Number(process.argv[4]);
  const itemSlots = normalizedSlots([
    process.argv[5],
    process.argv[6],
    process.argv[7],
  ]);
  const scrollName = process.argv[8] || "";
  const scrollSlot = Number(process.argv[9]);
  const beforeScrollQuantity = Number(process.argv[10]);

  if (
    !characterName ||
    !itemName ||
    !Number.isInteger(fromLevel) ||
    fromLevel < 0 ||
    !itemSlots ||
    !scrollName ||
    !Number.isInteger(scrollSlot) ||
    scrollSlot < 0 ||
    !Number.isInteger(beforeScrollQuantity) ||
    beforeScrollQuantity < 1
  ) {
    console.error(
      "Usage: npm run test:live:compound-reconcile -- <character> <itemName> <fromLevel> <slot1> <slot2> <slot3> <scrollName> <scrollSlot> <beforeScrollQuantity>",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    "READ-ONLY: this command does not call Compound and never retries the UNKNOWN action.\n",
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;
  const initialCharacter = findCharacter(dashboard.state, characterName);
  if (!initialCharacter) {
    throw new Error("Unknown character in dashboard state: " + characterName);
  }

  const originalDesired =
    initialCharacter.desired_runtime_state ||
    (initialCharacter.enabled ? "RUNNING" : "STOPPED");
  let startedForReconcile = false;

  try {
    if (
      initialCharacter.connected !== true ||
      initialCharacter.lifecycle_state !== "ONLINE" ||
      !Array.isArray(initialCharacter?.game?.items)
    ) {
      await controlCharacter(characterName, "start");
      startedForReconcile = originalDesired !== "RUNNING";
    }

    const first = await waitForCharacterInventory(characterName, {
      initialState: await readState(),
    });
    const firstSnapshot = targetSnapshot(
      first.character,
      itemSlots,
      scrollSlot,
    );

    await sleep(
      Number(process.env.CARACAL_COMPOUND_RECONCILE_STABILITY_MS || 2500),
    );

    const second = await waitForCharacterInventory(characterName, {
      initialState: await readState(),
    });
    const secondSnapshot = targetSnapshot(
      second.character,
      itemSlots,
      scrollSlot,
    );

    const expected = {
      itemName,
      fromLevel,
      itemSlots,
      scrollName,
      scrollSlot,
      beforeScrollQuantity,
    };
    const classification = classifyCompoundUnknown(secondSnapshot, expected);
    const stable =
      fingerprint(firstSnapshot) === fingerprint(secondSnapshot);

    const result = {
      outcome: stable ? "PASS" : "UNKNOWN",
      reason: stable
        ? classification.reason
        : "COMPOUND_UNKNOWN_RECONCILE_STATE_NOT_STABLE",
      character: characterName,
      expected,
      first: firstSnapshot,
      second: secondSnapshot,
      stable,
      reconciliation: classification,
      readOnly: true,
      compoundDispatched: false,
      blindRetryUsed: false,
    };

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!stable) process.exitCode = 1;
  } finally {
    if (!managedRuntime && startedForReconcile) {
      if (originalDesired === "PAUSED") {
        await controlCharacter(characterName, "pause").catch(() => {});
      } else if (originalDesired === "STOPPED") {
        await controlCharacter(characterName, "stop").catch(() => {});
      }
    }
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
  classifyCompoundUnknown,
  fingerprint,
  itemSnapshot,
  normalizedSlots,
  targetSnapshot,
  waitForCharacterInventory,
};

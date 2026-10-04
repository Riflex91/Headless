"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = String(
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924",
).replace(/\/$/, "");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function equipmentEntries(character) {
  return Object.entries(record(character?.game?.slots))
    .filter(([slot, item]) => !slot.startsWith("trade") && !!item)
    .sort(([left], [right]) => left.localeCompare(right));
}

function equipmentSignature(character) {
  return JSON.stringify(
    equipmentEntries(character).map(([slot, item]) => [
      slot,
      record(item).name || null,
      finite(record(item).level) ? record(item).level : 0,
      finite(record(item).q) ? record(item).q : 1,
    ]),
  );
}

function selectGearScoringCharacter(snapshot, requested = null) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];

  if (requested) {
    const exact = characters.find((character) => character.name === requested);
    if (!exact) {
      throw new Error(`Unknown character in dashboard state: ${requested}`);
    }
    return exact;
  }

  const hasEquipment = (character) => equipmentEntries(character).length > 0;
  const projectionReady = (character) =>
    character?.gear_scoring_runtime?.state === "READY";
  const connectedOwned = characters.filter(
    (character) =>
      character.account_owned === true && character.connected === true,
  );

  return (
    connectedOwned.find(
      (character) => projectionReady(character) && hasEquipment(character),
    ) ||
    connectedOwned.find(hasEquipment) ||
    null
  );
}

async function waitForGearScoringCharacter(
  requested = null,
  {
    initialState = null,
    readStateImpl = readState,
    timeoutMs = Number(
      process.env.CARACAL_GEAR_SCORING_LIVE_TIMEOUT_MS || 30000,
    ),
    pollMs = Number(process.env.CARACAL_GEAR_SCORING_LIVE_POLL_MS || 500),
    now = Date.now,
    sleepImpl = sleep,
  } = {},
) {
  const deadline = now() + timeoutMs;
  let state = initialState;

  while (now() < deadline) {
    if (!state) {
      state = await readStateImpl();
    }

    const selected = selectGearScoringCharacter(state, requested);
    const liveOwnedWithEquipment =
      selected?.account_owned === true &&
      selected?.connected === true &&
      equipmentEntries(selected).length > 0;

    if (liveOwnedWithEquipment) {
      return selected;
    }

    await sleepImpl(pollMs);
    state = await readStateImpl();
  }

  const target = requested ? ` for ${requested}` : "";
  throw new Error(
    `Timed out waiting for a connected account-owned Gear Scoring character${target}`,
  );
}

function contributionMatches(entry, weights) {
  const stats = record(entry?.stats);
  const contributions = record(entry?.contributions);
  let total = 0;

  for (const [key, contribution] of Object.entries(contributions)) {
    const stat = stats[key];
    const weight = weights[key];
    if (!finite(stat) || !finite(weight) || !finite(contribution)) {
      return false;
    }
    const expected = Math.round(stat * weight * 10000) / 10000;
    if (Math.abs(expected - contribution) > 0.0001) return false;
    total += contribution;
  }

  const roundedTotal = Math.round(total * 10000) / 10000;
  return finite(entry?.score) && Math.abs(roundedTotal - entry.score) <= 0.0001;
}

function gearScoringEvidence(character) {
  const scoring = record(character?.gear_scoring_runtime);
  const entries = Array.isArray(scoring.entries) ? scoring.entries : [];
  const weights = record(scoring.weights);
  const equipment = entries.filter((entry) => entry?.location === "EQUIPMENT");
  const scoredEquipment = equipment.filter(
    (entry) => entry?.definitionKnown === true && finite(entry?.score),
  );
  const scoredEntries = entries.filter((entry) => finite(entry?.score));

  const allKnownScoresFinite = entries
    .filter((entry) => entry?.definitionKnown === true)
    .every((entry) => finite(entry?.score));
  const unknownScoresRemainNull = entries
    .filter((entry) => entry?.definitionKnown === false)
    .every((entry) => entry?.score === null);
  const allScoredEntriesRecomputed = scoredEntries.every((entry) =>
    contributionMatches(entry, weights),
  );
  const equipmentCountMatches =
    scoring?.summary?.equippedGear === equipment.length;

  return {
    supervisorProjectionVisible: scoring.state === "READY",
    profile: scoring.profile || null,
    entryCount: entries.length,
    equipmentEntries: equipment.length,
    scoredEquipmentEntries: scoredEquipment.length,
    allKnownScoresFinite,
    unknownScoresRemainNull,
    allScoredEntriesRecomputed,
    equipmentCountMatches,
    equippedScoreObserved: scoredEquipment.length > 0,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.supervisorProjectionVisible === true &&
    evidence.equippedScoreObserved === true &&
    evidence.allKnownScoresFinite === true &&
    evidence.unknownScoresRemainNull === true &&
    evidence.allScoredEntriesRecomputed === true &&
    evidence.equipmentCountMatches === true
  );
}

async function waitForGearScoringProjection(
  characterName,
  {
    readStateImpl = readState,
    timeoutMs = Number(
      process.env.CARACAL_GEAR_SCORING_LIVE_TIMEOUT_MS || 30000,
    ),
    pollMs = Number(process.env.CARACAL_GEAR_SCORING_LIVE_POLL_MS || 500),
    now = Date.now,
    sleepImpl = sleep,
  } = {},
) {
  const deadline = now() + timeoutMs;
  let latest = null;

  while (now() < deadline) {
    const state = await readStateImpl();
    const character = (state.characters || []).find(
      (entry) => entry.name === characterName,
    );
    if (!character) {
      throw new Error(
        `Character disappeared from dashboard state: ${characterName}`,
      );
    }
    latest = character;

    if (gearScoringEvidence(character).supervisorProjectionVisible) {
      return character;
    }

    await sleepImpl(pollMs);
  }

  const state = record(latest?.gear_scoring_runtime).state || "MISSING";
  throw new Error(
    `Timed out waiting for Gear Scoring projection for ${characterName} (state=${state})`,
  );
}

async function runGearScoringSupervisorLiveTest(
  characterName,
  sampleMs = Number(process.env.CARACAL_GEAR_SCORING_LIVE_SETTLE_MS || 1200),
  options = {},
) {
  return readJson(
    await fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(characterName) +
        "/tests/gear-scoring",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleMs,
          ...(options.economyArbiterEnforcementProbe === true && {
            economyArbiterEnforcementProbe: true,
          }),
          ...(options.economyPrebuffExecutionLiveTest === true && {
            economyPrebuffExecutionLiveTest: true,
            expectedKind: options.expectedKind,
            expectedName: options.expectedName,
            expectedSlots: options.expectedSlots,
            confirmationToken: options.confirmationToken,
          }),
        }),
      },
    ),
  );
}

function supervisorSnapshotCharacter(characterName, snapshot) {
  const value = record(snapshot);
  return {
    name: characterName,
    game: {
      slots: record(value.slots),
    },
    gear_scoring_runtime: value.scoring || null,
  };
}

function combineGearScoringSupervisorResult(result) {
  const source = record(result);
  const beforeCharacter = supervisorSnapshotCharacter(
    source.character || null,
    source.before,
  );
  const afterCharacter = supervisorSnapshotCharacter(
    source.character || null,
    source.after,
  );
  const beforeEvidence = gearScoringEvidence(beforeCharacter);
  const finalEvidence = gearScoringEvidence(afterCharacter);
  const equipmentBaselineRestored =
    equipmentSignature(beforeCharacter) === equipmentSignature(afterCharacter);
  const runtimeStateRestored = source.cleanup?.runtimeStateRestored === true;
  const evidence = {
    ...finalEvidence,
    projectionWasReadyBeforeSettle:
      beforeEvidence.supervisorProjectionVisible === true,
    equipmentBaselineRestored,
    runtimeStateRestored,
  };
  const passed =
    source.outcome === "PASS" &&
    evidenceComplete(evidence) &&
    evidence.projectionWasReadyBeforeSettle === true &&
    equipmentBaselineRestored &&
    runtimeStateRestored;

  return {
    ...source,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "GEAR_SCORING_LIVE_E2E_CONFIRMED"
      : source.reason || "GEAR_SCORING_LIVE_E2E_EVIDENCE_INCOMPLETE",
    scoring: afterCharacter.gear_scoring_runtime,
    evidence,
    cleanup: {
      ...record(source.cleanup),
      equipmentBaselineRestored,
      runtimeStateRestored,
    },
  };
}

async function runGearScoringLiveVerification(
  characterName,
  {
    readStateImpl = readState,
    sleepImpl = sleep,
    settleMs = Number(process.env.CARACAL_GEAR_SCORING_LIVE_SETTLE_MS || 1200),
  } = {},
) {
  const startedAt = Date.now();
  const requestId = `gear-scoring-live-${startedAt}`;
  const first = await waitForGearScoringProjection(characterName, {
    readStateImpl,
    sleepImpl,
  });
  const baselineEquipment = equipmentSignature(first);
  const beforeEvidence = gearScoringEvidence(first);

  await sleepImpl(settleMs);

  const state = await readStateImpl();
  const finalCharacter = (state.characters || []).find(
    (entry) => entry.name === characterName,
  );
  if (!finalCharacter) {
    throw new Error(
      `Character disappeared from dashboard state: ${characterName}`,
    );
  }

  const finalEvidence = gearScoringEvidence(finalCharacter);
  const equipmentBaselineRestored =
    equipmentSignature(finalCharacter) === baselineEquipment;
  const evidence = {
    ...finalEvidence,
    projectionWasReadyBeforeSettle:
      beforeEvidence.supervisorProjectionVisible === true,
    equipmentBaselineRestored,
  };
  const passed =
    evidenceComplete(evidence) &&
    evidence.projectionWasReadyBeforeSettle === true &&
    equipmentBaselineRestored;
  const completedAt = Date.now();

  return {
    requestId,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "GEAR_SCORING_LIVE_E2E_CONFIRMED"
      : "GEAR_SCORING_LIVE_E2E_EVIDENCE_INCOMPLETE",
    character: characterName,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    scoring: finalCharacter.gear_scoring_runtime || null,
    evidence,
    scope: {
      readOnly: true,
      movementMutationForced: false,
      combatMutationForced: false,
      valueMutationForced: false,
      equipmentMutationForced: false,
    },
    cleanup: {
      equipmentBaselineRestored,
    },
  };
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

    const selected = await waitForGearScoringCharacter(requestedCharacter, {
      initialState: dashboard.state,
    });

    process.stdout.write(
      "Running read-only Gear Scoring E2E with " + selected.name + "\n",
    );
    const payload = await runGearScoringSupervisorLiveTest(selected.name);
    const result = combineGearScoringSupervisorResult(payload.result);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");

    if (result.outcome !== "PASS") {
      process.exitCode = 1;
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
  combineGearScoringSupervisorResult,
  contributionMatches,
  equipmentEntries,
  equipmentSignature,
  evidenceComplete,
  gearScoringEvidence,
  readState,
  runGearScoringLiveVerification,
  runGearScoringSupervisorLiveTest,
  selectGearScoringCharacter,
  waitForGearScoringCharacter,
  waitForGearScoringProjection,
};

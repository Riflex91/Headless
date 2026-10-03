"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const { readState } = require("./run_gear_scoring_live_e2e");

const baseUrl =
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

async function readJson(responsePromise) {
  const response = await responsePromise;
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      body?.message ||
        body?.error ||
        `HTTP ${response.status} from caracAL dashboard`,
    );
  }
  return body;
}

function characterType(character) {
  const value =
    character?.ctype ||
    character?.scoring?.characterClass ||
    character?.account_character_type ||
    null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function selectReservationPair(
  snapshot,
  requestedSource = null,
  requestedTarget = null,
) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters.filter((entry) => entry?.account_owned === true)
    : [];

  if (requestedSource && requestedTarget) {
    const source = characters.find((entry) => entry.name === requestedSource);
    const target = characters.find((entry) => entry.name === requestedTarget);
    if (
      !source ||
      !target ||
      source.name === target.name ||
      !characterType(source) ||
      characterType(source) !== characterType(target)
    ) {
      return null;
    }
    return { source, target };
  }

  const byType = new Map();
  for (const character of characters) {
    const ctype = characterType(character);
    if (!ctype) continue;
    if (!byType.has(ctype)) byType.set(ctype, []);
    byType.get(ctype).push(character);
  }

  const groups = [...byType.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .sort(([leftType], [rightType]) => {
      if (leftType === "ranger" && rightType !== "ranger") return -1;
      if (rightType === "ranger" && leftType !== "ranger") return 1;
      if (leftType === "merchant" && rightType !== "merchant") return 1;
      if (rightType === "merchant" && leftType !== "merchant") return -1;
      return leftType.localeCompare(rightType);
    });

  for (const [, entries] of groups) {
    const sorted = [...entries].sort(
      (left, right) =>
        Number(right.connected === true) - Number(left.connected === true) ||
        left.name.localeCompare(right.name),
    );

    let source = null;
    if (requestedSource) {
      source = sorted.find((entry) => entry.name === requestedSource) || null;
      if (!source) continue;
    } else {
      source = sorted[0];
    }

    let target = null;
    if (requestedTarget) {
      target = sorted.find(
        (entry) =>
          entry.name === requestedTarget && entry.name !== source.name,
      );
      if (!target) continue;
    } else {
      target = sorted.find((entry) => entry.name !== source.name);
    }

    if (source && target) return { source, target };
  }

  return null;
}

function targetSlots(slotGroup) {
  switch (slotGroup) {
    case "ring":
      return ["ring1", "ring2"];
    case "earring":
      return ["earring1", "earring2"];
    case "weapon":
      return ["mainhand"];
    case "offhand":
      return ["offhand"];
    default:
      return typeof slotGroup === "string" && slotGroup ? [slotGroup] : [];
  }
}

function scoreStats(stats, weights) {
  const source = record(stats);
  const targetWeights = record(weights);
  let score = 0;

  for (const [stat, rawValue] of Object.entries(source)) {
    const value = finite(rawValue);
    const weight = finite(targetWeights[stat]);
    if (value === null || weight === null) continue;
    score += value * weight;
  }

  return round(score);
}

function targetBaseline(sourceEntry, target) {
  const targets = targetSlots(sourceEntry?.slotGroup);
  const slots = record(target?.slots);
  const available = targets.filter((slot) =>
    Object.prototype.hasOwnProperty.call(slots, slot),
  );
  if (available.length === 0) return null;

  const empty = available.find((slot) => !slots[slot]);
  if (empty) return { slot: empty, score: 0 };

  const scoringEntries = Array.isArray(target?.scoring?.entries)
    ? target.scoring.entries
    : [];
  const scored = available.map((slot) => {
    const entry = scoringEntries.find(
      (candidate) =>
        candidate?.location === "EQUIPMENT" && candidate?.slot === slot,
    );
    return {
      slot,
      score: finite(entry?.score),
    };
  });
  if (scored.some((entry) => entry.score === null)) return null;

  return scored.reduce((lowest, current) =>
    current.score < lowest.score ? current : lowest,
  );
}

function expectedReservationPlan(snapshotCharacters) {
  const characters = Array.isArray(snapshotCharacters)
    ? snapshotCharacters
    : [];
  const ready = characters.filter(
    (character) =>
      character?.accountOwned === true &&
      character?.connected === true &&
      character?.scoring?.state === "READY" &&
      character?.futureGear?.state === "READY",
  );

  const claims = [];
  let evaluatedInventoryGear = 0;
  let eligiblePairs = 0;

  for (const source of ready) {
    const sourceClass = characterType(source);
    const sourceEntries = Array.isArray(source?.scoring?.entries)
      ? source.scoring.entries.filter(
          (entry) => entry?.location === "INVENTORY",
        )
      : [];
    evaluatedInventoryGear += sourceEntries.length;

    for (const target of ready) {
      if (source.name === target.name) continue;
      if (!sourceClass || sourceClass !== characterType(target)) continue;
      eligiblePairs += 1;

      for (const sourceEntry of sourceEntries) {
        if (!Number.isInteger(sourceEntry?.slot)) continue;
        if (finite(sourceEntry?.score) === null) continue;
        const ownFutureEntries = Array.isArray(source?.futureGear?.entries)
          ? source.futureGear.entries
          : [];
        if (
          ownFutureEntries.some(
            (entry) =>
              entry?.inventorySlot === sourceEntry.slot &&
              entry?.candidate === true,
          )
        ) {
          continue;
        }

        const baseline = targetBaseline(sourceEntry, target);
        if (!baseline) continue;

        const targetScore = scoreStats(
          sourceEntry.stats,
          target.scoring?.weights,
        );
        const minScoreDelta = Math.max(
          0,
          finite(target?.futureGear?.minScoreDelta) ?? 0,
        );
        const scoreDelta = round(targetScore - baseline.score);
        if (!(scoreDelta > minScoreDelta)) continue;

        claims.push({
          sourceCharacter: source.name,
          sourceInventorySlot: sourceEntry.slot,
          itemName: sourceEntry.name || null,
          level: Number.isFinite(sourceEntry.level) ? sourceEntry.level : 0,
          sourceClass,
          reservedForCharacter: target.name,
          targetClass: characterType(target),
          targetSlot: baseline.slot,
          targetScore,
          baselineScore: baseline.score,
          scoreDelta,
          minScoreDelta,
          reason: "ACCOUNT_GEAR_RESERVATION_SCORE_IMPROVEMENT",
        });
      }
    }
  }

  claims.sort(
    (left, right) =>
      right.scoreDelta - left.scoreDelta ||
      left.reservedForCharacter.localeCompare(right.reservedForCharacter) ||
      left.targetSlot.localeCompare(right.targetSlot) ||
      left.sourceCharacter.localeCompare(right.sourceCharacter) ||
      left.sourceInventorySlot - right.sourceInventorySlot,
  );

  const reservedItems = new Set();
  const filledTargets = new Set();
  const reservations = [];
  for (const claim of claims) {
    const itemKey = `${claim.sourceCharacter}:${claim.sourceInventorySlot}`;
    const targetKey = `${claim.reservedForCharacter}:${claim.targetSlot}`;
    if (reservedItems.has(itemKey) || filledTargets.has(targetKey)) continue;
    reservedItems.add(itemKey);
    filledTargets.add(targetKey);
    reservations.push(claim);
  }

  reservations.sort(
    (left, right) =>
      left.sourceCharacter.localeCompare(right.sourceCharacter) ||
      left.sourceInventorySlot - right.sourceInventorySlot ||
      left.reservedForCharacter.localeCompare(right.reservedForCharacter),
  );

  return {
    ready,
    claims,
    reservations,
    summary: {
      accountOwnedCharacters: characters.filter(
        (entry) => entry?.accountOwned === true,
      ).length,
      readyGearCharacters: ready.length,
      eligiblePairs,
      evaluatedInventoryGear,
      candidateClaims: claims.length,
      reservations: reservations.length,
    },
  };
}

function normalizedReservation(entry) {
  return {
    sourceCharacter: entry?.sourceCharacter || null,
    sourceInventorySlot: Number(entry?.sourceInventorySlot),
    itemName: entry?.itemName || null,
    level: Number.isFinite(entry?.level) ? entry.level : 0,
    sourceClass: entry?.sourceClass || null,
    reservedForCharacter: entry?.reservedForCharacter || null,
    targetClass: entry?.targetClass || null,
    targetSlot: entry?.targetSlot || null,
    targetScore: finite(entry?.targetScore),
    baselineScore: finite(entry?.baselineScore),
    scoreDelta: finite(entry?.scoreDelta),
    minScoreDelta: finite(entry?.minScoreDelta),
    reason: entry?.reason || null,
  };
}

function reservationKey(entry) {
  return `${entry.sourceCharacter}:${entry.sourceInventorySlot}->${entry.reservedForCharacter}:${entry.targetSlot}`;
}

function observedReservations(characters) {
  const map = new Map();
  for (const character of Array.isArray(characters) ? characters : []) {
    const entries = Array.isArray(
      character?.accountReservation?.sourceReservations,
    )
      ? character.accountReservation.sourceReservations
      : [];
    for (const entry of entries) {
      const normalized = normalizedReservation(entry);
      map.set(reservationKey(normalized), normalized);
    }
  }
  return [...map.values()].sort((left, right) =>
    reservationKey(left).localeCompare(reservationKey(right)),
  );
}

function reservationsMatch(expected, observed) {
  const left = expected
    .map(normalizedReservation)
    .sort((a, b) => reservationKey(a).localeCompare(reservationKey(b)));
  const right = observed
    .map(normalizedReservation)
    .sort((a, b) => reservationKey(a).localeCompare(reservationKey(b)));
  return JSON.stringify(left) === JSON.stringify(right);
}

function reservationProtectionComplete(characters, reservations) {
  const byName = new Map(
    (Array.isArray(characters) ? characters : []).map((entry) => [
      entry.name,
      entry,
    ]),
  );

  return reservations.every((reservation) => {
    const source = byName.get(reservation.sourceCharacter);
    const entries = Array.isArray(source?.inventoryIntelligence?.entries)
      ? source.inventoryIntelligence.entries
      : [];
    const inventoryEntry = entries.find(
      (entry) => entry?.slot === reservation.sourceInventorySlot,
    );
    return (
      inventoryEntry?.disposition === "RESERVED" &&
      inventoryEntry?.protected === true &&
      Array.isArray(inventoryEntry?.protections) &&
      inventoryEntry.protections.includes("RESERVED")
    );
  });
}

function summaryMatches(characters, expectedSummary) {
  const readyProjections = (Array.isArray(characters) ? characters : []).filter(
    (entry) =>
      entry?.accountReservation?.state === "READY" &&
      entry?.scoring?.state === "READY" &&
      entry?.futureGear?.state === "READY",
  );
  if (readyProjections.length < 2) return false;

  return readyProjections.every((character) => {
    const summary = record(character.accountReservation?.summary);
    return (
      summary.accountOwnedCharacters ===
        expectedSummary.accountOwnedCharacters &&
      summary.readyGearCharacters === expectedSummary.readyGearCharacters &&
      summary.eligiblePairs === expectedSummary.eligiblePairs &&
      summary.evaluatedInventoryGear ===
        expectedSummary.evaluatedInventoryGear &&
      summary.candidateClaims === expectedSummary.candidateClaims &&
      summary.reservations === expectedSummary.reservations
    );
  });
}

function accountGearReservationEvidence(snapshotCharacters) {
  const expected = expectedReservationPlan(snapshotCharacters);
  const observed = observedReservations(snapshotCharacters);
  const allReservationsRecomputed = reservationsMatch(
    expected.reservations,
    observed,
  );

  return {
    accountOwnedCharacterCount: expected.summary.accountOwnedCharacters,
    readyGearCharacterCount: expected.summary.readyGearCharacters,
    eligiblePairCount: expected.summary.eligiblePairs,
    evaluatedInventoryGear: expected.summary.evaluatedInventoryGear,
    expectedReservationCount: expected.reservations.length,
    observedReservationCount: observed.length,
    readyPairObserved:
      expected.summary.readyGearCharacters >= 2 &&
      expected.summary.eligiblePairs >= 2,
    inventoryGearObserved: expected.summary.evaluatedInventoryGear > 0,
    allReservationsRecomputed,
    reservationProtectionComplete: reservationProtectionComplete(
      snapshotCharacters,
      expected.reservations,
    ),
    summaryMatches: summaryMatches(snapshotCharacters, expected.summary),
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.readyPairObserved === true &&
    evidence.inventoryGearObserved === true &&
    evidence.allReservationsRecomputed === true &&
    evidence.reservationProtectionComplete === true &&
    evidence.summaryMatches === true
  );
}

function combineSupervisorResult(source) {
  const result = record(source);
  const beforeEvidence = accountGearReservationEvidence(result.before);
  const afterEvidence = accountGearReservationEvidence(result.after);
  const equipmentBaselineRestored =
    result.cleanup?.equipmentBaselineRestored === true;
  const inventoryGearBaselineRestored =
    result.cleanup?.inventoryGearBaselineRestored === true;
  const runtimeStatesRestored =
    result.cleanup?.runtimeStatesRestored === true;

  const evidence = {
    ...afterEvidence,
    projectionWasReadyBeforeSettle:
      beforeEvidence.readyPairObserved === true &&
      beforeEvidence.allReservationsRecomputed === true &&
      beforeEvidence.summaryMatches === true,
    equipmentBaselineRestored,
    inventoryGearBaselineRestored,
    runtimeStatesRestored,
  };

  const passed =
    result.outcome === "PASS" &&
    evidenceComplete(afterEvidence) &&
    evidence.projectionWasReadyBeforeSettle === true &&
    equipmentBaselineRestored &&
    inventoryGearBaselineRestored &&
    runtimeStatesRestored;

  return {
    ...result,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "ACCOUNT_GEAR_RESERVATION_LIVE_E2E_CONFIRMED"
      : "ACCOUNT_GEAR_RESERVATION_LIVE_E2E_EVIDENCE_INCOMPLETE",
    evidence,
    scope: {
      ...record(result.scope),
      readOnly: true,
      itemTransferMutationForced: false,
      equipmentMutationForced: false,
      valueMutationForced: false,
      upgradeMutationForced: false,
    },
  };
}

async function runSupervisorLiveTest(source, target, sampleMs) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(source) +
        "/tests/account-gear-reservation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetCharacter: target,
          sampleMs,
        }),
      },
    ),
  );
}

async function main() {
  const requestedSource = process.argv[2] || null;
  const requestedTarget = process.argv[3] || null;
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "Temporary caracAL runtime is ready at " + baseUrl + "\n"
        : "Using existing caracAL runtime at " + baseUrl + "\n",
    );

    const pair = selectReservationPair(
      dashboard.state,
      requestedSource,
      requestedTarget,
    );
    if (!pair) {
      throw new Error(
        "No two account-owned same-class characters are available for Account Gear Reservation live verification",
      );
    }

    process.stdout.write(
      "Running read-only Account Gear Reservation E2E with " +
        pair.source.name +
        " -> " +
        pair.target.name +
        "\n",
    );
    const sampleMs = Number(
      process.env.CARACAL_ACCOUNT_GEAR_RESERVATION_LIVE_SETTLE_MS || 1500,
    );
    const payload = await runSupervisorLiveTest(
      pair.source.name,
      pair.target.name,
      sampleMs,
    );
    const result = combineSupervisorResult(payload.result);
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
  accountGearReservationEvidence,
  combineSupervisorResult,
  evidenceComplete,
  expectedReservationPlan,
  observedReservations,
  reservationProtectionComplete,
  reservationsMatch,
  scoreStats,
  selectReservationPair,
  summaryMatches,
  targetBaseline,
  targetSlots,
};

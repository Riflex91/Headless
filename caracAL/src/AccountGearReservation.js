"use strict";

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

function characterClass(block) {
  const scoring = record(block?.gear_scoring_runtime);
  const value =
    scoring.characterClass ||
    block?.account_character_type ||
    block?.live_state?.ctype ||
    null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function targetBaseline(sourceEntry, targetBlock) {
  const targets = targetSlots(sourceEntry?.slotGroup);
  const slots = record(targetBlock?.live_state?.slots);
  const availableTargets = targets.filter((slot) =>
    Object.prototype.hasOwnProperty.call(slots, slot),
  );

  if (availableTargets.length === 0) return null;

  const empty = availableTargets.find((slot) => !slots[slot]);
  if (empty) {
    return {
      slot: empty,
      score: 0,
    };
  }

  const scoringEntries = Array.isArray(
    targetBlock?.gear_scoring_runtime?.entries,
  )
    ? targetBlock.gear_scoring_runtime.entries
    : [];
  const scored = availableTargets.map((slot) => {
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

function claimFor(sourceName, sourceBlock, sourceEntry, targetName, targetBlock) {
  if (sourceName === targetName) return null;
  if (sourceBlock?.account_owned !== true || targetBlock?.account_owned !== true) {
    return null;
  }

  const sourceClass = characterClass(sourceBlock);
  const targetClass = characterClass(targetBlock);
  if (!sourceClass || !targetClass || sourceClass !== targetClass) return null;

  const targetScoring = record(targetBlock.gear_scoring_runtime);
  if (targetScoring.state !== "READY") return null;
  if (sourceEntry?.location !== "INVENTORY") return null;
  if (!Number.isInteger(sourceEntry?.slot)) return null;
  if (finite(sourceEntry?.score) === null) return null;

  const baseline = targetBaseline(sourceEntry, targetBlock);
  if (!baseline) return null;

  const targetScore = scoreStats(sourceEntry.stats, targetScoring.weights);
  const minScoreDelta = Math.max(
    0,
    finite(targetBlock?.future_gear_runtime?.minScoreDelta) ?? 0,
  );
  const scoreDelta = round(targetScore - baseline.score);
  if (!(scoreDelta > minScoreDelta)) return null;

  return {
    sourceCharacter: sourceName,
    sourceInventorySlot: sourceEntry.slot,
    itemName: sourceEntry.name || null,
    level: Number.isFinite(sourceEntry.level) ? sourceEntry.level : 0,
    sourceClass,
    reservedForCharacter: targetName,
    targetClass,
    targetSlot: baseline.slot,
    targetScore,
    baselineScore: baseline.score,
    scoreDelta,
    minScoreDelta,
    reason: "ACCOUNT_GEAR_RESERVATION_SCORE_IMPROVEMENT",
  };
}

function buildAccountGearReservationPlan(
  characterManage,
  { now = Date.now } = {},
) {
  const characters = record(characterManage);
  const owned = Object.entries(characters).filter(
    ([, block]) => block?.account_owned === true,
  );
  const ready = owned.filter(
    ([, block]) => block?.gear_scoring_runtime?.state === "READY",
  );

  const claims = [];
  let evaluatedInventoryGear = 0;
  let eligiblePairs = 0;

  for (const [sourceName, sourceBlock] of ready) {
    const sourceClass = characterClass(sourceBlock);
    const sourceEntries = Array.isArray(sourceBlock?.gear_scoring_runtime?.entries)
      ? sourceBlock.gear_scoring_runtime.entries.filter(
          (entry) => entry?.location === "INVENTORY",
        )
      : [];
    evaluatedInventoryGear += sourceEntries.length;

    for (const [targetName, targetBlock] of ready) {
      if (sourceName === targetName) continue;
      if (!sourceClass || sourceClass !== characterClass(targetBlock)) continue;
      eligiblePairs += 1;

      for (const sourceEntry of sourceEntries) {
        const claim = claimFor(
          sourceName,
          sourceBlock,
          sourceEntry,
          targetName,
          targetBlock,
        );
        if (claim) claims.push(claim);
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

  const timestamp = Number(now());
  const projectionsReady = ready.length;
  const state = projectionsReady >= 2 ? "READY" : "EMPTY";

  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    enabled: true,
    state,
    reason:
      state === "READY"
        ? "ACCOUNT_GEAR_RESERVATION_READY"
        : "ACCOUNT_GEAR_RESERVATION_INSUFFICIENT_PROJECTIONS",
    sameClassOnly: true,
    reservations,
    summary: {
      accountOwnedCharacters: owned.length,
      readyGearCharacters: projectionsReady,
      eligiblePairs,
      evaluatedInventoryGear,
      candidateClaims: claims.length,
      reservations: reservations.length,
    },
  };
}

function reservationProjectionForCharacter(plan, characterName) {
  const sourceReservations = Array.isArray(plan?.reservations)
    ? plan.reservations.filter(
        (entry) => entry?.sourceCharacter === characterName,
      )
    : [];
  const targetReservations = Array.isArray(plan?.reservations)
    ? plan.reservations.filter(
        (entry) => entry?.reservedForCharacter === characterName,
      )
    : [];

  return {
    timestamp: plan?.timestamp || Date.now(),
    enabled: plan?.enabled !== false,
    state: plan?.state || "EMPTY",
    reason:
      plan?.reason || "ACCOUNT_GEAR_RESERVATION_INSUFFICIENT_PROJECTIONS",
    sameClassOnly: plan?.sameClassOnly !== false,
    sourceReservations,
    targetReservations,
    summary: {
      ...(record(plan?.summary)),
      sourceReservations: sourceReservations.length,
      targetReservations: targetReservations.length,
    },
  };
}

function reservedSlotsForCharacter(plan, characterName) {
  return reservationProjectionForCharacter(plan, characterName).sourceReservations
    .map((entry) => entry.sourceInventorySlot)
    .filter((slot) => Number.isInteger(slot) && slot >= 0)
    .sort((left, right) => left - right);
}

module.exports = {
  buildAccountGearReservationPlan,
  characterClass,
  claimFor,
  reservationProjectionForCharacter,
  reservedSlotsForCharacter,
  scoreStats,
  targetBaseline,
  targetSlots,
};

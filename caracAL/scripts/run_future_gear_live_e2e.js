"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const {
  readState,
  runGearScoringSupervisorLiveTest,
  waitForGearScoringCharacter,
} = require("./run_gear_scoring_live_e2e");

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

function sameNumber(actual, expected) {
  if (actual === null && expected === null) return true;
  return (
    finite(actual) !== null &&
    finite(expected) !== null &&
    Math.abs(actual - expected) <= 0.0001
  );
}

function sameStrings(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
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

function expectedFutureGearDecision(scoringEntry, snapshot) {
  const futureGear = record(snapshot?.futureGear);
  const minScoreDelta = Math.max(0, finite(futureGear.minScoreDelta) ?? 0);
  const slots = record(snapshot?.slots);
  const scoringEntries = Array.isArray(snapshot?.scoring?.entries)
    ? snapshot.scoring.entries
    : [];
  const targets = targetSlots(scoringEntry?.slotGroup);
  const score = finite(scoringEntry?.score);

  if (score === null) {
    return {
      targetSlots: targets,
      baselineSlot: null,
      baselineScore: null,
      scoreDelta: null,
      candidate: false,
      decision: "SCORE_UNKNOWN",
      reason: "FUTURE_GEAR_SCORE_UNKNOWN",
    };
  }

  const availableTargets = targets.filter((slot) =>
    Object.prototype.hasOwnProperty.call(slots, slot),
  );
  if (availableTargets.length === 0) {
    return {
      targetSlots: targets,
      baselineSlot: null,
      baselineScore: null,
      scoreDelta: null,
      candidate: false,
      decision: "SLOT_UNRESOLVED",
      reason: "FUTURE_GEAR_SLOT_UNRESOLVED",
    };
  }

  const emptySlot = availableTargets.find((slot) => !slots[slot]);
  if (emptySlot) {
    const scoreDelta = score;
    const candidate = scoreDelta > minScoreDelta;
    return {
      targetSlots: targets,
      baselineSlot: emptySlot,
      baselineScore: 0,
      scoreDelta,
      candidate,
      decision: candidate ? "CANDIDATE" : "NOT_BETTER",
      reason: candidate
        ? "FUTURE_GEAR_EMPTY_SLOT_IMPROVEMENT"
        : "FUTURE_GEAR_NOT_BETTER",
    };
  }

  const equipmentScores = availableTargets.map((slot) => {
    const entry = scoringEntries.find(
      (candidate) =>
        candidate?.location === "EQUIPMENT" && candidate?.slot === slot,
    );
    return {
      slot,
      score: finite(entry?.score),
    };
  });

  if (equipmentScores.some((entry) => entry.score === null)) {
    return {
      targetSlots: targets,
      baselineSlot: null,
      baselineScore: null,
      scoreDelta: null,
      candidate: false,
      decision: "BASELINE_UNKNOWN",
      reason: "FUTURE_GEAR_BASELINE_UNKNOWN",
    };
  }

  const baseline = equipmentScores.reduce((lowest, current) =>
    current.score < lowest.score ? current : lowest,
  );
  const scoreDelta = round(score - baseline.score);
  const candidate = scoreDelta > minScoreDelta;

  return {
    targetSlots: targets,
    baselineSlot: baseline.slot,
    baselineScore: baseline.score,
    scoreDelta,
    candidate,
    decision: candidate ? "CANDIDATE" : "NOT_BETTER",
    reason: candidate
      ? "FUTURE_GEAR_SCORE_IMPROVEMENT"
      : "FUTURE_GEAR_NOT_BETTER",
  };
}

function decisionMatches(entry, scoringEntry, snapshot) {
  if (!entry || !scoringEntry) return false;
  const expected = expectedFutureGearDecision(scoringEntry, snapshot);

  return (
    entry.inventorySlot === scoringEntry.slot &&
    entry.name === scoringEntry.name &&
    entry.level === scoringEntry.level &&
    entry.slotGroup === scoringEntry.slotGroup &&
    sameNumber(entry.score, scoringEntry.score) &&
    sameStrings(entry.targetSlots, expected.targetSlots) &&
    entry.baselineSlot === expected.baselineSlot &&
    sameNumber(entry.baselineScore, expected.baselineScore) &&
    sameNumber(entry.scoreDelta, expected.scoreDelta) &&
    entry.candidate === expected.candidate &&
    entry.decision === expected.decision &&
    entry.reason === expected.reason
  );
}

function futureGearEvidence(snapshot) {
  const scoring = record(snapshot?.scoring);
  const futureGear = record(snapshot?.futureGear);
  const inventoryIntelligence = record(snapshot?.inventoryIntelligence);
  const scoringEntries = Array.isArray(scoring.entries) ? scoring.entries : [];
  const futureEntries = Array.isArray(futureGear.entries)
    ? futureGear.entries
    : [];
  const inventoryEntries = Array.isArray(inventoryIntelligence.entries)
    ? inventoryIntelligence.entries
    : [];
  const scoringInventory = scoringEntries.filter(
    (entry) => entry?.location === "INVENTORY",
  );
  const scoringBySlot = new Map(
    scoringInventory
      .filter((entry) => Number.isInteger(entry?.slot))
      .map((entry) => [entry.slot, entry]),
  );
  const inventoryBySlot = new Map(
    inventoryEntries
      .filter((entry) => Number.isInteger(entry?.slot))
      .map((entry) => [entry.slot, entry]),
  );

  const allDecisionsRecomputed = futureEntries.every((entry) =>
    decisionMatches(entry, scoringBySlot.get(entry?.inventorySlot), snapshot),
  );
  const candidates = futureEntries.filter((entry) => entry?.candidate === true);
  const candidateProtectionComplete = candidates.every((entry) => {
    const intelligence = inventoryBySlot.get(entry.inventorySlot);
    return (
      intelligence?.protected === true &&
      Array.isArray(intelligence?.protections) &&
      intelligence.protections.includes("FUTURE_GEAR")
    );
  });

  const decisions = {
    CANDIDATE: 0,
    NOT_BETTER: 0,
    SCORE_UNKNOWN: 0,
    SLOT_UNRESOLVED: 0,
    BASELINE_UNKNOWN: 0,
  };
  for (const entry of futureEntries) {
    if (Object.prototype.hasOwnProperty.call(decisions, entry?.decision)) {
      decisions[entry.decision] += 1;
    }
  }

  const summary = record(futureGear.summary);
  const summaryMatches =
    summary.inventoryGear === futureEntries.length &&
    summary.candidates === decisions.CANDIDATE &&
    summary.notBetter === decisions.NOT_BETTER &&
    summary.scoreUnknown === decisions.SCORE_UNKNOWN &&
    summary.slotUnresolved === decisions.SLOT_UNRESOLVED &&
    summary.baselineUnknown === decisions.BASELINE_UNKNOWN;

  return {
    gearScoringReady: scoring.state === "READY",
    futureGearProjectionVisible: futureGear.state === "READY",
    inventoryIntelligenceReady: inventoryIntelligence.state === "READY",
    decisionEntriesObserved: futureEntries.length > 0,
    decisionEntryCount: futureEntries.length,
    candidateCount: candidates.length,
    inventoryGearCountMatches: futureEntries.length === scoringInventory.length,
    allDecisionsRecomputed,
    candidateProtectionComplete,
    summaryMatches,
  };
}

function decisionEvidenceComplete(evidence) {
  return (
    evidence.gearScoringReady === true &&
    evidence.futureGearProjectionVisible === true &&
    evidence.decisionEntriesObserved === true &&
    evidence.inventoryGearCountMatches === true &&
    evidence.allDecisionsRecomputed === true &&
    evidence.summaryMatches === true
  );
}

function evidenceComplete(evidence) {
  return (
    decisionEvidenceComplete(evidence) &&
    evidence.inventoryIntelligenceReady === true &&
    evidence.candidateProtectionComplete === true
  );
}

function combineFutureGearSupervisorResult(source) {
  const result = record(source);
  const beforeEvidence = futureGearEvidence(result.before);
  const afterEvidence = futureGearEvidence(result.after);
  const equipmentBaselineRestored =
    result.cleanup?.equipmentBaselineRestored === true;
  const runtimeStateRestored = result.cleanup?.runtimeStateRestored === true;
  const evidence = {
    ...afterEvidence,
    projectionWasReadyBeforeSettle: decisionEvidenceComplete(beforeEvidence),
    equipmentBaselineRestored,
    runtimeStateRestored,
  };
  const passed =
    result.outcome === "PASS" &&
    evidenceComplete(afterEvidence) &&
    evidence.projectionWasReadyBeforeSettle === true &&
    equipmentBaselineRestored &&
    runtimeStateRestored;

  return {
    ...result,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "FUTURE_GEAR_LIVE_E2E_CONFIRMED"
      : "FUTURE_GEAR_LIVE_E2E_EVIDENCE_INCOMPLETE",
    evidence,
    scope: {
      ...record(result.scope),
      readOnly: true,
      futureGearMutationForced: false,
      reservationMutationForced: false,
      equipmentMutationForced: false,
      valueMutationForced: false,
    },
    cleanup: {
      ...record(result.cleanup),
      equipmentBaselineRestored,
      runtimeStateRestored,
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
        ? "Temporary caracAL runtime is ready at http://127.0.0.1:924\n"
        : "Using existing caracAL runtime at http://127.0.0.1:924\n",
    );

    const selected = await waitForGearScoringCharacter(requestedCharacter, {
      initialState: dashboard.state,
    });

    process.stdout.write(
      "Running read-only Future Gear E2E with " + selected.name + "\n",
    );
    const sampleMs = Number(
      process.env.CARACAL_FUTURE_GEAR_LIVE_SETTLE_MS || 250,
    );
    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      sampleMs,
    );
    const result = combineFutureGearSupervisorResult(payload.result);
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
  combineFutureGearSupervisorResult,
  decisionMatches,
  decisionEvidenceComplete,
  evidenceComplete,
  expectedFutureGearDecision,
  futureGearEvidence,
  targetSlots,
};

"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const { readState } = require("./run_gear_scoring_live_e2e");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function verifyExchangePreflightResult(source) {
  const result = record(source);
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const selected = record(result.selected);
  const station = record(result.station);
  const evidence = record(result.evidence);
  const summary = record(result.summary);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);

  const counted = {
    exchangeDispositionItems: candidates.length,
    eligibleCandidates: candidates.filter((entry) => entry?.eligible === true)
      .length,
    protectedItems: candidates.filter((entry) => entry?.protected === true)
      .length,
    insufficientQuantityItems: candidates.filter(
      (entry) => entry?.reason === "EXCHANGE_QUANTITY_INSUFFICIENT",
    ).length,
  };

  const candidateEvidenceValid = candidates.every((entry) => {
    if (!Number.isInteger(entry?.itemSlot) || entry.itemSlot < 0) return false;
    if (typeof entry?.itemName !== "string" || !entry.itemName) return false;
    if (!Number.isInteger(entry?.quantity) || entry.quantity <= 0) return false;
    if (!Array.isArray(entry?.protections)) return false;

    if (entry.eligible === true) {
      return (
        Number.isInteger(entry.requiredQuantity) &&
        entry.requiredQuantity > 0 &&
        entry.quantity >= entry.requiredQuantity &&
        entry.protected === false &&
        entry.protections.length === 0 &&
        entry.reason === "EXCHANGE_POLICY_ELIGIBLE"
      );
    }

    return [
      "EXCHANGE_ITEM_PROTECTED",
      "EXCHANGE_ITEM_STATE_MISMATCH",
      "EXCHANGE_ITEM_NOT_EXCHANGEABLE",
      "EXCHANGE_QUANTITY_INSUFFICIENT",
    ].includes(entry.reason);
  });

  const selectedEvidenceValid =
    Object.keys(selected).length === 0 ||
    candidates.some(
      (entry) =>
        entry?.eligible === true &&
        entry.itemSlot === selected.itemSlot &&
        entry.itemName === selected.name &&
        entry.requiredQuantity === selected.requiredQuantity,
    );

  const stationVerified =
    station.located === true &&
    station.id === "exchange" &&
    station.map === "main" &&
    Number.isFinite(station.x) &&
    Number.isFinite(station.y) &&
    typeof station.travelRequired === "boolean";

  const summaryMatches = Object.entries(counted).every(
    ([key, value]) => summary[key] === value,
  );

  const scopeReadOnly =
    scope.readOnly === true &&
    scope.movementMutationForced === false &&
    scope.upgradeMutationForced === false &&
    scope.compoundMutationForced === false &&
    scope.exchangeMutationForced === false &&
    scope.craftMutationForced === false;

  const cleanupComplete =
    cleanup.runtimeStateRestored === true &&
    cleanup.dispatcherRestored === true;

  const preflightEvidenceValid =
    evidence.inventoryIntelligenceReady === true &&
    evidence.exchangePlanReadOnly === true &&
    evidence.stationLocated === true &&
    evidence.stationIdentityVerified === true &&
    evidence.selectedCandidateConsistent === true &&
    evidence.noMutationDispatched === true;

  const readyForExchangeConsistent =
    result.readyForExchange ===
    (Object.keys(selected).length > 0 &&
      stationVerified &&
      selectedEvidenceValid);

  const verified = {
    scanCompleted:
      result.outcome === "PASS" &&
      result.reason === "EXCHANGE_PREFLIGHT_COMPLETED",
    candidateEvidenceValid,
    selectedEvidenceValid,
    stationVerified,
    summaryMatches,
    preflightEvidenceValid,
    readyForExchangeConsistent,
    scopeReadOnly,
    cleanupComplete,
  };
  const passed = Object.values(verified).every((value) => value === true);

  return {
    ...result,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "EXCHANGE_PREFLIGHT_E2E_CONFIRMED"
      : "EXCHANGE_PREFLIGHT_E2E_EVIDENCE_INCOMPLETE",
    verifier: verified,
  };
}

async function readJson(responsePromise) {
  const response = await responsePromise;
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  if (!response.ok) {
    throw new Error(
      body?.message ||
        body?.error ||
        `HTTP ${response.status} from caracAL dashboard`,
    );
  }
  return body;
}

async function runSupervisorPreflight(character) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character) +
        "/tests/exchange-preflight",
      { method: "POST" },
    ),
  );
}

async function main() {
  const character = process.argv[2] || "";
  if (!character) {
    console.error(
      "Usage: npm run test:live:exchange-preflight -- <character>",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    `Running read-only Exchange preflight for ${character}; no movement or Exchange mutation will be dispatched.\n`,
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runSupervisorPreflight(character);
    const result = verifyExchangePreflightResult(payload.result);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.outcome !== "PASS") process.exitCode = 1;
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
  runSupervisorPreflight,
  verifyExchangePreflightResult,
};

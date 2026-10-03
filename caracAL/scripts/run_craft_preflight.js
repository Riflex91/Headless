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

function validRequirement(entry) {
  return (
    entry &&
    Number.isInteger(entry.quantity) &&
    entry.quantity > 0 &&
    typeof entry.name === "string" &&
    entry.name.length > 0 &&
    (entry.level === null ||
      (Number.isInteger(entry.level) && entry.level >= 0))
  );
}

function validCandidate(entry) {
  if (!entry || typeof entry.recipe !== "string" || !entry.recipe) return false;
  if (!Array.isArray(entry.itemSlots) || entry.itemSlots.length < 1) {
    return false;
  }
  if (
    entry.itemSlots.some(
      (slot) => !Number.isInteger(slot) || slot < 0,
    ) ||
    new Set(entry.itemSlots).size !== entry.itemSlots.length
  ) {
    return false;
  }
  if (
    !Array.isArray(entry.requirements) ||
    entry.requirements.length !== entry.itemSlots.length ||
    !entry.requirements.every(validRequirement)
  ) {
    return false;
  }
  return entry.reason === "CRAFT_POLICY_ELIGIBLE";
}

function verifyCraftPreflightResult(source) {
  const result = record(source);
  const craft = record(result.craft);
  const selected = record(result.selected);
  const candidates = Array.isArray(craft.candidates) ? craft.candidates : [];
  const station = record(result.station);
  const evidence = record(result.evidence);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);

  const candidateEvidenceValid = candidates.every(validCandidate);
  const selectedEvidenceValid =
    Object.keys(selected).length === 0 ||
    (validCandidate(selected) &&
      candidates.some(
        (candidate) =>
          candidate?.recipe === selected.recipe &&
          JSON.stringify(candidate?.itemSlots) ===
            JSON.stringify(selected.itemSlots),
      ));

  const stationVerified =
    station.located === true &&
    station.id === "craftsman" &&
    station.map === "main" &&
    Number.isFinite(station.x) &&
    Number.isFinite(station.y) &&
    typeof station.travelRequired === "boolean";

  const recipeMetadataValid =
    Number.isInteger(result.recipeCount) &&
    result.recipeCount > 0 &&
    evidence.recipeMetadataObserved === true;

  const scopeReadOnly =
    scope.readOnly === true &&
    scope.movementMutationForced === false &&
    scope.upgradeMutationForced === false &&
    scope.compoundMutationForced === false &&
    scope.exchangeMutationForced === false &&
    scope.craftMutationForced === false;

  const cleanupComplete =
    cleanup.craftConfigOverrideCleared === true &&
    cleanup.runtimeStateRestored === true &&
    cleanup.dispatcherRestored === true;

  const preflightEvidenceValid =
    evidence.inventoryIntelligenceReady === true &&
    evidence.craftPlanReadOnly === true &&
    evidence.stationLocated === true &&
    evidence.stationIdentityVerified === true &&
    evidence.selectedCandidateConsistent === true &&
    evidence.noMutationDispatched === true;

  const selectedPresent = Object.keys(selected).length > 0;
  const readyForCraftConsistent =
    result.readyForCraft ===
    (selectedPresent &&
      craft.state === "READY" &&
      stationVerified &&
      selectedEvidenceValid);

  const verified = {
    scanCompleted:
      result.outcome === "PASS" &&
      result.reason === "CRAFT_PREFLIGHT_COMPLETED",
    recipeMetadataValid,
    candidateEvidenceValid,
    selectedEvidenceValid,
    stationVerified,
    preflightEvidenceValid,
    readyForCraftConsistent,
    scopeReadOnly,
    cleanupComplete,
  };
  const passed = Object.values(verified).every((value) => value === true);

  return {
    ...result,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "CRAFT_PREFLIGHT_E2E_CONFIRMED"
      : "CRAFT_PREFLIGHT_E2E_EVIDENCE_INCOMPLETE",
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
        "/tests/craft-preflight",
      { method: "POST" },
    ),
  );
}

async function main() {
  const character = process.argv[2] || "";
  if (!character) {
    console.error("Usage: npm run test:live:craft-preflight -- <character>");
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    `Running read-only Craft preflight for ${character}; no movement or Craft mutation will be dispatched.\n`,
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runSupervisorPreflight(character);
    const result = verifyCraftPreflightResult(payload.result);
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
  verifyCraftPreflightResult,
};

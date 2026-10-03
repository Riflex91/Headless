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

function verifyUpgradePreflightResult(source) {
  const result = record(source);
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const summary = record(result.summary);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);

  const counted = {
    upgradableItems: candidates.length,
    eligibleCandidates: candidates.filter((entry) => entry?.eligible === true)
      .length,
    protectedItems: candidates.filter((entry) => entry?.protected === true)
      .length,
    unknownGradeItems: candidates.filter(
      (entry) => entry?.reason === "UPGRADE_PREFLIGHT_ITEM_GRADE_UNKNOWN",
    ).length,
    missingScrollItems: candidates.filter(
      (entry) => entry?.reason === "UPGRADE_PREFLIGHT_MATCHING_SCROLL_MISSING",
    ).length,
  };

  const candidateEvidenceValid = candidates.every((entry) => {
    if (!Number.isInteger(entry?.itemSlot) || entry.itemSlot < 0) return false;
    if (typeof entry?.itemName !== "string" || !entry.itemName) return false;
    if (!Number.isInteger(entry?.level) || entry.level < 0) return false;
    if (!Array.isArray(entry?.protections)) return false;
    if (!Array.isArray(entry?.matchingScrollSlots)) return false;

    if (entry.eligible === true) {
      return (
        Number.isInteger(entry.itemGrade) &&
        entry.itemGrade >= 0 &&
        entry.expectedScrollName === `scroll${entry.itemGrade}` &&
        entry.protected === false &&
        entry.protections.length === 0 &&
        entry.matchingScrollSlots.length > 0 &&
        entry.reason === "UPGRADE_PREFLIGHT_READY"
      );
    }

    return [
      "UPGRADE_PREFLIGHT_ITEM_PROTECTED",
      "UPGRADE_PREFLIGHT_ITEM_GRADE_UNKNOWN",
      "UPGRADE_PREFLIGHT_MATCHING_SCROLL_MISSING",
    ].includes(entry.reason);
  });

  const summaryMatches = Object.entries(counted).every(
    ([key, value]) => summary[key] === value,
  );
  const scopeReadOnly =
    scope.readOnly === true &&
    scope.upgradeMutationForced === false &&
    scope.offeringMutationForced === false &&
    scope.compoundMutationForced === false &&
    scope.exchangeMutationForced === false &&
    scope.craftMutationForced === false;
  const cleanupComplete =
    cleanup.runtimeStateRestored === true &&
    cleanup.dispatcherRestored === true;

  const verified = {
    scanCompleted:
      result.outcome === "PASS" &&
      result.reason === "UPGRADE_PREFLIGHT_COMPLETED",
    candidateEvidenceValid,
    summaryMatches,
    scopeReadOnly,
    cleanupComplete,
  };
  const passed = Object.values(verified).every((value) => value === true);

  return {
    ...result,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "UPGRADE_PREFLIGHT_E2E_CONFIRMED"
      : "UPGRADE_PREFLIGHT_E2E_EVIDENCE_INCOMPLETE",
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
        "/tests/upgrade-preflight",
      { method: "POST" },
    ),
  );
}

async function main() {
  const character = process.argv[2] || "";
  if (!character) {
    console.error(
      "Usage: npm run test:live:upgrade-preflight -- <character>",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    `Running read-only Upgrade preflight for ${character}; no mutation will be dispatched.\n`,
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runSupervisorPreflight(character);
    const result = verifyUpgradePreflightResult(payload.result);
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
  verifyUpgradePreflightResult,
};

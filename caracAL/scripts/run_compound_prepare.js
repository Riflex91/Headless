"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const { readState } = require("./run_gear_scoring_live_e2e");

const baseUrl = process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924";

const DEFAULT_MERCHANT = "My_Merchant";
const DEFAULT_WORKERS = ["My_Ranger1", "My_Ranger2", "My_Ranger3"];

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
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

async function runCompoundPreparation(merchant, workers) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(merchant) +
        "/tests/compound-prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workers }),
      },
    ),
  );
}

function verifyCompoundPreparation(source) {
  const result = record(source);
  const plan = record(result.plan);
  const selected = record(plan.selected);
  const workerResults = Array.isArray(result.workerResults)
    ? result.workerResults
    : [];

  const resultItemLevel = Number(result.itemLevel);
  const selectedItemLevel = Number(selected.itemLevel);
  const selectedSource =
    selected.source === "MERCHANT_INVENTORY"
      ? "MERCHANT_INVENTORY"
      : "MONSTER_DROP";

  const workerEvidenceValid = workerResults.every((entry) => {
    const evidence = record(entry?.evidence);
    return (
      entry?.outcome === "PASS" &&
      entry?.reason === "MATERIAL_GATHER_AND_DELIVERY_CONFIRMED" &&
      Number(entry?.itemLevel) === resultItemLevel &&
      evidence.combatControllerUsed === true &&
      evidence.materialObserved === true &&
      evidence.deliveryConfirmed === true &&
      evidence.blindRetryUsed === false &&
      record(entry?.cleanup).combatOverrideCleared === true &&
      record(entry?.cleanup).preferredTargetCleared === true
    );
  });

  const selectedSourceValid =
    selectedSource === "MERCHANT_INVENTORY"
      ? selected.monsterType === null &&
        Number.isInteger(selectedItemLevel) &&
        selectedItemLevel >= 0 &&
        Array.isArray(selected.itemSlots) &&
        selected.itemSlots.length >= 3
      : typeof selected.monsterType === "string" &&
        selected.monsterType.length > 0 &&
        (!Number.isFinite(selectedItemLevel) || selectedItemLevel === 0);

  const verified = {
    preparationConfirmed:
      result.outcome === "PASS" &&
      result.reason === "COMPOUND_MATERIAL_PREPARATION_CONFIRMED",
    gatherTargetSelected:
      plan.outcome === "PASS" &&
      plan.reason === "COMPOUND_GATHER_TARGET_SELECTED" &&
      typeof selected.itemName === "string" &&
      selectedSourceValid &&
      Number.isInteger(selected.itemGrade) &&
      selected.itemGrade >= 0 &&
      selected.scrollName === `cscroll${selected.itemGrade}`,
    matchingTripleObserved:
      Number.isInteger(resultItemLevel) &&
      resultItemLevel >= 0 &&
      Number(result.finalQuantity) >= 3 &&
      record(result.evidence).threeMatchingItemsObserved === true &&
      record(result.evidence).allDeliveredItemsLevelMatched === true,
    workerEvidenceValid,
    localPreflightReady:
      record(result.evidence).localPreflightReadOnly === true &&
      record(result.evidence).compoundOperationIdle === true &&
      record(result.evidence).itemLocksClear === true &&
      record(result.evidence).scrollLocksClear === true &&
      record(result.evidence).mapAllowsCompound === true &&
      Array.isArray(result.itemLockedSlots) &&
      result.itemLockedSlots.length === 0 &&
      Array.isArray(result.scrollLockedSlots) &&
      result.scrollLockedSlots.length === 0 &&
      typeof result.runtimeMap === "string" &&
      !result.runtimeMap.toLowerCase().startsWith("bank"),
    blindRetryAvoided: record(result.evidence).blindRetryUsed === false,
    matchingItemSlotsObserved:
      Array.isArray(result.matchingItemSlots) &&
      result.matchingItemSlots.length >= 3 &&
      result.matchingItemSlots.every(
        (slot) => Number.isInteger(Number(slot)) && Number(slot) >= 0,
      ),
    matchingScrollSlotsObserved:
      Array.isArray(result.matchingScrollSlots) &&
      result.matchingScrollSlots.length >= 1 &&
      result.matchingScrollSlots.every(
        (slot) => Number.isInteger(Number(slot)) && Number(slot) >= 0,
      ),
    scrollPresent:
      Number(result.scrollQuantity) >= 1 && result.readyForCompound === true,
  };

  const passed = Object.values(verified).every((value) => value === true);
  const sourceFailed =
    result.outcome === "FAIL" ||
    result.outcome === "UNKNOWN" ||
    result.outcome === "TIMEOUT";
  return {
    ...result,
    outcome: passed
      ? "PASS"
      : result.outcome === "UNKNOWN"
      ? "UNKNOWN"
      : result.outcome === "TIMEOUT"
      ? "TIMEOUT"
      : "FAIL",
    reason: passed
      ? "COMPOUND_PREPARATION_E2E_CONFIRMED"
      : sourceFailed && typeof result.reason === "string" && result.reason
      ? result.reason
      : verified.preparationConfirmed &&
        verified.matchingTripleObserved &&
        !verified.scrollPresent
      ? "COMPOUND_PREPARATION_SCROLL_MISSING"
      : "COMPOUND_PREPARATION_EVIDENCE_INCOMPLETE",
    verifier: verified,
  };
}

async function main() {
  const merchant = process.argv[2] || DEFAULT_MERCHANT;
  const suppliedWorkers = process.argv.slice(3).filter(Boolean);
  const workers = suppliedWorkers.length ? suppliedWorkers : DEFAULT_WORKERS;

  process.stdout.write(
    `Preparing Compound live test for ${merchant} with workers ${workers.join(
      ", ",
    )}. Rangers may move, fight, loot and send one matching item each. No Compound mutation is dispatched by this command.\n`,
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runCompoundPreparation(merchant, workers);
    const result = verifyCompoundPreparation(payload.result);
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
  runCompoundPreparation,
  verifyCompoundPreparation,
};

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

function itemStateSignature(state) {
  if (!state || typeof state !== "object") return JSON.stringify(null);
  return JSON.stringify([
    Number.isInteger(state.slot) ? state.slot : null,
    typeof state.name === "string" ? state.name : null,
    Number.isInteger(state.level) ? state.level : null,
    Number.isFinite(state.quantity) ? state.quantity : null,
    state.property ?? null,
    state.present === true,
  ]);
}

function combineUpgradeSupervisorResult(source) {
  const result = record(source);
  const evidence = record(result.evidence);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);
  const before = record(result.before);
  const after = record(result.after);
  const upgrade = record(result.upgrade);
  const lastAction = record(upgrade.lastAction);

  const itemStateChanged =
    itemStateSignature(before.item) !== itemStateSignature(after.item);
  const scrollStateChanged =
    itemStateSignature(before.scroll) !== itemStateSignature(after.scroll);
  const mutationObserved = itemStateChanged || scrollStateChanged;

  const verifiedEvidence = {
    explicitTargetObserved:
      typeof result.target?.itemName === "string" &&
      !!result.target.itemName &&
      Number.isInteger(result.target?.itemSlot) &&
      typeof result.target?.scrollName === "string" &&
      !!result.target.scrollName &&
      Number.isInteger(result.target?.scrollSlot),
    inventoryIntelligenceReady: evidence.inventoryIntelligenceReady === true,
    itemDefinitionUpgradable: evidence.itemDefinitionUpgradable === true,
    itemGradeKnown: evidence.itemGradeKnown === true,
    scrollGradeCompatible: evidence.scrollGradeCompatible === true,
    itemUnprotectedBefore: evidence.itemUnprotectedBefore === true,
    scrollUnprotectedBefore: evidence.scrollUnprotectedBefore === true,
    exactCandidateSelected: evidence.exactCandidateSelected === true,
    actionDispatchedOnce: evidence.actionDispatchedOnce === true,
    actionConfirmed:
      evidence.actionConfirmed === true &&
      lastAction.status === "CONFIRMED" &&
      typeof lastAction.id === "string" &&
      !!lastAction.id,
    itemStateChanged,
    scrollStateChanged,
    mutationObserved: evidence.mutationObserved === true && mutationObserved,
    blindRetryAvoided: evidence.blindRetryAvoided === true,
    offeringOmitted: evidence.offeringOmitted === true,
    cleanupComplete:
      cleanup.inventoryConfigOverrideCleared === true &&
      cleanup.upgradeConfigOverrideCleared === true &&
      cleanup.runtimeStateRestored === true &&
      cleanup.dispatcherRestored === true,
    scopeRestricted:
      scope.upgradeMutationAllowed === true &&
      scope.irreversibleMutation === true &&
      scope.offeringMutationAllowed === false &&
      scope.compoundMutationAllowed === false &&
      scope.exchangeMutationAllowed === false &&
      scope.craftMutationAllowed === false &&
      scope.blindRetryAllowed === false &&
      scope.mutationScope === "single-upgrade-attempt-only",
  };

  const pass =
    result.outcome === "PASS" &&
    result.reason === "UPGRADE_LIVE_E2E_CONFIRMED" &&
    Object.values(verifiedEvidence).every((value) => value === true);

  if (result.outcome === "UNKNOWN") {
    return {
      ...result,
      outcome: "UNKNOWN",
      reason: "UPGRADE_LIVE_OUTCOME_UNKNOWN_NO_RETRY",
      evidence: {
        ...evidence,
        verifier: verifiedEvidence,
      },
    };
  }

  return {
    ...result,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "UPGRADE_LIVE_E2E_CONFIRMED"
      : "UPGRADE_LIVE_E2E_EVIDENCE_INCOMPLETE",
    evidence: {
      ...evidence,
      verifier: verifiedEvidence,
    },
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

async function runSupervisorLiveTest(
  character,
  itemName,
  scrollName,
  itemSlot,
) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character) +
        "/tests/upgrade",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName,
          scrollName,
          ...(Number.isInteger(itemSlot) && { itemSlot }),
        }),
      },
    ),
  );
}

async function main() {
  const character = process.argv[2] || "";
  const itemName = process.argv[3] || "";
  const scrollName = process.argv[4] || "";
  const itemSlotRaw = process.argv[5];
  const itemSlot =
    itemSlotRaw !== undefined && /^\d+$/.test(itemSlotRaw)
      ? Number(itemSlotRaw)
      : undefined;

  if (!character || !itemName || !scrollName) {
    console.error(
      "Usage: npm run test:live:upgrade -- <character> <itemName> <scrollName> [itemSlot]",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    "WARNING: this test performs one irreversible real Upgrade attempt.\n",
  );
  process.stdout.write(
    `Target: ${character} item=${itemName} scroll=${scrollName}${
      Number.isInteger(itemSlot) ? ` slot=${itemSlot}` : ""
    }\n`,
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "Temporary caracAL runtime is ready at " + baseUrl + "\n"
        : "Using existing caracAL runtime at " + baseUrl + "\n",
    );

    const payload = await runSupervisorLiveTest(
      character,
      itemName,
      scrollName,
      itemSlot,
    );
    const result = combineUpgradeSupervisorResult(payload.result);
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
  combineUpgradeSupervisorResult,
  itemStateSignature,
  runSupervisorLiveTest,
};

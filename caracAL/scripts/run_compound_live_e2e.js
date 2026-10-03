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

function verifyCompoundLiveResult(source, expected = {}) {
  const result = record(source);
  const evidence = record(result.evidence);
  const scope = record(result.scope);
  const cleanup = record(result.cleanup);
  const target = record(result.target);
  const compound = record(result.compound);
  const lastAction = record(compound.lastAction);

  const expectedSlots = normalizedSlots(expected.itemSlots);
  const observedSlots = normalizedSlots(target.itemSlots);

  const verified = {
    explicitTargetObserved:
      typeof expected.itemName === "string" &&
      target.itemName === expected.itemName &&
      typeof expected.scrollName === "string" &&
      target.scrollName === expected.scrollName &&
      !!expectedSlots &&
      !!observedSlots &&
      JSON.stringify(expectedSlots) === JSON.stringify(observedSlots),
    inventoryIntelligenceReady: evidence.inventoryIntelligenceReady === true,
    itemDefinitionCompoundable: evidence.itemDefinitionCompoundable === true,
    exactTripleObserved: evidence.exactTripleObserved === true,
    sameName: evidence.sameName === true,
    sameLevel: evidence.sameLevel === true,
    itemGradesKnown: evidence.itemGradesKnown === true,
    itemGradesMatch: evidence.itemGradesMatch === true,
    scrollGradeCompatible: evidence.scrollGradeCompatible === true,
    allItemsUnprotectedBefore: evidence.allItemsUnprotectedBefore === true,
    scrollUnprotectedBefore: evidence.scrollUnprotectedBefore === true,
    exactCandidateSelected: evidence.exactCandidateSelected === true,
    actionDispatchedOnce:
      evidence.actionDispatchedOnce === true &&
      typeof lastAction.id === "string" &&
      lastAction.id.length > 0,
    actionConfirmed:
      evidence.actionConfirmed === true && lastAction.status === "CONFIRMED",
    mutationObserved: evidence.mutationObserved === true,
    blindRetryAvoided:
      evidence.blindRetryAvoided === true && scope.blindRetryAllowed === false,
    offeringOmitted:
      evidence.offeringOmitted === true &&
      scope.offeringMutationAllowed === false,
    cleanupComplete:
      cleanup.inventoryConfigOverrideCleared === true &&
      cleanup.compoundConfigOverrideCleared === true &&
      cleanup.runtimeStateRestored === true &&
      cleanup.dispatcherRestored === true,
    scopeRestricted:
      scope.upgradeMutationAllowed === false &&
      scope.compoundMutationAllowed === true &&
      scope.irreversibleMutation === true &&
      scope.exchangeMutationAllowed === false &&
      scope.craftMutationAllowed === false &&
      scope.mutationScope === "single-compound-attempt-only",
  };

  const pass =
    result.outcome === "PASS" &&
    result.reason === "COMPOUND_LIVE_E2E_CONFIRMED" &&
    Object.values(verified).every((value) => value === true);

  if (result.outcome === "UNKNOWN") {
    return {
      ...result,
      reason: result.reason || "COMPOUND_LIVE_OUTCOME_UNKNOWN_NO_RETRY",
      verifier: verified,
    };
  }

  if (result.outcome === "TIMEOUT") {
    return {
      ...result,
      verifier: verified,
    };
  }

  return {
    ...result,
    outcome: pass ? "PASS" : "FAIL",
    reason: pass
      ? "COMPOUND_LIVE_E2E_CONFIRMED"
      : "COMPOUND_LIVE_E2E_EVIDENCE_INCOMPLETE",
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

async function runSupervisorLiveTest(
  character,
  itemName,
  itemSlots,
  scrollName,
) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character) +
        "/tests/compound",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemName,
          itemSlots,
          scrollName,
        }),
      },
    ),
  );
}

async function main() {
  const character = process.argv[2] || "";
  const itemName = process.argv[3] || "";
  const rawSlots = [process.argv[4], process.argv[5], process.argv[6]];
  const itemSlots = normalizedSlots(rawSlots);
  const scrollName = process.argv[7] || "";

  if (!character || !itemName || !itemSlots || !scrollName) {
    console.error(
      "Usage: npm run test:live:compound -- <character> <itemName> <slot1> <slot2> <slot3> <scrollName>",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(
    "WARNING: this test performs exactly one irreversible real Compound attempt.\n",
  );
  process.stdout.write(
    `Target: ${character} item=${itemName} slots=${itemSlots.join(
      ",",
    )} scroll=${scrollName}\n`,
  );
  process.stdout.write(
    "UNKNOWN is terminal for this run: do not repeat the command until state is independently reconciled.\n",
  );

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const payload = await runSupervisorLiveTest(
      character,
      itemName,
      itemSlots,
      scrollName,
    );
    const result = verifyCompoundLiveResult(payload.result, {
      itemName,
      itemSlots,
      scrollName,
    });
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
  normalizedSlots,
  runSupervisorLiveTest,
  verifyCompoundLiveResult,
};

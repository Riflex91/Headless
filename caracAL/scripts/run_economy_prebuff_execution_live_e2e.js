"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const {
  readState,
  waitForGearScoringCharacter,
} = require("./run_gear_scoring_live_e2e");

const BASE_URL = "http://127.0.0.1:924";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function parseExpectedSlots(kind, raw) {
  const expectedCount = kind === "COMPOUND" ? 3 : 1;
  const values = String(raw || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0)
    .sort((left, right) => left - right);

  if (
    values.length !== expectedCount ||
    new Set(values).size !== expectedCount
  ) {
    return null;
  }
  return values;
}

async function readJson(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error("Invalid JSON response from Headless dashboard");
  }
  if (!response.ok) {
    const error = new Error(
      payload.message || payload.error || "HTTP request failed",
    );
    error.code = payload.error || "HTTP_REQUEST_FAILED";
    throw error;
  }
  return payload;
}

async function runEconomyPrebuffExecutionSupervisorLiveTest(
  characterName,
  expected,
) {
  return readJson(
    await fetch(
      BASE_URL +
        "/headless/api/characters/" +
        encodeURIComponent(characterName) +
        "/tests/economy-prebuff-execution",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedKind: expected.kind,
          expectedName: expected.name,
          expectedSlots: expected.slots,
        }),
      },
    ),
  );
}

function coupledExecutionEvidence(result) {
  const source = record(result);
  const child = record(source.coupledExecution);
  const execution = record(child.execution);
  const childEvidence = record(child.evidence);
  const childScope = record(child.scope);
  const childCleanup = record(child.cleanup);
  const supervisorScope = record(source.scope);
  const supervisorCleanup = record(source.cleanup);
  const prebuffAction = record(execution.prebuffAction);
  const economyAction = record(execution.economyAction);

  return {
    supervisorPassed: source.outcome === "PASS",
    supervisorReasonMatches:
      source.reason === "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    childPassed: child.outcome === "PASS",
    childReasonMatches:
      child.reason === "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED",
    explicitExpectationValid: childEvidence.explicitExpectationValid === true,
    riskPolicyReady: childEvidence.riskPolicyReady === true,
    riskPolicyUnknownClear: childEvidence.riskPolicyUnknownClear === true,
    expectedCandidateMatched: childEvidence.expectedCandidateMatched === true,
    prebuffReady: childEvidence.prebuffReady === true,
    prebuffDemandMatched: childEvidence.prebuffDemandMatched === true,
    selectedSkillPresent: childEvidence.selectedSkillPresent === true,
    arbiterEnforcementObserved:
      childEvidence.arbiterEnforcementObserved === true,
    prebuffActionConfirmed:
      childEvidence.prebuffActionConfirmed === true &&
      prebuffAction.status === "CONFIRMED",
    economyActionConfirmed:
      childEvidence.economyActionConfirmed === true &&
      economyAction.status === "CONFIRMED",
    exactKindExecuted: childEvidence.exactKindExecuted === true,
    exactNameExecuted: childEvidence.exactNameExecuted === true,
    inventoryMutationObserved: childEvidence.inventoryMutationObserved === true,
    oneValueMutationMaximum:
      childEvidence.oneValueMutationMaximum === true &&
      Number(execution.policy?.maxValueMutations) === 1 &&
      Number(childScope.maxValueMutations) === 1 &&
      Number(supervisorScope.maxValueMutations) === 1,
    blindRetryAvoided:
      childEvidence.blindRetryAvoided === true &&
      execution.policy?.blindRetryAllowed === false &&
      childScope.blindRetryAllowed === false &&
      supervisorScope.blindRetryAllowed === false,
    unknownHoldClear: execution.unknownStage == null,
    irreversibleMutationScoped:
      childScope.irreversibleMutation === true &&
      supervisorScope.irreversibleMutationAllowed === true,
    exchangeAndCraftBlocked:
      childScope.exchangeMutationAllowed === false &&
      childScope.craftMutationAllowed === false &&
      supervisorScope.exchangeMutationForced === false &&
      supervisorScope.craftMutationForced === false,
    arbiterOverrideCleared: childCleanup.arbiterConfigOverrideCleared === true,
    arbiterEnforcementRestored:
      childCleanup.arbiterEnforcementRestored === true,
    verificationPolicyOverrideCleared:
      childCleanup.verificationPolicyConfigOverrideCleared === true,
    verificationPolicyPlanningRestored:
      childCleanup.verificationPolicyPlanningRestored === true,
    prebuffVerificationOverrideCleared:
      childCleanup.prebuffVerificationConfigOverrideCleared === true,
    prebuffVerificationPlanningRestored:
      childCleanup.prebuffVerificationPlanningRestored === true,
    equipmentBaselineRestored:
      supervisorCleanup.equipmentBaselineRestored === true,
    runtimeStateRestored: supervisorCleanup.runtimeStateRestored === true,
  };
}

function evidenceComplete(evidence) {
  return Object.values(evidence).every((value) => value === true);
}

function combineEconomyPrebuffExecutionSupervisorResult(result) {
  const source = record(result);
  const evidence = coupledExecutionEvidence(source);
  const passed = evidenceComplete(evidence);

  return {
    ...source,
    outcome: passed ? "PASS" : "FAIL",
    reason: passed
      ? "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED"
      : "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_EVIDENCE_INCOMPLETE",
    evidence,
  };
}

async function main() {
  const requestedCharacter = process.argv[2] || null;
  const kind = String(process.argv[3] || "")
    .trim()
    .toUpperCase();
  const name = String(process.argv[4] || "").trim();
  const slots = parseExpectedSlots(kind, process.argv[5]);

  if (!["UPGRADE", "COMPOUND"].includes(kind) || !name || !slots) {
    console.error(
      "Usage: npm run test:live:economy-prebuff-execution -- <character> <UPGRADE|COMPOUND> <itemName> <slot[,slot,slot]>",
    );
    process.exitCode = 2;
    return;
  }

  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const selected = await waitForGearScoringCharacter(requestedCharacter, {
      initialState: dashboard.state,
    });
    process.stdout.write(
      "WARNING: this test may perform one irreversible value mutation.\n",
    );
    process.stdout.write(
      "Expected target: " +
        kind +
        " " +
        name +
        " slots=" +
        slots.join(",") +
        "\n",
    );
    const payload = await runEconomyPrebuffExecutionSupervisorLiveTest(
      selected.name,
      { kind, name, slots },
    );
    const result = combineEconomyPrebuffExecutionSupervisorResult(
      payload.result,
    );
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
  combineEconomyPrebuffExecutionSupervisorResult,
  coupledExecutionEvidence,
  evidenceComplete,
  parseExpectedSlots,
  runEconomyPrebuffExecutionSupervisorLiveTest,
};

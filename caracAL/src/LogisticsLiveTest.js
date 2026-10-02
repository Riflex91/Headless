"use strict";

function orderedByPriority(claims) {
  for (let index = 1; index < claims.length; index += 1) {
    const previous = Number(claims[index - 1]?.priority);
    const current = Number(claims[index]?.priority);
    if (Number.isFinite(previous) && Number.isFinite(current) && current > previous) {
      return false;
    }
  }
  return true;
}

function claimRouteValid(claim) {
  const merchant = claim?.merchant?.name;
  const farmer = claim?.farmer;
  if (typeof merchant !== "string" || !merchant) return false;
  if (typeof farmer !== "string" || !farmer) return false;

  const outbound = ["MLUCK", "POTION_DELIVERY", "ITEM_DELIVERY", "GEAR_DELIVERY"].includes(
    claim?.type,
  );
  const inbound = ["GOLD_PICKUP", "INVENTORY_PRESSURE"].includes(claim?.type);
  if (!outbound && !inbound) return false;

  const expectedDirection = outbound
    ? merchant + "->" + farmer
    : farmer + "->" + merchant;
  return claim.direction === expectedDirection;
}

function logisticsLiveTestEvidence(events = [], context = {}) {
  const runtimeEvents = (events || []).filter(
    (event) => event?.source === "bot_runtime",
  );
  const types = runtimeEvents.map((event) => event.type);
  const completed = runtimeEvents
    .slice()
    .reverse()
    .find(
      (event) =>
        event?.module === "LogisticsLiveTest" &&
        event?.type === "LOGISTICS_LIVE_TEST_COMPLETED",
    );
  const runtimeResult = completed?.data?.result || null;
  const board = context.board || {};
  const claims = Array.isArray(board.claims) ? board.claims : [];
  const suppressed = Array.isArray(board.suppressed) ? board.suppressed : [];
  const planner = context.planner || {};
  const holds = Array.isArray(planner.outcomeHolds)
    ? planner.outcomeHolds
    : [];
  const uncertainHolds = holds.filter(
    (hold) => hold?.outcome === "UNKNOWN" || hold?.outcome === "DISPATCHED",
  );
  const execution = context.execution || {};
  const account = context.account || {};

  return {
    runtimeTestStarted: types.includes("LOGISTICS_LIVE_TEST_STARTED"),
    runtimeTestCompleted: types.includes("LOGISTICS_LIVE_TEST_COMPLETED"),
    runtimeProbeBlocked:
      runtimeResult?.safetyProbe?.outcome === "BLOCKED" &&
      runtimeResult?.safetyProbe?.reason === "CLAIM_SELF_TRANSFER_BLOCKED" &&
      runtimeResult?.safetyProbe?.actionId === null,
    inventoryProjectionVisible:
      runtimeResult?.inventory?.state === "READY" ||
      runtimeResult?.inventory?.state === "EMPTY",
    inventorySafetyConfirmed:
      runtimeResult?.inventory?.allEntriesExplained === true &&
      runtimeResult?.inventory?.unknownItemsProtected === true,
    merchantIndependent: board.merchantIndependent === true,
    merchantAccountDetected: Number(account.merchantCount) > 0,
    farmerAccountDetected: Number(account.farmerCount) > 0,
    boardMerchantCount: Array.isArray(board.merchants)
      ? board.merchants.length
      : 0,
    claimCount: claims.length,
    readyClaims: claims.filter((claim) => claim?.status === "READY").length,
    claimsObserved: claims.length > 0,
    claimsNotForced: claims.length === 0,
    claimsPriorityOrdered: orderedByPriority(claims),
    claimRoutingValid: claims.every(claimRouteValid),
    antiPingPongStateVisible: Array.isArray(planner.transferHistory),
    antiPingPongSuppressions: suppressed.filter(
      (claim) => claim?.suppressionReason === "ANTI_PINGPONG",
    ).length,
    unknownHoldCount: uncertainHolds.length,
    unknownNoRetryObserved: uncertainHolds.length > 0,
    unknownNoRetryNotForced: uncertainHolds.length === 0,
    unknownHoldsSuppressed: uncertainHolds.every((hold) => {
      if (hold?.retryAt !== null) return false;
      const matchingCandidate = [...claims, ...suppressed].find(
        (claim) => claim?.id === hold?.id,
      );
      return (
        !matchingCandidate ||
        (matchingCandidate.suppressionReason === "OUTCOME_UNCERTAIN" &&
          matchingCandidate.status === "SUPPRESSED")
      );
    }),
    executionEligibility: execution,
    dispatcherSuppressedDuringTest:
      context.dispatcherSuppressedDuringTest === true,
  };
}

function evidenceComplete(evidence) {
  return (
    evidence.runtimeTestStarted === true &&
    evidence.runtimeTestCompleted === true &&
    evidence.runtimeProbeBlocked === true &&
    evidence.inventoryProjectionVisible === true &&
    evidence.inventorySafetyConfirmed === true &&
    evidence.merchantIndependent === true &&
    evidence.merchantAccountDetected === true &&
    evidence.farmerAccountDetected === true &&
    evidence.claimsPriorityOrdered === true &&
    evidence.claimRoutingValid === true &&
    evidence.antiPingPongStateVisible === true &&
    evidence.unknownHoldsSuppressed === true &&
    evidence.dispatcherSuppressedDuringTest === true
  );
}

function combineLogisticsLiveTestResult(runtimeResult, evidence) {
  if (runtimeResult?.outcome !== "PASS") return runtimeResult;
  if (evidenceComplete(evidence)) {
    return {
      ...runtimeResult,
      outcome: "PASS",
      reason: "LOGISTICS_LIVE_E2E_CONFIRMED",
    };
  }
  return {
    ...runtimeResult,
    outcome: "FAIL",
    reason: "SUPERVISOR_LOGISTICS_EVIDENCE_INCOMPLETE",
  };
}

function logisticsLiveTestDiagnostics(
  runtimeResult,
  {
    character = null,
    originalDesiredState = null,
    startState = null,
    evidence = null,
    board = null,
    planner = null,
    incidentId = null,
  } = {},
) {
  const runtime = runtimeResult || {};
  const supervisor = evidence || {};
  return {
    test_id: runtime.requestId || runtime.request_id || null,
    character: character || runtime.character?.name || null,
    start_state: startState || {
      desired_runtime_state: originalDesiredState,
    },
    navigation: {
      required: false,
      reason: "LOGISTICS_READ_ONLY_LIVE_SCOPE",
    },
    live_evidence: {
      runtime: {
        character: runtime.character || null,
        inventory: runtime.inventory || null,
        safetyProbe: runtime.safetyProbe || null,
      },
      supervisor,
      logisticsBoard: board,
      planner,
    },
    expected: {
      account_logistics_board_visible: true,
      merchant_independent: true,
      merchant_detected: true,
      farmer_detected: true,
      claim_priority_and_routing_valid_when_present: true,
      anti_pingpong_state_visible: true,
      unknown_no_blind_retry: true,
      runtime_ipc_confirmed: true,
      dispatcher_suppressed_during_test: true,
      send_item_forced: false,
      send_gold_forced: false,
      mluck_forced: false,
      value_mutation_forced: false,
      original_runtime_state_restored: true,
    },
    observed: {
      claims_observed: supervisor.claimsObserved === true,
      claims_not_forced: supervisor.claimsNotForced === true,
      claim_count: supervisor.claimCount ?? null,
      ready_claims: supervisor.readyClaims ?? null,
      anti_pingpong_suppressions:
        supervisor.antiPingPongSuppressions ?? null,
      unknown_hold_count: supervisor.unknownHoldCount ?? null,
      unknown_no_retry_not_forced:
        supervisor.unknownNoRetryNotForced === true,
      supervisor_evidence_complete: evidenceComplete(supervisor),
    },
    result: {
      outcome: runtime.outcome || "UNKNOWN",
      reason: runtime.reason || null,
    },
    duration: runtime.durationMs ?? null,
    incident_id: incidentId,
    scope: runtime.scope || null,
    cleanup: runtime.cleanup || null,
  };
}

module.exports = {
  combineLogisticsLiveTestResult,
  logisticsLiveTestDiagnostics,
  logisticsLiveTestEvidence,
};

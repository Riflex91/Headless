"use strict";

const {
  ensureDashboardAvailable,
  startManagedRuntime,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const {
  readState,
  runGearScoringSupervisorLiveTest,
  waitForGearScoringCharacter,
} = require("./run_gear_scoring_live_e2e");

const baseUrl = String(
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924",
).replace(/\/$/, "");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function diagnosticInventoryEntry(value) {
  const entry = record(value);
  return {
    slot: nonNegativeInteger(entry.slot),
    name:
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : null,
    level: finiteNumber(entry.level),
    disposition:
      typeof entry.disposition === "string" ? entry.disposition : null,
    protected: entry.protected === true,
    protections: array(entry.protections).filter(
      (protection) => typeof protection === "string",
    ),
    why: typeof entry.why === "string" ? entry.why : null,
  };
}

function diagnosticDecision(value) {
  const decision = record(value);
  const slots = array(decision.itemSlots)
    .map((slot) => Number(slot))
    .filter((slot) => Number.isInteger(slot) && slot >= 0)
    .sort((left, right) => left - right);
  return {
    itemSlot: nonNegativeInteger(decision.itemSlot),
    itemSlots: slots,
    name:
      typeof decision.name === "string" && decision.name.trim()
        ? decision.name.trim()
        : null,
    currentLevel: finiteNumber(decision.currentLevel),
    eligible: decision.eligible === true,
    reason: typeof decision.reason === "string" ? decision.reason : null,
    protections: array(decision.protections).filter(
      (protection) => typeof protection === "string",
    ),
    maxLevel: finiteNumber(decision.maxLevel),
    itemGrade: finiteNumber(decision.itemGrade),
    scrollName:
      typeof decision.scrollName === "string" ? decision.scrollName : null,
    scrollSlot: nonNegativeInteger(decision.scrollSlot),
  };
}

function diagnosticsFor(after) {
  const inventory = record(after.inventoryIntelligence);
  const upgrade = record(after.upgrade);
  const compound = record(after.compound);
  const expectedValue = record(after.expectedValue);
  const riskPolicy = record(after.riskPolicy);
  const economyPrebuff = record(after.economyPrebuff);

  return {
    inventoryIntelligence: {
      state: inventory.state || null,
      reason: inventory.reason || null,
      summary: record(inventory.summary),
      entries: array(inventory.entries).map(diagnosticInventoryEntry),
    },
    upgrade: {
      state: upgrade.state || null,
      reason: upgrade.reason || null,
      summary: record(upgrade.summary),
      decisions: array(upgrade.decisions).map(diagnosticDecision),
    },
    compound: {
      state: compound.state || null,
      reason: compound.reason || null,
      summary: record(compound.summary),
      decisions: array(compound.decisions).map(diagnosticDecision),
    },
    expectedValue: {
      state: expectedValue.state || null,
      reason: expectedValue.reason || null,
      summary: record(expectedValue.summary),
    },
    riskPolicy: {
      state: riskPolicy.state || null,
      reason: riskPolicy.reason || null,
      summary: record(riskPolicy.summary),
    },
    economyPrebuff: {
      state: economyPrebuff.state || null,
      reason: economyPrebuff.reason || null,
      selectedSkill: economyPrebuff.selectedSkill || null,
      demand: record(economyPrebuff.demand),
    },
  };
}

function verificationPolicyCandidates(result) {
  const after = record(record(result).after);
  const upgrade = record(after.upgrade);
  const compound = record(after.compound);
  const candidates = [];

  for (const rawDecision of array(upgrade.decisions)) {
    const decision = diagnosticDecision(rawDecision);
    if (
      ![
        "UPGRADE_MAX_LEVEL_POLICY_MISSING",
        "UPGRADE_SCROLL_POLICY_MISSING",
      ].includes(decision.reason) ||
      decision.itemSlot === null ||
      !decision.name ||
      decision.protections.length > 0
    ) {
      continue;
    }

    candidates.push({
      kind: "UPGRADE",
      name: decision.name,
      slots: [decision.itemSlot],
    });
  }

  for (const rawDecision of array(compound.decisions)) {
    const decision = diagnosticDecision(rawDecision);
    if (
      ![
        "COMPOUND_MAX_LEVEL_POLICY_MISSING",
        "COMPOUND_SCROLL_POLICY_MISSING",
      ].includes(decision.reason) ||
      decision.itemSlots.length !== 3 ||
      new Set(decision.itemSlots).size !== 3 ||
      !decision.name ||
      decision.protections.length > 0
    ) {
      continue;
    }

    candidates.push({
      kind: "COMPOUND",
      name: decision.name,
      slots: [...decision.itemSlots].sort((left, right) => left - right),
    });
  }

  return candidates.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.slots[0] - right.slots[0] ||
      left.name.localeCompare(right.name),
  );
}

async function readJson(responsePromise) {
  const response = await responsePromise;
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  if (!response.ok) {
    throw new Error(
      body?.message ||
        body?.error ||
        "HTTP " + response.status + " from caracAL dashboard",
    );
  }
  return body;
}

async function runReadOnlyCoupledCandidatePreflight(character, candidate) {
  return readJson(
    fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character) +
        "/tests/economy-prebuff-execution",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedKind: candidate.kind,
          expectedName: candidate.name,
          expectedSlots: candidate.slots,
          preflightOnly: true,
        }),
      },
    ),
  );
}

function normalizeVerificationPolicyPreflight(
  result,
  characterName,
  expected,
  diagnostics,
) {
  const source = record(result);
  const child = record(source.coupledExecution);
  const before = record(child.before);
  const risk = record(before.riskPolicy);
  const summary = record(risk.summary);
  const selected = record(risk.selected);
  const prebuff = record(before.economyPrebuff);
  const demand = record(prebuff.demand);
  const childScope = record(child.scope);
  const childCleanup = record(child.cleanup);
  const supervisorScope = record(source.scope);
  const supervisorCleanup = record(source.cleanup);
  const slots = array(selected.itemSlots)
    .map((slot) => Number(slot))
    .filter((slot) => Number.isInteger(slot) && slot >= 0)
    .sort((left, right) => left - right);
  const expectedSlots = [...expected.slots].sort((left, right) => left - right);
  const candidateMatched =
    selected.decision === "ALLOW" &&
    selected.kind === expected.kind &&
    selected.name === expected.name &&
    JSON.stringify(slots) === JSON.stringify(expectedSlots);
  const preflightConfirmed =
    source.outcome === "PASS" &&
    child.outcome === "PASS" &&
    child.reason === "ECONOMY_PREBUFF_EXECUTION_LIVE_PREFLIGHT_CONFIRMED" &&
    child.execution == null &&
    childScope.readOnly === true &&
    supervisorScope.readOnly === true &&
    supervisorScope.prebuffMutationForced === false &&
    supervisorScope.valueMutationForced === false &&
    risk.state === "READY" &&
    Number(summary.unknown) === 0 &&
    candidateMatched &&
    prebuff.state === "READY" &&
    demand.kind === expected.kind &&
    demand.name === expected.name &&
    Number(demand.unknown) === 0 &&
    typeof prebuff.selectedSkill === "string" &&
    prebuff.selectedSkill.length > 0 &&
    childCleanup.verificationPolicyConfigOverrideCleared === true &&
    childCleanup.verificationPolicyPlanningRestored === true &&
    childCleanup.prebuffVerificationConfigOverrideCleared === true &&
    childCleanup.prebuffVerificationPlanningRestored === true &&
    supervisorCleanup.equipmentBaselineRestored === true &&
    supervisorCleanup.runtimeStateRestored === true;

  if (!preflightConfirmed) {
    return {
      outcome: "NO_CANDIDATE",
      reason: "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_POLICY_NOT_READY",
      character: characterName,
      expected,
      riskPolicyState: risk.state || null,
      riskPolicyReason: risk.reason || null,
      prebuffState: prebuff.state || null,
      prebuffReason: prebuff.reason || null,
      selectedSkill: prebuff.selectedSkill || null,
      diagnostics,
      candidate: null,
      command: null,
      scope: {
        readOnly: true,
        mutationDispatched: false,
      },
    };
  }

  const slotArgument = slots.join(",");
  return {
    outcome: "READY",
    reason: "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_READY",
    character: characterName,
    riskPolicyState: risk.state,
    riskPolicyReason: risk.reason || null,
    prebuffState: prebuff.state,
    prebuffReason: prebuff.reason || null,
    selectedSkill: prebuff.selectedSkill,
    diagnostics,
    verificationPolicy: {
      temporary: true,
      exactTarget: true,
      cleanupConfirmed: true,
      temporaryPrebuffSkills: true,
      prebuffCleanupConfirmed: true,
    },
    candidate: {
      kind: selected.kind,
      name: selected.name,
      slots,
      currentLevel: finiteNumber(selected.currentLevel),
      targetLevel: finiteNumber(selected.targetLevel),
      expectedDeltaGold: finiteNumber(selected.expectedDeltaGold),
      successProbability: finiteNumber(selected.successProbability),
      failureLossGold: finiteNumber(selected.failureLossGold),
    },
    command:
      "npm run test:live:economy-prebuff-execution -- " +
      characterName +
      " " +
      selected.kind +
      " " +
      selected.name +
      " " +
      slotArgument,
    scope: {
      readOnly: true,
      mutationDispatched: false,
    },
  };
}

function normalizeCandidate(result, characterName) {
  const source = record(result);
  const after = record(source.after);
  const risk = record(after.riskPolicy);
  const summary = record(risk.summary);
  const selected = record(risk.selected);
  const prebuff = record(after.economyPrebuff);
  const demand = record(prebuff.demand);
  const diagnostics = diagnosticsFor(after);

  const kind =
    selected.kind === "UPGRADE" || selected.kind === "COMPOUND"
      ? selected.kind
      : null;
  const name =
    typeof selected.name === "string" && selected.name.trim()
      ? selected.name.trim()
      : null;
  const slots = Array.isArray(selected.itemSlots)
    ? selected.itemSlots
        .map((slot) => Number(slot))
        .filter((slot) => Number.isInteger(slot) && slot >= 0)
        .sort((left, right) => left - right)
    : [];
  const expectedCount = kind === "COMPOUND" ? 3 : kind === "UPGRADE" ? 1 : 0;
  const uniqueSlots =
    slots.length === expectedCount && new Set(slots).size === expectedCount;
  const riskReady =
    risk.state === "READY" &&
    Number(summary.unknown || 0) === 0 &&
    selected.decision === "ALLOW";
  const prebuffReady =
    prebuff.state === "READY" &&
    typeof prebuff.selectedSkill === "string" &&
    prebuff.selectedSkill.length > 0 &&
    demand.kind === kind &&
    demand.name === name &&
    Number(demand.unknown || 0) === 0;

  if (!riskReady || !prebuffReady || !kind || !name || !uniqueSlots) {
    return {
      outcome: "NO_CANDIDATE",
      reason:
        Number(summary.unknown || 0) > 0 || risk.state === "PARTIAL"
          ? "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_UNKNOWN"
          : "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_NO_READY_CANDIDATE",
      character: characterName,
      riskPolicyState: risk.state || null,
      riskPolicyReason: risk.reason || null,
      prebuffState: prebuff.state || null,
      prebuffReason: prebuff.reason || null,
      selectedSkill: prebuff.selectedSkill || null,
      diagnostics,
      candidate: null,
      command: null,
      scope: {
        readOnly: true,
        mutationDispatched: false,
      },
    };
  }

  const slotArgument = slots.join(",");
  const command =
    "npm run test:live:economy-prebuff-execution -- " +
    characterName +
    " " +
    kind +
    " " +
    name +
    " " +
    slotArgument;

  return {
    outcome: "READY",
    reason: "ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_READY",
    character: characterName,
    riskPolicyState: risk.state,
    riskPolicyReason: risk.reason || null,
    prebuffState: prebuff.state,
    prebuffReason: prebuff.reason || null,
    selectedSkill: prebuff.selectedSkill,
    diagnostics,
    candidate: {
      kind,
      name,
      slots,
      currentLevel: Number.isFinite(Number(selected.currentLevel))
        ? Number(selected.currentLevel)
        : null,
      targetLevel: Number.isFinite(Number(selected.targetLevel))
        ? Number(selected.targetLevel)
        : null,
      expectedDeltaGold: Number.isFinite(Number(selected.expectedDeltaGold))
        ? Number(selected.expectedDeltaGold)
        : null,
      successProbability: Number.isFinite(Number(selected.successProbability))
        ? Number(selected.successProbability)
        : null,
      failureLossGold: Number.isFinite(Number(selected.failureLossGold))
        ? Number(selected.failureLossGold)
        : null,
    },
    command,
    scope: {
      readOnly: true,
      mutationDispatched: false,
    },
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  let requestedCharacter = null;
  let verbose = false;
  let clearScreen = true;

  for (const arg of argv) {
    if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--no-clear") {
      clearScreen = false;
    } else if (!arg.startsWith("--") && requestedCharacter === null) {
      requestedCharacter = arg;
    }
  }

  return {
    requestedCharacter,
    verbose,
    clearScreen,
  };
}

function compactAttemptLine(attempt) {
  const source = record(attempt);
  const candidate = record(source.candidate);
  const slots = array(candidate.slots).join(",");
  const target = [
    candidate.kind || "UNKNOWN",
    candidate.name || "unknown",
    slots ? "[" + slots + "]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const risk =
    (source.riskPolicyState || "UNKNOWN") +
    (source.riskPolicyReason ? " (" + source.riskPolicyReason + ")" : "");
  const prebuff =
    (source.prebuffState || "UNKNOWN") +
    (source.prebuffReason ? " (" + source.prebuffReason + ")" : "");

  return "  - " + target + ": risk=" + risk + "; prebuff=" + prebuff;
}

function formatCompactResult(result) {
  const source = record(result);
  const candidate = record(source.candidate);
  const policy = record(source.verificationPolicy);
  const attempts = array(source.verificationPolicyAttempts);
  const scope = record(source.scope);
  const lines = [
    "Economy Prebuff Execution Preflight",
    "Outcome: " + (source.outcome || "UNKNOWN"),
    "Reason: " + (source.reason || "UNKNOWN"),
    "Character: " + (source.character || "UNKNOWN"),
    "Risk Policy: " +
      (source.riskPolicyState || "UNKNOWN") +
      (source.riskPolicyReason
        ? " (" + source.riskPolicyReason + ")"
        : ""),
    "Prebuff: " +
      (source.prebuffState || "UNKNOWN") +
      (source.prebuffReason ? " (" + source.prebuffReason + ")" : ""),
    "Selected skill: " + (source.selectedSkill || "none"),
  ];

  if (candidate.kind && candidate.name) {
    const slots = array(candidate.slots).join(",");
    lines.push(
      "Candidate: " +
        candidate.kind +
        " " +
        candidate.name +
        (slots ? " [" + slots + "]" : ""),
    );
    if (
      finiteNumber(candidate.currentLevel) !== null ||
      finiteNumber(candidate.targetLevel) !== null
    ) {
      lines.push(
        "Level: " +
          String(finiteNumber(candidate.currentLevel) ?? "?") +
          " -> " +
          String(finiteNumber(candidate.targetLevel) ?? "?"),
      );
    }
    if (finiteNumber(candidate.expectedDeltaGold) !== null) {
      lines.push("Expected delta gold: " + String(candidate.expectedDeltaGold));
    }
    if (finiteNumber(candidate.successProbability) !== null) {
      lines.push(
        "Success probability: " + String(candidate.successProbability),
      );
    }
  } else if (attempts.length > 0) {
    lines.push("Verification attempts: " + attempts.length);
    for (const attempt of attempts) {
      lines.push(compactAttemptLine(attempt));
    }
  }

  if (
    policy.cleanupConfirmed === true ||
    policy.prebuffCleanupConfirmed === true
  ) {
    lines.push(
      "Temporary policy cleanup: " +
        (policy.cleanupConfirmed === true &&
        policy.prebuffCleanupConfirmed === true
          ? "confirmed"
          : "incomplete"),
    );
  }

  lines.push(
    "Read-only: " + (scope.readOnly === true ? "yes" : "no"),
    "Mutation dispatched: " +
      (scope.mutationDispatched === true ? "yes" : "no"),
  );

  if (typeof source.command === "string" && source.command) {
    lines.push("", "Exact guarded mutation command:", source.command);
  }

  return lines.join("\n") + "\n";
}

function clearInteractiveTerminal() {
  if (process.stdout.isTTY) {
    process.stdout.write("\u001b[2J\u001b[H");
  }
}

async function main() {
  const { requestedCharacter, verbose, clearScreen } = parseCliArgs();
  const dashboard = await ensureDashboardAvailable(
    readState,
    verbose
      ? {}
      : {
          quiet: true,
          startRuntime: () =>
            startManagedRuntime({
              stdio: ["ignore", "ignore", "ignore"],
              windowsHide: true,
            }),
        },
  );
  const managedRuntime = dashboard.runtime;
  let result = null;

  try {
    const selected = await waitForGearScoringCharacter(requestedCharacter, {
      initialState: dashboard.state,
    });

    if (verbose) {
      process.stdout.write(
        "Running read-only coupled Economy Prebuff execution preflight with " +
          selected.name +
          "\n",
      );
    }

    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      Number(
        process.env.CARACAL_ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_SETTLE_MS ||
          1750,
      ),
    );
    result = normalizeCandidate(payload.result, selected.name);

    if (result.outcome !== "READY") {
      const candidates = verificationPolicyCandidates(payload.result);
      const attempts = [];

      for (const candidate of candidates) {
        const probePayload = await runReadOnlyCoupledCandidatePreflight(
          selected.name,
          candidate,
        );
        const probe = normalizeVerificationPolicyPreflight(
          probePayload.result,
          selected.name,
          candidate,
          result.diagnostics,
        );
        attempts.push({
          candidate,
          outcome: probe.outcome,
          reason: probe.reason,
          riskPolicyState: probe.riskPolicyState,
          riskPolicyReason: probe.riskPolicyReason,
          prebuffState: probe.prebuffState,
          prebuffReason: probe.prebuffReason,
        });
        if (probe.outcome === "READY") {
          result = {
            ...probe,
            verificationPolicyAttempts: attempts,
          };
          break;
        }
      }

      if (result.outcome !== "READY" && attempts.length > 0) {
        result = {
          ...result,
          verificationPolicyAttempts: attempts,
        };
      }
    }
  } finally {
    if (managedRuntime) {
      if (verbose) {
        process.stdout.write("Stopping temporary caracAL runtime\n");
      }
      await stopManagedRuntime(managedRuntime);
    }
  }

  if (!result) {
    throw new Error("Economy Prebuff execution preflight returned no result");
  }

  if (verbose) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.outcome === "READY" && result.command) {
      process.stdout.write("\nExact guarded mutation command:\n");
      process.stdout.write(result.command + "\n");
    }
    return;
  }

  if (clearScreen) {
    clearInteractiveTerminal();
  }
  process.stdout.write(formatCompactResult(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  compactAttemptLine,
  formatCompactResult,
  normalizeCandidate,
  normalizeVerificationPolicyPreflight,
  parseCliArgs,
  runReadOnlyCoupledCandidatePreflight,
  verificationPolicyCandidates,
};

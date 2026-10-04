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

function array(value) {
  return Array.isArray(value) ? value : [];
}

function diagnosticInventoryEntry(value) {
  const entry = record(value);
  return {
    slot: Number.isInteger(Number(entry.slot)) ? Number(entry.slot) : null,
    name:
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : null,
    level: Number.isFinite(Number(entry.level)) ? Number(entry.level) : null,
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
  const itemSlot = Number(decision.itemSlot);

  return {
    itemSlot:
      Number.isInteger(itemSlot) && itemSlot >= 0 ? itemSlot : null,
    itemSlots: slots,
    name:
      typeof decision.name === "string" && decision.name.trim()
        ? decision.name.trim()
        : null,
    currentLevel: Number.isFinite(Number(decision.currentLevel))
      ? Number(decision.currentLevel)
      : null,
    eligible: decision.eligible === true,
    reason: typeof decision.reason === "string" ? decision.reason : null,
    protections: array(decision.protections).filter(
      (protection) => typeof protection === "string",
    ),
    maxLevel: Number.isFinite(Number(decision.maxLevel))
      ? Number(decision.maxLevel)
      : null,
    itemGrade: Number.isFinite(Number(decision.itemGrade))
      ? Number(decision.itemGrade)
      : null,
    scrollName:
      typeof decision.scrollName === "string" ? decision.scrollName : null,
    scrollSlot: Number.isFinite(Number(decision.scrollSlot))
      ? Number(decision.scrollSlot)
      : null,
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

async function main() {
  const requestedCharacter = process.argv[2] || null;
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    const selected = await waitForGearScoringCharacter(requestedCharacter, {
      initialState: dashboard.state,
    });
    process.stdout.write(
      "Running read-only coupled Economy Prebuff execution preflight with " +
        selected.name +
        "\n",
    );

    const payload = await runGearScoringSupervisorLiveTest(
      selected.name,
      Number(
        process.env.CARACAL_ECONOMY_PREBUFF_EXECUTION_PREFLIGHT_SETTLE_MS ||
          1750,
      ),
    );
    const result = normalizeCandidate(payload.result, selected.name);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");

    if (result.outcome === "READY" && result.command) {
      process.stdout.write("\nExact guarded mutation command:\n");
      process.stdout.write(result.command + "\n");
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
  normalizeCandidate,
};

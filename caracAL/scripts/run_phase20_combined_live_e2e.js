"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");
const {
  readState,
  runPhase20IntegrationSupervisorLiveTest,
} = require("./run_phase20_integration_live_e2e");
const {
  evaluatePhase20MerchantLogisticsResult,
  formatCompactResult,
} = require("./run_phase20_merchant_logistics_live_e2e");

const EXPECTED_PHASE = "20.0d";
const EXPECTED_REASON = "PHASE20_INTEGRATION_COMBINED_CONFIRMED";

function evaluatePhase20CombinedResult(payload) {
  return evaluatePhase20MerchantLogisticsResult(payload, {
    phase: EXPECTED_PHASE,
    reason: EXPECTED_REASON,
  });
}

function formatPhase20CombinedResult(result) {
  return formatCompactResult(result, {
    title: "Phase 20.0d Complete Combined One-Click Live E2E",
  });
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "caracAL dashboard was not running; using temporary normal supervisor\n"
        : "Using existing caracAL runtime\n",
    );

    const payload = await runPhase20IntegrationSupervisorLiveTest({
      stage: EXPECTED_PHASE,
    });
    const result = evaluatePhase20CombinedResult(payload);

    if (verbose) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(formatPhase20CombinedResult(result));
    }

    if (result.outcome !== "PASS") {
      process.exitCode = 1;
    }
  } finally {
    if (managedRuntime) {
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
  EXPECTED_PHASE,
  EXPECTED_REASON,
  evaluatePhase20CombinedResult,
  formatPhase20CombinedResult,
};

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  combineInventoryLiveTestResult,
  inventoryLiveTestDiagnostics,
  inventoryLiveTestEvidence,
} = require("../src/InventoryLiveTest");

function runtimeEvents() {
  return [
    {
      source: "bot_runtime",
      module: "InventoryLiveTest",
      type: "INVENTORY_LIVE_TEST_STARTED",
    },
    {
      source: "bot_runtime",
      module: "InventoryIntelligenceController",
      type: "INVENTORY_INTELLIGENCE_UPDATED",
      data: {
        inventoryIntelligence: {
          state: "READY",
          entries: [
            {
              slot: 0,
              disposition: "CONSUMABLE",
              protected: false,
              protections: [],
              why: "CONSUMABLE via Adventure Land item metadata",
            },
            {
              slot: 1,
              disposition: "UNKNOWN",
              protected: true,
              protections: ["UNKNOWN"],
              why: "UNKNOWN via unknown item metadata · protected: UNKNOWN",
            },
          ],
        },
      },
    },
    {
      source: "bot_runtime",
      module: "InventoryLiveTest",
      type: "INVENTORY_LIVE_TEST_COMPLETED",
    },
  ];
}

test("inventory supervisor evidence proves classification and unknown safety", () => {
  const evidence = inventoryLiveTestEvidence(runtimeEvents(), {
    inventory_intelligence_runtime: null,
  });

  assert.equal(evidence.inventoryTestStarted, true);
  assert.equal(evidence.inventoryTestCompleted, true);
  assert.equal(evidence.inventoryProjectionVisible, true);
  assert.equal(evidence.classifiedEntries, 2);
  assert.equal(evidence.allEntriesExplained, true);
  assert.equal(evidence.unknownItemsProtected, true);
});

test("inventory supervisor downgrades runtime pass when evidence is incomplete", () => {
  const combined = combineInventoryLiveTestResult(
    {
      outcome: "PASS",
      reason: "INVENTORY_LIVE_E2E_CONFIRMED",
    },
    {
      inventoryTestStarted: true,
      inventoryTestCompleted: true,
      inventoryProjectionVisible: true,
      classifiedEntries: 1,
      allEntriesExplained: true,
      unknownItemsProtected: false,
    },
  );

  assert.equal(combined.outcome, "FAIL");
  assert.equal(
    combined.reason,
    "SUPERVISOR_INVENTORY_EVIDENCE_INCOMPLETE",
  );
});

test("inventory diagnostics preserve the read-only mutation boundary", () => {
  const diagnostics = inventoryLiveTestDiagnostics(
    {
      requestId: "inventory-1",
      outcome: "PASS",
      reason: "INVENTORY_LIVE_E2E_CONFIRMED",
      durationMs: 25,
      inventory: {
        nonEmptySlots: 2,
        classifiedEntries: 2,
        allEntriesValid: true,
        unknownItemsProtected: true,
        protectedEntriesExplained: true,
      },
      scope: {
        readOnly: true,
        movementMutationForced: false,
        combatMutationForced: false,
        valueMutationForced: false,
      },
      cleanup: { inventoryOverrideCleared: true },
    },
    {
      evidence: {
        inventoryTestStarted: true,
        inventoryTestCompleted: true,
        inventoryProjectionVisible: true,
        allEntriesExplained: true,
        unknownItemsProtected: true,
      },
    },
  );

  assert.equal(diagnostics.navigation.required, false);
  assert.equal(diagnostics.scope.readOnly, true);
  assert.equal(diagnostics.expected.value_mutation_forced, false);
  assert.equal(diagnostics.observed.classified_entries, 2);
  assert.equal(diagnostics.observed.supervisor_evidence_complete, true);
});

test("coordinator and dashboard expose autonomous inventory live path", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "src", "HeadlessDashboard.js"),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "run_inventory_live_e2e.js"),
    "utf8",
  );

  assert.match(coordinator, /run_inventory_live_test/);
  assert.match(coordinator, /wait_for_inventory_live_test_runtime/);
  assert.match(coordinator, /inventory_live_test_result/);
  assert.match(
    dashboard,
    /\/headless\/api\/characters\/:name\/tests\/inventory/,
  );
  assert.match(thread, /runInventoryIntelligenceLiveTest/);
  assert.match(launcher, /ensureDashboardAvailable/);
  assert.match(launcher, /Stopping temporary caracAL runtime/);
});

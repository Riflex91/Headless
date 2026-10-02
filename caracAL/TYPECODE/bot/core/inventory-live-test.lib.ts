import {
  INVENTORY_DISPOSITIONS,
  type InventoryIntelligenceController,
  type InventoryIntelligenceStatus,
} from "./inventory-intelligence-controller.lib";
import type { InventorySlotSnapshot } from "./game-adapter.lib";

export interface InventoryLiveTestOptions {
  requestId?: string;
}

export interface InventoryLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  inventory: {
    nonEmptySlots: number;
    classifiedEntries: number;
    allEntriesValid: boolean;
    unknownItemsProtected: boolean;
    protectedEntriesExplained: boolean;
    status: InventoryIntelligenceStatus;
  };
  scope: {
    readOnly: true;
    movementMutationForced: false;
    combatMutationForced: false;
    valueMutationForced: false;
  };
  cleanup: {
    inventoryOverrideCleared: boolean;
  };
}

interface InventoryLiveTestDependencies {
  inventoryIntelligence: Pick<
    InventoryIntelligenceController,
    "setConfigOverride" | "clearConfigOverride" | "tick"
  >;
  inventory(): InventorySlotSnapshot[];
  now?: () => number;
}

const VALID_DISPOSITIONS = new Set<string>(INVENTORY_DISPOSITIONS);

function entryValid(entry: InventoryIntelligenceStatus["entries"][number]): boolean {
  return (
    Number.isInteger(entry.slot) &&
    typeof entry.why === "string" &&
    entry.why.length > 0 &&
    VALID_DISPOSITIONS.has(entry.disposition)
  );
}

export class InventoryLiveTestRunner {
  private readonly now: () => number;

  constructor(private readonly deps: InventoryLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  run(options: InventoryLiveTestOptions = {}): InventoryLiveTestResult {
    const startedAt = this.now();
    const requestId = options.requestId || `inventory-live-${startedAt}`;
    const inventory = this.deps.inventory();
    const nonEmptySlots = inventory.filter((entry) => !!entry.item).length;
    let inventoryOverrideCleared = false;
    let status: InventoryIntelligenceStatus;

    this.deps.inventoryIntelligence.setConfigOverride({
      inventory: {
        intelligence: {
          enabled: true,
        },
      },
    });

    try {
      status = this.deps.inventoryIntelligence.tick();
    } finally {
      this.deps.inventoryIntelligence.clearConfigOverride();
      inventoryOverrideCleared = true;
    }

    const allEntriesValid = status.entries.every(entryValid);
    const unknownItemsProtected = status.entries
      .filter((entry) => entry.disposition === "UNKNOWN")
      .every(
        (entry) =>
          entry.protected === true &&
          entry.protections.includes("UNKNOWN"),
      );
    const protectedEntriesExplained = status.entries
      .filter((entry) => entry.protected)
      .every((entry) => entry.protections.length > 0);
    const countMatches = status.entries.length === nonEmptySlots;
    const stateMatches =
      nonEmptySlots > 0
        ? status.state === "READY"
        : status.state === "EMPTY";

    const outcome =
      allEntriesValid &&
      unknownItemsProtected &&
      protectedEntriesExplained &&
      countMatches &&
      stateMatches
        ? "PASS"
        : "FAIL";
    const reason =
      outcome === "PASS"
        ? nonEmptySlots > 0
          ? "INVENTORY_LIVE_E2E_CONFIRMED"
          : "INVENTORY_LIVE_E2E_EMPTY_VALID"
        : "INVENTORY_LIVE_E2E_CLASSIFICATION_INVALID";
    const completedAt = this.now();

    return {
      requestId,
      outcome,
      reason,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      inventory: {
        nonEmptySlots,
        classifiedEntries: status.entries.length,
        allEntriesValid,
        unknownItemsProtected,
        protectedEntriesExplained,
        status,
      },
      scope: {
        readOnly: true,
        movementMutationForced: false,
        combatMutationForced: false,
        valueMutationForced: false,
      },
      cleanup: {
        inventoryOverrideCleared,
      },
    };
  }
}

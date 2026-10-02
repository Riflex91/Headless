import type {
  InventoryIntelligenceController,
  InventoryIntelligenceStatus,
} from "./inventory-intelligence-controller.lib";
import type {
  LogisticsClaimExecutor,
  LogisticsExecutionResult,
} from "./logistics-claim-executor.lib";

export interface LogisticsLiveTestOptions {
  requestId?: string;
}

export interface LogisticsLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: {
    name: string;
    ctype: string | null;
  };
  inventory: {
    state: InventoryIntelligenceStatus["state"];
    classifiedEntries: number;
    allEntriesExplained: boolean;
    unknownItemsProtected: boolean;
  };
  safetyProbe: LogisticsExecutionResult;
  scope: {
    readOnly: true;
    movementMutationForced: false;
    combatMutationForced: false;
    valueMutationForced: false;
    sendItemForced: false;
    sendGoldForced: false;
    mluckForced: false;
    mutationScope: "not forced";
  };
  cleanup: {
    inventoryOverrideCleared: boolean;
  };
}

interface LogisticsLiveTestDependencies {
  logisticsClaims: Pick<LogisticsClaimExecutor, "execute">;
  inventoryIntelligence: Pick<
    InventoryIntelligenceController,
    "setConfigOverride" | "clearConfigOverride" | "tick"
  >;
  character(): {
    name: string;
    ctype?: string | null;
  };
  now?: () => number;
}

export class LogisticsLiveTestRunner {
  private readonly now: () => number;

  constructor(private readonly deps: LogisticsLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  async run(
    options: LogisticsLiveTestOptions = {},
  ): Promise<LogisticsLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || "logistics-live-" + startedAt;
    const currentCharacter = this.deps.character();
    let inventoryOverrideCleared = false;
    let inventoryStatus: InventoryIntelligenceStatus;

    this.deps.inventoryIntelligence.setConfigOverride({
      inventory: {
        intelligence: {
          enabled: true,
        },
      },
    });

    try {
      inventoryStatus = this.deps.inventoryIntelligence.tick();
    } finally {
      this.deps.inventoryIntelligence.clearConfigOverride();
      inventoryOverrideCleared = true;
    }

    const allEntriesExplained = inventoryStatus.entries.every(
      (entry) =>
        typeof entry.disposition === "string" &&
        typeof entry.why === "string" &&
        entry.why.length > 0,
    );
    const unknownItemsProtected = inventoryStatus.entries
      .filter((entry) => entry.disposition === "UNKNOWN")
      .every(
        (entry) =>
          entry.protected === true &&
          Array.isArray(entry.protections) &&
          entry.protections.includes("UNKNOWN"),
      );

    const safetyProbe = await this.deps.logisticsClaims.execute({
      id: requestId + ":safe-self-transfer-probe",
      type: "ITEM_DELIVERY",
      farmer: currentCharacter.name,
      merchant: {
        name: currentCharacter.name,
        live: true,
      },
      itemName: "__caracal_logistics_live_probe__",
      quantity: 1,
      reason: "LOGISTICS_LIVE_SAFE_SELF_TRANSFER_PROBE",
    });

    const inventoryReady =
      inventoryStatus.state === "READY" || inventoryStatus.state === "EMPTY";
    const probeBlocked =
      safetyProbe.outcome === "BLOCKED" &&
      safetyProbe.reason === "CLAIM_SELF_TRANSFER_BLOCKED" &&
      safetyProbe.actionId === null;

    const outcome =
      inventoryReady &&
      allEntriesExplained &&
      unknownItemsProtected &&
      probeBlocked &&
      inventoryOverrideCleared
        ? "PASS"
        : "FAIL";
    const reason =
      outcome === "PASS"
        ? "LOGISTICS_LIVE_RUNTIME_CONFIRMED"
        : !inventoryReady
          ? "LOGISTICS_LIVE_INVENTORY_UNAVAILABLE"
          : !allEntriesExplained || !unknownItemsProtected
            ? "LOGISTICS_LIVE_INVENTORY_SAFETY_INVALID"
            : !probeBlocked
              ? "LOGISTICS_LIVE_SAFE_PROBE_NOT_BLOCKED"
              : "LOGISTICS_LIVE_CLEANUP_FAILED";
    const completedAt = this.now();

    return {
      requestId,
      outcome,
      reason,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      character: {
        name: currentCharacter.name,
        ctype: currentCharacter.ctype || null,
      },
      inventory: {
        state: inventoryStatus.state,
        classifiedEntries: inventoryStatus.entries.length,
        allEntriesExplained,
        unknownItemsProtected,
      },
      safetyProbe,
      scope: {
        readOnly: true,
        movementMutationForced: false,
        combatMutationForced: false,
        valueMutationForced: false,
        sendItemForced: false,
        sendGoldForced: false,
        mluckForced: false,
        mutationScope: "not forced",
      },
      cleanup: {
        inventoryOverrideCleared,
      },
    };
  }
}

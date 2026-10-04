import type { InventorySlotSnapshot } from "./game-adapter.lib";
import type {
  EconomyArbiterController,
  EconomyArbiterStatus,
} from "./economy-arbiter-controller.lib";
import type {
  EconomyPrebuffExecutionController,
  EconomyPrebuffExecutionStatus,
} from "./economy-prebuff-execution-controller.lib";
import type {
  EconomyPrebuffController,
  EconomyPrebuffStatus,
} from "./economy-prebuff-controller.lib";
import type {
  RiskPolicyController,
  RiskPolicyStatus,
} from "./risk-policy-controller.lib";

export type EconomyPrebuffExecutionLiveKind = "UPGRADE" | "COMPOUND";

export interface EconomyPrebuffExecutionLiveTestOptions {
  requestId?: string;
  expectedKind: EconomyPrebuffExecutionLiveKind;
  expectedName: string;
  expectedSlots: number[];
  preflightOnly?: boolean;
  settleTimeoutMs?: number;
  settlePollMs?: number;
}

export interface EconomyPrebuffExecutionLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  expected: {
    kind: EconomyPrebuffExecutionLiveKind;
    name: string;
    slots: number[];
  };
  before: {
    riskPolicy: RiskPolicyStatus;
    economyPrebuff: EconomyPrebuffStatus;
    arbiter: EconomyArbiterStatus;
    inventorySignature: string;
  };
  after: {
    riskPolicy: RiskPolicyStatus;
    economyPrebuff: EconomyPrebuffStatus;
    arbiter: EconomyArbiterStatus;
    inventorySignature: string;
  } | null;
  execution: EconomyPrebuffExecutionStatus | null;
  evidence: {
    explicitExpectationValid: boolean;
    riskPolicyReady: boolean;
    riskPolicyUnknownClear: boolean;
    expectedCandidateMatched: boolean;
    prebuffReady: boolean;
    prebuffDemandMatched: boolean;
    selectedSkillPresent: boolean;
    arbiterEnforcementObserved: boolean;
    prebuffActionConfirmed: boolean;
    economyActionConfirmed: boolean;
    exactKindExecuted: boolean;
    exactNameExecuted: boolean;
    inventoryMutationObserved: boolean;
    oneValueMutationMaximum: boolean;
    blindRetryAvoided: boolean;
  };
  scope: {
    readOnly: boolean;
    irreversibleMutation: boolean;
    prebuffMutationAllowed: boolean;
    upgradeMutationAllowed: boolean;
    compoundMutationAllowed: boolean;
    exchangeMutationAllowed: false;
    craftMutationAllowed: false;
    offeringMutationAllowed: false;
    maxValueMutations: 1;
    blindRetryAllowed: false;
    mutationScope:
      | "single-coupled-prebuff-economy-attempt-only"
      | "read-only-coupled-preflight";
  };
  cleanup: {
    arbiterConfigOverrideCleared: boolean;
    arbiterEnforcementRestored: boolean;
    verificationPolicyConfigOverrideCleared: boolean;
    verificationPolicyPlanningRestored: boolean;
  };
}

interface LiveGame {
  inventory(): InventorySlotSnapshot[];
}

interface LiveDependencies {
  game: LiveGame;
  refreshPlanning(): void;
  riskPolicy: Pick<RiskPolicyController, "status">;
  prebuff: Pick<EconomyPrebuffController, "status">;
  arbiter: Pick<
    EconomyArbiterController,
    "status" | "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  execution: Pick<
    EconomyPrebuffExecutionController,
    "status" | "executeNext"
  >;
  characterName?: () => string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inventorySignature(inventory: InventorySlotSnapshot[]): string {
  return JSON.stringify(
    inventory.map((entry) => ({
      slot: entry.slot,
      item: entry.item || null,
    })),
  );
}

function normalizeSlots(
  kind: EconomyPrebuffExecutionLiveKind,
  slots: number[],
): number[] | null {
  const expectedCount = kind === "UPGRADE" ? 1 : 3;
  const normalized = slots
    .map((slot) => Number(slot))
    .filter(
      (slot) =>
        Number.isInteger(slot) &&
        Number.isFinite(slot) &&
        slot >= 0,
    )
    .sort((left, right) => left - right);

  if (
    normalized.length !== expectedCount ||
    new Set(normalized).size !== expectedCount
  ) {
    return null;
  }
  return normalized;
}

function sameSlots(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.every((value, index) => value === b[index]);
}

function expectedCandidateMatches(
  risk: RiskPolicyStatus,
  kind: EconomyPrebuffExecutionLiveKind,
  name: string,
  slots: number[],
): boolean {
  const selected = risk.selected;
  return (
    !!selected &&
    selected.decision === "ALLOW" &&
    selected.kind === kind &&
    selected.name === name &&
    sameSlots(selected.itemSlots, slots)
  );
}

export class EconomyPrebuffExecutionLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: LiveDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: EconomyPrebuffExecutionLiveTestOptions,
  ): Promise<EconomyPrebuffExecutionLiveTestResult> {
    const startedAt = this.now();
    const requestId =
      options.requestId || `economy-prebuff-execution-live-${startedAt}`;
    const expectedName =
      typeof options.expectedName === "string"
        ? options.expectedName.trim()
        : "";
    const expectedSlots = normalizeSlots(
      options.expectedKind,
      options.expectedSlots,
    );
    const preflightOnly = options.preflightOnly === true;
    const settleTimeoutMs = Math.max(500, options.settleTimeoutMs || 3000);
    const settlePollMs = Math.max(25, options.settlePollMs || 100);
    const evidence = {
      explicitExpectationValid: !!expectedName && !!expectedSlots,
      riskPolicyReady: false,
      riskPolicyUnknownClear: false,
      expectedCandidateMatched: false,
      prebuffReady: false,
      prebuffDemandMatched: false,
      selectedSkillPresent: false,
      arbiterEnforcementObserved: false,
      prebuffActionConfirmed: false,
      economyActionConfirmed: false,
      exactKindExecuted: false,
      exactNameExecuted: false,
      inventoryMutationObserved: false,
      oneValueMutationMaximum: true,
      blindRetryAvoided: true,
    };

    let beforeRisk: RiskPolicyStatus;
    let beforePrebuff: EconomyPrebuffStatus;
    let beforeArbiter: EconomyArbiterStatus;
    let beforeInventorySignature = "";
    let after: EconomyPrebuffExecutionLiveTestResult["after"] = null;
    let execution: EconomyPrebuffExecutionStatus | null = null;
    let outcome: EconomyPrebuffExecutionLiveTestResult["outcome"] = "FAIL";
    let reason = "ECONOMY_PREBUFF_EXECUTION_LIVE_EVIDENCE_INCOMPLETE";
    let arbiterConfigOverrideCleared = false;
    let arbiterEnforcementRestored = false;
    let finalResult: EconomyPrebuffExecutionLiveTestResult | null = null;

    this.deps.refreshPlanning();
    beforeRisk = this.deps.riskPolicy.status();
    beforePrebuff = this.deps.prebuff.status();
    beforeArbiter = this.deps.arbiter.tick();
    beforeInventorySignature = inventorySignature(this.deps.game.inventory());

    const finish = (): EconomyPrebuffExecutionLiveTestResult => {
      const completedAt = this.now();
      return {
        requestId,
        outcome,
        reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        character: this.deps.characterName?.() || null,
        expected: {
          kind: options.expectedKind,
          name: expectedName,
          slots: expectedSlots || [],
        },
        before: {
          riskPolicy: beforeRisk,
          economyPrebuff: beforePrebuff,
          arbiter: beforeArbiter,
          inventorySignature: beforeInventorySignature,
        },
        after,
        execution,
        evidence,
        scope: {
          readOnly: preflightOnly,
          irreversibleMutation: !preflightOnly,
          prebuffMutationAllowed: !preflightOnly,
          upgradeMutationAllowed:
            !preflightOnly && options.expectedKind === "UPGRADE",
          compoundMutationAllowed:
            !preflightOnly && options.expectedKind === "COMPOUND",
          exchangeMutationAllowed: false,
          craftMutationAllowed: false,
          offeringMutationAllowed: false,
          maxValueMutations: 1,
          blindRetryAllowed: false,
          mutationScope: preflightOnly
            ? "read-only-coupled-preflight"
            : "single-coupled-prebuff-economy-attempt-only",
        },
        cleanup: {
          arbiterConfigOverrideCleared,
          arbiterEnforcementRestored,
          verificationPolicyConfigOverrideCleared: false,
          verificationPolicyPlanningRestored: false,
        },
      };
    };

    if (!evidence.explicitExpectationValid || !expectedSlots) {
      reason = "ECONOMY_PREBUFF_EXECUTION_LIVE_EXPECTATION_INVALID";
      return finish();
    }

    evidence.riskPolicyReady = beforeRisk.state === "READY";
    evidence.riskPolicyUnknownClear =
      beforeRisk.summary.unknown === 0 && beforeRisk.state !== "PARTIAL";
    evidence.expectedCandidateMatched = expectedCandidateMatches(
      beforeRisk,
      options.expectedKind,
      expectedName,
      expectedSlots,
    );
    evidence.prebuffReady = beforePrebuff.state === "READY";
    evidence.prebuffDemandMatched =
      beforePrebuff.demand.kind === options.expectedKind &&
      beforePrebuff.demand.name === expectedName;
    evidence.selectedSkillPresent =
      typeof beforePrebuff.selectedSkill === "string" &&
      beforePrebuff.selectedSkill.length > 0;

    if (
      !evidence.riskPolicyReady ||
      !evidence.riskPolicyUnknownClear ||
      !evidence.expectedCandidateMatched ||
      !evidence.prebuffReady ||
      !evidence.prebuffDemandMatched ||
      !evidence.selectedSkillPresent
    ) {
      reason = "ECONOMY_PREBUFF_EXECUTION_LIVE_PREFLIGHT_BLOCKED";
      return finish();
    }

    if (preflightOnly) {
      outcome = "PASS";
      reason = "ECONOMY_PREBUFF_EXECUTION_LIVE_PREFLIGHT_CONFIRMED";
      return finish();
    }

    const originalEnforcement = beforeArbiter.policy.enforcementEnabled;
    this.deps.arbiter.setConfigOverride({
      economyArbiter: {
        enabled: true,
        enforcementEnabled: true,
      },
    });

    try {
      const enforced = this.deps.arbiter.tick();
      evidence.arbiterEnforcementObserved =
        enforced.policy.enforcementEnabled === true;
      if (!evidence.arbiterEnforcementObserved) {
        reason = "ECONOMY_PREBUFF_EXECUTION_LIVE_ENFORCEMENT_NOT_ACTIVE";
        return (finalResult = finish());
      }

      execution = await this.deps.execution.executeNext();
      evidence.prebuffActionConfirmed =
        execution.prebuffAction?.status === "CONFIRMED";
      evidence.economyActionConfirmed =
        execution.economyAction?.status === "CONFIRMED";
      evidence.exactKindExecuted = execution.kind === options.expectedKind;
      evidence.exactNameExecuted = execution.name === expectedName;
      evidence.oneValueMutationMaximum =
        execution.policy.maxValueMutations === 1;
      evidence.blindRetryAvoided =
        execution.policy.blindRetryAllowed === false;

      if (execution.state === "UNKNOWN_HOLD") {
        outcome = "UNKNOWN";
        reason = "ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY";
        return (finalResult = finish());
      }

      if (
        execution.state !== "CONFIRMED" ||
        !evidence.prebuffActionConfirmed ||
        !evidence.economyActionConfirmed ||
        !evidence.exactKindExecuted ||
        !evidence.exactNameExecuted
      ) {
        reason =
          execution.reason ||
          "ECONOMY_PREBUFF_EXECUTION_LIVE_COUPLED_ACTION_NOT_CONFIRMED";
        return (finalResult = finish());
      }

      const settleStartedAt = this.now();
      do {
        this.deps.refreshPlanning();
        const afterInventorySignature = inventorySignature(
          this.deps.game.inventory(),
        );
        after = {
          riskPolicy: this.deps.riskPolicy.status(),
          economyPrebuff: this.deps.prebuff.status(),
          arbiter: this.deps.arbiter.tick(),
          inventorySignature: afterInventorySignature,
        };
        evidence.inventoryMutationObserved =
          afterInventorySignature !== beforeInventorySignature;
        if (evidence.inventoryMutationObserved) break;
        await this.sleep(settlePollMs);
      } while (this.now() - settleStartedAt < settleTimeoutMs);

      if (!evidence.inventoryMutationObserved) {
        outcome = "TIMEOUT";
        reason =
          "ECONOMY_PREBUFF_EXECUTION_LIVE_CONFIRMED_BUT_MUTATION_NOT_OBSERVED";
        return (finalResult = finish());
      }

      outcome = "PASS";
      reason = "ECONOMY_PREBUFF_EXECUTION_LIVE_E2E_CONFIRMED";
      return (finalResult = finish());
    } finally {
      this.deps.arbiter.clearConfigOverride();
      arbiterConfigOverrideCleared = true;
      const restored = this.deps.arbiter.tick();
      arbiterEnforcementRestored =
        restored.policy.enforcementEnabled === originalEnforcement;
      if (finalResult) {
        finalResult.cleanup.arbiterConfigOverrideCleared =
          arbiterConfigOverrideCleared;
        finalResult.cleanup.arbiterEnforcementRestored =
          arbiterEnforcementRestored;
      }
    }
  }
}

export {
  expectedCandidateMatches,
  inventorySignature as economyPrebuffExecutionInventorySignature,
  normalizeSlots as normalizeEconomyPrebuffExecutionSlots,
};

import type { SkillRequest } from "./action-boundary.lib";
import type { ActionRecord } from "./action-ledger.lib";
import type {
  CompoundStatus,
} from "./compound-controller.lib";
import type {
  EconomyArbiterAuthorization,
  EconomyArbiterLane,
} from "./economy-arbiter-controller.lib";
import type {
  EconomyPrebuffStatus,
} from "./economy-prebuff-controller.lib";
import type {
  RiskPolicyEstimateDecision,
  RiskPolicyStatus,
} from "./risk-policy-controller.lib";
import type {
  UpgradeStatus,
} from "./upgrade-controller.lib";

export type EconomyPrebuffExecutionState =
  | "IDLE"
  | "PREBUFF"
  | "ECONOMY"
  | "CONFIRMED"
  | "BLOCKED"
  | "REJECTED"
  | "UNKNOWN_HOLD";

export type EconomyPrebuffExecutionKind = "UPGRADE" | "COMPOUND";

export interface EconomyPrebuffExecutionAction {
  id: string;
  status: ActionRecord["status"];
  why: string;
  error: string | null;
}

export interface EconomyPrebuffExecutionStatus {
  timestamp: number;
  state: EconomyPrebuffExecutionState;
  reason: string;
  busy: boolean;
  correlationId: string | null;
  activeLane: EconomyArbiterLane | null;
  kind: EconomyPrebuffExecutionKind | null;
  name: string | null;
  selectedSkill: string | null;
  prebuffAction: EconomyPrebuffExecutionAction | null;
  economyAction: EconomyPrebuffExecutionAction | null;
  unknownStage: "PREBUFF" | "ECONOMY" | null;
  policy: {
    explicitOneShot: true;
    arbiterEnforcementRequired: true;
    prebuffMustConfirmBeforeEconomy: true;
    revalidateAfterPrebuff: true;
    maxValueMutations: 1;
    blindRetryAllowed: false;
    supportedKinds: ["UPGRADE", "COMPOUND"];
    exchangeSupported: false;
  };
}

export interface EconomyPrebuffExecutionEvent {
  type: "ECONOMY_PREBUFF_EXECUTION_UPDATED";
  timestamp: number;
  reason: string;
  status: EconomyPrebuffExecutionStatus;
}

interface EconomyPrebuffExecutionPrebuff {
  status(): EconomyPrebuffStatus;
}

interface EconomyPrebuffExecutionRiskPolicy {
  status(): RiskPolicyStatus;
}

interface EconomyPrebuffExecutionArbiter {
  authorize(lane: EconomyArbiterLane): EconomyArbiterAuthorization;
}

interface EconomyPrebuffExecutionActions {
  useSkill(request: SkillRequest): Promise<ActionRecord>;
}

interface EconomyPrebuffExecutionUpgrade {
  status(): UpgradeStatus;
  executeNext(): Promise<UpgradeStatus>;
}

interface EconomyPrebuffExecutionCompound {
  status(): CompoundStatus;
  executeNext(): Promise<CompoundStatus>;
}

export interface EconomyPrebuffExecutionControllerOptions {
  now?: () => number;
  nextCorrelationId?: () => string;
  onEvent?: (event: EconomyPrebuffExecutionEvent) => void;
}

function sameSlots(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.every((value, index) => value === b[index]);
}

function sameRiskSelection(
  left: RiskPolicyEstimateDecision,
  right: RiskPolicyEstimateDecision | null,
): boolean {
  return (
    !!right &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.currentLevel === right.currentLevel &&
    left.targetLevel === right.targetLevel &&
    sameSlots(left.itemSlots, right.itemSlots) &&
    right.decision === "ALLOW"
  );
}

function actionSummary(
  action: {
    id: string;
    status: ActionRecord["status"];
    why: string;
    error?: string | null;
  },
): EconomyPrebuffExecutionAction {
  return {
    id: action.id,
    status: action.status,
    why: action.why,
    error: action.error || null,
  };
}

function terminalUnknown(status: ActionRecord["status"]): boolean {
  return status === "UNKNOWN" || status === "DISPATCHED" || status === null;
}

export class EconomyPrebuffExecutionController {
  private readonly now: () => number;
  private readonly nextCorrelationId: () => string;
  private readonly onEvent?: (event: EconomyPrebuffExecutionEvent) => void;
  private lastEventSignature: string | null = null;
  private busy = false;
  private lastStatus: EconomyPrebuffExecutionStatus;

  constructor(
    private readonly refreshPlanning: () => void,
    private readonly prebuff: EconomyPrebuffExecutionPrebuff,
    private readonly riskPolicy: EconomyPrebuffExecutionRiskPolicy,
    private readonly arbiter: EconomyPrebuffExecutionArbiter,
    private readonly actions: EconomyPrebuffExecutionActions,
    private readonly upgrade: EconomyPrebuffExecutionUpgrade,
    private readonly compound: EconomyPrebuffExecutionCompound,
    options: EconomyPrebuffExecutionControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.nextCorrelationId =
      options.nextCorrelationId ||
      (() => `economy-prebuff-execution-${this.now()}`);
    this.onEvent = options.onEvent;
    this.lastStatus = this.baseStatus(
      "IDLE",
      "ECONOMY_PREBUFF_EXECUTION_IDLE",
    );
  }

  status(): EconomyPrebuffExecutionStatus {
    return this.lastStatus;
  }

  async executeNext(): Promise<EconomyPrebuffExecutionStatus> {
    if (this.busy) return this.lastStatus;
    if (this.lastStatus.state === "UNKNOWN_HOLD") return this.lastStatus;

    this.busy = true;
    const correlationId = this.nextCorrelationId();

    try {
      this.refreshPlanning();

      const initialRisk = this.riskPolicy.status();
      const initialPrebuff = this.prebuff.status();
      const selected = initialRisk.selected;

      if (
        initialRisk.state !== "READY" ||
        initialRisk.summary.unknown > 0 ||
        !selected ||
        selected.decision !== "ALLOW"
      ) {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_RISK_POLICY_NOT_READY",
          correlationId,
        );
      }

      if (selected.kind !== "UPGRADE" && selected.kind !== "COMPOUND") {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_KIND_UNSUPPORTED",
          correlationId,
        );
      }

      if (
        initialPrebuff.state !== "READY" ||
        !initialPrebuff.selectedSkill ||
        initialPrebuff.demand.kind !== selected.kind ||
        initialPrebuff.demand.name !== selected.name
      ) {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_PLAN_NOT_READY",
          correlationId,
          selected,
        );
      }

      if (!this.candidateMatches(selected)) {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_CANDIDATE_MISMATCH",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
        );
      }

      this.publish({
        ...this.baseStatus("PREBUFF", "ECONOMY_PREBUFF_DISPATCHING"),
        busy: true,
        correlationId,
        activeLane: "ECONOMY_PREBUFF",
        kind: selected.kind,
        name: selected.name,
        selectedSkill: initialPrebuff.selectedSkill,
      });

      const prebuffAuthorization = this.arbiter.authorize("ECONOMY_PREBUFF");
      if (!prebuffAuthorization.enforced) {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_ARBITER_ENFORCEMENT_REQUIRED",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
        );
      }
      if (!prebuffAuthorization.allowed) {
        return this.finish(
          "BLOCKED",
          prebuffAuthorization.reason,
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
        );
      }

      const prebuffAction = await this.actions.useSkill({
        skill: initialPrebuff.selectedSkill,
        module: "MerchantSkillController",
        why: "ECONOMY_PREBUFF_COUPLED_EXECUTION",
        correlationId,
      });
      const prebuffActionSummary = actionSummary(prebuffAction);

      if (terminalUnknown(prebuffAction.status)) {
        return this.holdUnknown(
          "PREBUFF",
          "ECONOMY_PREBUFF_OUTCOME_UNKNOWN",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
          null,
        );
      }

      if (prebuffAction.status !== "CONFIRMED") {
        return this.finish(
          prebuffAction.status === "REJECTED" ? "REJECTED" : "BLOCKED",
          prebuffAction.status === "REJECTED"
            ? "ECONOMY_PREBUFF_ACTION_REJECTED"
            : "ECONOMY_PREBUFF_ACTION_BLOCKED",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
        );
      }

      this.publish({
        ...this.baseStatus("ECONOMY", "ECONOMY_PREBUFF_REVALIDATING"),
        busy: true,
        correlationId,
        activeLane: "ECONOMY",
        kind: selected.kind,
        name: selected.name,
        selectedSkill: initialPrebuff.selectedSkill,
        prebuffAction: prebuffActionSummary,
      });

      this.refreshPlanning();
      const revalidatedRisk = this.riskPolicy.status();

      if (
        revalidatedRisk.state !== "READY" ||
        revalidatedRisk.summary.unknown > 0 ||
        !sameRiskSelection(selected, revalidatedRisk.selected) ||
        !this.candidateMatches(selected)
      ) {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_REVALIDATION_FAILED",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
        );
      }

      const economyAuthorization = this.arbiter.authorize("ECONOMY");
      if (!economyAuthorization.enforced) {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_ARBITER_ENFORCEMENT_REQUIRED",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
        );
      }
      if (!economyAuthorization.allowed) {
        return this.finish(
          "BLOCKED",
          economyAuthorization.reason,
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
        );
      }

      const beforeActionId = this.economyActionId(selected.kind);
      const economyStatus =
        selected.kind === "UPGRADE"
          ? await this.upgrade.executeNext()
          : await this.compound.executeNext();
      const action = economyStatus.lastAction;

      if (!action || action.id === beforeActionId) {
        return this.finish(
          "BLOCKED",
          "ECONOMY_PREBUFF_ECONOMY_ACTION_NOT_DISPATCHED",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
        );
      }

      const economyAction = actionSummary(action);

      if (terminalUnknown(action.status)) {
        return this.holdUnknown(
          "ECONOMY",
          "ECONOMY_PREBUFF_ECONOMY_OUTCOME_UNKNOWN",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
          economyAction,
        );
      }

      if (action.status !== "CONFIRMED") {
        return this.finish(
          action.status === "REJECTED" ? "REJECTED" : "BLOCKED",
          action.status === "REJECTED"
            ? "ECONOMY_PREBUFF_ECONOMY_ACTION_REJECTED"
            : "ECONOMY_PREBUFF_ECONOMY_ACTION_BLOCKED",
          correlationId,
          selected,
          initialPrebuff.selectedSkill,
          prebuffActionSummary,
          economyAction,
        );
      }

      return this.finish(
        "CONFIRMED",
        "ECONOMY_PREBUFF_COUPLED_EXECUTION_CONFIRMED",
        correlationId,
        selected,
        initialPrebuff.selectedSkill,
        prebuffActionSummary,
        economyAction,
      );
    } finally {
      this.busy = false;
      if (this.lastStatus.busy) {
        this.publish({
          ...this.lastStatus,
          timestamp: this.now(),
          busy: false,
        });
      }
    }
  }

  private candidateMatches(selected: RiskPolicyEstimateDecision): boolean {
    if (selected.kind === "UPGRADE") {
      const candidate = this.upgrade.status().selected;
      return (
        !!candidate &&
        candidate.name === selected.name &&
        candidate.currentLevel === selected.currentLevel &&
        selected.targetLevel === candidate.currentLevel + 1 &&
        sameSlots(selected.itemSlots, [candidate.itemSlot])
      );
    }

    if (selected.kind === "COMPOUND") {
      const candidate = this.compound.status().selected;
      return (
        !!candidate &&
        candidate.name === selected.name &&
        candidate.currentLevel === selected.currentLevel &&
        selected.targetLevel === candidate.currentLevel + 1 &&
        sameSlots(selected.itemSlots, candidate.itemSlots)
      );
    }

    return false;
  }

  private economyActionId(kind: EconomyPrebuffExecutionKind): string | null {
    return kind === "UPGRADE"
      ? this.upgrade.status().lastAction?.id || null
      : this.compound.status().lastAction?.id || null;
  }

  private holdUnknown(
    stage: "PREBUFF" | "ECONOMY",
    reason: string,
    correlationId: string,
    selected: RiskPolicyEstimateDecision,
    selectedSkill: string,
    prebuffAction: EconomyPrebuffExecutionAction | null,
    economyAction: EconomyPrebuffExecutionAction | null,
  ): EconomyPrebuffExecutionStatus {
    return this.publish({
      ...this.baseStatus("UNKNOWN_HOLD", reason),
      busy: true,
      correlationId,
      activeLane: stage === "PREBUFF" ? "ECONOMY_PREBUFF" : "ECONOMY",
      kind: selected.kind as EconomyPrebuffExecutionKind,
      name: selected.name,
      selectedSkill,
      prebuffAction,
      economyAction,
      unknownStage: stage,
    });
  }

  private finish(
    state: Extract<
      EconomyPrebuffExecutionState,
      "CONFIRMED" | "BLOCKED" | "REJECTED"
    >,
    reason: string,
    correlationId: string,
    selected?: RiskPolicyEstimateDecision,
    selectedSkill: string | null = null,
    prebuffAction: EconomyPrebuffExecutionAction | null = null,
    economyAction: EconomyPrebuffExecutionAction | null = null,
  ): EconomyPrebuffExecutionStatus {
    return this.publish({
      ...this.baseStatus(state, reason),
      busy: true,
      correlationId,
      kind:
        selected?.kind === "UPGRADE" || selected?.kind === "COMPOUND"
          ? selected.kind
          : null,
      name: selected?.name || null,
      selectedSkill,
      prebuffAction,
      economyAction,
    });
  }

  private baseStatus(
    state: EconomyPrebuffExecutionState,
    reason: string,
  ): EconomyPrebuffExecutionStatus {
    return {
      timestamp: this.now(),
      state,
      reason,
      busy: false,
      correlationId: null,
      activeLane: null,
      kind: null,
      name: null,
      selectedSkill: null,
      prebuffAction: null,
      economyAction: null,
      unknownStage: null,
      policy: {
        explicitOneShot: true,
        arbiterEnforcementRequired: true,
        prebuffMustConfirmBeforeEconomy: true,
        revalidateAfterPrebuff: true,
        maxValueMutations: 1,
        blindRetryAllowed: false,
        supportedKinds: ["UPGRADE", "COMPOUND"],
        exchangeSupported: false,
      },
    };
  }

  private publish(
    status: EconomyPrebuffExecutionStatus,
  ): EconomyPrebuffExecutionStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      state: status.state,
      reason: status.reason,
      busy: status.busy,
      correlationId: status.correlationId,
      activeLane: status.activeLane,
      kind: status.kind,
      name: status.name,
      selectedSkill: status.selectedSkill,
      prebuffAction: status.prebuffAction,
      economyAction: status.economyAction,
      unknownStage: status.unknownStage,
      policy: status.policy,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "ECONOMY_PREBUFF_EXECUTION_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

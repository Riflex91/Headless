import type {
  ExpectedValueEstimate,
  ExpectedValueKind,
  ExpectedValueStatus,
} from "./expected-value-controller.lib";

export type RiskPolicyState =
  | "DISABLED"
  | "EMPTY"
  | "READY"
  | "BLOCKED"
  | "PARTIAL";

export type RiskPolicyDecision = "ALLOW" | "BLOCK" | "UNKNOWN";

export interface RiskPolicyEstimateDecision {
  kind: ExpectedValueKind;
  name: string;
  currentLevel: number;
  targetLevel: number;
  itemSlots: number[];
  expectedDeltaGold: number | null;
  successProbability: number | null;
  inputValueGold: number | null;
  failureOutcomeValueGold: number | null;
  failureLossGold: number | null;
  decision: RiskPolicyDecision;
  reason: string;
}

export interface RiskPolicySummary {
  estimates: number;
  allowed: number;
  blocked: number;
  unknown: number;
  upgradeAllowed: number;
  compoundAllowed: number;
  selectedKind: ExpectedValueKind | null;
  selectedName: string | null;
  selectedExpectedDeltaGold: number | null;
}

export interface RiskPolicyStatus {
  timestamp: number;
  enabled: boolean;
  state: RiskPolicyState;
  reason: string;
  policy: {
    minExpectedDeltaGold: number;
    minSuccessProbability: number;
    maxInputValueGold: number | null;
    maxFailureLossGold: number | null;
    allowedKinds: ExpectedValueKind[];
    unknownAlwaysBlocked: true;
  };
  selected: RiskPolicyEstimateDecision | null;
  decisions: RiskPolicyEstimateDecision[];
  summary: RiskPolicySummary;
}

export interface RiskPolicyEvent {
  type: "RISK_POLICY_UPDATED";
  timestamp: number;
  reason: string;
  status: RiskPolicyStatus;
}

export interface RiskPolicyControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: RiskPolicyEvent) => void;
}

interface RiskPolicyExpectedValueSource {
  status(): ExpectedValueStatus;
}

interface NormalizedRiskPolicyConfig {
  enabled: boolean;
  minExpectedDeltaGold: number;
  minSuccessProbability: number;
  maxInputValueGold: number | null;
  maxFailureLossGold: number | null;
  allowedKinds: Set<ExpectedValueKind>;
}

const ALL_KINDS: ExpectedValueKind[] = ["UPGRADE", "COMPOUND"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number | null {
  const normalized = finite(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function probability(value: unknown): number | null {
  const normalized = finite(value);
  return normalized !== null && normalized >= 0 && normalized <= 1
    ? normalized
    : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeAllowedKinds(value: unknown): Set<ExpectedValueKind> {
  if (!Array.isArray(value)) return new Set(ALL_KINDS);
  const normalized = value.filter(
    (entry): entry is ExpectedValueKind =>
      entry === "UPGRADE" || entry === "COMPOUND",
  );
  return new Set(normalized);
}

function normalizeConfig(value: unknown): NormalizedRiskPolicyConfig {
  const root = record(value);
  const risk = record(root.riskPolicy ?? root.risk);
  return {
    enabled: bool(risk.enabled, true),
    minExpectedDeltaGold: finite(risk.minExpectedDeltaGold) ?? 0,
    minSuccessProbability: probability(risk.minSuccessProbability) ?? 0,
    maxInputValueGold: nonNegative(risk.maxInputValueGold),
    maxFailureLossGold: nonNegative(risk.maxFailureLossGold),
    allowedKinds: normalizeAllowedKinds(risk.allowedKinds),
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function failureLoss(estimate: ExpectedValueEstimate): number | null {
  const input = finite(estimate.inputValueGold);
  const failure = finite(estimate.failureOutcomeValueGold);
  if (input === null || failure === null) return null;
  return roundMoney(Math.max(0, input - failure));
}

function unknownDecision(
  estimate: ExpectedValueEstimate,
  reason: string,
): RiskPolicyEstimateDecision {
  return {
    kind: estimate.kind,
    name: estimate.name,
    currentLevel: estimate.currentLevel,
    targetLevel: estimate.targetLevel,
    itemSlots: [...estimate.itemSlots],
    expectedDeltaGold: estimate.expectedDeltaGold,
    successProbability: estimate.successProbability,
    inputValueGold: estimate.inputValueGold,
    failureOutcomeValueGold: estimate.failureOutcomeValueGold,
    failureLossGold: failureLoss(estimate),
    decision: "UNKNOWN",
    reason,
  };
}

function decideEstimate(
  estimate: ExpectedValueEstimate,
  config: NormalizedRiskPolicyConfig,
): RiskPolicyEstimateDecision {
  const base = {
    kind: estimate.kind,
    name: estimate.name,
    currentLevel: estimate.currentLevel,
    targetLevel: estimate.targetLevel,
    itemSlots: [...estimate.itemSlots],
    expectedDeltaGold: estimate.expectedDeltaGold,
    successProbability: estimate.successProbability,
    inputValueGold: estimate.inputValueGold,
    failureOutcomeValueGold: estimate.failureOutcomeValueGold,
    failureLossGold: failureLoss(estimate),
  };

  if (!config.allowedKinds.has(estimate.kind)) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_KIND_NOT_ALLOWED",
    };
  }

  const expectedDelta = finite(estimate.expectedDeltaGold);
  const successProbability = probability(estimate.successProbability);
  const inputValue = nonNegative(estimate.inputValueGold);
  const currentFailureLoss = base.failureLossGold;

  if (
    estimate.decision === "UNKNOWN" ||
    expectedDelta === null ||
    successProbability === null ||
    inputValue === null ||
    currentFailureLoss === null
  ) {
    return unknownDecision(estimate, "RISK_POLICY_EXPECTED_VALUE_UNKNOWN");
  }

  if (expectedDelta < config.minExpectedDeltaGold) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_EXPECTED_DELTA_BELOW_MINIMUM",
    };
  }

  if (successProbability < config.minSuccessProbability) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_SUCCESS_PROBABILITY_BELOW_MINIMUM",
    };
  }

  if (
    config.maxInputValueGold !== null &&
    inputValue > config.maxInputValueGold
  ) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_INPUT_VALUE_LIMIT_EXCEEDED",
    };
  }

  if (
    config.maxFailureLossGold !== null &&
    currentFailureLoss > config.maxFailureLossGold
  ) {
    return {
      ...base,
      decision: "BLOCK",
      reason: "RISK_POLICY_FAILURE_LOSS_LIMIT_EXCEEDED",
    };
  }

  return {
    ...base,
    decision: "ALLOW",
    reason: "RISK_POLICY_ALLOWED",
  };
}

function emptySummary(): RiskPolicySummary {
  return {
    estimates: 0,
    allowed: 0,
    blocked: 0,
    unknown: 0,
    upgradeAllowed: 0,
    compoundAllowed: 0,
    selectedKind: null,
    selectedName: null,
    selectedExpectedDeltaGold: null,
  };
}

export class RiskPolicyController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: RiskPolicyEvent) => void;
  private lastEventSignature: string | null = null;
  private lastStatus: RiskPolicyStatus;

  constructor(
    private readonly expectedValue: RiskPolicyExpectedValueSource,
    options: RiskPolicyControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      true,
      "EMPTY",
      "RISK_POLICY_NO_ESTIMATES",
      normalizeConfig({}),
    );
  }

  status(): RiskPolicyStatus {
    return this.lastStatus;
  }

  tick(): RiskPolicyStatus {
    const timestamp = this.now();
    const config = normalizeConfig(this.configSource());

    if (!config.enabled) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          false,
          "DISABLED",
          "RISK_POLICY_DISABLED",
          config,
        ),
      );
    }

    const expectedValue = this.expectedValue.status();
    const estimates = Array.isArray(expectedValue.estimates)
      ? expectedValue.estimates
      : [];

    if (estimates.length === 0) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          true,
          "EMPTY",
          "RISK_POLICY_NO_ESTIMATES",
          config,
        ),
      );
    }

    const decisions = estimates.map((estimate) =>
      decideEstimate(estimate, config),
    );
    const allowed = decisions.filter(
      (decision) => decision.decision === "ALLOW",
    );
    const blocked = decisions.filter(
      (decision) => decision.decision === "BLOCK",
    );
    const unknown = decisions.filter(
      (decision) => decision.decision === "UNKNOWN",
    );

    const selected =
      allowed
        .slice()
        .sort(
          (left, right) =>
            (right.expectedDeltaGold ?? Number.NEGATIVE_INFINITY) -
              (left.expectedDeltaGold ?? Number.NEGATIVE_INFINITY) ||
            (right.successProbability ?? Number.NEGATIVE_INFINITY) -
              (left.successProbability ?? Number.NEGATIVE_INFINITY) ||
            left.kind.localeCompare(right.kind) ||
            left.name.localeCompare(right.name),
        )[0] || null;

    const summary: RiskPolicySummary = {
      estimates: decisions.length,
      allowed: allowed.length,
      blocked: blocked.length,
      unknown: unknown.length,
      upgradeAllowed: allowed.filter(
        (decision) => decision.kind === "UPGRADE",
      ).length,
      compoundAllowed: allowed.filter(
        (decision) => decision.kind === "COMPOUND",
      ).length,
      selectedKind: selected?.kind ?? null,
      selectedName: selected?.name ?? null,
      selectedExpectedDeltaGold: selected?.expectedDeltaGold ?? null,
    };

    const state: RiskPolicyState =
      unknown.length > 0
        ? "PARTIAL"
        : selected
          ? "READY"
          : "BLOCKED";
    const reason =
      state === "PARTIAL"
        ? "RISK_POLICY_PARTIAL_UNKNOWN"
        : state === "READY"
          ? "RISK_POLICY_CANDIDATE_ALLOWED"
          : "RISK_POLICY_ALL_CANDIDATES_BLOCKED";

    return this.publish({
      timestamp,
      enabled: true,
      state,
      reason,
      policy: this.policySnapshot(config),
      selected,
      decisions,
      summary,
    });
  }

  private policySnapshot(
    config: NormalizedRiskPolicyConfig,
  ): RiskPolicyStatus["policy"] {
    return {
      minExpectedDeltaGold: config.minExpectedDeltaGold,
      minSuccessProbability: config.minSuccessProbability,
      maxInputValueGold: config.maxInputValueGold,
      maxFailureLossGold: config.maxFailureLossGold,
      allowedKinds: ALL_KINDS.filter((kind) => config.allowedKinds.has(kind)),
      unknownAlwaysBlocked: true,
    };
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: RiskPolicyState,
    reason: string,
    config: NormalizedRiskPolicyConfig,
  ): RiskPolicyStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      policy: this.policySnapshot(config),
      selected: null,
      decisions: [],
      summary: emptySummary(),
    };
  }

  private publish(status: RiskPolicyStatus): RiskPolicyStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      policy: status.policy,
      selected: status.selected,
      decisions: status.decisions,
      summary: status.summary,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "RISK_POLICY_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

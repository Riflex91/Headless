export type EconomyArbiterLane =
  | "SAFETY"
  | "MERRIT"
  | "CRITICAL_FARMER_LOGISTICS"
  | "ECONOMY_PREBUFF"
  | "ECONOMY"
  | "MERCHANT_STAND"
  | "BACKGROUND";

export type EconomyArbiterState =
  | "DISABLED"
  | "IDLE"
  | "READY"
  | "BLOCKED"
  | "UNKNOWN";

export interface EconomyArbiterSignal {
  active: boolean;
  blocked?: boolean;
  unknown?: boolean;
  reason?: string;
  data?: Record<string, unknown> | null;
}

export interface EconomyArbiterLaneStatus {
  lane: EconomyArbiterLane;
  rank: number;
  active: boolean;
  blocked: boolean;
  unknown: boolean;
  reason: string;
  data: Record<string, unknown> | null;
}

export interface EconomyArbiterStatus {
  timestamp: number;
  enabled: boolean;
  state: EconomyArbiterState;
  reason: string;
  selected: EconomyArbiterLaneStatus | null;
  lanes: EconomyArbiterLaneStatus[];
  summary: {
    active: number;
    blocked: number;
    unknown: number;
  };
  policy: {
    laneOrder: EconomyArbiterLane[];
    unknownBlocksLowerPriority: true;
    safetyBlocksLowerPriority: true;
    backgroundDynamicScoring: false;
    enforcementEnabled: boolean;
    executionEnabled: false;
    valueMutationForced: false;
  };
}

export interface EconomyArbiterEvent {
  type: "ECONOMY_ARBITER_UPDATED";
  timestamp: number;
  reason: string;
  status: EconomyArbiterStatus;
}

export interface EconomyArbiterAuthorization {
  enforced: boolean;
  allowed: boolean;
  lane: EconomyArbiterLane;
  selectedLane: EconomyArbiterLane | null;
  state: EconomyArbiterState;
  reason: string;
}

export interface EconomyArbiterIntent {
  module: string;
  action: string;
  why: string;
  metadata?: Record<string, unknown>;
}

const ECONOMY_ACTIONS = new Set([
  "UPGRADE",
  "COMPOUND",
  "EXCHANGE",
  "CRAFT",
]);

const ECONOMY_MODULES = new Set([
  "UpgradeController",
  "CompoundController",
  "ExchangeController",
  "CraftController",
]);

const ECONOMY_PREBUFF_SKILLS = new Set([
  "massproduction",
  "massproductionpp",
  "massexchange",
  "massexchangepp",
]);

export function economyArbiterLaneForIntent(
  intent: EconomyArbiterIntent,
): EconomyArbiterLane | null {
  const module = typeof intent.module === "string" ? intent.module.trim() : "";
  const action = typeof intent.action === "string"
    ? intent.action.trim().toUpperCase()
    : "";
  const why = typeof intent.why === "string"
    ? intent.why.trim().toUpperCase()
    : "";
  const skill =
    typeof intent.metadata?.skill === "string"
      ? intent.metadata.skill.trim().toLowerCase()
      : "";

  if (action === "MERRIT_STATUS_REQUEST") {
    return null;
  }
  if (
    (module === "MerchantMerritController" ||
      module === "MerchantFishingController") &&
    why.includes("RESTORE")
  ) {
    return null;
  }

  if (module === "MerchantMerritController" || why.startsWith("MERRIT_")) {
    return "MERRIT";
  }
  if (module === "MerchantLogistics") {
    return "CRITICAL_FARMER_LOGISTICS";
  }
  if (
    module === "MerchantSkillController" &&
    ECONOMY_PREBUFF_SKILLS.has(skill)
  ) {
    return "ECONOMY_PREBUFF";
  }
  if (ECONOMY_MODULES.has(module) || ECONOMY_ACTIONS.has(action)) {
    return "ECONOMY";
  }
  if (
    module === "MerchantFishingController" ||
    why.startsWith("FISHING_")
  ) {
    return "BACKGROUND";
  }
  return null;
}

export interface EconomyArbiterControllerOptions {
  now?: () => number;
  config?: () => unknown;
  signals?: () => Partial<Record<EconomyArbiterLane, EconomyArbiterSignal>>;
  onEvent?: (event: EconomyArbiterEvent) => void;
}

interface NormalizedEconomyArbiterConfig {
  enabled: boolean;
  enforcementEnabled: boolean;
}

const LANE_ORDER: EconomyArbiterLane[] = [
  "SAFETY",
  "MERRIT",
  "CRITICAL_FARMER_LOGISTICS",
  "ECONOMY_PREBUFF",
  "ECONOMY",
  "MERCHANT_STAND",
  "BACKGROUND",
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeConfig(value: unknown): NormalizedEconomyArbiterConfig {
  const root = record(value);
  const arbiter = record(root.economyArbiter ?? root.economy_arbiter);
  return {
    enabled: arbiter.enabled !== false,
    enforcementEnabled:
      arbiter.enforcementEnabled === true ||
      arbiter.enforcement_enabled === true,
  };
}

function normalizeSignal(
  lane: EconomyArbiterLane,
  rank: number,
  signal: EconomyArbiterSignal | undefined,
): EconomyArbiterLaneStatus {
  return {
    lane,
    rank,
    active: signal?.active === true,
    blocked: signal?.blocked === true,
    unknown: signal?.unknown === true,
    reason:
      typeof signal?.reason === "string" && signal.reason.trim()
        ? signal.reason.trim()
        : `${lane}_INACTIVE`,
    data:
      signal?.data && typeof signal.data === "object" && !Array.isArray(signal.data)
        ? { ...signal.data }
        : null,
  };
}

function emptyStatus(
  timestamp: number,
  enabled: boolean,
  state: EconomyArbiterState,
  reason: string,
  enforcementEnabled = false,
): EconomyArbiterStatus {
  return {
    timestamp,
    enabled,
    state,
    reason,
    selected: null,
    lanes: LANE_ORDER.map((lane, rank) =>
      normalizeSignal(lane, rank, undefined),
    ),
    summary: {
      active: 0,
      blocked: 0,
      unknown: 0,
    },
    policy: {
      laneOrder: [...LANE_ORDER],
      unknownBlocksLowerPriority: true,
      safetyBlocksLowerPriority: true,
      backgroundDynamicScoring: false,
      enforcementEnabled,
      executionEnabled: false,
      valueMutationForced: false,
    },
  };
}

export class EconomyArbiterController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly signalSource: () => Partial<
    Record<EconomyArbiterLane, EconomyArbiterSignal>
  >;
  private readonly onEvent?: (event: EconomyArbiterEvent) => void;
  private lastEventSignature: string | null = null;
  private lastStatus: EconomyArbiterStatus;

  constructor(options: EconomyArbiterControllerOptions = {}) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.signalSource = options.signals || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = emptyStatus(
      this.now(),
      true,
      "IDLE",
      "ECONOMY_ARBITER_IDLE",
    );
  }

  status(): EconomyArbiterStatus {
    return this.lastStatus;
  }

  authorize(lane: EconomyArbiterLane): EconomyArbiterAuthorization {
    const status = this.tick();
    const selectedLane = status.selected?.lane || null;

    if (!status.policy.enforcementEnabled) {
      return {
        enforced: false,
        allowed: true,
        lane,
        selectedLane,
        state: status.state,
        reason: "ECONOMY_ARBITER_ENFORCEMENT_DISABLED",
      };
    }

    if (!status.enabled) {
      return {
        enforced: true,
        allowed: false,
        lane,
        selectedLane,
        state: status.state,
        reason: "ECONOMY_ARBITER_DISABLED",
      };
    }

    if (status.state !== "READY") {
      return {
        enforced: true,
        allowed: false,
        lane,
        selectedLane,
        state: status.state,
        reason:
          status.state === "UNKNOWN"
            ? "ECONOMY_ARBITER_UNKNOWN_BLOCK"
            : status.state === "BLOCKED"
              ? "ECONOMY_ARBITER_SELECTED_BLOCKED"
              : "ECONOMY_ARBITER_LANE_NOT_SELECTED",
      };
    }

    if (selectedLane !== lane) {
      return {
        enforced: true,
        allowed: false,
        lane,
        selectedLane,
        state: status.state,
        reason: "ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED",
      };
    }

    return {
      enforced: true,
      allowed: true,
      lane,
      selectedLane,
      state: status.state,
      reason: "ECONOMY_ARBITER_LANE_AUTHORIZED",
    };
  }

  tick(): EconomyArbiterStatus {
    const timestamp = this.now();
    const config = normalizeConfig(this.configSource());

    if (!config.enabled) {
      return this.publish(
        emptyStatus(
          timestamp,
          false,
          "DISABLED",
          "ECONOMY_ARBITER_DISABLED",
          config.enforcementEnabled,
        ),
      );
    }

    const source = this.signalSource() || {};
    const lanes = LANE_ORDER.map((lane, rank) =>
      normalizeSignal(lane, rank, source[lane]),
    );
    const selected = lanes.find((lane) => lane.active) || null;
    const summary = {
      active: lanes.filter((lane) => lane.active).length,
      blocked: lanes.filter((lane) => lane.active && lane.blocked).length,
      unknown: lanes.filter((lane) => lane.active && lane.unknown).length,
    };

    if (!selected) {
      return this.publish({
        ...emptyStatus(
          timestamp,
          true,
          "IDLE",
          "ECONOMY_ARBITER_IDLE",
          config.enforcementEnabled,
        ),
        lanes,
        summary,
      });
    }

    let state: EconomyArbiterState = "READY";
    let reason = "ECONOMY_ARBITER_SELECTED";

    if (selected.unknown) {
      state = "UNKNOWN";
      reason = "ECONOMY_ARBITER_SELECTED_UNKNOWN";
    } else if (selected.lane === "SAFETY" || selected.blocked) {
      state = "BLOCKED";
      reason =
        selected.lane === "SAFETY"
          ? "ECONOMY_ARBITER_SAFETY_BLOCK"
          : "ECONOMY_ARBITER_SELECTED_BLOCKED";
    }

    return this.publish({
      timestamp,
      enabled: true,
      state,
      reason,
      selected,
      lanes,
      summary,
      policy: {
        laneOrder: [...LANE_ORDER],
        unknownBlocksLowerPriority: true,
        safetyBlocksLowerPriority: true,
        backgroundDynamicScoring: false,
        enforcementEnabled: config.enforcementEnabled,
        executionEnabled: false,
        valueMutationForced: false,
      },
    });
  }

  private publish(status: EconomyArbiterStatus): EconomyArbiterStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      selected: status.selected,
      lanes: status.lanes,
      summary: status.summary,
      policy: status.policy,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "ECONOMY_ARBITER_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

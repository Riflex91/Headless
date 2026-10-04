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

export interface EconomyArbiterControllerOptions {
  now?: () => number;
  config?: () => unknown;
  signals?: () => Partial<Record<EconomyArbiterLane, EconomyArbiterSignal>>;
  onEvent?: (event: EconomyArbiterEvent) => void;
}

interface NormalizedEconomyArbiterConfig {
  enabled: boolean;
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
        ...emptyStatus(timestamp, true, "IDLE", "ECONOMY_ARBITER_IDLE"),
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

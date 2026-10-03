import type { EquipmentSnapshot } from "./game-adapter.lib";
import type {
  GearScoringController,
  GearScoringEntry,
} from "./gear-scoring-controller.lib";

export type FutureGearState = "DISABLED" | "EMPTY" | "READY";

export type FutureGearDecision =
  | "CANDIDATE"
  | "NOT_BETTER"
  | "SCORE_UNKNOWN"
  | "SLOT_UNRESOLVED"
  | "BASELINE_UNKNOWN";

export interface FutureGearEntry {
  inventorySlot: number;
  name: string | null;
  level: number;
  slotGroup: string | null;
  score: number | null;
  targetSlots: string[];
  baselineSlot: string | null;
  baselineScore: number | null;
  scoreDelta: number | null;
  candidate: boolean;
  decision: FutureGearDecision;
  reason: string;
}

export interface FutureGearSummary {
  inventoryGear: number;
  candidates: number;
  notBetter: number;
  scoreUnknown: number;
  slotUnresolved: number;
  baselineUnknown: number;
}

export interface FutureGearStatus {
  timestamp: number;
  enabled: boolean;
  state: FutureGearState;
  reason: string;
  minScoreDelta: number;
  entries: FutureGearEntry[];
  summary: FutureGearSummary;
}

export interface FutureGearEvent {
  type: "FUTURE_GEAR_UPDATED";
  timestamp: number;
  reason: string;
  status: FutureGearStatus;
}

export interface FutureGearControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: FutureGearEvent) => void;
}

interface FutureGearGameAdapter {
  equipment(): EquipmentSnapshot;
}

interface NormalizedFutureGearConfig {
  enabled: boolean;
  minScoreDelta: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeConfig(value: unknown): NormalizedFutureGearConfig {
  const root = record(value);
  const gear = record(root.gear);
  const policy = record(gear.futureGearPolicy);
  const configuredDelta = finite(policy.minScoreDelta);

  return {
    enabled: bool(policy.enabled, true),
    minScoreDelta: Math.max(0, configuredDelta ?? 0),
  };
}

function targetSlots(slotGroup: string | null): string[] {
  if (!slotGroup) return [];

  switch (slotGroup) {
    case "ring":
      return ["ring1", "ring2"];
    case "earring":
      return ["earring1", "earring2"];
    case "weapon":
      return ["mainhand"];
    case "offhand":
      return ["offhand"];
    default:
      return [slotGroup];
  }
}

function equipmentScoreBySlot(
  entries: GearScoringEntry[],
): Map<string, GearScoringEntry> {
  return new Map(
    entries
      .filter(
        (entry) =>
          entry.location === "EQUIPMENT" && typeof entry.slot === "string",
      )
      .map((entry) => [String(entry.slot), entry]),
  );
}

function emptySummary(): FutureGearSummary {
  return {
    inventoryGear: 0,
    candidates: 0,
    notBetter: 0,
    scoreUnknown: 0,
    slotUnresolved: 0,
    baselineUnknown: 0,
  };
}

function decisionEntry(
  entry: GearScoringEntry,
  equipment: EquipmentSnapshot,
  scoreBySlot: Map<string, GearScoringEntry>,
  minScoreDelta: number,
): FutureGearEntry {
  const inventorySlot =
    typeof entry.slot === "number" && Number.isInteger(entry.slot)
      ? entry.slot
      : -1;
  const targets = targetSlots(entry.slotGroup);

  const base = {
    inventorySlot,
    name: entry.name,
    level: entry.level,
    slotGroup: entry.slotGroup,
    score: entry.score,
    targetSlots: targets,
  };

  if (entry.score === null || !Number.isFinite(entry.score)) {
    return {
      ...base,
      baselineSlot: null,
      baselineScore: null,
      scoreDelta: null,
      candidate: false,
      decision: "SCORE_UNKNOWN",
      reason: "FUTURE_GEAR_SCORE_UNKNOWN",
    };
  }

  const availableTargets = targets.filter((slot) =>
    Object.prototype.hasOwnProperty.call(equipment, slot),
  );
  if (availableTargets.length === 0) {
    return {
      ...base,
      baselineSlot: null,
      baselineScore: null,
      scoreDelta: null,
      candidate: false,
      decision: "SLOT_UNRESOLVED",
      reason: "FUTURE_GEAR_SLOT_UNRESOLVED",
    };
  }

  const emptySlot = availableTargets.find((slot) => !equipment[slot]);
  if (emptySlot) {
    const delta = entry.score;
    const candidate = delta > minScoreDelta;
    return {
      ...base,
      baselineSlot: emptySlot,
      baselineScore: 0,
      scoreDelta: delta,
      candidate,
      decision: candidate ? "CANDIDATE" : "NOT_BETTER",
      reason: candidate
        ? "FUTURE_GEAR_EMPTY_SLOT_IMPROVEMENT"
        : "FUTURE_GEAR_NOT_BETTER",
    };
  }

  const scoredTargets = availableTargets.map((slot) => ({
    slot,
    score: scoreBySlot.get(slot)?.score ?? null,
  }));
  if (
    scoredTargets.some(
      (target) => target.score === null || !Number.isFinite(target.score),
    )
  ) {
    return {
      ...base,
      baselineSlot: null,
      baselineScore: null,
      scoreDelta: null,
      candidate: false,
      decision: "BASELINE_UNKNOWN",
      reason: "FUTURE_GEAR_BASELINE_UNKNOWN",
    };
  }

  const baseline = scoredTargets.reduce((lowest, current) =>
    Number(current.score) < Number(lowest.score) ? current : lowest,
  );
  const baselineScore = Number(baseline.score);
  const delta = Math.round((entry.score - baselineScore) * 10000) / 10000;
  const candidate = delta > minScoreDelta;

  return {
    ...base,
    baselineSlot: baseline.slot,
    baselineScore,
    scoreDelta: delta,
    candidate,
    decision: candidate ? "CANDIDATE" : "NOT_BETTER",
    reason: candidate
      ? "FUTURE_GEAR_SCORE_IMPROVEMENT"
      : "FUTURE_GEAR_NOT_BETTER",
  };
}

export class FutureGearController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: FutureGearEvent) => void;
  private lastEventSignature: string | null = null;
  private lastStatus: FutureGearStatus;

  constructor(
    private readonly game: FutureGearGameAdapter,
    private readonly gearScoring: GearScoringController,
    options: FutureGearControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    const config = normalizeConfig(this.configSource());
    this.lastStatus = this.emptyStatus(
      this.now(),
      config.enabled,
      config.enabled ? "EMPTY" : "DISABLED",
      config.enabled ? "FUTURE_GEAR_EMPTY" : "FUTURE_GEAR_DISABLED",
      config.minScoreDelta,
    );
  }

  status(): FutureGearStatus {
    return this.lastStatus;
  }

  candidateSlots(): number[] {
    return this.lastStatus.entries
      .filter((entry) => entry.candidate)
      .map((entry) => entry.inventorySlot)
      .filter((slot) => slot >= 0);
  }

  tick(): FutureGearStatus {
    const timestamp = this.now();
    const config = normalizeConfig(this.configSource());

    if (!config.enabled) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          false,
          "DISABLED",
          "FUTURE_GEAR_DISABLED",
          config.minScoreDelta,
        ),
      );
    }

    const scoring = this.gearScoring.status();
    if (scoring.state === "DISABLED") {
      return this.publish(
        this.emptyStatus(
          timestamp,
          true,
          "EMPTY",
          "FUTURE_GEAR_GEAR_SCORING_DISABLED",
          config.minScoreDelta,
        ),
      );
    }

    const inventoryEntries = scoring.entries.filter(
      (entry) => entry.location === "INVENTORY",
    );
    const equipment = this.game.equipment();
    const scoreBySlot = equipmentScoreBySlot(scoring.entries);
    const entries = inventoryEntries.map((entry) =>
      decisionEntry(
        entry,
        equipment,
        scoreBySlot,
        config.minScoreDelta,
      ),
    );

    const summary = emptySummary();
    summary.inventoryGear = entries.length;
    for (const entry of entries) {
      if (entry.candidate) summary.candidates += 1;
      if (entry.decision === "NOT_BETTER") summary.notBetter += 1;
      if (entry.decision === "SCORE_UNKNOWN") summary.scoreUnknown += 1;
      if (entry.decision === "SLOT_UNRESOLVED") summary.slotUnresolved += 1;
      if (entry.decision === "BASELINE_UNKNOWN") summary.baselineUnknown += 1;
    }

    const status: FutureGearStatus = {
      timestamp,
      enabled: true,
      state: entries.length > 0 ? "READY" : "EMPTY",
      reason:
        entries.length > 0 ? "FUTURE_GEAR_READY" : "FUTURE_GEAR_EMPTY",
      minScoreDelta: config.minScoreDelta,
      entries,
      summary,
    };

    return this.publish(status);
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: FutureGearState,
    reason: string,
    minScoreDelta: number,
  ): FutureGearStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      minScoreDelta,
      entries: [],
      summary: emptySummary(),
    };
  }

  private publish(status: FutureGearStatus): FutureGearStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      minScoreDelta: status.minScoreDelta,
      entries: status.entries,
      summary: status.summary,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "FUTURE_GEAR_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

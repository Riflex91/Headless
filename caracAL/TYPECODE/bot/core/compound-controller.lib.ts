import type { ActionRecord } from "./action-ledger.lib";
import type { CompoundRequest } from "./action-boundary.lib";
import type { InventorySlotSnapshot } from "./game-adapter.lib";
import type {
  InventoryIntelligenceEntry,
  InventoryIntelligenceStatus,
} from "./inventory-intelligence-controller.lib";

export type CompoundState =
  | "DISABLED"
  | "EMPTY"
  | "READY"
  | "EXECUTING"
  | "UNKNOWN_HOLD";

export interface CompoundDecision {
  itemSlots: number[];
  name: string | null;
  currentLevel: number | null;
  disposition: string;
  protections: string[];
  eligible: boolean;
  reason: string;
  maxLevel: number | null;
  itemGrade: number | null;
  scrollName: string | null;
  scrollSlot: number | null;
}

export interface CompoundCandidate {
  itemSlots: [number, number, number];
  name: string;
  currentLevel: number;
  maxLevel: number;
  itemGrade: number;
  scrollName: string;
  scrollSlot: number;
  offeringSlot: null;
  reason: "COMPOUND_POLICY_ELIGIBLE";
}

export interface CompoundUnknownHold {
  actionId: string;
  fingerprint: string;
  itemSlots: [number, number, number];
  name: string;
  level: number;
  scrollSlot: number;
  reason: string;
  createdAt: number;
}

export interface CompoundActionSummary {
  id: string;
  status: ActionRecord["status"];
  why: string;
  error: string | null;
  itemSlots: [number, number, number];
  name: string;
  fromLevel: number;
  scrollSlot: number;
  scrollName: string;
  compoundSucceeded: boolean | null;
}

export interface CompoundStatus {
  timestamp: number;
  enabled: boolean;
  state: CompoundState;
  reason: string;
  executionMode: "EXPLICIT_ONE_SHOT";
  selected: CompoundCandidate | null;
  candidates: CompoundCandidate[];
  decisions: CompoundDecision[];
  unknownHold: CompoundUnknownHold | null;
  lastAction: CompoundActionSummary | null;
  summary: {
    compoundDispositionItems: number;
    protectedCompoundItems: number;
    eligibleCandidates: number;
    scrollPolicyGrades: number;
  };
}

export interface CompoundEvent {
  type: "COMPOUND_UPDATED";
  timestamp: number;
  reason: string;
  actionId?: string;
  status: CompoundStatus;
}

export interface CompoundControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: CompoundEvent) => void;
}

interface CompoundGameAdapter {
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
  itemGrade(item: Record<string, unknown>): number | null;
}

interface CompoundActionBoundary {
  compound(request: CompoundRequest): Promise<ActionRecord>;
}

interface CompoundInventoryIntelligence {
  status(): InventoryIntelligenceStatus;
}

interface NormalizedCompoundConfig {
  enabled: boolean;
  maxLevel: number | null;
  maxLevelByItem: Map<string, number>;
  scrollByGrade: Map<number, string>;
  allowedSlots: Set<number> | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const normalized = integer(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNameMap(value: unknown): Map<number, string> {
  const result = new Map<number, string>();
  for (const [rawKey, rawName] of Object.entries(record(value))) {
    const key = Number(rawKey);
    const name = text(rawName);
    if (!Number.isInteger(key) || key < 0 || !name) continue;
    result.set(key, name);
  }
  return result;
}

function normalizeItemMaxLevels(value: unknown): Map<string, number> {
  const result = new Map<string, number>();
  for (const [rawName, rawLevel] of Object.entries(record(value))) {
    const name = text(rawName);
    const level = nonNegativeInteger(rawLevel);
    if (!name || level === null) continue;
    result.set(name, level);
  }
  return result;
}

function normalizeAllowedSlots(value: unknown): Set<number> | null {
  if (!Array.isArray(value)) return null;
  return new Set(
    value
      .map((slot) => nonNegativeInteger(slot))
      .filter((slot): slot is number => slot !== null),
  );
}

function normalizeConfig(value: unknown): NormalizedCompoundConfig {
  const root = record(value);
  const compound = record(root.compound);
  return {
    enabled: bool(compound.enabled, true),
    maxLevel: nonNegativeInteger(compound.maxLevel),
    maxLevelByItem: normalizeItemMaxLevels(
      compound.maxLevelByItem ?? compound.itemMaxLevels,
    ),
    scrollByGrade: normalizeNameMap(
      compound.scrollByGrade ?? compound.scrollsByGrade,
    ),
    allowedSlots: normalizeAllowedSlots(compound.allowedSlots),
  };
}

function itemRecord(
  inventory: InventorySlotSnapshot[],
  slot: number,
): Record<string, unknown> | null {
  const found = inventory.find((entry) => entry.slot === slot)?.item;
  return found ? record(found) : null;
}

function itemName(item: Record<string, unknown> | null): string | null {
  return item ? text(item.name) : null;
}

function itemLevel(item: Record<string, unknown> | null): number | null {
  if (!item) return null;
  return nonNegativeInteger(item.level) ?? 0;
}

function itemQuantity(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  return Math.max(1, nonNegativeInteger(item.q) ?? 1);
}

function itemFingerprint(
  slot: number,
  item: Record<string, unknown> | null,
): unknown[] {
  return [
    slot,
    itemName(item),
    itemLevel(item),
    item?.p ?? null,
    itemQuantity(item),
  ];
}

function mutationFingerprint(
  inventory: InventorySlotSnapshot[],
  candidate: Pick<CompoundCandidate, "itemSlots" | "scrollSlot">,
): string {
  return JSON.stringify([
    ...candidate.itemSlots.map((slot) =>
      itemFingerprint(slot, itemRecord(inventory, slot)),
    ),
    itemFingerprint(
      candidate.scrollSlot,
      itemRecord(inventory, candidate.scrollSlot),
    ),
  ]);
}

function isDefinitionCompoundable(
  definition: Record<string, unknown>,
): boolean {
  return Object.prototype.hasOwnProperty.call(definition, "compound");
}

function actionSummary(
  action: ActionRecord,
  candidate: CompoundCandidate,
): CompoundActionSummary {
  const evidence = record(action.evidence);
  return {
    id: action.id,
    status: action.status,
    why: action.why,
    error: action.error || null,
    itemSlots: [...candidate.itemSlots] as [number, number, number],
    name: candidate.name,
    fromLevel: candidate.currentLevel,
    scrollSlot: candidate.scrollSlot,
    scrollName: candidate.scrollName,
    compoundSucceeded:
      typeof evidence.compoundSucceeded === "boolean"
        ? evidence.compoundSucceeded
        : null,
  };
}

export class CompoundController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: CompoundEvent) => void;
  private configOverride: unknown | undefined;
  private busy = false;
  private unknownHold: CompoundUnknownHold | null = null;
  private lastAction: CompoundActionSummary | null = null;
  private lastEventSignature: string | null = null;
  private lastStatus: CompoundStatus;

  constructor(
    private readonly game: CompoundGameAdapter,
    private readonly actions: CompoundActionBoundary,
    private readonly inventoryIntelligence: CompoundInventoryIntelligence,
    options: CompoundControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      true,
      "EMPTY",
      "COMPOUND_NO_ELIGIBLE_CANDIDATE",
    );
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  status(): CompoundStatus {
    return this.lastStatus;
  }

  tick(): CompoundStatus {
    return this.publish(this.plan());
  }

  async executeNext(): Promise<CompoundStatus> {
    if (this.busy) {
      return this.publish({
        ...this.plan(),
        state: "EXECUTING",
        reason: "COMPOUND_ACTION_ALREADY_RUNNING",
      });
    }

    const plan = this.plan();
    if (
      !plan.enabled ||
      plan.state === "UNKNOWN_HOLD" ||
      !plan.selected
    ) {
      return this.publish(plan);
    }

    const candidate = plan.selected;
    const fingerprint = mutationFingerprint(this.game.inventory(), candidate);

    this.busy = true;
    this.publish({
      ...plan,
      state: "EXECUTING",
      reason: "COMPOUND_ACTION_DISPATCHING",
    });

    try {
      const action = await this.actions.compound({
        module: "CompoundController",
        why: "COMPOUND_POLICY_SELECTED",
        itemSlots: [...candidate.itemSlots] as [number, number, number],
        scrollSlot: candidate.scrollSlot,
        offeringSlot: null,
      });
      this.lastAction = actionSummary(action, candidate);

      if (action.status === "UNKNOWN") {
        this.unknownHold = {
          actionId: action.id,
          fingerprint,
          itemSlots: [...candidate.itemSlots] as [number, number, number],
          name: candidate.name,
          level: candidate.currentLevel,
          scrollSlot: candidate.scrollSlot,
          reason:
            action.error || action.why || "COMPOUND_OUTCOME_UNKNOWN",
          createdAt: this.now(),
        };
      }
    } finally {
      this.busy = false;
    }

    return this.publish(this.plan());
  }

  private plan(): CompoundStatus {
    const now = this.now();
    const config = normalizeConfig(
      this.configOverride === undefined
        ? this.configSource()
        : this.configOverride,
    );

    if (!config.enabled) {
      return this.emptyStatus(
        now,
        false,
        "DISABLED",
        "COMPOUND_DISABLED",
      );
    }

    const inventory = this.game.inventory();
    this.reconcileUnknownHold(inventory);

    const gameData = record(this.game.gameData());
    const itemDefinitions = record(gameData.items);
    const intelligence = this.inventoryIntelligence.status();
    const intelligenceBySlot = new Map(
      intelligence.entries.map((entry) => [entry.slot, entry]),
    );
    const compoundEntries = intelligence.entries
      .filter(
        (entry) =>
          entry.disposition === "COMPOUND" &&
          (!config.allowedSlots || config.allowedSlots.has(entry.slot)),
      )
      .sort((left, right) => left.slot - right.slot);

    const groups = new Map<string, InventoryIntelligenceEntry[]>();
    for (const entry of compoundEntries) {
      const key = JSON.stringify([entry.name, entry.level]);
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    }

    const decisions: CompoundDecision[] = [];
    const candidates: CompoundCandidate[] = [];

    for (const group of groups.values()) {
      const decision = this.decide(
        group,
        inventory,
        intelligenceBySlot,
        itemDefinitions,
        config,
      );
      decisions.push(decision);
      if (
        decision.eligible &&
        decision.name &&
        decision.currentLevel !== null &&
        decision.maxLevel !== null &&
        decision.itemGrade !== null &&
        decision.scrollName &&
        decision.scrollSlot !== null &&
        decision.itemSlots.length >= 3
      ) {
        const slots = decision.itemSlots
          .slice(0, 3)
          .sort((left, right) => left - right) as [
          number,
          number,
          number,
        ];
        candidates.push({
          itemSlots: slots,
          name: decision.name,
          currentLevel: decision.currentLevel,
          maxLevel: decision.maxLevel,
          itemGrade: decision.itemGrade,
          scrollName: decision.scrollName,
          scrollSlot: decision.scrollSlot,
          offeringSlot: null,
          reason: "COMPOUND_POLICY_ELIGIBLE",
        });
      }
    }

    candidates.sort(
      (left, right) =>
        left.itemSlots[0] - right.itemSlots[0] ||
        left.name.localeCompare(right.name) ||
        left.currentLevel - right.currentLevel,
    );
    decisions.sort(
      (left, right) =>
        (left.itemSlots[0] ?? Number.MAX_SAFE_INTEGER) -
          (right.itemSlots[0] ?? Number.MAX_SAFE_INTEGER) ||
        (left.name || "").localeCompare(right.name || ""),
    );

    const selected = this.unknownHold ? null : candidates[0] || null;
    const state: CompoundState = this.unknownHold
      ? "UNKNOWN_HOLD"
      : selected
        ? "READY"
        : "EMPTY";
    const reason = this.unknownHold
      ? "COMPOUND_UNKNOWN_HOLD_ACTIVE"
      : selected
        ? "COMPOUND_CANDIDATE_READY"
        : "COMPOUND_NO_ELIGIBLE_CANDIDATE";

    return {
      timestamp: now,
      enabled: true,
      state,
      reason,
      executionMode: "EXPLICIT_ONE_SHOT",
      selected,
      candidates,
      decisions,
      unknownHold: this.unknownHold ? { ...this.unknownHold } : null,
      lastAction: this.lastAction ? { ...this.lastAction } : null,
      summary: {
        compoundDispositionItems: compoundEntries.length,
        protectedCompoundItems: compoundEntries.filter(
          (entry) => entry.protected,
        ).length,
        eligibleCandidates: candidates.length,
        scrollPolicyGrades: config.scrollByGrade.size,
      },
    };
  }

  private decide(
    group: InventoryIntelligenceEntry[],
    inventory: InventorySlotSnapshot[],
    intelligenceBySlot: Map<number, InventoryIntelligenceEntry>,
    itemDefinitions: Record<string, unknown>,
    config: NormalizedCompoundConfig,
  ): CompoundDecision {
    const first = group[0];
    const allSlots = group.map((entry) => entry.slot).sort((a, b) => a - b);
    const protections = Array.from(
      new Set(group.flatMap((entry) => entry.protections)),
    ).sort();
    const usable = group
      .filter((entry) => !entry.protected && entry.protections.length === 0)
      .sort((left, right) => left.slot - right.slot);

    const base: CompoundDecision = {
      itemSlots: usable.map((entry) => entry.slot),
      name: first?.name || null,
      currentLevel: first?.level ?? null,
      disposition: "COMPOUND",
      protections,
      eligible: false,
      reason: "COMPOUND_NOT_ELIGIBLE",
      maxLevel: null,
      itemGrade: null,
      scrollName: null,
      scrollSlot: null,
    };

    if (!first?.name || first.level === null) {
      return { ...base, itemSlots: allSlots, reason: "COMPOUND_ITEM_STATE_UNKNOWN" };
    }

    if (usable.length < 3) {
      return {
        ...base,
        reason:
          group.length >= 3
            ? "COMPOUND_ITEMS_PROTECTED"
            : "COMPOUND_TRIPLE_MISSING",
      };
    }

    const selectedEntries = usable.slice(0, 3);
    const selectedItems = selectedEntries.map((entry) =>
      itemRecord(inventory, entry.slot),
    );
    if (
      selectedItems.some(
        (item) =>
          !item ||
          itemName(item) !== first.name ||
          itemLevel(item) !== first.level,
      )
    ) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        reason: "COMPOUND_ITEM_STATE_MISMATCH",
      };
    }

    const definitionValue = itemDefinitions[first.name];
    if (
      !definitionValue ||
      typeof definitionValue !== "object" ||
      !isDefinitionCompoundable(record(definitionValue))
    ) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        reason: "COMPOUND_ITEM_NOT_COMPOUNDABLE",
      };
    }

    const maxLevel =
      config.maxLevelByItem.get(first.name) ?? config.maxLevel;
    if (maxLevel === null) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        reason: "COMPOUND_MAX_LEVEL_POLICY_MISSING",
      };
    }
    if (first.level >= maxLevel) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        maxLevel,
        reason: "COMPOUND_MAX_LEVEL_REACHED",
      };
    }

    const grades = selectedItems.map((item) =>
      item ? this.game.itemGrade(item) : null,
    );
    if (
      grades.some(
        (grade) =>
          grade === null || !Number.isInteger(grade) || Number(grade) < 0,
      )
    ) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        maxLevel,
        reason: "COMPOUND_ITEM_GRADE_UNKNOWN",
      };
    }
    if (!grades.every((grade) => grade === grades[0])) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        maxLevel,
        reason: "COMPOUND_ITEM_GRADE_MISMATCH",
      };
    }

    const itemGrade = grades[0] as number;
    const scrollName = config.scrollByGrade.get(itemGrade) || null;
    if (!scrollName) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        maxLevel,
        itemGrade,
        reason: "COMPOUND_SCROLL_POLICY_MISSING",
      };
    }
    if (scrollName !== "cscroll" + itemGrade) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        maxLevel,
        itemGrade,
        scrollName,
        reason: "COMPOUND_SCROLL_GRADE_MISMATCH",
      };
    }

    const selectedSlots = new Set(selectedEntries.map((entry) => entry.slot));
    const scrollSlot =
      inventory
        .filter((slot) => !selectedSlots.has(slot.slot))
        .filter(
          (slot) =>
            itemName(slot.item ? record(slot.item) : null) === scrollName,
        )
        .filter(
          (slot) => itemQuantity(slot.item ? record(slot.item) : null) > 0,
        )
        .filter((slot) => {
          const intelligenceEntry = intelligenceBySlot.get(slot.slot);
          return (
            !!intelligenceEntry &&
            !intelligenceEntry.protected &&
            intelligenceEntry.protections.length === 0
          );
        })
        .map((slot) => slot.slot)
        .sort((left, right) => left - right)[0] ?? null;

    if (scrollSlot === null) {
      return {
        ...base,
        itemSlots: selectedEntries.map((entry) => entry.slot),
        maxLevel,
        itemGrade,
        scrollName,
        reason: "COMPOUND_SCROLL_MISSING",
      };
    }

    return {
      ...base,
      itemSlots: selectedEntries.map((entry) => entry.slot),
      maxLevel,
      itemGrade,
      scrollName,
      scrollSlot,
      eligible: true,
      reason: "COMPOUND_POLICY_ELIGIBLE",
    };
  }

  private reconcileUnknownHold(inventory: InventorySlotSnapshot[]): void {
    if (!this.unknownHold) return;
    const currentFingerprint = JSON.stringify([
      ...this.unknownHold.itemSlots.map((slot) =>
        itemFingerprint(slot, itemRecord(inventory, slot)),
      ),
      itemFingerprint(
        this.unknownHold.scrollSlot,
        itemRecord(inventory, this.unknownHold.scrollSlot),
      ),
    ]);
    if (currentFingerprint !== this.unknownHold.fingerprint) {
      this.unknownHold = null;
    }
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: CompoundState,
    reason: string,
  ): CompoundStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      executionMode: "EXPLICIT_ONE_SHOT",
      selected: null,
      candidates: [],
      decisions: [],
      unknownHold: this.unknownHold ? { ...this.unknownHold } : null,
      lastAction: this.lastAction ? { ...this.lastAction } : null,
      summary: {
        compoundDispositionItems: 0,
        protectedCompoundItems: 0,
        eligibleCandidates: 0,
        scrollPolicyGrades: 0,
      },
    };
  }

  private publish(status: CompoundStatus): CompoundStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      selected: status.selected,
      candidates: status.candidates,
      decisions: status.decisions,
      unknownHold: status.unknownHold,
      lastAction: status.lastAction,
      summary: status.summary,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "COMPOUND_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        ...(status.lastAction?.id && { actionId: status.lastAction.id }),
        status,
      });
    }

    return status;
  }
}

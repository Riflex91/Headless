import type { ActionRecord } from "./action-ledger.lib";
import type { UpgradeRequest } from "./action-boundary.lib";
import type { InventorySlotSnapshot } from "./game-adapter.lib";
import type {
  InventoryIntelligenceEntry,
  InventoryIntelligenceStatus,
} from "./inventory-intelligence-controller.lib";

export type UpgradeState =
  | "DISABLED"
  | "EMPTY"
  | "READY"
  | "EXECUTING"
  | "UNKNOWN_HOLD";

export interface UpgradeDecision {
  itemSlot: number;
  name: string | null;
  currentLevel: number | null;
  disposition: string;
  protections: string[];
  eligible: boolean;
  reason: string;
  maxLevel: number | null;
  scrollName: string | null;
  scrollSlot: number | null;
}

export interface UpgradeCandidate {
  itemSlot: number;
  name: string;
  currentLevel: number;
  maxLevel: number;
  scrollName: string;
  scrollSlot: number;
  offeringSlot: null;
  reason: "UPGRADE_POLICY_ELIGIBLE";
}

export interface UpgradeUnknownHold {
  actionId: string;
  fingerprint: string;
  itemSlot: number;
  name: string;
  level: number;
  reason: string;
  createdAt: number;
}

export interface UpgradeActionSummary {
  id: string;
  status: ActionRecord["status"];
  why: string;
  error: string | null;
  itemSlot: number;
  name: string;
  fromLevel: number;
  scrollSlot: number;
  scrollName: string;
  upgradeSucceeded: boolean | null;
}

export interface UpgradeStatus {
  timestamp: number;
  enabled: boolean;
  state: UpgradeState;
  reason: string;
  executionMode: "EXPLICIT_ONE_SHOT";
  selected: UpgradeCandidate | null;
  candidates: UpgradeCandidate[];
  decisions: UpgradeDecision[];
  unknownHold: UpgradeUnknownHold | null;
  lastAction: UpgradeActionSummary | null;
  summary: {
    upgradeDispositionItems: number;
    protectedUpgradeItems: number;
    eligibleCandidates: number;
    scrollPolicyLevels: number;
  };
}

export interface UpgradeEvent {
  type: "UPGRADE_UPDATED";
  timestamp: number;
  reason: string;
  actionId?: string;
  status: UpgradeStatus;
}

export interface UpgradeControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: UpgradeEvent) => void;
}

interface UpgradeGameAdapter {
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
}

interface UpgradeActionBoundary {
  ["upgrade"]: (request: UpgradeRequest) => Promise<ActionRecord>;
}

interface UpgradeInventoryIntelligence {
  status(): InventoryIntelligenceStatus;
}

interface NormalizedUpgradeConfig {
  enabled: boolean;
  maxLevel: number | null;
  maxLevelByItem: Map<string, number>;
  scrollByCurrentLevel: Map<number, string>;
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

function normalizeLevelMap(value: unknown): Map<number, string> {
  const result = new Map<number, string>();
  for (const [rawLevel, rawName] of Object.entries(record(value))) {
    const level = Number(rawLevel);
    const name = text(rawName);
    if (!Number.isInteger(level) || level < 0 || !name) continue;
    result.set(level, name);
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

function normalizeConfig(value: unknown): NormalizedUpgradeConfig {
  const root = record(value);
  const upgrade = record(root.upgrade);
  return {
    enabled: bool(upgrade.enabled, true),
    maxLevel: nonNegativeInteger(upgrade.maxLevel),
    maxLevelByItem: normalizeItemMaxLevels(
      upgrade.maxLevelByItem ?? upgrade.itemMaxLevels,
    ),
    scrollByCurrentLevel: normalizeLevelMap(
      upgrade.scrollByCurrentLevel ?? upgrade.scrollsByCurrentLevel,
    ),
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
  const quantity = nonNegativeInteger(item.q);
  return Math.max(1, quantity ?? 1);
}

function itemFingerprint(
  slot: number,
  item: Record<string, unknown> | null,
): string {
  return JSON.stringify([
    slot,
    itemName(item),
    itemLevel(item),
    item?.p ?? null,
    itemQuantity(item),
  ]);
}

function isDefinitionUpgradable(definition: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(definition, "upgrade");
}

function actionSummary(
  action: ActionRecord,
  candidate: UpgradeCandidate,
): UpgradeActionSummary {
  const evidence = record(action.evidence);
  return {
    id: action.id,
    status: action.status,
    why: action.why,
    error: action.error || null,
    itemSlot: candidate.itemSlot,
    name: candidate.name,
    fromLevel: candidate.currentLevel,
    scrollSlot: candidate.scrollSlot,
    scrollName: candidate.scrollName,
    upgradeSucceeded:
      typeof evidence.upgradeSucceeded === "boolean"
        ? evidence.upgradeSucceeded
        : null,
  };
}

export class UpgradeController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: UpgradeEvent) => void;
  private configOverride: unknown | undefined;
  private busy = false;
  private unknownHold: UpgradeUnknownHold | null = null;
  private lastAction: UpgradeActionSummary | null = null;
  private lastEventSignature: string | null = null;
  private lastStatus: UpgradeStatus;

  constructor(
    private readonly game: UpgradeGameAdapter,
    private readonly actions: UpgradeActionBoundary,
    private readonly inventoryIntelligence: UpgradeInventoryIntelligence,
    options: UpgradeControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      true,
      "EMPTY",
      "UPGRADE_NO_ELIGIBLE_CANDIDATE",
    );
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  status(): UpgradeStatus {
    return this.lastStatus;
  }

  tick(): UpgradeStatus {
    return this.publish(this.plan());
  }

  async executeNext(): Promise<UpgradeStatus> {
    if (this.busy) {
      return this.publish({
        ...this.plan(),
        state: "EXECUTING",
        reason: "UPGRADE_ACTION_ALREADY_RUNNING",
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
    const inventory = this.game.inventory();
    const item = itemRecord(inventory, candidate.itemSlot);
    const fingerprint = itemFingerprint(candidate.itemSlot, item);

    this.busy = true;
    this.publish({
      ...plan,
      state: "EXECUTING",
      reason: "UPGRADE_ACTION_DISPATCHING",
    });

    try {
      const action = await this.actions.upgrade({
        module: "UpgradeController",
        why: "UPGRADE_POLICY_SELECTED",
        itemSlot: candidate.itemSlot,
        scrollSlot: candidate.scrollSlot,
        offeringSlot: null,
      });
      this.lastAction = actionSummary(action, candidate);

      if (action.status === "UNKNOWN") {
        this.unknownHold = {
          actionId: action.id,
          fingerprint,
          itemSlot: candidate.itemSlot,
          name: candidate.name,
          level: candidate.currentLevel,
          reason: action.error || action.why || "UPGRADE_OUTCOME_UNKNOWN",
          createdAt: this.now(),
        };
      }
    } finally {
      this.busy = false;
    }

    return this.publish(this.plan());
  }

  private plan(): UpgradeStatus {
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
        "UPGRADE_DISABLED",
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
    const upgradeEntries = intelligence.entries.filter(
      (entry) => entry.disposition === "UPGRADE",
    );
    const decisions: UpgradeDecision[] = [];
    const candidates: UpgradeCandidate[] = [];

    for (const entry of upgradeEntries) {
      const decision = this.decide(
        entry,
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
        decision.scrollName &&
        decision.scrollSlot !== null
      ) {
        candidates.push({
          itemSlot: decision.itemSlot,
          name: decision.name,
          currentLevel: decision.currentLevel,
          maxLevel: decision.maxLevel,
          scrollName: decision.scrollName,
          scrollSlot: decision.scrollSlot,
          offeringSlot: null,
          reason: "UPGRADE_POLICY_ELIGIBLE",
        });
      }
    }

    candidates.sort(
      (left, right) =>
        left.itemSlot - right.itemSlot ||
        left.name.localeCompare(right.name),
    );
    decisions.sort((left, right) => left.itemSlot - right.itemSlot);

    const selected = this.unknownHold ? null : candidates[0] || null;
    const state: UpgradeState = this.unknownHold
      ? "UNKNOWN_HOLD"
      : selected
        ? "READY"
        : "EMPTY";
    const reason = this.unknownHold
      ? "UPGRADE_UNKNOWN_HOLD_ACTIVE"
      : selected
        ? "UPGRADE_CANDIDATE_READY"
        : "UPGRADE_NO_ELIGIBLE_CANDIDATE";

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
        upgradeDispositionItems: upgradeEntries.length,
        protectedUpgradeItems: upgradeEntries.filter(
          (entry) => entry.protected,
        ).length,
        eligibleCandidates: candidates.length,
        scrollPolicyLevels: config.scrollByCurrentLevel.size,
      },
    };
  }

  private decide(
    entry: InventoryIntelligenceEntry,
    inventory: InventorySlotSnapshot[],
    intelligenceBySlot: Map<number, InventoryIntelligenceEntry>,
    itemDefinitions: Record<string, unknown>,
    config: NormalizedUpgradeConfig,
  ): UpgradeDecision {
    const base: UpgradeDecision = {
      itemSlot: entry.slot,
      name: entry.name,
      currentLevel: entry.level,
      disposition: entry.disposition,
      protections: [...entry.protections],
      eligible: false,
      reason: "UPGRADE_NOT_ELIGIBLE",
      maxLevel: null,
      scrollName: null,
      scrollSlot: null,
    };

    if (entry.protected || entry.protections.length > 0) {
      return { ...base, reason: "UPGRADE_ITEM_PROTECTED" };
    }

    const item = itemRecord(inventory, entry.slot);
    const name = itemName(item);
    if (!item || !name || name !== entry.name) {
      return { ...base, reason: "UPGRADE_ITEM_STATE_MISMATCH" };
    }

    const definitionValue = itemDefinitions[name];
    if (
      !definitionValue ||
      typeof definitionValue !== "object" ||
      !isDefinitionUpgradable(record(definitionValue))
    ) {
      return { ...base, reason: "UPGRADE_ITEM_NOT_UPGRADABLE" };
    }

    const currentLevel = itemLevel(item);
    if (currentLevel === null) {
      return { ...base, reason: "UPGRADE_LEVEL_UNKNOWN" };
    }

    const maxLevel =
      config.maxLevelByItem.get(name) ?? config.maxLevel;
    if (maxLevel === null) {
      return {
        ...base,
        currentLevel,
        reason: "UPGRADE_MAX_LEVEL_POLICY_MISSING",
      };
    }
    if (currentLevel >= maxLevel) {
      return {
        ...base,
        currentLevel,
        maxLevel,
        reason: "UPGRADE_MAX_LEVEL_REACHED",
      };
    }

    const scrollName = config.scrollByCurrentLevel.get(currentLevel) || null;
    if (!scrollName) {
      return {
        ...base,
        currentLevel,
        maxLevel,
        reason: "UPGRADE_SCROLL_POLICY_MISSING",
      };
    }

    const scrollSlot =
      inventory
        .filter((slot) => slot.slot !== entry.slot)
        .filter((slot) => itemName(slot.item ? record(slot.item) : null) === scrollName)
        .filter((slot) => itemQuantity(slot.item ? record(slot.item) : null) > 0)
        .filter((slot) => {
          const intelligenceEntry = intelligenceBySlot.get(slot.slot);
          return !intelligenceEntry?.protected;
        })
        .map((slot) => slot.slot)
        .sort((left, right) => left - right)[0] ?? null;

    if (scrollSlot === null) {
      return {
        ...base,
        currentLevel,
        maxLevel,
        scrollName,
        reason: "UPGRADE_SCROLL_MISSING",
      };
    }

    return {
      ...base,
      currentLevel,
      maxLevel,
      scrollName,
      scrollSlot,
      eligible: true,
      reason: "UPGRADE_POLICY_ELIGIBLE",
    };
  }

  private reconcileUnknownHold(inventory: InventorySlotSnapshot[]): void {
    if (!this.unknownHold) return;
    const item = itemRecord(inventory, this.unknownHold.itemSlot);
    const currentFingerprint = itemFingerprint(
      this.unknownHold.itemSlot,
      item,
    );
    if (currentFingerprint !== this.unknownHold.fingerprint) {
      this.unknownHold = null;
    }
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: UpgradeState,
    reason: string,
  ): UpgradeStatus {
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
        upgradeDispositionItems: 0,
        protectedUpgradeItems: 0,
        eligibleCandidates: 0,
        scrollPolicyLevels: 0,
      },
    };
  }

  private publish(status: UpgradeStatus): UpgradeStatus {
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
        type: "UPGRADE_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        ...(status.lastAction?.id && { actionId: status.lastAction.id }),
        status,
      });
    }

    return status;
  }
}

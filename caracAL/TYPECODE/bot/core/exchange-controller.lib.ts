import type { ActionRecord } from "./action-ledger.lib";
import type { ExchangeRequest } from "./action-boundary.lib";
import type { InventorySlotSnapshot } from "./game-adapter.lib";
import type {
  InventoryIntelligenceEntry,
  InventoryIntelligenceStatus,
} from "./inventory-intelligence-controller.lib";

export type ExchangeState =
  | "DISABLED"
  | "EMPTY"
  | "READY"
  | "EXECUTING"
  | "UNKNOWN_HOLD";

export interface ExchangeDecision {
  itemSlot: number;
  name: string | null;
  quantity: number;
  disposition: string;
  protections: string[];
  eligible: boolean;
  reason: string;
  requiredQuantity: number | null;
}

export interface ExchangeCandidate {
  itemSlot: number;
  name: string;
  quantity: number;
  requiredQuantity: number;
  reason: "EXCHANGE_POLICY_ELIGIBLE";
}

export interface ExchangeUnknownHold {
  actionId: string;
  fingerprint: string;
  itemSlot: number;
  name: string;
  requiredQuantity: number;
  reason: string;
  createdAt: number;
}

export interface ExchangeActionSummary {
  id: string;
  status: ActionRecord["status"];
  why: string;
  error: string | null;
  itemSlot: number;
  name: string;
  requiredQuantity: number;
  exchangeSucceeded: boolean | null;
}

export interface ExchangeStatus {
  timestamp: number;
  enabled: boolean;
  state: ExchangeState;
  reason: string;
  executionMode: "EXPLICIT_ONE_SHOT";
  selected: ExchangeCandidate | null;
  candidates: ExchangeCandidate[];
  decisions: ExchangeDecision[];
  unknownHold: ExchangeUnknownHold | null;
  lastAction: ExchangeActionSummary | null;
  summary: {
    exchangeDispositionItems: number;
    protectedExchangeItems: number;
    eligibleCandidates: number;
  };
}

export interface ExchangeEvent {
  type: "EXCHANGE_UPDATED";
  timestamp: number;
  reason: string;
  actionId?: string;
  status: ExchangeStatus;
}

export interface ExchangeControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: ExchangeEvent) => void;
}

interface ExchangeGameAdapter {
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
}

interface ExchangeActionBoundary {
  ["exchange"]: (request: ExchangeRequest) => Promise<ActionRecord>;
}

interface ExchangeInventoryIntelligence {
  status(): InventoryIntelligenceStatus;
}

interface NormalizedExchangeConfig {
  enabled: boolean;
  allowedItems: Set<string> | null;
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

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  const normalized = nonNegativeInteger(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeStringSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null;
  return new Set(
    value
      .map((entry) => text(entry))
      .filter((entry): entry is string => entry !== null),
  );
}

function normalizeSlotSet(value: unknown): Set<number> | null {
  if (!Array.isArray(value)) return null;
  return new Set(
    value
      .map((entry) => nonNegativeInteger(entry))
      .filter((entry): entry is number => entry !== null),
  );
}

function normalizeConfig(value: unknown): NormalizedExchangeConfig {
  const root = record(value);
  const exchange = record(root.exchange);
  return {
    enabled: bool(exchange.enabled, true),
    allowedItems: normalizeStringSet(exchange.allowedItems),
    allowedSlots: normalizeSlotSet(exchange.allowedSlots),
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
    nonNegativeInteger(item?.level) ?? 0,
    item?.p ?? null,
    itemQuantity(item),
  ]);
}

function requiredExchangeQuantity(
  itemDefinitions: Record<string, unknown>,
  name: string,
): number | null {
  const raw = itemDefinitions[name];
  if (!raw || typeof raw !== "object") return null;
  return positiveInteger(record(raw).e);
}

function actionSummary(
  action: ActionRecord,
  candidate: ExchangeCandidate,
): ExchangeActionSummary {
  const evidence = record(action.evidence);
  return {
    id: action.id,
    status: action.status,
    why: action.why,
    error: action.error || null,
    itemSlot: candidate.itemSlot,
    name: candidate.name,
    requiredQuantity: candidate.requiredQuantity,
    exchangeSucceeded:
      typeof evidence.exchangeSucceeded === "boolean"
        ? evidence.exchangeSucceeded
        : null,
  };
}

export class ExchangeController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: ExchangeEvent) => void;
  private configOverride: unknown | undefined;
  private busy = false;
  private unknownHold: ExchangeUnknownHold | null = null;
  private lastAction: ExchangeActionSummary | null = null;
  private lastEventSignature: string | null = null;
  private lastStatus: ExchangeStatus;

  constructor(
    private readonly game: ExchangeGameAdapter,
    private readonly actions: ExchangeActionBoundary,
    private readonly inventoryIntelligence: ExchangeInventoryIntelligence,
    options: ExchangeControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      true,
      "EMPTY",
      "EXCHANGE_NO_ELIGIBLE_CANDIDATE",
    );
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  status(): ExchangeStatus {
    return this.lastStatus;
  }

  tick(): ExchangeStatus {
    return this.publish(this.plan());
  }

  async executeNext(): Promise<ExchangeStatus> {
    if (this.busy) {
      return this.publish({
        ...this.plan(),
        state: "EXECUTING",
        reason: "EXCHANGE_ACTION_ALREADY_RUNNING",
      });
    }

    const plan = this.plan();
    if (!plan.enabled || plan.state === "UNKNOWN_HOLD" || !plan.selected) {
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
      reason: "EXCHANGE_ACTION_DISPATCHING",
    });

    try {
      const action = await this.actions.exchange({
        module: "ExchangeController",
        why: "EXCHANGE_POLICY_SELECTED",
        itemSlot: candidate.itemSlot,
      });
      this.lastAction = actionSummary(action, candidate);

      if (action.status === "UNKNOWN") {
        this.unknownHold = {
          actionId: action.id,
          fingerprint,
          itemSlot: candidate.itemSlot,
          name: candidate.name,
          requiredQuantity: candidate.requiredQuantity,
          reason: action.error || action.why || "EXCHANGE_OUTCOME_UNKNOWN",
          createdAt: this.now(),
        };
      }
    } finally {
      this.busy = false;
    }

    return this.publish(this.plan());
  }

  private plan(): ExchangeStatus {
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
        "EXCHANGE_DISABLED",
      );
    }

    const inventory = this.game.inventory();
    this.reconcileUnknownHold(inventory);

    const gameData = record(this.game.gameData());
    const itemDefinitions = record(gameData.items);
    const intelligence = this.inventoryIntelligence.status();
    const exchangeEntries = intelligence.entries.filter(
      (entry) =>
        entry.disposition === "EXCHANGE" &&
        (!config.allowedSlots || config.allowedSlots.has(entry.slot)) &&
        (!config.allowedItems ||
          (entry.name !== null && config.allowedItems.has(entry.name))),
    );

    const decisions = exchangeEntries.map((entry) =>
      this.decide(entry, inventory, itemDefinitions),
    );
    const candidates = decisions
      .filter(
        (
          decision,
        ): decision is ExchangeDecision & {
          name: string;
          requiredQuantity: number;
        } =>
          decision.eligible &&
          decision.name !== null &&
          decision.requiredQuantity !== null,
      )
      .map((decision) => ({
        itemSlot: decision.itemSlot,
        name: decision.name,
        quantity: decision.quantity,
        requiredQuantity: decision.requiredQuantity,
        reason: "EXCHANGE_POLICY_ELIGIBLE" as const,
      }))
      .sort(
        (left, right) =>
          left.itemSlot - right.itemSlot ||
          left.name.localeCompare(right.name),
      );

    decisions.sort((left, right) => left.itemSlot - right.itemSlot);

    const selected = this.unknownHold ? null : candidates[0] || null;
    const state: ExchangeState = this.unknownHold
      ? "UNKNOWN_HOLD"
      : selected
        ? "READY"
        : "EMPTY";
    const reason = this.unknownHold
      ? "EXCHANGE_UNKNOWN_HOLD_ACTIVE"
      : selected
        ? "EXCHANGE_CANDIDATE_READY"
        : "EXCHANGE_NO_ELIGIBLE_CANDIDATE";

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
        exchangeDispositionItems: exchangeEntries.length,
        protectedExchangeItems: exchangeEntries.filter(
          (entry) => entry.protected,
        ).length,
        eligibleCandidates: candidates.length,
      },
    };
  }

  private decide(
    entry: InventoryIntelligenceEntry,
    inventory: InventorySlotSnapshot[],
    itemDefinitions: Record<string, unknown>,
  ): ExchangeDecision {
    const item = itemRecord(inventory, entry.slot);
    const quantity = itemQuantity(item);
    const base: ExchangeDecision = {
      itemSlot: entry.slot,
      name: entry.name,
      quantity,
      disposition: entry.disposition,
      protections: [...entry.protections],
      eligible: false,
      reason: "EXCHANGE_NOT_ELIGIBLE",
      requiredQuantity: null,
    };

    if (entry.protected || entry.protections.length > 0) {
      return { ...base, reason: "EXCHANGE_ITEM_PROTECTED" };
    }

    const name = itemName(item);
    if (!item || !name || name !== entry.name) {
      return { ...base, reason: "EXCHANGE_ITEM_STATE_MISMATCH" };
    }

    const requiredQuantity = requiredExchangeQuantity(itemDefinitions, name);
    if (requiredQuantity === null) {
      return {
        ...base,
        name,
        reason: "EXCHANGE_ITEM_NOT_EXCHANGEABLE",
      };
    }

    if (quantity < requiredQuantity) {
      return {
        ...base,
        name,
        requiredQuantity,
        reason: "EXCHANGE_QUANTITY_INSUFFICIENT",
      };
    }

    return {
      ...base,
      name,
      quantity,
      requiredQuantity,
      eligible: true,
      reason: "EXCHANGE_POLICY_ELIGIBLE",
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
    state: ExchangeState,
    reason: string,
  ): ExchangeStatus {
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
        exchangeDispositionItems: 0,
        protectedExchangeItems: 0,
        eligibleCandidates: 0,
      },
    };
  }

  private publish(status: ExchangeStatus): ExchangeStatus {
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
        type: "EXCHANGE_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        ...(status.lastAction?.id && { actionId: status.lastAction.id }),
        status,
      });
    }

    return status;
  }
}

import type {
  CharacterSnapshot,
  InventorySlotSnapshot,
  NpcSnapshot,
} from "./game-adapter.lib";
import type {
  InventoryIntelligenceController,
  InventoryIntelligenceEntry,
} from "./inventory-intelligence-controller.lib";
import type { MovementController } from "./movement-controller.lib";
import type {
  ExchangeController,
  ExchangeStatus,
} from "./exchange-controller.lib";

export interface ExchangeLiveTestOptions {
  requestId?: string;
  itemName: string;
  itemSlot: number;
  settleTimeoutMs?: number;
  settlePollMs?: number;
}

export interface ExchangeLiveRuntimePreflight {
  map: string | null;
  exchangeInProgress: boolean;
}

export interface ExchangeLiveItemState {
  slot: number;
  name: string | null;
  level: number | null;
  quantity: number;
  property: unknown;
  present: boolean;
}

export interface ExchangeLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  target: {
    itemName: string;
    itemSlot: number | null;
    requiredQuantity: number | null;
  };
  before: {
    item: ExchangeLiveItemState | null;
    totalQuantity: number;
  };
  after: {
    item: ExchangeLiveItemState | null;
    totalQuantity: number;
  };
  exchange: ExchangeStatus | null;
  evidence: {
    inventoryIntelligenceReady: boolean;
    itemDefinitionExchangeable: boolean;
    exactItemObserved: boolean;
    quantitySufficient: boolean;
    itemUnprotectedBefore: boolean;
    exactCandidateSelected: boolean;
    stationLocated: boolean;
    stationId: string | null;
    stationMap: string | null;
    stationX: number | null;
    stationY: number | null;
    stationDistanceBefore: number | null;
    stationTravelRequired: boolean;
    stationTravelConfirmed: boolean;
    stationTravelActionId: string | null;
    stationTravelStatus: string | null;
    stationDistanceAfter: number | null;
    stationProximityReady: boolean;
    movementIdleBeforeDispatch: boolean;
    localPreflightReadOnly: boolean;
    exchangeOperationIdle: boolean;
    itemLockClear: boolean;
    mapAllowsExchange: boolean;
    itemStillExactBeforeDispatch: boolean;
    quantityStillSufficientBeforeDispatch: boolean;
    exactCandidateStillSelected: boolean;
    actionDispatchedOnce: boolean;
    actionConfirmed: boolean;
    exchangeSucceeded: boolean | null;
    itemStateChanged: boolean;
    quantityConsumed: boolean;
    mutationObserved: boolean;
    blindRetryAvoided: boolean;
  };
  scope: {
    movementMutationAllowed: true;
    upgradeMutationAllowed: false;
    compoundMutationAllowed: false;
    exchangeMutationAllowed: true;
    craftMutationAllowed: false;
    irreversibleMutation: true;
    blindRetryAllowed: false;
    mutationScope: "single-exchange-attempt-only";
  };
  cleanup: {
    inventoryConfigOverrideCleared: boolean;
    exchangeConfigOverrideCleared: boolean;
  };
}

interface ExchangeLiveGameAdapter {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  npcs(mapName?: string | null): NpcSnapshot[];
  gameData(): Record<string, unknown>;
}

interface ExchangeLiveTestDependencies {
  game: ExchangeLiveGameAdapter;
  inventoryIntelligence: Pick<
    InventoryIntelligenceController,
    "status" | "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  exchange: Pick<
    ExchangeController,
    "status" | "tick" | "executeNext" | "setConfigOverride" | "clearConfigOverride"
  >;
  movement: Pick<MovementController, "smart" | "status">;
  runtimePreflight: () => ExchangeLiveRuntimePreflight;
  characterName?: () => string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface SelectedExchangeTarget {
  itemName: string;
  itemSlot: number;
  requiredQuantity: number;
  entry: InventoryIntelligenceEntry;
}

const EXCHANGE_STATION_ID = "exchange";
const EXCHANGE_STATION_MAP = "main";
const EXCHANGE_STATION_MAX_DISTANCE = 60;

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

function inventoryItem(
  inventory: InventorySlotSnapshot[],
  slot: number,
): Record<string, unknown> | null {
  const raw = inventory.find((entry) => entry.slot === slot)?.item;
  return raw ? record(raw) : null;
}

function itemLocked(item: Record<string, unknown> | null): boolean {
  if (!item) return false;
  return item.locked === true || (typeof item.l === "string" && item.l.length > 0);
}

function itemQuantity(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  return Math.max(1, nonNegativeInteger(item.q) ?? 1);
}

function itemState(
  inventory: InventorySlotSnapshot[],
  slot: number,
): ExchangeLiveItemState {
  const item = inventoryItem(inventory, slot);
  return {
    slot,
    name: item ? text(item.name) : null,
    level: item ? nonNegativeInteger(item.level) ?? 0 : null,
    quantity: itemQuantity(item),
    property: item?.p ?? null,
    present: !!item,
  };
}

function stateSignature(state: ExchangeLiveItemState | null): string {
  return JSON.stringify(
    state
      ? [
          state.slot,
          state.name,
          state.level,
          state.quantity,
          state.property,
          state.present,
        ]
      : null,
  );
}

function totalItemQuantity(
  inventory: InventorySlotSnapshot[],
  name: string,
): number {
  return inventory.reduce((total, entry) => {
    const item = entry.item ? record(entry.item) : null;
    if (!item || text(item.name) !== name) return total;
    return total + itemQuantity(item);
  }, 0);
}

function requiredExchangeQuantity(
  gameData: Record<string, unknown>,
  itemName: string,
): number | null {
  const definition = record(record(gameData.items)[itemName]);
  return positiveInteger(definition.e);
}

function stationDistance(
  character: CharacterSnapshot,
  station: NpcSnapshot,
): number | null {
  if (
    character.map !== station.map ||
    typeof character.x !== "number" ||
    !Number.isFinite(character.x) ||
    typeof character.y !== "number" ||
    !Number.isFinite(character.y) ||
    typeof station.x !== "number" ||
    !Number.isFinite(station.x) ||
    typeof station.y !== "number" ||
    !Number.isFinite(station.y)
  ) {
    return null;
  }
  return Math.hypot(character.x - station.x, character.y - station.y);
}

function selectExchangeLiveTarget(
  inventory: InventorySlotSnapshot[],
  intelligenceEntries: InventoryIntelligenceEntry[],
  gameData: Record<string, unknown>,
  itemName: string,
  itemSlot: number,
): SelectedExchangeTarget | null {
  if (!Number.isInteger(itemSlot) || itemSlot < 0) return null;

  const item = inventoryItem(inventory, itemSlot);
  if (!item || text(item.name) !== itemName) return null;

  const requiredQuantity = requiredExchangeQuantity(gameData, itemName);
  if (requiredQuantity === null || itemQuantity(item) < requiredQuantity) {
    return null;
  }

  const entry = intelligenceEntries.find(
    (candidate) =>
      candidate.slot === itemSlot &&
      candidate.name === itemName &&
      candidate.disposition === "EXCHANGE",
  );
  if (!entry || entry.protected || entry.protections.length > 0) return null;

  return {
    itemName,
    itemSlot,
    requiredQuantity,
    entry,
  };
}

function baseEvidence(): ExchangeLiveTestResult["evidence"] {
  return {
    inventoryIntelligenceReady: false,
    itemDefinitionExchangeable: false,
    exactItemObserved: false,
    quantitySufficient: false,
    itemUnprotectedBefore: false,
    exactCandidateSelected: false,
    stationLocated: false,
    stationId: null,
    stationMap: null,
    stationX: null,
    stationY: null,
    stationDistanceBefore: null,
    stationTravelRequired: false,
    stationTravelConfirmed: false,
    stationTravelActionId: null,
    stationTravelStatus: null,
    stationDistanceAfter: null,
    stationProximityReady: false,
    movementIdleBeforeDispatch: false,
    localPreflightReadOnly: false,
    exchangeOperationIdle: false,
    itemLockClear: false,
    mapAllowsExchange: false,
    itemStillExactBeforeDispatch: false,
    quantityStillSufficientBeforeDispatch: false,
    exactCandidateStillSelected: false,
    actionDispatchedOnce: false,
    actionConfirmed: false,
    exchangeSucceeded: null,
    itemStateChanged: false,
    quantityConsumed: false,
    mutationObserved: false,
    blindRetryAvoided: true,
  };
}

export class ExchangeLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ExchangeLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(options: ExchangeLiveTestOptions): Promise<ExchangeLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `exchange-live-${startedAt}`;
    const itemName = text(options.itemName);
    const itemSlot = nonNegativeInteger(options.itemSlot);
    const settleTimeoutMs = Math.max(500, options.settleTimeoutMs || 3000);
    const settlePollMs = Math.max(25, options.settlePollMs || 100);
    const evidence = baseEvidence();

    let selected: SelectedExchangeTarget | null = null;
    let beforeItem: ExchangeLiveItemState | null = null;
    let afterItem: ExchangeLiveItemState | null = null;
    let beforeTotalQuantity = 0;
    let afterTotalQuantity = 0;
    let exchangeStatus: ExchangeStatus | null = null;
    let outcome: ExchangeLiveTestResult["outcome"] = "FAIL";
    let reason = "EXCHANGE_LIVE_EVIDENCE_INCOMPLETE";
    let inventoryConfigOverrideCleared = false;
    let exchangeConfigOverrideCleared = false;
    let executionAttempts = 0;
    let finalResult: ExchangeLiveTestResult | null = null;

    const finish = (): ExchangeLiveTestResult => {
      const completedAt = this.now();
      return {
        requestId,
        outcome,
        reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        character: this.deps.characterName?.() || null,
        target: {
          itemName: itemName || "",
          itemSlot,
          requiredQuantity: selected?.requiredQuantity ?? null,
        },
        before: {
          item: beforeItem,
          totalQuantity: beforeTotalQuantity,
        },
        after: {
          item: afterItem,
          totalQuantity: afterTotalQuantity,
        },
        exchange: exchangeStatus,
        evidence: {
          ...evidence,
          actionDispatchedOnce:
            executionAttempts === 1 && !!exchangeStatus?.lastAction?.id,
          actionConfirmed: exchangeStatus?.lastAction?.status === "CONFIRMED",
          exchangeSucceeded:
            typeof exchangeStatus?.lastAction?.exchangeSucceeded === "boolean"
              ? exchangeStatus.lastAction.exchangeSucceeded
              : null,
          blindRetryAvoided: executionAttempts <= 1,
        },
        scope: {
          movementMutationAllowed: true,
          upgradeMutationAllowed: false,
          compoundMutationAllowed: false,
          exchangeMutationAllowed: true,
          craftMutationAllowed: false,
          irreversibleMutation: true,
          blindRetryAllowed: false,
          mutationScope: "single-exchange-attempt-only",
        },
        cleanup: {
          inventoryConfigOverrideCleared,
          exchangeConfigOverrideCleared,
        },
      };
    };

    if (!itemName || itemSlot === null) {
      reason = "EXCHANGE_LIVE_EXPLICIT_ITEM_AND_SLOT_REQUIRED";
      return (finalResult = finish());
    }

    try {
      const originalIntelligence = this.deps.inventoryIntelligence.tick();
      evidence.inventoryIntelligenceReady = ["READY", "EMPTY"].includes(
        originalIntelligence.state,
      );
      if (!evidence.inventoryIntelligenceReady) {
        reason = "EXCHANGE_LIVE_INVENTORY_INTELLIGENCE_NOT_READY";
        return (finalResult = finish());
      }

      const initialInventory = this.deps.game.inventory();
      const gameData = this.deps.game.gameData();
      const requiredQuantity = requiredExchangeQuantity(gameData, itemName);
      evidence.itemDefinitionExchangeable = requiredQuantity !== null;
      if (requiredQuantity === null) {
        reason = "EXCHANGE_LIVE_ITEM_NOT_EXCHANGEABLE";
        return (finalResult = finish());
      }

      const initialItem = inventoryItem(initialInventory, itemSlot);
      evidence.exactItemObserved =
        !!initialItem && text(initialItem.name) === itemName;
      evidence.quantitySufficient =
        !!initialItem && itemQuantity(initialItem) >= requiredQuantity;
      const initialEntry = originalIntelligence.entries.find(
        (entry) => entry.slot === itemSlot && entry.name === itemName,
      );
      evidence.itemUnprotectedBefore =
        !!initialEntry &&
        !initialEntry.protected &&
        initialEntry.protections.length === 0;

      selected = selectExchangeLiveTarget(
        initialInventory,
        originalIntelligence.entries,
        gameData,
        itemName,
        itemSlot,
      );
      if (!selected) {
        reason = "EXCHANGE_LIVE_SAFE_ITEM_NOT_FOUND";
        return (finalResult = finish());
      }

      beforeItem = itemState(initialInventory, itemSlot);
      beforeTotalQuantity = totalItemQuantity(initialInventory, itemName);
      afterItem = beforeItem;
      afterTotalQuantity = beforeTotalQuantity;

      this.deps.inventoryIntelligence.setConfigOverride({
        inventory: {
          intelligence: {
            enabled: true,
          },
          rules: {
            [itemName]: "EXCHANGE",
          },
        },
      });
      this.deps.inventoryIntelligence.tick();

      this.deps.exchange.setConfigOverride({
        exchange: {
          enabled: true,
          allowedItems: [itemName],
          allowedSlots: [itemSlot],
        },
      });

      const planned = this.deps.exchange.tick();
      evidence.exactCandidateSelected =
        planned.state === "READY" &&
        planned.selected?.name === itemName &&
        planned.selected?.itemSlot === itemSlot &&
        planned.selected?.requiredQuantity === selected.requiredQuantity;

      if (!evidence.exactCandidateSelected) {
        exchangeStatus = planned;
        reason = planned.reason || "EXCHANGE_LIVE_EXACT_CANDIDATE_NOT_READY";
        return (finalResult = finish());
      }

      const station =
        this.deps.game
          .npcs(EXCHANGE_STATION_MAP)
          .find(
            (npc) =>
              npc.id === EXCHANGE_STATION_ID &&
              npc.map === EXCHANGE_STATION_MAP &&
              typeof npc.x === "number" &&
              Number.isFinite(npc.x) &&
              typeof npc.y === "number" &&
              Number.isFinite(npc.y),
          ) || null;

      evidence.stationLocated = !!station;
      evidence.stationId = station?.id || null;
      evidence.stationMap = station?.map || null;
      evidence.stationX = station?.x ?? null;
      evidence.stationY = station?.y ?? null;

      if (!station) {
        exchangeStatus = planned;
        reason = "EXCHANGE_LIVE_STATION_NOT_FOUND";
        return (finalResult = finish());
      }

      evidence.stationDistanceBefore = stationDistance(
        this.deps.game.character(),
        station,
      );
      evidence.stationTravelRequired =
        evidence.stationDistanceBefore === null ||
        evidence.stationDistanceBefore > EXCHANGE_STATION_MAX_DISTANCE;

      if (evidence.stationTravelRequired) {
        try {
          const travel = await this.deps.movement.smart({
            owner: "ExchangeLiveTest",
            module: "ExchangeLiveTest",
            why: "EXCHANGE_STATION_REQUIRED",
            correlationId: requestId,
            destination: {
              map: station.map,
              x: station.x as number,
              y: station.y as number,
            },
          });
          evidence.stationTravelActionId = travel.id;
          evidence.stationTravelStatus = travel.status || null;
          evidence.stationTravelConfirmed = travel.status === "CONFIRMED";

          if (travel.status === "UNKNOWN") {
            exchangeStatus = planned;
            outcome = "UNKNOWN";
            reason =
              "EXCHANGE_LIVE_STATION_TRAVEL_UNKNOWN_NO_EXCHANGE_DISPATCH";
            return (finalResult = finish());
          }
          if (!evidence.stationTravelConfirmed) {
            exchangeStatus = planned;
            reason = "EXCHANGE_LIVE_STATION_TRAVEL_NOT_CONFIRMED";
            return (finalResult = finish());
          }
        } catch (_error) {
          exchangeStatus = planned;
          reason = "EXCHANGE_LIVE_STATION_TRAVEL_ERROR";
          return (finalResult = finish());
        }
      } else {
        evidence.stationTravelConfirmed = true;
      }

      let dispatchCharacter = this.deps.game.character();
      evidence.stationDistanceAfter = stationDistance(dispatchCharacter, station);
      evidence.stationProximityReady =
        evidence.stationDistanceAfter !== null &&
        evidence.stationDistanceAfter <= EXCHANGE_STATION_MAX_DISTANCE &&
        dispatchCharacter.moving !== true;

      if (!evidence.stationProximityReady) {
        exchangeStatus = planned;
        reason = "EXCHANGE_LIVE_STATION_PROXIMITY_NOT_CONFIRMED";
        return (finalResult = finish());
      }

      const runtimePreflight = this.deps.runtimePreflight();
      const dispatchInventory = this.deps.game.inventory();
      const dispatchItem = inventoryItem(dispatchInventory, itemSlot);
      dispatchCharacter = this.deps.game.character();
      evidence.stationDistanceAfter = stationDistance(dispatchCharacter, station);
      evidence.stationProximityReady =
        evidence.stationDistanceAfter !== null &&
        evidence.stationDistanceAfter <= EXCHANGE_STATION_MAX_DISTANCE &&
        dispatchCharacter.moving !== true;
      const movementStatus = this.deps.movement.status();
      evidence.movementIdleBeforeDispatch =
        movementStatus.owner === null && movementStatus.active === null;
      evidence.localPreflightReadOnly = true;
      evidence.exchangeOperationIdle =
        runtimePreflight.exchangeInProgress !== true;
      evidence.itemLockClear = !itemLocked(dispatchItem);
      evidence.mapAllowsExchange =
        !!text(runtimePreflight.map) &&
        !text(runtimePreflight.map)!.toLowerCase().startsWith("bank");
      evidence.itemStillExactBeforeDispatch =
        !!dispatchItem && text(dispatchItem.name) === itemName;
      evidence.quantityStillSufficientBeforeDispatch =
        !!dispatchItem &&
        itemQuantity(dispatchItem) >= selected.requiredQuantity;

      const dispatchIntelligence = this.deps.inventoryIntelligence.tick();
      const dispatchPlan = this.deps.exchange.tick();
      const dispatchEntry = dispatchIntelligence.entries.find(
        (entry) => entry.slot === itemSlot && entry.name === itemName,
      );
      evidence.exactCandidateStillSelected =
        !!dispatchEntry &&
        !dispatchEntry.protected &&
        dispatchEntry.protections.length === 0 &&
        dispatchPlan.state === "READY" &&
        dispatchPlan.selected?.name === itemName &&
        dispatchPlan.selected?.itemSlot === itemSlot &&
        dispatchPlan.selected?.requiredQuantity === selected.requiredQuantity;

      if (
        !evidence.stationProximityReady ||
        !evidence.movementIdleBeforeDispatch ||
        !evidence.exchangeOperationIdle ||
        !evidence.itemLockClear ||
        !evidence.mapAllowsExchange ||
        !evidence.itemStillExactBeforeDispatch ||
        !evidence.quantityStillSufficientBeforeDispatch ||
        !evidence.exactCandidateStillSelected
      ) {
        exchangeStatus = dispatchPlan;
        reason = "EXCHANGE_LIVE_LOCAL_PREFLIGHT_BLOCKED";
        return (finalResult = finish());
      }

      executionAttempts += 1;
      exchangeStatus = await this.deps.exchange.executeNext();

      const observedInventory = this.deps.game.inventory();
      afterItem = itemState(observedInventory, itemSlot);
      afterTotalQuantity = totalItemQuantity(observedInventory, itemName);
      evidence.itemStateChanged =
        stateSignature(afterItem) !== stateSignature(beforeItem);
      evidence.quantityConsumed =
        afterTotalQuantity <= beforeTotalQuantity - selected.requiredQuantity;
      evidence.mutationObserved =
        evidence.itemStateChanged || evidence.quantityConsumed;

      if (exchangeStatus.lastAction?.status === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "EXCHANGE_LIVE_OUTCOME_UNKNOWN_NO_RETRY";
        return (finalResult = finish());
      }

      if (exchangeStatus.lastAction?.status !== "CONFIRMED") {
        reason =
          exchangeStatus.lastAction?.why ||
          "EXCHANGE_LIVE_ACTION_NOT_CONFIRMED";
        return (finalResult = finish());
      }

      const settleStartedAt = this.now();
      do {
        const settledInventory = this.deps.game.inventory();
        afterItem = itemState(settledInventory, itemSlot);
        afterTotalQuantity = totalItemQuantity(settledInventory, itemName);
        evidence.itemStateChanged =
          stateSignature(afterItem) !== stateSignature(beforeItem);
        evidence.quantityConsumed =
          afterTotalQuantity <= beforeTotalQuantity - selected.requiredQuantity;
        evidence.mutationObserved =
          evidence.itemStateChanged || evidence.quantityConsumed;
        if (evidence.quantityConsumed) break;
        await this.sleep(settlePollMs);
      } while (this.now() - settleStartedAt < settleTimeoutMs);

      if (!evidence.quantityConsumed) {
        outcome = "TIMEOUT";
        reason = "EXCHANGE_LIVE_CONFIRMED_BUT_CONSUMPTION_NOT_OBSERVED";
        return (finalResult = finish());
      }

      outcome = "PASS";
      reason = "EXCHANGE_LIVE_E2E_CONFIRMED";
      return (finalResult = finish());
    } finally {
      this.deps.inventoryIntelligence.clearConfigOverride();
      inventoryConfigOverrideCleared = true;
      this.deps.exchange.clearConfigOverride();
      exchangeConfigOverrideCleared = true;
      this.deps.inventoryIntelligence.tick();
      this.deps.exchange.tick();

      if (finalResult) {
        finalResult.cleanup.inventoryConfigOverrideCleared =
          inventoryConfigOverrideCleared;
        finalResult.cleanup.exchangeConfigOverrideCleared =
          exchangeConfigOverrideCleared;
      }
    }
  }
}

export {
  itemState as exchangeLiveItemState,
  selectExchangeLiveTarget,
  stateSignature as exchangeLiveStateSignature,
  totalItemQuantity as exchangeLiveTotalItemQuantity,
};

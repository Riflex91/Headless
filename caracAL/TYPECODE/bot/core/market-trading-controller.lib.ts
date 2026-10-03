import type { ActionRecord } from "./action-ledger.lib";
import type {
  CharacterSnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";

const MODULE = "MarketTradingController";
const SAFE_ITEMS = ["hpot0", "mpot0"] as const;
const TEST_LISTING_PRICE = 100_000_000;
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 10000;
const DEFAULT_POLL_MS = 100;

type TradeSlotsSnapshot = Record<string, Record<string, unknown> | null>;

export interface MarketTradingOperation {
  actionId: string | null;
  actionStatus: string | null;
  settled: boolean;
}

export interface MarketTradingRoundTripResult {
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  itemName: string | null;
  inventorySlot: number | null;
  tradeSlot: string | null;
  listingPrice: number | null;
  itemQuantityBefore: number | null;
  itemQuantityAfter: number | null;
  standInitiallyOpen: boolean;
  standFinallyOpen: boolean;
  standOpenedByTest: boolean;
  standClosedByTest: boolean;
  openStand: MarketTradingOperation;
  list: MarketTradingOperation;
  unlist: MarketTradingOperation;
  closeStand: MarketTradingOperation;
  listingObserved: boolean;
  tradeSlotCleared: boolean;
  itemBaselineRestored: boolean;
  standBaselineRestored: boolean;
  blindRetryPerformed: false;
  foreignTradeMutationPerformed: false;
}

interface MarketTradingGame {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  tradeSlots(): TradeSlotsSnapshot;
  gameData(): Record<string, unknown>;
}

interface MarketTradingActions {
  openStand: (request: {
    module: string;
    why: string;
    correlationId?: string;
  }) => Promise<ActionRecord>;
  closeStand: (request: {
    module: string;
    why: string;
    correlationId?: string;
  }) => Promise<ActionRecord>;
  tradeList: (request: {
    inventorySlot: number;
    slot: string;
    price: number;
    quantity: number;
    module: string;
    why: string;
    correlationId?: string;
  }) => Promise<ActionRecord>;
  tradeUnlist: (request: {
    slot: string;
    module: string;
    why: string;
    correlationId?: string;
  }) => Promise<ActionRecord>;
}

export interface MarketTradingControllerOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  settlementTimeoutMs?: number;
  pollMs?: number;
  listingPrice?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function itemName(item: Record<string, unknown> | null): string | null {
  return item && typeof item.name === "string" ? item.name : null;
}

function itemQuantity(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  const quantity = Number(item.q);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function itemLocked(item: Record<string, unknown> | null): boolean {
  if (!item) return false;
  return item.locked === true || (typeof item.l === "string" && item.l.length > 0);
}

function totalQuantity(
  inventory: InventorySlotSnapshot[],
  name: string,
): number {
  return inventory.reduce((total, entry) => {
    return itemName(entry.item) === name
      ? total + itemQuantity(entry.item)
      : total;
  }, 0);
}

function selectInventoryItem(
  inventory: InventorySlotSnapshot[],
): { slot: number; name: string } | null {
  for (const safeName of SAFE_ITEMS) {
    const match = inventory.find(
      (entry) =>
        itemName(entry.item) === safeName &&
        itemQuantity(entry.item) >= 1 &&
        !itemLocked(entry.item),
    );
    if (match) return { slot: match.slot, name: safeName };
  }
  return null;
}

function freeTradeSlot(slots: TradeSlotsSnapshot): string | null {
  for (let index = 1; index <= 16; index += 1) {
    const slot = `trade${index}`;
    if (!slots[slot]) return slot;
  }
  return null;
}

function listedItemMatches(
  slot: Record<string, unknown> | null,
  name: string,
  price: number,
): boolean {
  return (
    !!slot &&
    slot.b !== true &&
    slot.giveaway === undefined &&
    slot.want === undefined &&
    itemName(slot) === name &&
    Number(slot.price) === price &&
    itemQuantity(slot) === 1
  );
}

function actionOperation(
  action?: ActionRecord | null,
  settled = false,
): MarketTradingOperation {
  return {
    actionId: action?.id || null,
    actionStatus: action?.status || null,
    settled,
  };
}

function hardFailure(action: ActionRecord): "BLOCKED" | "REJECTED" | null {
  if (action.status === "BLOCKED") return "BLOCKED";
  if (action.status === "REJECTED") return "REJECTED";
  return null;
}

export class MarketTradingController {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly settlementTimeoutMs: number;
  private readonly pollMs: number;
  private readonly listingPrice: number;

  constructor(
    private readonly game: MarketTradingGame,
    private readonly actions: MarketTradingActions,
    options: MarketTradingControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.sleep =
      options.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.settlementTimeoutMs = Math.max(
      100,
      options.settlementTimeoutMs || DEFAULT_SETTLEMENT_TIMEOUT_MS,
    );
    this.pollMs = Math.max(10, options.pollMs || DEFAULT_POLL_MS);
    this.listingPrice =
      Number.isInteger(options.listingPrice) && Number(options.listingPrice) > 0
        ? Number(options.listingPrice)
        : TEST_LISTING_PRICE;
  }

  async roundTrip(correlationId?: string): Promise<MarketTradingRoundTripResult> {
    const character = this.game.character();
    const standInitiallyOpen = !!character.stand;
    const inventory = this.game.inventory();
    const selected = selectInventoryItem(inventory);
    const slot = freeTradeSlot(this.game.tradeSlots());
    const empty = actionOperation();

    if (character.ctype !== "merchant") {
      return this.result(
        "FAIL",
        "MARKET_TRADING_MERCHANT_REQUIRED",
        null,
        null,
        null,
        standInitiallyOpen,
        empty,
        empty,
        empty,
        empty,
      );
    }
    if (standInitiallyOpen) {
      return this.result(
        "FAIL",
        "MARKET_TRADING_REQUIRES_CLOSED_STAND_BASELINE",
        selected,
        slot,
        null,
        standInitiallyOpen,
        empty,
        empty,
        empty,
        empty,
      );
    }
    if (!selected) {
      return this.result(
        "FAIL",
        "MARKET_TRADING_SAFE_ITEM_UNAVAILABLE",
        null,
        slot,
        null,
        standInitiallyOpen,
        empty,
        empty,
        empty,
        empty,
      );
    }
    if (!slot) {
      return this.result(
        "FAIL",
        "MARKET_TRADING_NO_FREE_TRADE_SLOT",
        selected,
        null,
        null,
        standInitiallyOpen,
        empty,
        empty,
        empty,
        empty,
      );
    }
    if (!inventory.some((entry) => entry.item === null)) {
      return this.result(
        "FAIL",
        "MARKET_TRADING_REQUIRES_EMPTY_INVENTORY_SLOT",
        selected,
        slot,
        totalQuantity(inventory, selected.name),
        standInitiallyOpen,
        empty,
        empty,
        empty,
        empty,
      );
    }

    const definition = record(record(this.game.gameData().items)[selected.name]);
    if (Object.keys(definition).length === 0) {
      return this.result(
        "FAIL",
        "MARKET_TRADING_ITEM_DEFINITION_UNAVAILABLE",
        selected,
        slot,
        totalQuantity(inventory, selected.name),
        standInitiallyOpen,
        empty,
        empty,
        empty,
        empty,
      );
    }

    const baselineQuantity = totalQuantity(inventory, selected.name);
    let openAction: ActionRecord;
    try {
      openAction = await this.actions.openStand({
        module: MODULE,
        why: "PHASE13_MARKET_TRADING_OPEN_STAND",
        correlationId,
      });
    } catch (error) {
      return this.result(
        "UNKNOWN",
        `MARKET_TRADING_OPEN_STAND_DISPATCH_ERROR:${
          error instanceof Error ? error.message : String(error)
        }`,
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        empty,
        empty,
        empty,
        empty,
      );
    }

    const openFailure = hardFailure(openAction);
    if (openFailure) {
      return this.result(
        "FAIL",
        `MARKET_TRADING_OPEN_STAND_${openFailure}`,
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction),
        empty,
        empty,
        empty,
      );
    }

    const standOpened = await this.waitUntil(() => !!this.game.character().stand);
    if (!standOpened) {
      return this.result(
        openAction.status === "UNKNOWN" ? "UNKNOWN" : "TIMEOUT",
        openAction.status === "UNKNOWN"
          ? "MARKET_TRADING_OPEN_STAND_OUTCOME_UNKNOWN"
          : "MARKET_TRADING_OPEN_STAND_SETTLEMENT_TIMEOUT",
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction),
        empty,
        empty,
        empty,
      );
    }

    let listAction: ActionRecord;
    try {
      listAction = await this.actions.tradeList({
        inventorySlot: selected.slot,
        slot,
        price: this.listingPrice,
        quantity: 1,
        module: MODULE,
        why: "PHASE13_MARKET_TRADING_LIST",
        correlationId,
      });
    } catch (error) {
      const close = await this.closeForSafety(correlationId);
      return this.result(
        "UNKNOWN",
        `MARKET_TRADING_LIST_DISPATCH_ERROR:${
          error instanceof Error ? error.message : String(error)
        }`,
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction, true),
        empty,
        empty,
        close,
      );
    }

    const listFailure = hardFailure(listAction);
    if (listFailure) {
      const close = await this.closeForSafety(correlationId);
      return this.result(
        "FAIL",
        `MARKET_TRADING_LIST_${listFailure}`,
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction, true),
        actionOperation(listAction),
        empty,
        close,
      );
    }

    const listingObserved = await this.waitUntil(() =>
      listedItemMatches(
        this.game.tradeSlots()[slot] || null,
        selected.name,
        this.listingPrice,
      ),
    );
    if (!listingObserved) {
      const close = await this.closeForSafety(correlationId);
      return this.result(
        listAction.status === "UNKNOWN" ? "UNKNOWN" : "TIMEOUT",
        listAction.status === "UNKNOWN"
          ? "MARKET_TRADING_LIST_OUTCOME_UNKNOWN"
          : "MARKET_TRADING_LIST_SETTLEMENT_TIMEOUT",
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction, true),
        actionOperation(listAction),
        empty,
        close,
      );
    }

    let unlistAction: ActionRecord;
    try {
      unlistAction = await this.actions.tradeUnlist({
        slot,
        module: MODULE,
        why: "PHASE13_MARKET_TRADING_UNLIST",
        correlationId,
      });
    } catch (error) {
      const close = await this.closeForSafety(correlationId);
      return this.result(
        "UNKNOWN",
        `MARKET_TRADING_UNLIST_DISPATCH_ERROR:${
          error instanceof Error ? error.message : String(error)
        }`,
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction, true),
        actionOperation(listAction, true),
        empty,
        close,
      );
    }

    const unlistFailure = hardFailure(unlistAction);
    if (unlistFailure) {
      const close = await this.closeForSafety(correlationId);
      return this.result(
        "FAIL",
        `MARKET_TRADING_UNLIST_${unlistFailure}`,
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction, true),
        actionOperation(listAction, true),
        actionOperation(unlistAction),
        close,
      );
    }

    const unlisted = await this.waitUntil(() => {
      return (
        !this.game.tradeSlots()[slot] &&
        totalQuantity(this.game.inventory(), selected.name) === baselineQuantity
      );
    });
    if (!unlisted) {
      const close = await this.closeForSafety(correlationId);
      return this.result(
        unlistAction.status === "UNKNOWN" ? "UNKNOWN" : "TIMEOUT",
        unlistAction.status === "UNKNOWN"
          ? "MARKET_TRADING_UNLIST_OUTCOME_UNKNOWN"
          : "MARKET_TRADING_UNLIST_SETTLEMENT_TIMEOUT",
        selected,
        slot,
        baselineQuantity,
        standInitiallyOpen,
        actionOperation(openAction, true),
        actionOperation(listAction, true),
        actionOperation(unlistAction),
        close,
      );
    }

    const closeAction = await this.closeForSafety(correlationId);
    const closeSettled = closeAction.settled;
    return this.result(
      closeSettled ? "PASS" : "FAIL",
      closeSettled
        ? "MARKET_TRADING_ROUND_TRIP_SETTLED"
        : "MARKET_TRADING_STAND_RESTORE_FAILED",
      selected,
      slot,
      baselineQuantity,
      standInitiallyOpen,
      actionOperation(openAction, true),
      actionOperation(listAction, true),
      actionOperation(unlistAction, true),
      closeAction,
    );
  }

  private async closeForSafety(
    correlationId?: string,
  ): Promise<MarketTradingOperation> {
    let action: ActionRecord;
    try {
      action = await this.actions.closeStand({
        module: MODULE,
        why: "PHASE13_MARKET_TRADING_CLOSE_STAND",
        correlationId,
      });
    } catch (_error) {
      return actionOperation();
    }

    const failure = hardFailure(action);
    if (failure) return actionOperation(action);

    const settled = await this.waitUntil(() => !this.game.character().stand);
    return actionOperation(action, settled);
  }

  private async waitUntil(predicate: () => boolean): Promise<boolean> {
    const startedAt = this.now();
    while (this.now() - startedAt <= this.settlementTimeoutMs) {
      if (predicate()) return true;
      await this.sleep(this.pollMs);
    }
    return false;
  }

  private result(
    outcome: MarketTradingRoundTripResult["outcome"],
    reason: string,
    selected: { slot: number; name: string } | null,
    tradeSlot: string | null,
    itemQuantityBefore: number | null,
    standInitiallyOpen: boolean,
    openStand: MarketTradingOperation,
    list: MarketTradingOperation,
    unlist: MarketTradingOperation,
    closeStand: MarketTradingOperation,
  ): MarketTradingRoundTripResult {
    const itemQuantityAfter = selected
      ? totalQuantity(this.game.inventory(), selected.name)
      : null;
    const standFinallyOpen = !!this.game.character().stand;
    const tradeSlotCleared = tradeSlot
      ? !this.game.tradeSlots()[tradeSlot]
      : false;
    const itemBaselineRestored =
      itemQuantityBefore !== null &&
      itemQuantityAfter !== null &&
      itemQuantityBefore === itemQuantityAfter;
    const standBaselineRestored = standFinallyOpen === standInitiallyOpen;

    return {
      outcome,
      reason,
      itemName: selected?.name || null,
      inventorySlot: selected?.slot ?? null,
      tradeSlot,
      listingPrice: selected ? this.listingPrice : null,
      itemQuantityBefore,
      itemQuantityAfter,
      standInitiallyOpen,
      standFinallyOpen,
      standOpenedByTest: openStand.settled,
      standClosedByTest: closeStand.settled,
      openStand,
      list,
      unlist,
      closeStand,
      listingObserved: list.settled,
      tradeSlotCleared,
      itemBaselineRestored,
      standBaselineRestored,
      blindRetryPerformed: false,
      foreignTradeMutationPerformed: false,
    };
  }
}

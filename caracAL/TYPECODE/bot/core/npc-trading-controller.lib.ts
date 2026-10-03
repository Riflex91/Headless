import type { ActionRecord } from "./action-ledger.lib";
import type {
  CharacterSnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";
import type { MovementController } from "./movement-controller.lib";

const MODULE = "NpcTradingController";
const OWNER = "NpcTradingController";
const DEFAULT_SAFE_ITEMS = ["hpot0", "mpot0"] as const;
const MAX_SAFE_UNIT_PRICE = 1000;
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 10000;
const DEFAULT_POLL_MS = 100;

export interface SafeNpcTradeItem {
  itemName: string;
  unitPrice: number;
}

export interface NpcTradingSnapshot {
  characterGold: number;
  itemQuantity: number;
}

export interface NpcTradingOperation {
  actionId: string | null;
  actionStatus: string | null;
  settled: boolean;
}

export interface NpcTradingRoundTripResult {
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  itemName: string | null;
  unitPrice: number | null;
  baseline: NpcTradingSnapshot | null;
  afterBuy: NpcTradingSnapshot | null;
  final: NpcTradingSnapshot | null;
  travel: NpcTradingOperation;
  buy: NpcTradingOperation;
  sell: NpcTradingOperation;
  buyGoldDelta: number | null;
  sellGoldDelta: number | null;
  netGoldCost: number | null;
  itemBaselineRestored: boolean;
  blindRetryPerformed: false;
}

interface NpcTradingGame {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
}

interface NpcTradingActions {
  buy: (request: {
    itemName: string;
    quantity: number;
    module: string;
    why: string;
    correlationId?: string;
  }) => Promise<ActionRecord>;
  sell: (request: {
    inventorySlot: number;
    quantity: number;
    module: string;
    why: string;
    correlationId?: string;
  }) => Promise<ActionRecord>;
}

interface NpcTradingMovement {
  smart(
    request: Parameters<MovementController["smart"]>[0],
  ): Promise<ActionRecord>;
}

export interface NpcTradingControllerOptions {
  safeItems?: readonly string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  settlementTimeoutMs?: number;
  pollMs?: number;
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
  return inventory.reduce((total, slot) => {
    const item = slot.item;
    return itemName(item) === name ? total + itemQuantity(item) : total;
  }, 0);
}

function snapshot(
  game: NpcTradingGame,
  name: string,
): NpcTradingSnapshot | null {
  const gold = game.character().gold;
  if (gold === null || !Number.isFinite(gold)) return null;
  return {
    characterGold: Number(gold),
    itemQuantity: totalQuantity(game.inventory(), name),
  };
}

function sellSlot(
  inventory: InventorySlotSnapshot[],
  name: string,
): number | null {
  const match = inventory.find(
    (slot) => itemName(slot.item) === name && !itemLocked(slot.item),
  );
  return match ? match.slot : null;
}

function operation(action?: ActionRecord | null, settled = false): NpcTradingOperation {
  return {
    actionId: action?.id || null,
    actionStatus: action?.status || null,
    settled,
  };
}

function hardFailure(action: ActionRecord): string | null {
  if (action.status === "BLOCKED") return "BLOCKED";
  if (action.status === "REJECTED") return "REJECTED";
  return null;
}

export function selectSafeNpcTradeItem(
  gameData: Record<string, unknown>,
  safeItems: readonly string[] = DEFAULT_SAFE_ITEMS,
): SafeNpcTradeItem | null {
  const items = record(gameData.items);
  const candidates = safeItems
    .map((name) => {
      const definition = record(items[name]);
      const price = Number(definition.g);
      return {
        itemName: name,
        unitPrice:
          Number.isFinite(price) && price > 0 && price <= MAX_SAFE_UNIT_PRICE
            ? price
            : null,
      };
    })
    .filter(
      (candidate): candidate is SafeNpcTradeItem =>
        candidate.unitPrice !== null,
    )
    .sort(
      (a, b) =>
        a.unitPrice - b.unitPrice ||
        a.itemName.localeCompare(b.itemName),
    );

  return candidates[0] || null;
}

export class NpcTradingController {
  private readonly safeItems: readonly string[];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly settlementTimeoutMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly game: NpcTradingGame,
    private readonly actions: NpcTradingActions,
    private readonly movement: NpcTradingMovement,
    options: NpcTradingControllerOptions = {},
  ) {
    this.safeItems = options.safeItems || DEFAULT_SAFE_ITEMS;
    this.now = options.now || (() => Date.now());
    this.sleep =
      options.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.settlementTimeoutMs = Math.max(
      100,
      options.settlementTimeoutMs || DEFAULT_SETTLEMENT_TIMEOUT_MS,
    );
    this.pollMs = Math.max(10, options.pollMs || DEFAULT_POLL_MS);
  }

  async roundTrip(correlationId?: string): Promise<NpcTradingRoundTripResult> {
    const selected = selectSafeNpcTradeItem(
      this.game.gameData(),
      this.safeItems,
    );
    const empty = operation();

    if (!selected) {
      return this.result(
        "FAIL",
        "NPC_TRADING_SAFE_ITEM_UNAVAILABLE",
        null,
        null,
        null,
        null,
        null,
        empty,
        empty,
        empty,
      );
    }

    const character = this.game.character();
    if (character.ctype !== "merchant") {
      return this.result(
        "FAIL",
        "NPC_TRADING_MERCHANT_REQUIRED",
        selected,
        null,
        null,
        null,
        empty,
        empty,
        empty,
      );
    }

    const baseline = snapshot(this.game, selected.itemName);
    if (!baseline) {
      return this.result(
        "FAIL",
        "NPC_TRADING_BASELINE_UNAVAILABLE",
        selected,
        null,
        null,
        null,
        empty,
        empty,
        empty,
      );
    }
    if (baseline.characterGold < selected.unitPrice) {
      return this.result(
        "FAIL",
        "NPC_TRADING_INSUFFICIENT_GOLD",
        selected,
        baseline,
        null,
        baseline,
        empty,
        empty,
        empty,
      );
    }

    let travelAction: ActionRecord;
    try {
      travelAction = await this.movement.smart({
        owner: OWNER,
        module: MODULE,
        why: "NPC_TRADING_VENDOR_REQUIRED",
        destination: selected.itemName,
      });
    } catch (error) {
      return this.result(
        "UNKNOWN",
        `NPC_TRADING_TRAVEL_ERROR:${
          error instanceof Error ? error.message : String(error)
        }`,
        selected,
        baseline,
        null,
        snapshot(this.game, selected.itemName),
        empty,
        empty,
        empty,
      );
    }

    const travelFailure = hardFailure(travelAction);
    if (travelFailure) {
      return this.result(
        "FAIL",
        `NPC_TRADING_TRAVEL_${travelFailure}`,
        selected,
        baseline,
        null,
        snapshot(this.game, selected.itemName),
        operation(travelAction),
        empty,
        empty,
      );
    }
    if (travelAction.status === "UNKNOWN") {
      return this.result(
        "UNKNOWN",
        "NPC_TRADING_TRAVEL_OUTCOME_UNKNOWN",
        selected,
        baseline,
        null,
        snapshot(this.game, selected.itemName),
        operation(travelAction),
        empty,
        empty,
      );
    }

    let buyAction: ActionRecord;
    try {
      buyAction = await this.actions.buy({
        itemName: selected.itemName,
        quantity: 1,
        module: MODULE,
        why: "PHASE13_NPC_TRADING_BUY",
        correlationId,
      });
    } catch (error) {
      return this.result(
        "UNKNOWN",
        `NPC_TRADING_BUY_DISPATCH_ERROR:${
          error instanceof Error ? error.message : String(error)
        }`,
        selected,
        baseline,
        null,
        snapshot(this.game, selected.itemName),
        operation(travelAction, true),
        empty,
        empty,
      );
    }

    const buyFailure = hardFailure(buyAction);
    if (buyFailure) {
      return this.result(
        "FAIL",
        `NPC_TRADING_BUY_${buyFailure}`,
        selected,
        baseline,
        null,
        snapshot(this.game, selected.itemName),
        operation(travelAction, true),
        operation(buyAction),
        empty,
      );
    }

    const afterBuy = await this.waitForBuySettlement(selected, baseline);
    if (!afterBuy) {
      return this.result(
        buyAction.status === "UNKNOWN" ? "UNKNOWN" : "TIMEOUT",
        buyAction.status === "UNKNOWN"
          ? "NPC_TRADING_BUY_OUTCOME_UNKNOWN"
          : "NPC_TRADING_BUY_SETTLEMENT_TIMEOUT",
        selected,
        baseline,
        null,
        snapshot(this.game, selected.itemName),
        operation(travelAction, true),
        operation(buyAction),
        empty,
      );
    }

    const slot = sellSlot(this.game.inventory(), selected.itemName);
    if (slot === null) {
      return this.result(
        "FAIL",
        "NPC_TRADING_SELL_SLOT_UNAVAILABLE",
        selected,
        baseline,
        afterBuy,
        afterBuy,
        operation(travelAction, true),
        operation(buyAction, true),
        empty,
      );
    }

    let sellAction: ActionRecord;
    try {
      sellAction = await this.actions.sell({
        inventorySlot: slot,
        quantity: 1,
        module: MODULE,
        why: "PHASE13_NPC_TRADING_SELL",
        correlationId,
      });
    } catch (error) {
      return this.result(
        "UNKNOWN",
        `NPC_TRADING_SELL_DISPATCH_ERROR:${
          error instanceof Error ? error.message : String(error)
        }`,
        selected,
        baseline,
        afterBuy,
        snapshot(this.game, selected.itemName),
        operation(travelAction, true),
        operation(buyAction, true),
        empty,
      );
    }

    const sellFailure = hardFailure(sellAction);
    if (sellFailure) {
      return this.result(
        "FAIL",
        `NPC_TRADING_SELL_${sellFailure}`,
        selected,
        baseline,
        afterBuy,
        snapshot(this.game, selected.itemName),
        operation(travelAction, true),
        operation(buyAction, true),
        operation(sellAction),
      );
    }

    const final = await this.waitForSellSettlement(
      selected,
      baseline,
      afterBuy,
    );
    if (!final) {
      return this.result(
        sellAction.status === "UNKNOWN" ? "UNKNOWN" : "TIMEOUT",
        sellAction.status === "UNKNOWN"
          ? "NPC_TRADING_SELL_OUTCOME_UNKNOWN"
          : "NPC_TRADING_SELL_SETTLEMENT_TIMEOUT",
        selected,
        baseline,
        afterBuy,
        snapshot(this.game, selected.itemName),
        operation(travelAction, true),
        operation(buyAction, true),
        operation(sellAction),
      );
    }

    const netGoldCost = baseline.characterGold - final.characterGold;
    const safeNetCost =
      netGoldCost >= 0 && netGoldCost <= selected.unitPrice;
    const itemBaselineRestored =
      final.itemQuantity === baseline.itemQuantity;

    return this.result(
      safeNetCost && itemBaselineRestored ? "PASS" : "FAIL",
      safeNetCost && itemBaselineRestored
        ? "NPC_TRADING_ROUND_TRIP_SETTLED"
        : "NPC_TRADING_FINAL_STATE_INVALID",
      selected,
      baseline,
      afterBuy,
      final,
      operation(travelAction, true),
      operation(buyAction, true),
      operation(sellAction, true),
    );
  }

  private async waitForBuySettlement(
    selected: SafeNpcTradeItem,
    baseline: NpcTradingSnapshot,
  ): Promise<NpcTradingSnapshot | null> {
    const startedAt = this.now();
    while (this.now() - startedAt <= this.settlementTimeoutMs) {
      const current = snapshot(this.game, selected.itemName);
      if (
        current &&
        current.itemQuantity === baseline.itemQuantity + 1 &&
        baseline.characterGold - current.characterGold === selected.unitPrice
      ) {
        return current;
      }
      await this.sleep(this.pollMs);
    }
    return null;
  }

  private async waitForSellSettlement(
    selected: SafeNpcTradeItem,
    baseline: NpcTradingSnapshot,
    afterBuy: NpcTradingSnapshot,
  ): Promise<NpcTradingSnapshot | null> {
    const startedAt = this.now();
    while (this.now() - startedAt <= this.settlementTimeoutMs) {
      const current = snapshot(this.game, selected.itemName);
      if (
        current &&
        current.itemQuantity === baseline.itemQuantity &&
        current.characterGold > afterBuy.characterGold
      ) {
        return current;
      }
      await this.sleep(this.pollMs);
    }
    return null;
  }

  private result(
    outcome: NpcTradingRoundTripResult["outcome"],
    reason: string,
    selected: SafeNpcTradeItem | null,
    baseline: NpcTradingSnapshot | null,
    afterBuy: NpcTradingSnapshot | null,
    final: NpcTradingSnapshot | null,
    travel: NpcTradingOperation,
    buy: NpcTradingOperation,
    sell: NpcTradingOperation,
  ): NpcTradingRoundTripResult {
    const buyGoldDelta =
      baseline && afterBuy
        ? baseline.characterGold - afterBuy.characterGold
        : null;
    const sellGoldDelta =
      afterBuy && final ? final.characterGold - afterBuy.characterGold : null;
    const netGoldCost =
      baseline && final ? baseline.characterGold - final.characterGold : null;

    return {
      outcome,
      reason,
      itemName: selected?.itemName || null,
      unitPrice: selected?.unitPrice ?? null,
      baseline,
      afterBuy,
      final,
      travel,
      buy,
      sell,
      buyGoldDelta,
      sellGoldDelta,
      netGoldCost,
      itemBaselineRestored:
        !!baseline &&
        !!final &&
        baseline.itemQuantity === final.itemQuantity,
      blindRetryPerformed: false,
    };
  }
}

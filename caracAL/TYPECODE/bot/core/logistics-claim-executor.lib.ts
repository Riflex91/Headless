import type { ActionRecord } from "./action-ledger.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type {
  GameAdapter,
  InventorySlotSnapshot,
} from "./game-adapter.lib";

export type LogisticsClaimType =
  | "MLUCK"
  | "POTION_DELIVERY"
  | "ITEM_DELIVERY"
  | "GOLD_PICKUP"
  | "INVENTORY_PRESSURE"
  | "GEAR_DELIVERY"
  | "MATERIAL_DELIVERY";

export interface LogisticsClaim {
  id: string;
  type: LogisticsClaimType;
  farmer: string;
  merchant: {
    name: string;
    live?: boolean;
  } | null;
  itemName?: string | null;
  quantity?: number | null;
  amount?: number | null;
  inventorySlot?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LogisticsExecutionResult {
  claimId: string;
  type: LogisticsClaimType;
  source: string | null;
  target: string | null;
  outcome:
    | "CONFIRMED"
    | "REJECTED"
    | "UNKNOWN"
    | "BLOCKED"
    | "DISPATCHED";
  reason: string;
  actionId: string | null;
  itemName: string | null;
  requestedQuantity: number | null;
  executedQuantity: number | null;
  amount: number | null;
  fulfilled: boolean;
}

interface ActionBoundaryLike {
  useSkill: ActionBoundary["useSkill"];
  sendItem: ActionBoundary["sendItem"];
  sendGold: ActionBoundary["sendGold"];
}

interface GameAdapterLike {
  character: GameAdapter["character"];
  entities: GameAdapter["entities"];
  inventory: GameAdapter["inventory"];
}

interface InventoryIntelligenceLike {
  status(): {
    entries: Array<{
      slot: number;
      name: string | null;
      protected: boolean;
      disposition: string;
    }>;
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function itemName(slot: InventorySlotSnapshot): string | null {
  return text(slot.item?.name);
}

function itemQuantity(slot: InventorySlotSnapshot): number {
  if (!slot.item) return 0;
  const quantity = Number(slot.item.q);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function sourceAndTarget(claim: LogisticsClaim): {
  source: string | null;
  target: string | null;
} {
  const merchant = text(claim.merchant?.name);
  const farmer = text(claim.farmer);

  switch (claim.type) {
    case "MLUCK":
    case "POTION_DELIVERY":
    case "ITEM_DELIVERY":
    case "GEAR_DELIVERY":
      return { source: merchant, target: farmer };
    case "GOLD_PICKUP":
    case "INVENTORY_PRESSURE":
    case "MATERIAL_DELIVERY":
      return { source: farmer, target: merchant };
  }
}

function resultFromAction(
  claim: LogisticsClaim,
  source: string | null,
  target: string | null,
  action: ActionRecord,
  details: {
    itemName?: string | null;
    requestedQuantity?: number | null;
    executedQuantity?: number | null;
    amount?: number | null;
    fulfilled?: boolean;
  } = {},
): LogisticsExecutionResult {
  const outcome = action.status || "UNKNOWN";
  return {
    claimId: claim.id,
    type: claim.type,
    source,
    target,
    outcome,
    reason: action.status ? action.why : "ACTION_OUTCOME_MISSING",
    actionId: action.id,
    itemName: details.itemName ?? text(claim.itemName),
    requestedQuantity:
      details.requestedQuantity ?? positiveInteger(claim.quantity),
    executedQuantity: details.executedQuantity ?? null,
    amount: details.amount ?? positiveInteger(claim.amount),
    fulfilled: outcome === "CONFIRMED" && details.fulfilled !== false,
  };
}

function blocked(
  claim: LogisticsClaim,
  source: string | null,
  target: string | null,
  reason: string,
): LogisticsExecutionResult {
  return {
    claimId: claim.id,
    type: claim.type,
    source,
    target,
    outcome: "BLOCKED",
    reason,
    actionId: null,
    itemName: text(claim.itemName),
    requestedQuantity: positiveInteger(claim.quantity),
    executedQuantity: null,
    amount: positiveInteger(claim.amount),
    fulfilled: false,
  };
}

export class LogisticsClaimExecutor {
  constructor(
    private readonly actions: ActionBoundaryLike,
    private readonly game: GameAdapterLike,
    private readonly inventoryIntelligence: InventoryIntelligenceLike,
  ) {}

  async execute(claim: LogisticsClaim): Promise<LogisticsExecutionResult> {
    const { source, target } = sourceAndTarget(claim);
    const currentCharacter = text(this.game.character().name);

    if (!text(claim.id)) {
      return blocked(claim, source, target, "CLAIM_ID_INVALID");
    }
    if (!source || !target) {
      return blocked(claim, source, target, "CLAIM_PARTICIPANT_INVALID");
    }
    if (!currentCharacter || currentCharacter !== source) {
      return blocked(claim, source, target, "CLAIM_SOURCE_MISMATCH");
    }
    if (source === target) {
      return blocked(claim, source, target, "CLAIM_SELF_TRANSFER_BLOCKED");
    }

    switch (claim.type) {
      case "MLUCK":
        return this.executeMluck(claim, source, target);
      case "POTION_DELIVERY":
      case "ITEM_DELIVERY":
      case "GEAR_DELIVERY":
        return this.executeOutboundItem(claim, source, target);
      case "GOLD_PICKUP":
        return this.executeGoldPickup(claim, source, target);
      case "INVENTORY_PRESSURE":
        return this.executeInventoryPressure(claim, source, target);
      case "MATERIAL_DELIVERY":
        return this.executeMaterialDelivery(claim, source, target);
    }
  }

  private async executeMluck(
    claim: LogisticsClaim,
    source: string,
    target: string,
  ): Promise<LogisticsExecutionResult> {
    const targetEntity = this.game
      .entities()
      .find(
        (entity) =>
          entity.type === "character" &&
          entity.name === target &&
          !entity.dead &&
          !entity.rip,
      );
    if (!targetEntity) {
      return blocked(claim, source, target, "CLAIM_TARGET_NOT_VISIBLE");
    }

    const action = await this.actions.useSkill({
      skill: "mluck",
      targetId: targetEntity.id,
      module: "MerchantLogistics",
      why: claim.reason || "MLUCK_CLAIM",
      correlationId: claim.id,
    });
    return resultFromAction(claim, source, target, action, {
      fulfilled: action.status === "CONFIRMED",
    });
  }

  private async executeOutboundItem(
    claim: LogisticsClaim,
    source: string,
    target: string,
  ): Promise<LogisticsExecutionResult> {
    const name = text(claim.itemName);
    const requestedQuantity = positiveInteger(claim.quantity) || 1;
    if (!name) {
      return blocked(claim, source, target, "CLAIM_ITEM_INVALID");
    }

    const candidates = this.game
      .inventory()
      .filter(
        (slot) =>
          itemName(slot) === name &&
          !!slot.item &&
          this.transferAllowed(slot.slot, name),
      )
      .sort((a, b) => itemQuantity(b) - itemQuantity(a));
    const slot = candidates[0];
    if (!slot) {
      return blocked(claim, source, target, "CLAIM_ITEM_UNAVAILABLE");
    }

    const quantity = Math.min(requestedQuantity, itemQuantity(slot));
    if (quantity <= 0) {
      return blocked(claim, source, target, "CLAIM_ITEM_QUANTITY_INVALID");
    }

    const action = await this.actions.sendItem({
      recipient: target,
      inventorySlot: slot.slot,
      quantity,
      module: "MerchantLogistics",
      why: claim.reason || claim.type,
      correlationId: claim.id,
    });

    return resultFromAction(claim, source, target, action, {
      itemName: name,
      requestedQuantity,
      executedQuantity: quantity,
      fulfilled:
        action.status === "CONFIRMED" && quantity >= requestedQuantity,
    });
  }

  private async executeGoldPickup(
    claim: LogisticsClaim,
    source: string,
    target: string,
  ): Promise<LogisticsExecutionResult> {
    const requestedAmount = positiveInteger(claim.amount);
    if (!requestedAmount) {
      return blocked(claim, source, target, "CLAIM_GOLD_AMOUNT_INVALID");
    }

    const currentGold = this.game.character().gold;
    const keepGold = Math.max(
      0,
      Number(claim.metadata?.keepGold) || 0,
    );
    if (currentGold === null) {
      return blocked(claim, source, target, "CLAIM_GOLD_STATE_UNAVAILABLE");
    }
    const available = Math.max(0, Math.floor(currentGold - keepGold));
    const amount = Math.min(requestedAmount, available);
    if (amount <= 0) {
      return blocked(claim, source, target, "CLAIM_GOLD_RESERVE_REACHED");
    }

    const action = await this.actions.sendGold({
      recipient: target,
      amount,
      module: "MerchantLogistics",
      why: claim.reason || "GOLD_PICKUP_CLAIM",
      correlationId: claim.id,
    });
    return resultFromAction(claim, source, target, action, {
      amount,
      fulfilled:
        action.status === "CONFIRMED" && amount >= requestedAmount,
    });
  }

  private async executeMaterialDelivery(
    claim: LogisticsClaim,
    source: string,
    target: string,
  ): Promise<LogisticsExecutionResult> {
    const name = text(claim.itemName);
    const requestedQuantity = positiveInteger(claim.quantity) || 1;
    if (!name) {
      return blocked(claim, source, target, "CLAIM_ITEM_INVALID");
    }
    if (
      claim.metadata?.purpose !== "FISHING_MATERIAL" ||
      claim.metadata?.authorized !== true
    ) {
      return blocked(
        claim,
        source,
        target,
        "MATERIAL_DELIVERY_AUTHORIZATION_INVALID",
      );
    }

    const candidates = this.game
      .inventory()
      .filter((slot) => {
        if (itemName(slot) !== name || !slot.item) return false;
        const item = slot.item;
        return (
          item.l !== true &&
          item.locked !== true &&
          item.acl !== true
        );
      })
      .sort((a, b) => itemQuantity(b) - itemQuantity(a));
    const slot = candidates[0];
    if (!slot) {
      return blocked(claim, source, target, "CLAIM_ITEM_UNAVAILABLE");
    }

    const quantity = Math.min(requestedQuantity, itemQuantity(slot));
    if (quantity <= 0) {
      return blocked(
        claim,
        source,
        target,
        "CLAIM_ITEM_QUANTITY_INVALID",
      );
    }

    const action = await this.actions.sendItem({
      recipient: target,
      inventorySlot: slot.slot,
      quantity,
      module: "MerchantLogistics",
      why: claim.reason || "MATERIAL_DELIVERY",
      correlationId: claim.id,
    });

    return resultFromAction(claim, source, target, action, {
      itemName: name,
      requestedQuantity,
      executedQuantity: quantity,
      fulfilled:
        action.status === "CONFIRMED" && quantity >= requestedQuantity,
    });
  }

  private async executeInventoryPressure(
    claim: LogisticsClaim,
    source: string,
    target: string,
  ): Promise<LogisticsExecutionResult> {
    const name = text(claim.itemName);
    const inventorySlot = Number(claim.inventorySlot);
    const requestedQuantity = positiveInteger(claim.quantity) || 1;
    if (!name) {
      return blocked(claim, source, target, "CLAIM_ITEM_INVALID");
    }
    if (!Number.isInteger(inventorySlot) || inventorySlot < 0) {
      return blocked(claim, source, target, "CLAIM_INVENTORY_SLOT_INVALID");
    }

    const slot = this.game
      .inventory()
      .find((entry) => entry.slot === inventorySlot);
    if (!slot?.item || itemName(slot) !== name) {
      return blocked(claim, source, target, "CLAIM_ITEM_REVALIDATION_FAILED");
    }
    if (!this.transferAllowed(inventorySlot, name)) {
      return blocked(claim, source, target, "CLAIM_ITEM_PROTECTED");
    }

    const quantity = Math.min(requestedQuantity, itemQuantity(slot));
    const action = await this.actions.sendItem({
      recipient: target,
      inventorySlot,
      quantity,
      module: "MerchantLogistics",
      why: claim.reason || "INVENTORY_PRESSURE_CLAIM",
      correlationId: claim.id,
    });
    return resultFromAction(claim, source, target, action, {
      itemName: name,
      requestedQuantity,
      executedQuantity: quantity,
      fulfilled:
        action.status === "CONFIRMED" && quantity >= requestedQuantity,
    });
  }

  private transferAllowed(slot: number, name: string): boolean {
    const decision = this.inventoryIntelligence
      .status()
      .entries.find(
        (entry) => entry.slot === slot && entry.name === name,
      );
    if (!decision || decision.protected === true) return false;
    return !["QUEST", "RESERVED", "UNKNOWN"].includes(
      String(decision.disposition || "").toUpperCase(),
    );
  }
}

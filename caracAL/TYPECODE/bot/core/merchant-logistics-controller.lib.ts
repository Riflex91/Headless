import type { ActionRecord } from "./action-ledger.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type {
  CharacterSnapshot,
  EntitySnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";
import type {
  InventoryIntelligenceStatus,
} from "./inventory-intelligence-controller.lib";
import type {
  MovementController,
  MovementControllerStatus,
} from "./movement-controller.lib";

const MODULE = "MerchantLogisticsController";
const MOVEMENT_OWNER = "MerchantLogisticsController";
const DEFAULT_INTERACTION_RANGE = 250;
const DEFAULT_RETRY_BACKOFF_MS = 5000;

export type MerchantLogisticsActorRole = "MERCHANT" | "FARMER_TRANSFER";

export type MerchantLogisticsClaimType =
  | "MLUCK"
  | "POTION_DELIVERY"
  | "ITEM_DELIVERY"
  | "GOLD_PICKUP"
  | "INVENTORY_PRESSURE"
  | "GEAR_DELIVERY";

export interface MerchantLogisticsRuntimeClaim {
  id: string;
  type: MerchantLogisticsClaimType;
  actorRole: MerchantLogisticsActorRole;
  farmer: string;
  merchant: {
    name: string;
    live: boolean;
  } | null;
  target: {
    name: string;
    map: string | null;
    x: number | null;
    y: number | null;
  };
  itemName: string | null;
  quantity: number | null;
  amount: number | null;
  inventorySlot: number | null;
  priority: number;
  reason: string;
  direction: string | null;
  metadata: Record<string, unknown>;
}

export interface MerchantLogisticsRuntimePlan {
  generatedAt: number | null;
  claims: MerchantLogisticsRuntimeClaim[];
}

export type MerchantLogisticsRuntimeState =
  | "IDLE"
  | "WAITING_TARGET"
  | "WAITING_MOVEMENT"
  | "MOVING"
  | "WAITING_RENDEZVOUS"
  | "RENDEZVOUS_READY"
  | "WAITING_STOCK"
  | "WAITING_SAFE_ITEM"
  | "BACKOFF"
  | "EXECUTING"
  | "COMPLETED"
  | "UNCERTAIN"
  | "BLOCKED";

export interface MerchantLogisticsRuntimeStatus {
  timestamp: number;
  state: MerchantLogisticsRuntimeState;
  reason: string;
  planGeneratedAt: number | null;
  claimCount: number;
  activeClaim: MerchantLogisticsRuntimeClaim | null;
  lastAction: {
    claimId: string;
    actionId: string;
    action: string;
    status: string;
    why: string;
    timestamp: number;
  } | null;
  uncertainClaimIds: string[];
  movement: MovementControllerStatus;
}

export interface MerchantLogisticsRuntimeEvent {
  type:
    | "MERCHANT_LOGISTICS_PLAN_UPDATED"
    | "MERCHANT_LOGISTICS_STATE_CHANGED"
    | "MERCHANT_LOGISTICS_CLAIM_COMPLETED"
    | "MERCHANT_LOGISTICS_CLAIM_UNCERTAIN"
    | "MERCHANT_LOGISTICS_CLAIM_ATTEMPT_FAILED";
  timestamp: number;
  reason: string;
  status: MerchantLogisticsRuntimeStatus;
  completion?: {
    claimId: string;
    type: MerchantLogisticsClaimType;
    farmer: string;
    merchant: string | null;
    itemName: string | null;
    quantity: number | null;
    amount: number | null;
    direction: string | null;
    actionId: string;
  };
}

export interface MerchantLogisticsControllerOptions {
  now?: () => number;
  interactionRange?: number;
  retryBackoffMs?: number;
  onEvent?: (event: MerchantLogisticsRuntimeEvent) => void;
}

interface MerchantLogisticsGame {
  character(): CharacterSnapshot;
  entities(): EntitySnapshot[];
  inventory(): InventorySlotSnapshot[];
}

interface InventoryIntelligenceLike {
  status(): InventoryIntelligenceStatus;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function itemName(item: Record<string, unknown> | null): string | null {
  return item && typeof item.name === "string" && item.name.trim()
    ? item.name.trim()
    : null;
}

function itemQuantity(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  const q = finite(item.q);
  return q !== null && q > 0 ? q : 1;
}

function cloneClaim(
  claim: MerchantLogisticsRuntimeClaim | null,
): MerchantLogisticsRuntimeClaim | null {
  if (!claim) return null;
  return {
    ...claim,
    merchant: claim.merchant ? { ...claim.merchant } : null,
    target: { ...claim.target },
    metadata: { ...claim.metadata },
  };
}

function validClaim(value: unknown): value is MerchantLogisticsRuntimeClaim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Partial<MerchantLogisticsRuntimeClaim>;
  return (
    typeof claim.id === "string" &&
    claim.id.length > 0 &&
    typeof claim.type === "string" &&
    typeof claim.actorRole === "string" &&
    typeof claim.farmer === "string" &&
    !!claim.target &&
    typeof claim.target === "object" &&
    typeof claim.target.name === "string"
  );
}

export class MerchantLogisticsController {
  private readonly now: () => number;
  private readonly interactionRange: number;
  private readonly retryBackoffMs: number;
  private readonly onEvent?: (event: MerchantLogisticsRuntimeEvent) => void;
  private claims: MerchantLogisticsRuntimeClaim[] = [];
  private planGeneratedAt: number | null = null;
  private uncertainClaims = new Set<string>();
  private retryAt = new Map<string, number>();
  private busy = false;
  private state: MerchantLogisticsRuntimeState = "IDLE";
  private reason = "NO_LOGISTICS_CLAIMS";
  private activeClaim: MerchantLogisticsRuntimeClaim | null = null;
  private lastAction: MerchantLogisticsRuntimeStatus["lastAction"] = null;
  private lastStateSignature = "";

  constructor(
    private readonly game: MerchantLogisticsGame,
    private readonly actions: Pick<
      ActionBoundary,
      "sendItem" | "sendGold" | "useSkill"
    >,
    private readonly movement: Pick<
      MovementController,
      "status" | "smart"
    >,
    private readonly inventoryIntelligence: InventoryIntelligenceLike,
    options: MerchantLogisticsControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.interactionRange = Math.max(
      50,
      finite(options.interactionRange) ?? DEFAULT_INTERACTION_RANGE,
    );
    this.retryBackoffMs = Math.max(
      1000,
      finite(options.retryBackoffMs) ?? DEFAULT_RETRY_BACKOFF_MS,
    );
    this.onEvent = options.onEvent;
  }

  setPlan(value: unknown): MerchantLogisticsRuntimeStatus {
    const raw =
      value && typeof value === "object"
        ? (value as Partial<MerchantLogisticsRuntimePlan>)
        : {};
    const incoming = Array.isArray(raw.claims)
      ? raw.claims.filter(validClaim).map((claim) => cloneClaim(claim)!)
      : [];
    incoming.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    );

    const ids = new Set(incoming.map((claim) => claim.id));
    for (const claimId of [...this.uncertainClaims]) {
      if (!ids.has(claimId)) this.uncertainClaims.delete(claimId);
    }
    for (const claimId of [...this.retryAt.keys()]) {
      if (!ids.has(claimId)) this.retryAt.delete(claimId);
    }

    this.claims = incoming;
    this.planGeneratedAt = finite(raw.generatedAt);
    if (!this.claims.length) {
      this.activeClaim = null;
      this.setState("IDLE", "NO_LOGISTICS_CLAIMS");
    }

    this.emit({
      type: "MERCHANT_LOGISTICS_PLAN_UPDATED",
      reason: "SUPERVISOR_PLAN_APPLIED",
    });
    return this.status();
  }

  status(): MerchantLogisticsRuntimeStatus {
    return {
      timestamp: this.now(),
      state: this.state,
      reason: this.reason,
      planGeneratedAt: this.planGeneratedAt,
      claimCount: this.claims.length,
      activeClaim: cloneClaim(this.activeClaim),
      lastAction: this.lastAction ? { ...this.lastAction } : null,
      uncertainClaimIds: [...this.uncertainClaims].sort(),
      movement: this.movement.status(),
    };
  }

  async tick(): Promise<MerchantLogisticsRuntimeStatus> {
    if (this.busy) return this.status();
    this.busy = true;

    try {
      const claim = this.claims[0] || null;
      this.activeClaim = claim;

      if (!claim) {
        this.setState("IDLE", "NO_LOGISTICS_CLAIMS");
        return this.status();
      }

      if (this.uncertainClaims.has(claim.id)) {
        this.setState("UNCERTAIN", "CLAIM_OUTCOME_UNCERTAIN_NO_RETRY");
        return this.status();
      }

      const retryAt = this.retryAt.get(claim.id) || 0;
      if (retryAt > this.now()) {
        this.setState("BACKOFF", "CLAIM_RETRY_BACKOFF");
        return this.status();
      }

      const rendezvous = await this.ensureRendezvous(claim);
      if (!rendezvous) return this.status();

      if (
        claim.actorRole === "MERCHANT" &&
        (claim.type === "GOLD_PICKUP" ||
          claim.type === "INVENTORY_PRESSURE")
      ) {
        this.setState("RENDEZVOUS_READY", "WAITING_FOR_FARMER_TRANSFER");
        return this.status();
      }

      this.setState("EXECUTING", "LOGISTICS_ACTION_DISPATCH");
      const action = await this.executeClaim(claim);
      if (!action) return this.status();
      this.handleActionResult(claim, action);
      return this.status();
    } finally {
      this.busy = false;
    }
  }

  private async ensureRendezvous(
    claim: MerchantLogisticsRuntimeClaim,
  ): Promise<boolean> {
    const character = this.game.character();
    const visible = this.visibleCharacter(claim.target.name);
    const targetMap = visible?.map || claim.target.map;
    const targetX = visible?.x ?? claim.target.x;
    const targetY = visible?.y ?? claim.target.y;
    const sameMap =
      !!character.map && !!targetMap && character.map === targetMap;
    const distance =
      sameMap &&
      character.x !== null &&
      character.y !== null &&
      targetX !== null &&
      targetY !== null
        ? Math.hypot(character.x - targetX, character.y - targetY)
        : null;

    if (distance !== null && distance <= this.interactionRange) {
      return true;
    }

    if (claim.actorRole === "FARMER_TRANSFER") {
      this.setState(
        "WAITING_RENDEZVOUS",
        "FARMER_WAITS_FOR_MERCHANT",
      );
      return false;
    }

    if (!targetMap || targetX === null || targetY === null) {
      this.setState("WAITING_TARGET", "TARGET_POSITION_UNAVAILABLE");
      return false;
    }

    const movement = this.movement.status();
    if (
      movement.owner &&
      movement.owner !== MOVEMENT_OWNER
    ) {
      this.setState("WAITING_MOVEMENT", "MOVEMENT_OWNED_BY_OTHER");
      return false;
    }
    if (
      movement.active &&
      movement.active.owner !== MOVEMENT_OWNER
    ) {
      this.setState("WAITING_MOVEMENT", "MOVEMENT_OWNED_BY_OTHER");
      return false;
    }
    if (
      movement.owner === MOVEMENT_OWNER &&
      movement.active
    ) {
      this.setState("MOVING", "LOGISTICS_RENDEZVOUS_IN_PROGRESS");
      return false;
    }
    if (
      movement.owner === MOVEMENT_OWNER &&
      movement.mode === "UNKNOWN"
    ) {
      this.uncertainClaims.add(claim.id);
      this.setState("UNCERTAIN", "LOGISTICS_MOVEMENT_OUTCOME_UNKNOWN");
      return false;
    }

    const action = await this.movement.smart({
      owner: MOVEMENT_OWNER,
      module: MODULE,
      why: "LOGISTICS_RENDEZVOUS",
      correlationId: claim.id,
      destination: {
        map: targetMap,
        x: targetX,
        y: targetY,
      },
    });
    this.recordAction(claim, action);

    if (action.status === "CONFIRMED") {
      this.setState("MOVING", "LOGISTICS_RENDEZVOUS_ARRIVED");
    } else if (
      action.status === "UNKNOWN" ||
      action.status === "DISPATCHED"
    ) {
      this.uncertainClaims.add(claim.id);
      this.setState("UNCERTAIN", "LOGISTICS_MOVEMENT_OUTCOME_UNKNOWN");
      this.emit({
        type: "MERCHANT_LOGISTICS_CLAIM_UNCERTAIN",
        reason: "LOGISTICS_MOVEMENT_OUTCOME_UNKNOWN",
      });
    } else {
      this.retryAt.set(claim.id, this.now() + this.retryBackoffMs);
      this.setState("BACKOFF", "LOGISTICS_MOVEMENT_NOT_CONFIRMED");
      this.emit({
        type: "MERCHANT_LOGISTICS_CLAIM_ATTEMPT_FAILED",
        reason: "LOGISTICS_MOVEMENT_NOT_CONFIRMED",
      });
    }
    return false;
  }

  private async executeClaim(
    claim: MerchantLogisticsRuntimeClaim,
  ): Promise<ActionRecord | null> {
    if (claim.type === "MLUCK") {
      return this.actions.useSkill({
        skill: "mluck",
        args: [claim.farmer],
        module: MODULE,
        why: "MLUCK_FARMER",
        correlationId: claim.id,
      });
    }

    if (
      claim.type === "POTION_DELIVERY" ||
      claim.type === "ITEM_DELIVERY" ||
      claim.type === "GEAR_DELIVERY"
    ) {
      const source = this.safeTransferSlot(
        claim.itemName,
        null,
      );
      if (!source) {
        this.setState("WAITING_STOCK", "SAFE_MERCHANT_STOCK_UNAVAILABLE");
        return null;
      }

      const requested = positiveInteger(claim.quantity) || 1;
      const quantity = Math.min(requested, source.quantity);
      return this.actions.sendItem({
        recipient: claim.farmer,
        inventorySlot: source.slot,
        quantity,
        module: MODULE,
        why: claim.type,
        correlationId: claim.id,
      });
    }

    if (
      claim.actorRole === "FARMER_TRANSFER" &&
      claim.type === "GOLD_PICKUP"
    ) {
      const merchantName = claim.merchant?.name;
      const currentGold = this.game.character().gold;
      const keepGold = Math.max(
        0,
        finite(claim.metadata.keepGold) ?? 0,
      );
      const requested = positiveInteger(claim.amount);
      const available =
        currentGold === null
          ? null
          : Math.max(0, Math.floor(currentGold - keepGold));

      if (!merchantName || requested === null || available === null) {
        this.setState("BLOCKED", "GOLD_PICKUP_PREFLIGHT_INVALID");
        return null;
      }
      const amount = Math.min(requested, available);
      if (amount <= 0) {
        this.setState("BLOCKED", "GOLD_PICKUP_RESERVE_REACHED");
        return null;
      }
      return this.actions.sendGold({
        recipient: merchantName,
        amount,
        module: MODULE,
        why: "GOLD_PICKUP",
        correlationId: claim.id,
      });
    }

    if (
      claim.actorRole === "FARMER_TRANSFER" &&
      claim.type === "INVENTORY_PRESSURE"
    ) {
      const merchantName = claim.merchant?.name;
      const source = this.safeTransferSlot(
        claim.itemName,
        claim.inventorySlot,
      );
      if (!merchantName || !source) {
        this.setState(
          "WAITING_SAFE_ITEM",
          "INVENTORY_PRESSURE_ITEM_NOT_TRANSFERABLE",
        );
        return null;
      }
      const requested = positiveInteger(claim.quantity) || source.quantity;
      return this.actions.sendItem({
        recipient: merchantName,
        inventorySlot: source.slot,
        quantity: Math.min(requested, source.quantity),
        module: MODULE,
        why: "INVENTORY_PRESSURE",
        correlationId: claim.id,
      });
    }

    this.setState("BLOCKED", "CLAIM_NOT_EXECUTABLE_BY_ACTOR");
    return null;
  }

  private safeTransferSlot(
    expectedName: string | null,
    requiredSlot: number | null,
  ): { slot: number; quantity: number } | null {
    if (!expectedName) return null;
    const intelligence = this.inventoryIntelligence.status();
    const intelligenceBySlot = new Map(
      intelligence.entries.map((entry) => [entry.slot, entry]),
    );

    const candidates = this.game.inventory().filter((entry) => {
      if (requiredSlot !== null && entry.slot !== requiredSlot) return false;
      if (itemName(entry.item) !== expectedName) return false;
      const decision = intelligenceBySlot.get(entry.slot);
      return (
        !!decision &&
        decision.name === expectedName &&
        decision.protected !== true &&
        decision.disposition !== "QUEST" &&
        decision.disposition !== "RESERVED" &&
        decision.disposition !== "UNKNOWN"
      );
    });

    const source = candidates[0];
    if (!source?.item) return null;
    return {
      slot: source.slot,
      quantity: itemQuantity(source.item),
    };
  }

  private visibleCharacter(name: string): EntitySnapshot | null {
    return (
      this.game
        .entities()
        .find(
          (entity) =>
            entity.type === "character" &&
            entity.name === name &&
            !entity.dead &&
            !entity.rip,
        ) || null
    );
  }

  private handleActionResult(
    claim: MerchantLogisticsRuntimeClaim,
    action: ActionRecord,
  ): void {
    this.recordAction(claim, action);

    if (action.status === "CONFIRMED") {
      this.retryAt.delete(claim.id);
      this.setState("COMPLETED", "LOGISTICS_CLAIM_CONFIRMED");
      this.emit({
        type: "MERCHANT_LOGISTICS_CLAIM_COMPLETED",
        reason: "LOGISTICS_CLAIM_CONFIRMED",
        completion: {
          claimId: claim.id,
          type: claim.type,
          farmer: claim.farmer,
          merchant: claim.merchant?.name || null,
          itemName: claim.itemName,
          quantity:
            claim.type === "GOLD_PICKUP" ? null : claim.quantity,
          amount:
            claim.type === "GOLD_PICKUP" ? claim.amount : null,
          direction: claim.direction,
          actionId: action.id,
        },
      });
      return;
    }

    if (
      action.status === "UNKNOWN" ||
      action.status === "DISPATCHED"
    ) {
      this.uncertainClaims.add(claim.id);
      this.setState("UNCERTAIN", "CLAIM_OUTCOME_UNCERTAIN_NO_RETRY");
      this.emit({
        type: "MERCHANT_LOGISTICS_CLAIM_UNCERTAIN",
        reason: "CLAIM_OUTCOME_UNCERTAIN_NO_RETRY",
      });
      return;
    }

    this.retryAt.set(claim.id, this.now() + this.retryBackoffMs);
    this.setState("BACKOFF", "LOGISTICS_ACTION_NOT_CONFIRMED");
    this.emit({
      type: "MERCHANT_LOGISTICS_CLAIM_ATTEMPT_FAILED",
      reason: "LOGISTICS_ACTION_NOT_CONFIRMED",
    });
  }

  private recordAction(
    claim: MerchantLogisticsRuntimeClaim,
    action: ActionRecord,
  ): void {
    this.lastAction = {
      claimId: claim.id,
      actionId: action.id,
      action: action.action,
      status: action.status,
      why: action.why,
      timestamp: this.now(),
    };
  }

  private setState(
    state: MerchantLogisticsRuntimeState,
    reason: string,
  ): void {
    this.state = state;
    this.reason = reason;
    const signature =
      state +
      "|" +
      reason +
      "|" +
      (this.activeClaim?.id || "");
    if (signature === this.lastStateSignature) return;
    this.lastStateSignature = signature;
    this.emit({
      type: "MERCHANT_LOGISTICS_STATE_CHANGED",
      reason,
    });
  }

  private emit(
    event: Omit<
      MerchantLogisticsRuntimeEvent,
      "timestamp" | "status"
    >,
  ): void {
    this.onEvent?.({
      ...event,
      timestamp: this.now(),
      status: this.status(),
    });
  }
}

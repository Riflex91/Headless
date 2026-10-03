import type { ActionRecord } from "./action-ledger.lib";
import type {
  BankSnapshot,
  CharacterSnapshot,
  EntitySnapshot,
  EquipmentSnapshot,
  InventorySlotSnapshot,
  MapSnapshot,
  SkillSnapshot,
  TradeSlotsSnapshot,
} from "./game-adapter.lib";

interface ActionIntentInput {
  module: string;
  action: string;
  why: string;
  correlationId?: string;
  allowDuringEmergencyStop?: boolean;
  expectedCost?: Record<string, unknown>;
  expectedEffect?: Record<string, unknown>;
  before?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface ActionResolutionInput {
  why: string;
  after?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  error?: string;
}

interface ActionLedgerLike {
  create(intent: ActionIntentInput): ActionRecord;
  dispatch(
    actionId: string,
    evidence?: Record<string, unknown>,
  ): ActionRecord;
  confirm(
    actionId: string,
    resolution: ActionResolutionInput,
  ): ActionRecord;
  reject(
    actionId: string,
    resolution: ActionResolutionInput,
  ): ActionRecord;
  unknown(
    actionId: string,
    resolution: ActionResolutionInput,
  ): ActionRecord;
  block(actionId: string, why: string): ActionRecord;
  get(actionId: string): ActionRecord | undefined;
}

interface GameReadAdapter {
  character(): CharacterSnapshot;
  entity(id: string): EntitySnapshot | null;
  inventory(): InventorySlotSnapshot[];
  equipment(): EquipmentSnapshot;
  tradeSlots(): TradeSlotsSnapshot;
  party(): Record<string, unknown>;
  bank(): BankSnapshot;
  skills(characterOnly?: boolean): SkillSnapshot[];
  map(): MapSnapshot;
  gameData(): Record<string, unknown>;
}

export interface BoundaryRequest {
  module: string;
  why: string;
  correlationId?: string;
}

export interface MoveRequest extends BoundaryRequest {
  x: number;
  y: number;
}

export type SmartMoveTarget =
  | string
  | {
      x: number;
      y: number;
      map?: string;
    };

export type SmartMoveDestination =
  | SmartMoveTarget
  | {
      to: SmartMoveTarget;
      return?: boolean;
    };

export interface SmartMoveRequest extends BoundaryRequest {
  destination: SmartMoveDestination;
}

export interface AttackRequest extends BoundaryRequest {
  targetId: string;
}

export interface SkillRequest extends BoundaryRequest {
  skill: string;
  targetId?: string;
  targetIds?: string[];
  args?: unknown[];
}

export interface LootRequest extends BoundaryRequest {
  chestId?: string;
}

export interface BuyRequest extends BoundaryRequest {
  itemName: string;
  quantity?: number;
}

export interface SellRequest extends BoundaryRequest {
  inventorySlot: number;
  quantity?: number;
}

export interface SendItemRequest extends BoundaryRequest {
  recipient: string;
  inventorySlot: number;
  quantity?: number;
}

export interface SendGoldRequest extends BoundaryRequest {
  recipient: string;
  amount: number;
}

export interface BankStoreRequest extends BoundaryRequest {
  inventorySlot: number;
  pack?: string;
  packSlot?: number;
}

export interface BankRetrieveRequest extends BoundaryRequest {
  pack: string;
  packSlot: number;
  inventorySlot?: number;
}

export interface BankGoldRequest extends BoundaryRequest {
  amount: number;
}

export interface EquipRequest extends BoundaryRequest {
  inventorySlot: number;
  slot?: string;
}

export interface UnequipRequest extends BoundaryRequest {
  slot: string;
}

export interface UpgradeRequest extends BoundaryRequest {
  itemSlot: number;
  scrollSlot: number;
  offeringSlot?: number | null;
}

export interface CompoundRequest extends BoundaryRequest {
  itemSlots: [number, number, number];
  scrollSlot: number;
  offeringSlot?: number | null;
}

export interface ExchangeRequest extends BoundaryRequest {
  itemSlot: number;
}

export interface CraftRequest extends BoundaryRequest {
  recipe: string;
  itemSlots: number[];
}

export interface OpenStandRequest extends BoundaryRequest {
  inventorySlot?: number;
}

export interface TradeListRequest extends BoundaryRequest {
  inventorySlot: number;
  slot: string | number;
  price: number;
  quantity?: number;
}

export interface TradeUnlistRequest extends BoundaryRequest {
  slot: string | number;
}

export interface WishlistRequest extends BoundaryRequest {
  slot: string | number;
  itemName: string;
  price: number;
  level?: number;
  quantity?: number;
}

export interface PontyBuyRequest extends BoundaryRequest {
  rid: string;
  itemName: string;
  price: number;
}

export interface PartyTargetRequest extends BoundaryRequest {
  name: string;
}

export interface MutationDriver {
  move(x: number, y: number): unknown;
  smartMove(
    destination: SmartMoveDestination,
  ): Promise<unknown> | unknown;
  cancelMovement(): Promise<unknown> | unknown;
  resolveEntity(id: string): unknown;
  canAttack(entity: unknown): boolean;
  attack(entity: unknown): Promise<unknown> | unknown;
  canUseSkill(skill: string): boolean;
  useSkill(skill: string, ...args: unknown[]): Promise<unknown> | unknown;
  loot(chestId?: string): Promise<unknown> | unknown;
  buy(itemName: string, quantity?: number): Promise<unknown> | unknown;
  sell(inventorySlot: number, quantity?: number): Promise<unknown> | unknown;
  sendItem(
    recipient: string,
    inventorySlot: number,
    quantity?: number,
  ): Promise<unknown> | unknown;
  sendGold(recipient: string, amount: number): Promise<unknown> | unknown;
  bankStore(
    inventorySlot: number,
    pack?: string,
    packSlot?: number,
  ): Promise<unknown> | unknown;
  bankRetrieve(
    pack: string,
    packSlot: number,
    inventorySlot?: number,
  ): Promise<unknown> | unknown;
  bankDeposit(amount: number): Promise<unknown> | unknown;
  bankWithdraw(amount: number): Promise<unknown> | unknown;
  equip(inventorySlot: number, slot?: string): Promise<unknown> | unknown;
  unequip(slot: string): Promise<unknown> | unknown;
  upgrade(
    itemSlot: number,
    scrollSlot: number,
    offeringSlot?: number | null,
  ): Promise<unknown> | unknown;
  compound(
    itemSlot1: number,
    itemSlot2: number,
    itemSlot3: number,
    scrollSlot: number,
    offeringSlot?: number | null,
  ): Promise<unknown> | unknown;
  exchange(itemSlot: number): Promise<unknown> | unknown;
  craft(itemSlots: number[]): Promise<unknown> | unknown;
  openStand(inventorySlot?: number): Promise<unknown> | unknown;
  closeStand(): Promise<unknown> | unknown;
  tradeList(
    inventorySlot: number,
    slot: string | number,
    price: number,
    quantity?: number,
  ): Promise<unknown> | unknown;
  tradeUnlist(slot: string): Promise<unknown> | unknown;
  wishlist(
    slot: string | number,
    itemName: string,
    price: number,
    level?: number,
    quantity?: number,
  ): Promise<unknown> | unknown;
  pontyBuy(rid: string): Promise<unknown> | unknown;
  partyInvite(name: string): Promise<unknown> | unknown;
  partyRequest(name: string): Promise<unknown> | unknown;
  partyAcceptInvite(name: string): Promise<unknown> | unknown;
  partyAcceptRequest(name: string): Promise<unknown> | unknown;
  partyLeave(): Promise<unknown> | unknown;
  respawn(): Promise<unknown> | unknown;
}

function runtimeFunction(name: string): (...args: unknown[]) => unknown {
  const scope = globalThis as unknown as Record<string, unknown>;
  const fn = scope[name];

  if (typeof fn !== "function") {
    throw new Error(`Adventure Land mutation function unavailable: ${name}`);
  }

  return fn as (...args: unknown[]) => unknown;
}

function runtimeSocketEmit(event: string, payload: unknown): unknown {
  const local = globalThis as unknown as Record<string, unknown>;
  const parentScope =
    typeof parent === "undefined"
      ? null
      : (parent as unknown as Record<string, unknown>);
  const socket = objectRecord(local.socket ?? parentScope?.socket);
  const emit = socket.emit;

  if (typeof emit !== "function") {
    throw new Error("Adventure Land socket unavailable");
  }

  return (emit as (event: string, payload: unknown) => unknown).call(
    socket,
    event,
    payload,
  );
}

export function createRuntimeMutationDriver(): MutationDriver {
  return {
    move: (x, y) => runtimeFunction("move")(x, y),
    smartMove: (destination) =>
      runtimeFunction("smart_move")(destination),
    cancelMovement: () => runtimeFunction("stop")("move"),
    resolveEntity: (id) => runtimeFunction("get_entity")(id),
    canAttack: (entity) => Boolean(runtimeFunction("can_attack")(entity)),
    attack: (entity) => runtimeFunction("attack")(entity),
    canUseSkill: (skill) => Boolean(runtimeFunction("can_use")(skill)),
    useSkill: (skill, ...args) => runtimeFunction("use_skill")(skill, ...args),
    loot: (chestId) =>
      chestId === undefined
        ? runtimeFunction("loot")()
        : runtimeFunction("loot")(chestId),
    buy: (itemName, quantity) =>
      quantity === undefined
        ? runtimeFunction("buy")(itemName)
        : runtimeFunction("buy")(itemName, quantity),
    sell: (inventorySlot, quantity) =>
      quantity === undefined
        ? runtimeFunction("sell")(inventorySlot)
        : runtimeFunction("sell")(inventorySlot, quantity),
    sendItem: (recipient, inventorySlot, quantity) =>
      quantity === undefined
        ? runtimeFunction("send_item")(recipient, inventorySlot)
        : runtimeFunction("send_item")(recipient, inventorySlot, quantity),
    sendGold: (recipient, amount) =>
      runtimeFunction("send_gold")(recipient, amount),
    bankStore: (inventorySlot, pack, packSlot) => {
      if (pack === undefined) {
        return runtimeFunction("bank_store")(inventorySlot);
      }
      if (packSlot === undefined) {
        return runtimeFunction("bank_store")(inventorySlot, pack);
      }
      return runtimeFunction("bank_store")(inventorySlot, pack, packSlot);
    },
    bankRetrieve: (pack, packSlot, inventorySlot) =>
      inventorySlot === undefined
        ? runtimeFunction("bank_retrieve")(pack, packSlot)
        : runtimeFunction("bank_retrieve")(pack, packSlot, inventorySlot),
    bankDeposit: (amount) => runtimeFunction("bank_deposit")(amount),
    bankWithdraw: (amount) => runtimeFunction("bank_withdraw")(amount),
    equip: (inventorySlot, slot) =>
      slot === undefined
        ? runtimeFunction("equip")(inventorySlot)
        : runtimeFunction("equip")(inventorySlot, slot),
    unequip: (slot) => runtimeFunction("unequip")(slot),
    upgrade: (itemSlot, scrollSlot, offeringSlot) =>
      runtimeFunction("upgrade")(
        itemSlot,
        scrollSlot,
        offeringSlot === undefined ? null : offeringSlot,
      ),
    compound: (
      itemSlot1,
      itemSlot2,
      itemSlot3,
      scrollSlot,
      offeringSlot,
    ) =>
      runtimeFunction("compound")(
        itemSlot1,
        itemSlot2,
        itemSlot3,
        scrollSlot,
        offeringSlot === undefined ? null : offeringSlot,
      ),
    exchange: (itemSlot) => runtimeFunction("exchange")(itemSlot),
    craft: (itemSlots) => runtimeFunction("craft")(...itemSlots),
    openStand: (inventorySlot) =>
      inventorySlot === undefined
        ? runtimeFunction("open_stand")()
        : runtimeFunction("open_stand")(inventorySlot),
    closeStand: () => runtimeFunction("close_stand")(),
    tradeList: (inventorySlot, slot, price, quantity) =>
      quantity === undefined
        ? runtimeFunction("trade")(inventorySlot, slot, price)
        : runtimeFunction("trade")(inventorySlot, slot, price, quantity),
    tradeUnlist: (slot) => runtimeFunction("unequip")(slot),
    wishlist: (slot, itemName, price, level, quantity) =>
      runtimeFunction("wishlist")(slot, itemName, price, level, quantity),
    pontyBuy: (rid) => runtimeSocketEmit("sbuy", { rid }),
    partyInvite: (name) => runtimeFunction("send_party_invite")(name),
    partyRequest: (name) => runtimeFunction("send_party_request")(name),
    partyAcceptInvite: (name) =>
      runtimeFunction("accept_party_invite")(name),
    partyAcceptRequest: (name) =>
      runtimeFunction("accept_party_request")(name),
    partyLeave: () => runtimeFunction("leave_party")(),
    respawn: () => runtimeFunction("respawn")(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function structuredReason(value: unknown): string | null {
  const recordValue = objectRecord(value);
  return typeof recordValue.reason === "string" &&
    recordValue.reason.trim().length > 0
    ? recordValue.reason
    : null;
}

function validSmartMoveTarget(target: SmartMoveTarget): boolean {
  if (typeof target === "string") {
    return target.trim().length > 0;
  }

  return (
    !!target &&
    typeof target === "object" &&
    Number.isFinite(target.x) &&
    Number.isFinite(target.y) &&
    (target.map === undefined ||
      (typeof target.map === "string" && target.map.trim().length > 0))
  );
}

function validSmartMoveDestination(
  destination: SmartMoveDestination,
): boolean {
  if (typeof destination === "string") {
    return validSmartMoveTarget(destination);
  }

  if (!destination || typeof destination !== "object") return false;
  if ("to" in destination) {
    return (
      validSmartMoveTarget(destination.to) &&
      (destination.return === undefined ||
        typeof destination.return === "boolean")
    );
  }

  return validSmartMoveTarget(destination);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown, fallback = 1): number | null {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function inventoryItem(
  inventory: InventorySlotSnapshot[],
  slot: number,
): Record<string, unknown> | null {
  return inventory.find((entry) => entry.slot === slot)?.item || null;
}

function itemQuantity(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  const quantity = Number(item.q);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function itemName(item: Record<string, unknown> | null): string | null {
  return item && typeof item.name === "string" ? item.name : null;
}

function itemLevel(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  const level = Number(item.level);
  return Number.isInteger(level) && level >= 0 ? level : 0;
}

function inventorySlotValid(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0;
}

function distinctSlots(slots: Array<number | null | undefined>): boolean {
  const present = slots.filter(
    (slot): slot is number => slot !== null && slot !== undefined,
  );
  return new Set(present).size === present.length;
}

function gameItemDefinition(
  gameData: Record<string, unknown>,
  name: string | null,
): Record<string, unknown> {
  if (!name) return {};
  return objectRecord(objectRecord(gameData.items)[name]);
}

function normalizeTradeSlot(slot: string | number): string | null {
  if (typeof slot === "number") {
    return Number.isInteger(slot) && slot >= 1 && slot <= 30
      ? `trade${slot}`
      : null;
  }

  const normalized = slot.trim();
  return /^trade(?:[1-9]|[12]\\d|30)$/.test(normalized)
    ? normalized
    : null;
}

function itemLocked(item: Record<string, unknown> | null): boolean {
  if (!item) return false;
  return item.locked === true || (typeof item.l === "string" && item.l.length > 0);
}

function totalItemQuantity(
  inventory: InventorySlotSnapshot[],
  name: string,
): number {
  return inventory.reduce((total, entry) => {
    if (itemName(entry.item) !== name) return total;
    return total + itemQuantity(entry.item);
  }, 0);
}

function explicitFailure(result: unknown): boolean {
  const value = objectRecord(result);
  return value.success === false || value.failed === true;
}

function safeResultEvidence(result: unknown): unknown {
  if (
    result === null ||
    result === undefined ||
    typeof result === "string" ||
    typeof result === "number" ||
    typeof result === "boolean"
  ) {
    return result ?? null;
  }

  const value = objectRecord(result);
  const evidence: Record<string, unknown> = {};
  for (const key of [
    "success",
    "failed",
    "response",
    "reason",
    "place",
    "level",
    "num",
    "reward",
    "chance",
  ]) {
    const entry = value[key];
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      evidence[key] = entry;
    }
  }
  return evidence;
}

function relevantInventoryState(
  inventory: InventorySlotSnapshot[],
  slot: number,
): Record<string, unknown> {
  const item = inventoryItem(inventory, slot);
  return {
    slot,
    item,
    quantity: itemQuantity(item),
  };
}

function bankPack(
  bank: BankSnapshot,
  packName: string,
): InventorySlotSnapshot[] | null {
  return bank.packs.find((pack) => pack.name === packName)?.items || null;
}

function bankItem(
  bank: BankSnapshot,
  packName: string,
  slot: number,
): Record<string, unknown> | null {
  const pack = bankPack(bank, packName);
  return pack ? inventoryItem(pack, slot) : null;
}

function itemIdentity(item: Record<string, unknown> | null): string | null {
  if (!item) return null;
  const name = itemName(item);
  if (!name) return null;

  return JSON.stringify({
    name,
    level: Number.isFinite(Number(item.level)) ? Number(item.level) : 0,
    p: typeof item.p === "string" ? item.p : null,
    stat_type: typeof item.stat_type === "string" ? item.stat_type : null,
  });
}

function equipmentSlot(
  equipment: EquipmentSnapshot,
  slot: string,
): Record<string, unknown> | null {
  const item = equipment[slot];
  return item && typeof item === "object" ? item : null;
}

function equipmentHasIdentity(
  equipment: EquipmentSnapshot,
  identity: string | null,
): boolean {
  if (!identity) return false;
  return Object.values(equipment).some(
    (item) => itemIdentity(item) === identity,
  );
}

function inventoryHasIdentity(
  inventory: InventorySlotSnapshot[],
  identity: string | null,
): boolean {
  if (!identity) return false;
  return inventory.some((entry) => itemIdentity(entry.item) === identity);
}

function inventoryIdentityCount(
  inventory: InventorySlotSnapshot[],
  identity: string | null,
): number {
  if (!identity) return 0;
  return inventory.filter((entry) => itemIdentity(entry.item) === identity)
    .length;
}

function partyMembers(party: Record<string, unknown>): string[] {
  return Object.keys(party).sort((a, b) => a.localeCompare(b));
}

function partyJoined(
  party: Record<string, unknown>,
  names: string[],
): boolean {
  const members = new Set(Object.keys(party));
  return names.every((name) => members.has(name));
}

export const ACTION_BOUNDARY_MUTATION_CAPABILITIES = [
  "MOVE",
  "SMART_MOVE",
  "MOVEMENT_CANCEL",
  "ATTACK",
  "SKILL",
  "LOOT",
  "BUY",
  "SELL",
  "SEND_ITEM",
  "SEND_GOLD",
  "BANK_STORE",
  "BANK_RETRIEVE",
  "BANK_DEPOSIT_GOLD",
  "BANK_WITHDRAW_GOLD",
  "EQUIP",
  "UNEQUIP",
  "UPGRADE",
  "COMPOUND",
  "EXCHANGE",
  "CRAFT",
  "OPEN_STAND",
  "CLOSE_STAND",
  "TRADE_LIST",
  "TRADE_UNLIST",
  "WISHLIST",
  "PONTY_BUY",
  "PARTY_INVITE",
  "PARTY_REQUEST",
  "PARTY_ACCEPT_INVITE",
  "PARTY_ACCEPT_REQUEST",
  "PARTY_LEAVE",
  "RESPAWN",
] as const;

export class ActionBoundary {
  constructor(
    private readonly ledger: ActionLedgerLike,
    private readonly game: GameReadAdapter,
    private readonly driver: MutationDriver = createRuntimeMutationDriver(),
  ) {}

  capabilities(): readonly string[] {
    return ACTION_BOUNDARY_MUTATION_CAPABILITIES;
  }

  move(request: MoveRequest): ActionRecord {
    const before = this.game.character();
    const transaction = this.ledger.create({
      module: request.module,
      action: "MOVE",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        map: before.map,
        x: request.x,
        y: request.y,
      },
      before: {
        map: before.map,
        x: before.x,
        y: before.y,
        moving: before.moving,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;

    if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) {
      return this.ledger.block(transaction.id, "INVALID_MOVE_DESTINATION");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "move",
      x: request.x,
      y: request.y,
    });

    try {
      this.driver.move(request.x, request.y);
      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "MOVE_DISPATCH_UNCERTAIN",
        error: errorMessage(error),
        after: { ...this.game.map() },
      });
    }
  }

  directMove(request: MoveRequest): ActionRecord {
    return this.move(request);
  }

  cancelDirectMove(
    actionId: string,
    reason = "MOVE_CANCELLED",
  ): ActionRecord {
    const record = this.ledger.get(actionId);
    if (!record) {
      throw new Error(`unknown movement action: ${actionId}`);
    }
    if (record.action !== "MOVE") {
      throw new Error(
        `action ${actionId} is not a direct movement action`,
      );
    }
    if (record.status !== "DISPATCHED") return record;

    const after = this.game.character();
    return this.ledger.reject(actionId, {
      why: reason,
      after: {
        map: after.map,
        x: after.x,
        y: after.y,
        moving: after.moving,
      },
      evidence: {
        cancelled: true,
      },
    });
  }

  settleMove(actionId: string, tolerance = 5): ActionRecord {
    const record = this.ledger.get(actionId);
    if (!record) {
      throw new Error(`unknown movement action: ${actionId}`);
    }
    if (record.action !== "MOVE") {
      throw new Error(
        `action ${actionId} is not a direct movement action`,
      );
    }
    if (record.status !== "DISPATCHED") return record;

    const expected = objectRecord(record.expectedEffect);
    const targetX = Number(expected.x);
    const targetY = Number(expected.y);
    const targetMap =
      typeof expected.map === "string" ? expected.map : null;
    const normalizedTolerance =
      Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 5;

    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      return this.ledger.unknown(actionId, {
        why: "MOVE_SETTLEMENT_TARGET_INVALID",
        after: { ...this.game.map() },
      });
    }

    const after = this.game.character();
    const distance =
      typeof after.x === "number" &&
      Number.isFinite(after.x) &&
      typeof after.y === "number" &&
      Number.isFinite(after.y)
        ? Math.hypot(after.x - targetX, after.y - targetY)
        : null;
    const sameMap = targetMap === null || after.map === targetMap;

    if (
      sameMap &&
      distance !== null &&
      distance <= normalizedTolerance &&
      !after.moving
    ) {
      return this.ledger.confirm(actionId, {
        why: "MOVE_ARRIVED",
        after: {
          map: after.map,
          x: after.x,
          y: after.y,
          moving: after.moving,
        },
        evidence: {
          distance,
          tolerance: normalizedTolerance,
        },
      });
    }

    return record;
  }

  async smartMove(request: SmartMoveRequest): Promise<ActionRecord> {
    const before = this.game.character();
    const transaction = this.ledger.create({
      module: request.module,
      action: "SMART_MOVE",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        destination: request.destination,
      },
      before: {
        map: before.map,
        x: before.x,
        y: before.y,
        moving: before.moving,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!validSmartMoveDestination(request.destination)) {
      return this.ledger.block(
        transaction.id,
        "INVALID_SMART_MOVE_DESTINATION",
      );
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "smart_move",
      destination: request.destination,
    });

    try {
      const result = await this.driver.smartMove(request.destination);
      const response = objectRecord(result);
      const reason = structuredReason(result);
      const after = this.game.character();

      if (response.success === false || reason) {
        return this.ledger.reject(transaction.id, {
          why: "SMART_MOVE_REJECTED",
          after: {
            map: after.map,
            x: after.x,
            y: after.y,
            moving: after.moving,
          },
          evidence: {
            reason,
            result: safeResultEvidence(result),
          },
        });
      }
      if (response.success === true) {
        return this.ledger.confirm(transaction.id, {
          why: "SMART_MOVE_ARRIVED",
          after: {
            map: after.map,
            x: after.x,
            y: after.y,
            moving: after.moving,
          },
          evidence: {
            apiResolved: true,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "SMART_MOVE_RESULT_UNVERIFIED",
        after: {
          map: after.map,
          x: after.x,
          y: after.y,
          moving: after.moving,
        },
        evidence: {
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      const reason = structuredReason(error);
      const after = this.game.character();

      if (reason) {
        return this.ledger.reject(transaction.id, {
          why:
            reason === "interrupted"
              ? "SMART_MOVE_INTERRUPTED"
              : "SMART_MOVE_REJECTED",
          after: {
            map: after.map,
            x: after.x,
            y: after.y,
            moving: after.moving,
          },
          evidence: { reason },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "SMART_MOVE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          map: after.map,
          x: after.x,
          y: after.y,
          moving: after.moving,
        },
      });
    }
  }

  async cancelMovement(request: BoundaryRequest): Promise<ActionRecord> {
    const before = this.game.character();
    const transaction = this.ledger.create({
      module: request.module,
      action: "MOVEMENT_CANCEL",
      why: request.why,
      correlationId: request.correlationId,
      allowDuringEmergencyStop: true,
      expectedEffect: {
        movement: "STOPPED",
      },
      before: {
        map: before.map,
        x: before.x,
        y: before.y,
        moving: before.moving,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;

    this.ledger.dispatch(transaction.id, {
      mutation: "stop",
      action: "move",
    });

    try {
      const result = await this.driver.cancelMovement();
      const after = this.game.character();
      const reason = structuredReason(result);

      if (explicitFailure(result) || reason) {
        return this.ledger.reject(transaction.id, {
          why: "MOVEMENT_CANCEL_REJECTED",
          after: {
            map: after.map,
            x: after.x,
            y: after.y,
            moving: after.moving,
          },
          evidence: {
            reason,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.confirm(transaction.id, {
        why: "MOVEMENT_CANCEL_API_CONFIRMED",
        after: {
          map: after.map,
          x: after.x,
          y: after.y,
          moving: after.moving,
        },
        evidence: {
          apiResolved: true,
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      const reason = structuredReason(error);
      const after = this.game.character();

      if (reason) {
        return this.ledger.reject(transaction.id, {
          why: "MOVEMENT_CANCEL_REJECTED",
          after: {
            map: after.map,
            x: after.x,
            y: after.y,
            moving: after.moving,
          },
          evidence: { reason },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "MOVEMENT_CANCEL_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          map: after.map,
          x: after.x,
          y: after.y,
          moving: after.moving,
        },
      });
    }
  }

  async attack(request: AttackRequest): Promise<ActionRecord> {
    const before = this.game.character();
    const targetSnapshot = this.game.entity(request.targetId);
    const transaction = this.ledger.create({
      module: request.module,
      action: "ATTACK",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        targetId: request.targetId,
        effect: "ATTACK_TARGET",
      },
      before: {
        hp: before.hp,
        mp: before.mp,
        target: before.target,
        targetSnapshot,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;

    const target = this.driver.resolveEntity(request.targetId);
    if (!target) {
      return this.ledger.block(transaction.id, "TARGET_NOT_FOUND");
    }

    let canAttack = false;
    try {
      canAttack = this.driver.canAttack(target);
    } catch (_error) {
      return this.ledger.block(transaction.id, "ATTACK_PREFLIGHT_FAILED");
    }

    if (!canAttack) {
      return this.ledger.block(transaction.id, "TARGET_NOT_ATTACKABLE");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "attack",
      targetId: request.targetId,
    });

    try {
      const result = await this.driver.attack(target);
      const afterTarget = this.game.entity(request.targetId);
      return this.ledger.confirm(transaction.id, {
        why: "ATTACK_API_CONFIRMED",
        after: {
          character: this.game.character(),
          target: afterTarget,
        },
        evidence: {
          apiResolved: true,
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "ATTACK_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          character: this.game.character(),
          target: this.game.entity(request.targetId),
        },
      });
    }
  }

  async useSkill(request: SkillRequest): Promise<ActionRecord> {
    const skill = this.game
      .skills(false)
      .find((candidate) => candidate.key === request.skill);
    const before = this.game.character();
    const targetIds = Array.isArray(request.targetIds)
      ? [...new Set(request.targetIds.map((id) => id.trim()).filter(Boolean))]
      : [];
    const targetSnapshot = request.targetId
      ? this.game.entity(request.targetId)
      : null;
    const targetSnapshots = targetIds.map((id) => this.game.entity(id));
    const args = Array.isArray(request.args) ? request.args : [];
    const transaction = this.ledger.create({
      module: request.module,
      action: "SKILL",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        mp: skill?.mp ?? null,
      },
      expectedEffect: {
        skill: request.skill,
        targetId: request.targetId || null,
        targetIds,
      },
      before: {
        hp: before.hp,
        mp: before.mp,
        target: before.target,
        targetSnapshot,
        targetSnapshots,
      },
      metadata: {
        skill: request.skill,
        targetId: request.targetId || null,
        targetIds,
        argCount: args.length,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!skill) {
      return this.ledger.block(transaction.id, "UNKNOWN_SKILL");
    }
    if (request.targetId && targetIds.length) {
      return this.ledger.block(transaction.id, "SKILL_TARGET_MODE_CONFLICT");
    }
    if (targetIds.length > 5) {
      return this.ledger.block(transaction.id, "SKILL_TARGETS_INVALID");
    }
    if (args.length > 3) {
      return this.ledger.block(transaction.id, "SKILL_ARGUMENTS_INVALID");
    }

    let resolvedTarget: unknown = null;
    if (request.targetId) {
      resolvedTarget = this.driver.resolveEntity(request.targetId);
      if (!resolvedTarget) {
        return this.ledger.block(transaction.id, "SKILL_TARGET_NOT_FOUND");
      }
    }

    const resolvedTargets: unknown[] = [];
    for (const targetId of targetIds) {
      const resolved = this.driver.resolveEntity(targetId);
      if (!resolved) {
        return this.ledger.block(transaction.id, "SKILL_TARGET_NOT_FOUND");
      }
      resolvedTargets.push(resolved);
    }

    let canUse = false;
    try {
      canUse = this.driver.canUseSkill(request.skill);
    } catch (_error) {
      return this.ledger.block(transaction.id, "SKILL_PREFLIGHT_FAILED");
    }
    if (!canUse) {
      return this.ledger.block(transaction.id, "SKILL_NOT_USABLE");
    }

    const callArgs = resolvedTargets.length
      ? [resolvedTargets, ...args]
      : resolvedTarget
        ? [resolvedTarget, ...args]
        : args;
    this.ledger.dispatch(transaction.id, {
      mutation: "use_skill",
      skill: request.skill,
      targetId: request.targetId || null,
      targetIds,
      argCount: callArgs.length,
    });

    try {
      const result = await this.driver.useSkill(request.skill, ...callArgs);
      return this.ledger.confirm(transaction.id, {
        why: "SKILL_API_CONFIRMED",
        after: {
          character: this.game.character(),
          target: request.targetId
            ? this.game.entity(request.targetId)
            : null,
          targets: targetIds.map((id) => this.game.entity(id)),
        },
        evidence: {
          apiResolved: true,
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "SKILL_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          character: this.game.character(),
          target: request.targetId
            ? this.game.entity(request.targetId)
            : null,
          targets: targetIds.map((id) => this.game.entity(id)),
        },
      });
    }
  }

  async loot(request: LootRequest): Promise<ActionRecord> {
    const beforeCharacter = this.game.character();
    const beforeInventory = this.game.inventory();
    const transaction = this.ledger.create({
      module: request.module,
      action: "LOOT",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        chestId: request.chestId || null,
        effect: "COLLECT_LOOT",
      },
      before: {
        gold: beforeCharacter.gold,
        inventory: beforeInventory,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (
      request.chestId !== undefined &&
      (typeof request.chestId !== "string" || !request.chestId.trim())
    ) {
      return this.ledger.block(transaction.id, "CHEST_ID_INVALID");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "loot",
      chestId: request.chestId || null,
    });

    try {
      const result = await this.driver.loot(request.chestId);
      return this.ledger.confirm(transaction.id, {
        why: "LOOT_API_CONFIRMED",
        after: {
          gold: this.game.character().gold,
          inventory: this.game.inventory(),
        },
        evidence: {
          apiResolved: true,
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "LOOT_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          gold: this.game.character().gold,
          inventory: this.game.inventory(),
        },
      });
    }
  }

  async buy(request: BuyRequest): Promise<ActionRecord> {
    const quantity = positiveInteger(request.quantity);
    const beforeCharacter = this.game.character();
    const beforeInventory = this.game.inventory();
    const gameData = objectRecord(this.game.gameData());
    const itemDefinition = objectRecord(
      objectRecord(gameData.items)[request.itemName],
    );
    const unitPrice =
      typeof itemDefinition.g === "number" &&
      Number.isFinite(itemDefinition.g)
        ? itemDefinition.g
        : null;
    const transaction = this.ledger.create({
      module: request.module,
      action: "BUY",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        gold:
          unitPrice !== null && quantity !== null
            ? unitPrice * quantity
            : null,
      },
      expectedEffect: {
        itemName: request.itemName,
        quantity,
      },
      before: {
        gold: beforeCharacter.gold,
        itemQuantity: totalItemQuantity(beforeInventory, request.itemName),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!request.itemName?.trim()) {
      return this.ledger.block(transaction.id, "ITEM_NAME_INVALID");
    }
    if (quantity === null) {
      return this.ledger.block(transaction.id, "QUANTITY_INVALID");
    }
    if (!itemDefinition.name && Object.keys(itemDefinition).length === 0) {
      return this.ledger.block(transaction.id, "UNKNOWN_ITEM");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "buy",
      itemName: request.itemName,
      quantity,
    });

    try {
      const result = await this.driver.buy(request.itemName, quantity);
      const afterCharacter = this.game.character();
      const afterInventory = this.game.inventory();
      const beforeQuantity = totalItemQuantity(
        beforeInventory,
        request.itemName,
      );
      const afterQuantity = totalItemQuantity(afterInventory, request.itemName);

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "BUY_API_REJECTED",
          after: {
            gold: afterCharacter.gold,
            itemQuantity: afterQuantity,
          },
          evidence: {
            result: safeResultEvidence(result),
          },
        });
      }

      const resultRecord = objectRecord(result);
      if (
        resultRecord.success === true ||
        resultRecord.response === "buy_success" ||
        afterQuantity >= beforeQuantity + quantity
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "BUY_CONFIRMED",
          after: {
            gold: afterCharacter.gold,
            itemQuantity: afterQuantity,
          },
          evidence: {
            result: safeResultEvidence(result),
            itemDelta: afterQuantity - beforeQuantity,
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "BUY_OUTCOME_UNVERIFIED",
        after: {
          gold: afterCharacter.gold,
          itemQuantity: afterQuantity,
        },
        evidence: {
          result: safeResultEvidence(result),
          itemDelta: afterQuantity - beforeQuantity,
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "BUY_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          gold: this.game.character().gold,
          itemQuantity: totalItemQuantity(
            this.game.inventory(),
            request.itemName,
          ),
        },
      });
    }
  }

  async sell(request: SellRequest): Promise<ActionRecord> {
    const quantity = positiveInteger(request.quantity);
    const beforeCharacter = this.game.character();
    const beforeInventory = this.game.inventory();
    const beforeItem = inventoryItem(
      beforeInventory,
      request.inventorySlot,
    );
    const beforeItemName = itemName(beforeItem);
    const beforeQuantity = itemQuantity(beforeItem);
    const transaction = this.ledger.create({
      module: request.module,
      action: "SELL",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        inventorySlot: request.inventorySlot,
        quantity,
        itemName: beforeItemName,
      },
      before: {
        gold: beforeCharacter.gold,
        inventory: relevantInventoryState(
          beforeInventory,
          request.inventorySlot,
        ),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!Number.isInteger(request.inventorySlot) || request.inventorySlot < 0) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (quantity === null) {
      return this.ledger.block(transaction.id, "QUANTITY_INVALID");
    }
    if (!beforeItem || !beforeItemName) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_EMPTY");
    }
    if (itemLocked(beforeItem)) {
      return this.ledger.block(transaction.id, "ITEM_LOCKED");
    }
    if (quantity > beforeQuantity) {
      return this.ledger.block(transaction.id, "QUANTITY_EXCEEDS_STACK");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "sell",
      inventorySlot: request.inventorySlot,
      quantity,
    });

    try {
      const result = await this.driver.sell(
        request.inventorySlot,
        quantity,
      );
      const afterCharacter = this.game.character();
      const afterInventory = this.game.inventory();
      const afterItem = inventoryItem(
        afterInventory,
        request.inventorySlot,
      );
      const sameItem = itemName(afterItem) === beforeItemName;
      const afterQuantity = sameItem ? itemQuantity(afterItem) : 0;
      const quantityReduced =
        !sameItem || afterQuantity <= beforeQuantity - quantity;
      const goldIncreased =
        beforeCharacter.gold !== null &&
        afterCharacter.gold !== null &&
        afterCharacter.gold > beforeCharacter.gold;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "SELL_API_REJECTED",
          after: {
            gold: afterCharacter.gold,
            inventory: relevantInventoryState(
              afterInventory,
              request.inventorySlot,
            ),
          },
          evidence: {
            result: safeResultEvidence(result),
          },
        });
      }
      if (quantityReduced || goldIncreased) {
        return this.ledger.confirm(transaction.id, {
          why: "SELL_STATE_CONFIRMED",
          after: {
            gold: afterCharacter.gold,
            inventory: relevantInventoryState(
              afterInventory,
              request.inventorySlot,
            ),
          },
          evidence: {
            quantityDelta: beforeQuantity - afterQuantity,
            goldDelta:
              beforeCharacter.gold !== null &&
              afterCharacter.gold !== null
                ? afterCharacter.gold - beforeCharacter.gold
                : null,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "SELL_OUTCOME_UNVERIFIED",
        after: {
          gold: afterCharacter.gold,
          inventory: relevantInventoryState(
            afterInventory,
            request.inventorySlot,
          ),
        },
        evidence: {
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "SELL_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          gold: this.game.character().gold,
          inventory: relevantInventoryState(
            this.game.inventory(),
            request.inventorySlot,
          ),
        },
      });
    }
  }

  async sendItem(request: SendItemRequest): Promise<ActionRecord> {
    const recipient = request.recipient?.trim();
    const quantity = positiveInteger(request.quantity);
    const beforeInventory = this.game.inventory();
    const beforeItem = inventoryItem(
      beforeInventory,
      request.inventorySlot,
    );
    const beforeItemName = itemName(beforeItem);
    const beforeQuantity = itemQuantity(beforeItem);
    const transaction = this.ledger.create({
      module: request.module,
      action: "SEND_ITEM",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        itemName: beforeItemName,
        quantity,
      },
      expectedEffect: {
        recipient: recipient || null,
      },
      before: {
        inventory: relevantInventoryState(
          beforeInventory,
          request.inventorySlot,
        ),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!recipient) {
      return this.ledger.block(transaction.id, "RECIPIENT_INVALID");
    }
    if (!Number.isInteger(request.inventorySlot) || request.inventorySlot < 0) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (quantity === null) {
      return this.ledger.block(transaction.id, "QUANTITY_INVALID");
    }
    if (!beforeItem || !beforeItemName) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_EMPTY");
    }
    if (itemLocked(beforeItem)) {
      return this.ledger.block(transaction.id, "ITEM_LOCKED");
    }
    if (quantity > beforeQuantity) {
      return this.ledger.block(transaction.id, "QUANTITY_EXCEEDS_STACK");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "send_item",
      recipient,
      inventorySlot: request.inventorySlot,
      quantity,
    });

    try {
      const result = await this.driver.sendItem(
        recipient,
        request.inventorySlot,
        quantity,
      );
      const afterInventory = this.game.inventory();
      const afterItem = inventoryItem(
        afterInventory,
        request.inventorySlot,
      );
      const sameItem = itemName(afterItem) === beforeItemName;
      const afterQuantity = sameItem ? itemQuantity(afterItem) : 0;
      const quantityReduced =
        !sameItem || afterQuantity <= beforeQuantity - quantity;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "SEND_ITEM_API_REJECTED",
          after: {
            inventory: relevantInventoryState(
              afterInventory,
              request.inventorySlot,
            ),
          },
          evidence: {
            result: safeResultEvidence(result),
          },
        });
      }
      if (quantityReduced) {
        return this.ledger.confirm(transaction.id, {
          why: "SEND_ITEM_STATE_CONFIRMED",
          after: {
            inventory: relevantInventoryState(
              afterInventory,
              request.inventorySlot,
            ),
          },
          evidence: {
            quantityDelta: beforeQuantity - afterQuantity,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "SEND_ITEM_OUTCOME_UNVERIFIED",
        after: {
          inventory: relevantInventoryState(
            afterInventory,
            request.inventorySlot,
          ),
        },
        evidence: {
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "SEND_ITEM_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          inventory: relevantInventoryState(
            this.game.inventory(),
            request.inventorySlot,
          ),
        },
      });
    }
  }

  async sendGold(request: SendGoldRequest): Promise<ActionRecord> {
    const recipient = request.recipient?.trim();
    const beforeCharacter = this.game.character();
    const transaction = this.ledger.create({
      module: request.module,
      action: "SEND_GOLD",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        gold: request.amount,
      },
      expectedEffect: {
        recipient: recipient || null,
      },
      before: {
        gold: beforeCharacter.gold,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!recipient) {
      return this.ledger.block(transaction.id, "RECIPIENT_INVALID");
    }
    if (!Number.isInteger(request.amount) || request.amount <= 0) {
      return this.ledger.block(transaction.id, "GOLD_AMOUNT_INVALID");
    }
    if (
      beforeCharacter.gold !== null &&
      request.amount > beforeCharacter.gold
    ) {
      return this.ledger.block(transaction.id, "INSUFFICIENT_GOLD");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "send_gold",
      recipient,
      amount: request.amount,
    });

    try {
      const result = await this.driver.sendGold(recipient, request.amount);
      const afterCharacter = this.game.character();
      const goldDelta =
        beforeCharacter.gold !== null && afterCharacter.gold !== null
          ? beforeCharacter.gold - afterCharacter.gold
          : null;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "SEND_GOLD_API_REJECTED",
          after: {
            gold: afterCharacter.gold,
          },
          evidence: {
            result: safeResultEvidence(result),
          },
        });
      }
      if (goldDelta !== null && goldDelta >= request.amount) {
        return this.ledger.confirm(transaction.id, {
          why: "SEND_GOLD_STATE_CONFIRMED",
          after: {
            gold: afterCharacter.gold,
          },
          evidence: {
            goldDelta,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "SEND_GOLD_OUTCOME_UNVERIFIED",
        after: {
          gold: afterCharacter.gold,
        },
        evidence: {
          goldDelta,
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "SEND_GOLD_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          gold: this.game.character().gold,
        },
      });
    }
  }

  async bankStore(request: BankStoreRequest): Promise<ActionRecord> {
    const beforeBank = this.game.bank();
    const beforeInventory = this.game.inventory();
    const beforeItem = inventoryItem(beforeInventory, request.inventorySlot);
    const identity = itemIdentity(beforeItem);
    const transaction = this.ledger.create({
      module: request.module,
      action: "BANK_STORE",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        inventorySlot: request.inventorySlot,
        pack: request.pack || null,
        packSlot: request.packSlot ?? null,
        item: identity,
      },
      before: {
        bankAvailable: beforeBank.available,
        inventory: relevantInventoryState(
          beforeInventory,
          request.inventorySlot,
        ),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!beforeBank.available) {
      return this.ledger.block(transaction.id, "BANK_NOT_AVAILABLE");
    }
    if (!Number.isInteger(request.inventorySlot) || request.inventorySlot < 0) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (!beforeItem || !identity) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_EMPTY");
    }
    if (
      request.pack !== undefined &&
      (typeof request.pack !== "string" || !request.pack.trim())
    ) {
      return this.ledger.block(transaction.id, "BANK_PACK_INVALID");
    }
    if (request.packSlot !== undefined && request.pack === undefined) {
      return this.ledger.block(transaction.id, "BANK_PACK_REQUIRED");
    }
    if (
      request.packSlot !== undefined &&
      (!Number.isInteger(request.packSlot) || request.packSlot < 0)
    ) {
      return this.ledger.block(transaction.id, "BANK_PACK_SLOT_INVALID");
    }
    if (
      request.pack &&
      !beforeBank.packs.some((pack) => pack.name === request.pack)
    ) {
      return this.ledger.block(transaction.id, "BANK_PACK_UNAVAILABLE");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "bank_store",
      inventorySlot: request.inventorySlot,
      pack: request.pack || null,
      packSlot: request.packSlot ?? null,
    });

    try {
      const result = await this.driver.bankStore(
        request.inventorySlot,
        request.pack,
        request.packSlot,
      );
      const afterInventory = this.game.inventory();
      const afterBank = this.game.bank();
      const afterSource = inventoryItem(afterInventory, request.inventorySlot);
      const sourceChanged = itemIdentity(afterSource) !== identity;
      const targetItem =
        request.pack !== undefined && request.packSlot !== undefined
          ? bankItem(afterBank, request.pack, request.packSlot)
          : null;
      const targetMatched =
        targetItem !== null && itemIdentity(targetItem) === identity;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "BANK_STORE_API_REJECTED",
          after: {
            inventory: relevantInventoryState(
              afterInventory,
              request.inventorySlot,
            ),
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (sourceChanged || targetMatched) {
        return this.ledger.confirm(transaction.id, {
          why: "BANK_STORE_STATE_CONFIRMED",
          after: {
            inventory: relevantInventoryState(
              afterInventory,
              request.inventorySlot,
            ),
            targetMatched,
          },
          evidence: {
            sourceChanged,
            targetMatched,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "BANK_STORE_OUTCOME_UNVERIFIED",
        after: {
          inventory: relevantInventoryState(
            afterInventory,
            request.inventorySlot,
          ),
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "BANK_STORE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          inventory: relevantInventoryState(
            this.game.inventory(),
            request.inventorySlot,
          ),
        },
      });
    }
  }

  async bankRetrieve(request: BankRetrieveRequest): Promise<ActionRecord> {
    const beforeBank = this.game.bank();
    const beforeInventory = this.game.inventory();
    const beforeItem = bankItem(beforeBank, request.pack, request.packSlot);
    const identity = itemIdentity(beforeItem);
    const transaction = this.ledger.create({
      module: request.module,
      action: "BANK_RETRIEVE",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        pack: request.pack,
        packSlot: request.packSlot,
        inventorySlot: request.inventorySlot ?? null,
        item: identity,
      },
      before: {
        bankAvailable: beforeBank.available,
        bankItem: beforeItem,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!beforeBank.available) {
      return this.ledger.block(transaction.id, "BANK_NOT_AVAILABLE");
    }
    if (!request.pack?.trim()) {
      return this.ledger.block(transaction.id, "BANK_PACK_INVALID");
    }
    if (!Number.isInteger(request.packSlot) || request.packSlot < 0) {
      return this.ledger.block(transaction.id, "BANK_PACK_SLOT_INVALID");
    }
    if (
      request.inventorySlot !== undefined &&
      (!Number.isInteger(request.inventorySlot) || request.inventorySlot < 0)
    ) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (!bankPack(beforeBank, request.pack)) {
      return this.ledger.block(transaction.id, "BANK_PACK_UNAVAILABLE");
    }
    if (!beforeItem || !identity) {
      return this.ledger.block(transaction.id, "BANK_SLOT_EMPTY");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "bank_retrieve",
      pack: request.pack,
      packSlot: request.packSlot,
      inventorySlot: request.inventorySlot ?? null,
    });

    try {
      const result = await this.driver.bankRetrieve(
        request.pack,
        request.packSlot,
        request.inventorySlot,
      );
      const afterBank = this.game.bank();
      const afterInventory = this.game.inventory();
      const afterBankItem = bankItem(
        afterBank,
        request.pack,
        request.packSlot,
      );
      const bankChanged = itemIdentity(afterBankItem) !== identity;
      const inventoryMatched =
        request.inventorySlot !== undefined
          ? itemIdentity(
              inventoryItem(afterInventory, request.inventorySlot),
            ) === identity
          : inventoryHasIdentity(afterInventory, identity);

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "BANK_RETRIEVE_API_REJECTED",
          after: {
            bankItem: afterBankItem,
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (bankChanged || inventoryMatched) {
        return this.ledger.confirm(transaction.id, {
          why: "BANK_RETRIEVE_STATE_CONFIRMED",
          after: {
            bankItem: afterBankItem,
            inventoryMatched,
          },
          evidence: {
            bankChanged,
            inventoryMatched,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "BANK_RETRIEVE_OUTCOME_UNVERIFIED",
        after: {
          bankItem: afterBankItem,
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "BANK_RETRIEVE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          bankItem: bankItem(
            this.game.bank(),
            request.pack,
            request.packSlot,
          ),
        },
      });
    }
  }

  async bankDepositGold(request: BankGoldRequest): Promise<ActionRecord> {
    const beforeCharacter = this.game.character();
    const beforeBank = this.game.bank();
    const transaction = this.ledger.create({
      module: request.module,
      action: "BANK_DEPOSIT_GOLD",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: { gold: request.amount },
      expectedEffect: { bankGoldIncrease: request.amount },
      before: {
        characterGold: beforeCharacter.gold,
        bankGold: beforeBank.gold,
        bankAvailable: beforeBank.available,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!beforeBank.available) {
      return this.ledger.block(transaction.id, "BANK_NOT_AVAILABLE");
    }
    if (!Number.isInteger(request.amount) || request.amount <= 0) {
      return this.ledger.block(transaction.id, "GOLD_AMOUNT_INVALID");
    }
    if (
      beforeCharacter.gold !== null &&
      request.amount > beforeCharacter.gold
    ) {
      return this.ledger.block(transaction.id, "INSUFFICIENT_GOLD");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "bank_deposit",
      amount: request.amount,
    });

    try {
      const result = await this.driver.bankDeposit(request.amount);
      const afterCharacter = this.game.character();
      const afterBank = this.game.bank();
      const characterDelta =
        beforeCharacter.gold !== null && afterCharacter.gold !== null
          ? beforeCharacter.gold - afterCharacter.gold
          : null;
      const bankDelta =
        beforeBank.gold !== null && afterBank.gold !== null
          ? afterBank.gold - beforeBank.gold
          : null;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "BANK_DEPOSIT_GOLD_API_REJECTED",
          after: {
            characterGold: afterCharacter.gold,
            bankGold: afterBank.gold,
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (
        (characterDelta !== null && characterDelta >= request.amount) ||
        (bankDelta !== null && bankDelta >= request.amount)
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "BANK_DEPOSIT_GOLD_STATE_CONFIRMED",
          after: {
            characterGold: afterCharacter.gold,
            bankGold: afterBank.gold,
          },
          evidence: {
            characterGoldDelta: characterDelta,
            bankGoldDelta: bankDelta,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "BANK_DEPOSIT_GOLD_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          characterGold: this.game.character().gold,
          bankGold: this.game.bank().gold,
        },
      });
    }
  }

  async bankWithdrawGold(request: BankGoldRequest): Promise<ActionRecord> {
    const beforeCharacter = this.game.character();
    const beforeBank = this.game.bank();
    const transaction = this.ledger.create({
      module: request.module,
      action: "BANK_WITHDRAW_GOLD",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        characterGoldIncrease: request.amount,
        bankGoldDecrease: request.amount,
      },
      before: {
        characterGold: beforeCharacter.gold,
        bankGold: beforeBank.gold,
        bankAvailable: beforeBank.available,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!beforeBank.available) {
      return this.ledger.block(transaction.id, "BANK_NOT_AVAILABLE");
    }
    if (!Number.isInteger(request.amount) || request.amount <= 0) {
      return this.ledger.block(transaction.id, "GOLD_AMOUNT_INVALID");
    }
    if (beforeBank.gold !== null && request.amount > beforeBank.gold) {
      return this.ledger.block(transaction.id, "INSUFFICIENT_BANK_GOLD");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "bank_withdraw",
      amount: request.amount,
    });

    try {
      const result = await this.driver.bankWithdraw(request.amount);
      const afterCharacter = this.game.character();
      const afterBank = this.game.bank();
      const characterDelta =
        beforeCharacter.gold !== null && afterCharacter.gold !== null
          ? afterCharacter.gold - beforeCharacter.gold
          : null;
      const bankDelta =
        beforeBank.gold !== null && afterBank.gold !== null
          ? beforeBank.gold - afterBank.gold
          : null;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "BANK_WITHDRAW_GOLD_API_REJECTED",
          after: {
            characterGold: afterCharacter.gold,
            bankGold: afterBank.gold,
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (
        (characterDelta !== null && characterDelta >= request.amount) ||
        (bankDelta !== null && bankDelta >= request.amount)
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "BANK_WITHDRAW_GOLD_STATE_CONFIRMED",
          after: {
            characterGold: afterCharacter.gold,
            bankGold: afterBank.gold,
          },
          evidence: {
            characterGoldDelta: characterDelta,
            bankGoldDelta: bankDelta,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "BANK_WITHDRAW_GOLD_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          characterGold: this.game.character().gold,
          bankGold: this.game.bank().gold,
        },
      });
    }
  }

  async equip(request: EquipRequest): Promise<ActionRecord> {
    const beforeInventory = this.game.inventory();
    const beforeEquipment = this.game.equipment();
    const beforeItem = inventoryItem(
      beforeInventory,
      request.inventorySlot,
    );
    const identity = itemIdentity(beforeItem);
    const slot = request.slot?.trim() || undefined;
    const transaction = this.ledger.create({
      module: request.module,
      action: "EQUIP",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        inventorySlot: request.inventorySlot,
        equipmentSlot: slot || null,
        item: identity,
      },
      before: {
        inventory: relevantInventoryState(
          beforeInventory,
          request.inventorySlot,
        ),
        equipment: beforeEquipment,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!Number.isInteger(request.inventorySlot) || request.inventorySlot < 0) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (!beforeItem || !identity) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_EMPTY");
    }
    if (request.slot !== undefined && !slot) {
      return this.ledger.block(transaction.id, "EQUIPMENT_SLOT_INVALID");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "equip",
      inventorySlot: request.inventorySlot,
      equipmentSlot: slot || null,
    });

    try {
      const result = await this.driver.equip(request.inventorySlot, slot);
      const afterInventory = this.game.inventory();
      const afterEquipment = this.game.equipment();
      const sourceChanged =
        itemIdentity(inventoryItem(afterInventory, request.inventorySlot)) !==
        identity;
      const destinationMatched =
        slot !== undefined
          ? itemIdentity(equipmentSlot(afterEquipment, slot)) === identity
          : equipmentHasIdentity(afterEquipment, identity);
      const equipped = sourceChanged && destinationMatched;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "EQUIP_API_REJECTED",
          after: { equipment: afterEquipment },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (equipped) {
        return this.ledger.confirm(transaction.id, {
          why: "EQUIP_STATE_CONFIRMED",
          after: {
            inventory: relevantInventoryState(
              afterInventory,
              request.inventorySlot,
            ),
            equipment: afterEquipment,
          },
          evidence: {
            sourceChanged,
            destinationMatched,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "EQUIP_OUTCOME_UNVERIFIED",
        after: {
          inventory: relevantInventoryState(
            afterInventory,
            request.inventorySlot,
          ),
          equipment: afterEquipment,
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "EQUIP_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          equipment: this.game.equipment(),
        },
      });
    }
  }

  async unequip(request: UnequipRequest): Promise<ActionRecord> {
    const slot = request.slot?.trim();
    const beforeEquipment = this.game.equipment();
    const beforeItem = slot ? equipmentSlot(beforeEquipment, slot) : null;
    const identity = itemIdentity(beforeItem);
    const beforeInventory = this.game.inventory();
    const transaction = this.ledger.create({
      module: request.module,
      action: "UNEQUIP",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        equipmentSlot: slot || null,
        item: identity,
      },
      before: {
        equipmentItem: beforeItem,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!slot) {
      return this.ledger.block(transaction.id, "EQUIPMENT_SLOT_INVALID");
    }
    if (!beforeItem || !identity) {
      return this.ledger.block(transaction.id, "EQUIPMENT_SLOT_EMPTY");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "unequip",
      equipmentSlot: slot,
    });

    try {
      const result = await this.driver.unequip(slot);
      const afterEquipment = this.game.equipment();
      const afterInventory = this.game.inventory();
      const equipmentChanged =
        itemIdentity(equipmentSlot(afterEquipment, slot)) !== identity;
      const beforeInventoryCount = inventoryIdentityCount(
        beforeInventory,
        identity,
      );
      const afterInventoryCount = inventoryIdentityCount(
        afterInventory,
        identity,
      );
      const inventoryMatched = afterInventoryCount > beforeInventoryCount;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "UNEQUIP_API_REJECTED",
          after: {
            equipmentItem: equipmentSlot(afterEquipment, slot),
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (equipmentChanged && inventoryMatched) {
        return this.ledger.confirm(transaction.id, {
          why: "UNEQUIP_STATE_CONFIRMED",
          after: {
            equipmentItem: equipmentSlot(afterEquipment, slot),
            inventoryMatched,
          },
          evidence: {
            equipmentChanged,
            inventoryMatched,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "UNEQUIP_OUTCOME_UNVERIFIED",
        after: {
          equipmentItem: equipmentSlot(afterEquipment, slot),
          inventoryMatched,
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "UNEQUIP_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          equipmentItem: equipmentSlot(this.game.equipment(), slot),
        },
      });
    }
  }


  async upgrade(request: UpgradeRequest): Promise<ActionRecord> {
    const beforeInventory = this.game.inventory();
    const item = inventoryItem(beforeInventory, request.itemSlot);
    const scroll = inventoryItem(beforeInventory, request.scrollSlot);
    const offering =
      request.offeringSlot === null || request.offeringSlot === undefined
        ? null
        : inventoryItem(beforeInventory, request.offeringSlot);
    const name = itemName(item);
    const itemDefinition = gameItemDefinition(this.game.gameData(), name);
    const transaction = this.ledger.create({
      module: request.module,
      action: "UPGRADE",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        scroll: itemName(scroll),
        offering: itemName(offering),
      },
      expectedEffect: {
        item: name,
        fromLevel: itemLevel(item),
        itemSlot: request.itemSlot,
      },
      before: {
        item: relevantInventoryState(beforeInventory, request.itemSlot),
        scroll: relevantInventoryState(beforeInventory, request.scrollSlot),
        offering:
          request.offeringSlot === null ||
          request.offeringSlot === undefined
            ? null
            : relevantInventoryState(
                beforeInventory,
                request.offeringSlot,
              ),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (
      !inventorySlotValid(request.itemSlot) ||
      !inventorySlotValid(request.scrollSlot) ||
      (request.offeringSlot !== undefined &&
        request.offeringSlot !== null &&
        !inventorySlotValid(request.offeringSlot))
    ) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (
      !distinctSlots([
        request.itemSlot,
        request.scrollSlot,
        request.offeringSlot,
      ])
    ) {
      return this.ledger.block(transaction.id, "UPGRADE_SLOTS_NOT_DISTINCT");
    }
    if (!item || !name) {
      return this.ledger.block(transaction.id, "UPGRADE_ITEM_MISSING");
    }
    if (itemLocked(item)) {
      return this.ledger.block(transaction.id, "ITEM_LOCKED");
    }
    if (!scroll) {
      return this.ledger.block(transaction.id, "UPGRADE_SCROLL_MISSING");
    }
    if (itemLocked(scroll)) {
      return this.ledger.block(transaction.id, "SCROLL_LOCKED");
    }
    if (
      request.offeringSlot !== undefined &&
      request.offeringSlot !== null &&
      !offering
    ) {
      return this.ledger.block(transaction.id, "UPGRADE_OFFERING_MISSING");
    }
    if (offering && itemLocked(offering)) {
      return this.ledger.block(transaction.id, "OFFERING_LOCKED");
    }
    if (!Object.prototype.hasOwnProperty.call(itemDefinition, "upgrade")) {
      return this.ledger.block(transaction.id, "ITEM_NOT_UPGRADABLE");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "upgrade",
      itemSlot: request.itemSlot,
      scrollSlot: request.scrollSlot,
      offeringSlot: request.offeringSlot ?? null,
    });

    try {
      const result = await this.driver.upgrade(
        request.itemSlot,
        request.scrollSlot,
        request.offeringSlot,
      );
      const response = objectRecord(result);
      const afterInventory = this.game.inventory();
      const afterItem = inventoryItem(afterInventory, request.itemSlot);
      const structuredOutcome =
        typeof response.success === "boolean" &&
        Number.isFinite(Number(response.level)) &&
        Number.isInteger(Number(response.num));
      const stateChanged =
        itemIdentity(afterItem) !== itemIdentity(item) ||
        itemLevel(afterItem) !== itemLevel(item);

      if (
        !structuredOutcome &&
        typeof response.reason === "string" &&
        response.reason.length > 0
      ) {
        return this.ledger.reject(transaction.id, {
          why: "UPGRADE_API_REJECTED",
          after: {
            item: relevantInventoryState(
              afterInventory,
              request.itemSlot,
            ),
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (structuredOutcome || stateChanged) {
        return this.ledger.confirm(transaction.id, {
          why: structuredOutcome
            ? "UPGRADE_RESULT_CONFIRMED"
            : "UPGRADE_STATE_CONFIRMED",
          after: {
            item: relevantInventoryState(
              afterInventory,
              request.itemSlot,
            ),
          },
          evidence: {
            upgradeSucceeded:
              typeof response.success === "boolean"
                ? response.success
                : null,
            result: safeResultEvidence(result),
            stateChanged,
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "UPGRADE_OUTCOME_UNVERIFIED",
        after: {
          item: relevantInventoryState(
            afterInventory,
            request.itemSlot,
          ),
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "UPGRADE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          item: relevantInventoryState(
            this.game.inventory(),
            request.itemSlot,
          ),
        },
      });
    }
  }

  async compound(request: CompoundRequest): Promise<ActionRecord> {
    const beforeInventory = this.game.inventory();
    const items = request.itemSlots.map((slot) =>
      inventoryItem(beforeInventory, slot),
    );
    const scroll = inventoryItem(beforeInventory, request.scrollSlot);
    const offering =
      request.offeringSlot === null || request.offeringSlot === undefined
        ? null
        : inventoryItem(beforeInventory, request.offeringSlot);
    const names = items.map((item) => itemName(item));
    const levels = items.map((item) => itemLevel(item));
    const primaryName = names[0];
    const itemDefinition = gameItemDefinition(
      this.game.gameData(),
      primaryName,
    );
    const transaction = this.ledger.create({
      module: request.module,
      action: "COMPOUND",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        items: names,
        scroll: itemName(scroll),
        offering: itemName(offering),
      },
      expectedEffect: {
        item: primaryName,
        fromLevel: levels[0],
        itemSlots: [...request.itemSlots],
      },
      before: {
        items: request.itemSlots.map((slot) =>
          relevantInventoryState(beforeInventory, slot),
        ),
        scroll: relevantInventoryState(beforeInventory, request.scrollSlot),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    const allSlots = [
      ...request.itemSlots,
      request.scrollSlot,
      request.offeringSlot,
    ];
    if (
      request.itemSlots.some((slot) => !inventorySlotValid(slot)) ||
      !inventorySlotValid(request.scrollSlot) ||
      (request.offeringSlot !== undefined &&
        request.offeringSlot !== null &&
        !inventorySlotValid(request.offeringSlot))
    ) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (!distinctSlots(allSlots)) {
      return this.ledger.block(transaction.id, "COMPOUND_SLOTS_NOT_DISTINCT");
    }
    if (items.some((item) => !item) || names.some((name) => !name)) {
      return this.ledger.block(transaction.id, "COMPOUND_ITEM_MISSING");
    }
    if (items.some((item) => itemLocked(item))) {
      return this.ledger.block(transaction.id, "ITEM_LOCKED");
    }
    if (
      !names.every((name) => name === primaryName) ||
      !levels.every((level) => level === levels[0])
    ) {
      return this.ledger.block(transaction.id, "COMPOUND_ITEMS_MISMATCH");
    }
    if (!scroll) {
      return this.ledger.block(transaction.id, "COMPOUND_SCROLL_MISSING");
    }
    if (itemLocked(scroll)) {
      return this.ledger.block(transaction.id, "SCROLL_LOCKED");
    }
    if (
      request.offeringSlot !== undefined &&
      request.offeringSlot !== null &&
      !offering
    ) {
      return this.ledger.block(transaction.id, "COMPOUND_OFFERING_MISSING");
    }
    if (offering && itemLocked(offering)) {
      return this.ledger.block(transaction.id, "OFFERING_LOCKED");
    }
    if (!Object.prototype.hasOwnProperty.call(itemDefinition, "compound")) {
      return this.ledger.block(transaction.id, "ITEM_NOT_COMPOUNDABLE");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "compound",
      itemSlots: [...request.itemSlots],
      scrollSlot: request.scrollSlot,
      offeringSlot: request.offeringSlot ?? null,
    });

    try {
      const result = await this.driver.compound(
        request.itemSlots[0],
        request.itemSlots[1],
        request.itemSlots[2],
        request.scrollSlot,
        request.offeringSlot,
      );
      const response = objectRecord(result);
      const afterInventory = this.game.inventory();
      const structuredOutcome =
        typeof response.success === "boolean" &&
        Number.isFinite(Number(response.level)) &&
        Number.isInteger(Number(response.num));
      const stateChanged = request.itemSlots.some(
        (slot, index) =>
          itemIdentity(inventoryItem(afterInventory, slot)) !==
          itemIdentity(items[index]),
      );

      if (
        !structuredOutcome &&
        typeof response.reason === "string" &&
        response.reason.length > 0
      ) {
        return this.ledger.reject(transaction.id, {
          why: "COMPOUND_API_REJECTED",
          after: {
            items: request.itemSlots.map((slot) =>
              relevantInventoryState(afterInventory, slot),
            ),
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (structuredOutcome || stateChanged) {
        return this.ledger.confirm(transaction.id, {
          why: structuredOutcome
            ? "COMPOUND_RESULT_CONFIRMED"
            : "COMPOUND_STATE_CONFIRMED",
          after: {
            items: request.itemSlots.map((slot) =>
              relevantInventoryState(afterInventory, slot),
            ),
          },
          evidence: {
            compoundSucceeded:
              typeof response.success === "boolean"
                ? response.success
                : null,
            result: safeResultEvidence(result),
            stateChanged,
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "COMPOUND_OUTCOME_UNVERIFIED",
        after: {
          items: request.itemSlots.map((slot) =>
            relevantInventoryState(afterInventory, slot),
          ),
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "COMPOUND_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          items: request.itemSlots.map((slot) =>
            relevantInventoryState(this.game.inventory(), slot),
          ),
        },
      });
    }
  }

  async exchange(request: ExchangeRequest): Promise<ActionRecord> {
    const beforeInventory = this.game.inventory();
    const item = inventoryItem(beforeInventory, request.itemSlot);
    const name = itemName(item);
    const definition = gameItemDefinition(this.game.gameData(), name);
    const requiredQuantity = Number(definition.e);
    const transaction = this.ledger.create({
      module: request.module,
      action: "EXCHANGE",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        item: name,
        quantity:
          Number.isInteger(requiredQuantity) && requiredQuantity > 0
            ? requiredQuantity
            : null,
      },
      expectedEffect: {
        itemSlot: request.itemSlot,
        effect: "EXCHANGE_ITEM",
      },
      before: {
        item: relevantInventoryState(beforeInventory, request.itemSlot),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!inventorySlotValid(request.itemSlot)) {
      return this.ledger.block(transaction.id, "INVENTORY_SLOT_INVALID");
    }
    if (!item || !name) {
      return this.ledger.block(transaction.id, "EXCHANGE_ITEM_MISSING");
    }
    if (itemLocked(item)) {
      return this.ledger.block(transaction.id, "ITEM_LOCKED");
    }
    if (!Number.isInteger(requiredQuantity) || requiredQuantity <= 0) {
      return this.ledger.block(transaction.id, "ITEM_NOT_EXCHANGEABLE");
    }
    if (itemQuantity(item) < requiredQuantity) {
      return this.ledger.block(
        transaction.id,
        "EXCHANGE_QUANTITY_INSUFFICIENT",
      );
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "exchange",
      itemSlot: request.itemSlot,
      requiredQuantity,
    });

    try {
      const result = await this.driver.exchange(request.itemSlot);
      const response = objectRecord(result);
      const afterInventory = this.game.inventory();
      const afterItem = inventoryItem(afterInventory, request.itemSlot);
      const stateChanged =
        itemIdentity(afterItem) !== itemIdentity(item) ||
        itemQuantity(afterItem) <= itemQuantity(item) - requiredQuantity;
      const structuredOutcome =
        typeof response.success === "boolean" &&
        Number.isInteger(Number(response.num));

      if (response.success === false && !stateChanged) {
        return this.ledger.reject(transaction.id, {
          why: "EXCHANGE_API_REJECTED",
          after: {
            item: relevantInventoryState(
              afterInventory,
              request.itemSlot,
            ),
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (response.success === true || stateChanged) {
        return this.ledger.confirm(transaction.id, {
          why:
            response.success === true
              ? "EXCHANGE_RESULT_CONFIRMED"
              : "EXCHANGE_STATE_CONFIRMED",
          after: {
            item: relevantInventoryState(
              afterInventory,
              request.itemSlot,
            ),
          },
          evidence: {
            exchangeSucceeded:
              typeof response.success === "boolean"
                ? response.success
                : null,
            structuredOutcome,
            stateChanged,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "EXCHANGE_OUTCOME_UNVERIFIED",
        after: {
          item: relevantInventoryState(
            afterInventory,
            request.itemSlot,
          ),
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "EXCHANGE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          item: relevantInventoryState(
            this.game.inventory(),
            request.itemSlot,
          ),
        },
      });
    }
  }


  async craft(request: CraftRequest): Promise<ActionRecord> {
    const recipeName = request.recipe?.trim();
    const beforeInventory = this.game.inventory();
    const beforeCharacter = this.game.character();
    const gameData = this.game.gameData();
    const recipe = recipeName
      ? objectRecord(objectRecord(gameData.craft)[recipeName])
      : {};
    const requirements = Array.isArray(recipe.items) ? recipe.items : [];
    const cost =
      typeof recipe.cost === "number" && Number.isFinite(recipe.cost)
        ? recipe.cost
        : null;
    const transaction = this.ledger.create({
      module: request.module,
      action: "CRAFT",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        gold: cost,
        ingredients: requirements,
      },
      expectedEffect: {
        recipe: recipeName || null,
        itemSlots: [...request.itemSlots],
      },
      before: {
        gold: beforeCharacter.gold,
        items: request.itemSlots.map((slot) =>
          relevantInventoryState(beforeInventory, slot),
        ),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!recipeName) {
      return this.ledger.block(transaction.id, "CRAFT_RECIPE_INVALID");
    }
    if (!requirements.length) {
      return this.ledger.block(transaction.id, "CRAFT_RECIPE_UNKNOWN");
    }
    if (
      !Array.isArray(request.itemSlots) ||
      request.itemSlots.length < 1 ||
      request.itemSlots.length > 9 ||
      request.itemSlots.some((slot) => !inventorySlotValid(slot))
    ) {
      return this.ledger.block(transaction.id, "CRAFT_SLOTS_INVALID");
    }
    if (!distinctSlots(request.itemSlots)) {
      return this.ledger.block(transaction.id, "CRAFT_SLOTS_NOT_DISTINCT");
    }
    if (request.itemSlots.length !== requirements.length) {
      return this.ledger.block(
        transaction.id,
        "CRAFT_INGREDIENT_COUNT_MISMATCH",
      );
    }
    if (
      cost !== null &&
      beforeCharacter.gold !== null &&
      beforeCharacter.gold < cost
    ) {
      return this.ledger.block(transaction.id, "INSUFFICIENT_GOLD");
    }

    for (let index = 0; index < requirements.length; index += 1) {
      const rawRequirement = requirements[index];
      if (!Array.isArray(rawRequirement) || rawRequirement.length < 2) {
        return this.ledger.block(
          transaction.id,
          "CRAFT_RECIPE_REQUIREMENT_INVALID",
        );
      }

      const requiredQuantity = Number(rawRequirement[0]);
      const requiredName =
        typeof rawRequirement[1] === "string" ? rawRequirement[1] : null;
      const requiredLevel =
        rawRequirement.length >= 3 ? Number(rawRequirement[2]) : null;
      if (
        !Number.isInteger(requiredQuantity) ||
        requiredQuantity <= 0 ||
        !requiredName ||
        (requiredLevel !== null &&
          (!Number.isInteger(requiredLevel) || requiredLevel < 0))
      ) {
        return this.ledger.block(
          transaction.id,
          "CRAFT_RECIPE_REQUIREMENT_INVALID",
        );
      }

      const ingredient = inventoryItem(
        beforeInventory,
        request.itemSlots[index],
      );
      if (!ingredient) {
        return this.ledger.block(transaction.id, "CRAFT_INGREDIENT_MISSING");
      }
      if (itemLocked(ingredient)) {
        return this.ledger.block(transaction.id, "ITEM_LOCKED");
      }
      if (
        itemName(ingredient) !== requiredName ||
        itemQuantity(ingredient) < requiredQuantity ||
        (requiredLevel !== null && itemLevel(ingredient) !== requiredLevel)
      ) {
        return this.ledger.block(
          transaction.id,
          "CRAFT_INGREDIENT_MISMATCH",
        );
      }
    }

    const beforeOutputQuantity = totalItemQuantity(
      beforeInventory,
      recipeName,
    );
    this.ledger.dispatch(transaction.id, {
      mutation: "craft",
      recipe: recipeName,
      itemSlots: [...request.itemSlots],
    });

    try {
      const result = await this.driver.craft([...request.itemSlots]);
      const response = objectRecord(result);
      const afterInventory = this.game.inventory();
      const afterCharacter = this.game.character();
      const afterOutputQuantity = totalItemQuantity(
        afterInventory,
        recipeName,
      );
      const ingredientStateChanged = request.itemSlots.some(
        (slot, index) => {
          const beforeItem = inventoryItem(beforeInventory, slot);
          const afterItem = inventoryItem(afterInventory, slot);
          return (
            itemIdentity(afterItem) !== itemIdentity(beforeItem) ||
            itemQuantity(afterItem) !== itemQuantity(beforeItem)
          );
        },
      );
      const outputIncreased = afterOutputQuantity > beforeOutputQuantity;
      const structuredSuccess =
        response.success === true &&
        (response.response === "craft" ||
          typeof response.name === "string");

      if (
        response.failed === true ||
        (typeof response.reason === "string" && response.reason.length > 0)
      ) {
        return this.ledger.reject(transaction.id, {
          why: "CRAFT_API_REJECTED",
          after: {
            gold: afterCharacter.gold,
            outputQuantity: afterOutputQuantity,
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (structuredSuccess || outputIncreased || ingredientStateChanged) {
        return this.ledger.confirm(transaction.id, {
          why: structuredSuccess
            ? "CRAFT_RESULT_CONFIRMED"
            : "CRAFT_STATE_CONFIRMED",
          after: {
            gold: afterCharacter.gold,
            outputQuantity: afterOutputQuantity,
            items: request.itemSlots.map((slot) =>
              relevantInventoryState(afterInventory, slot),
            ),
          },
          evidence: {
            structuredSuccess,
            outputIncreased,
            ingredientStateChanged,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.unknown(transaction.id, {
        why: "CRAFT_OUTCOME_UNVERIFIED",
        after: {
          gold: afterCharacter.gold,
          outputQuantity: afterOutputQuantity,
        },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "CRAFT_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          gold: this.game.character().gold,
          outputQuantity: totalItemQuantity(
            this.game.inventory(),
            recipeName,
          ),
        },
      });
    }
  }

  async openStand(request: OpenStandRequest): Promise<ActionRecord> {
    const beforeCharacter = this.game.character();
    const beforeInventory = this.game.inventory();
    const gameData = this.game.gameData();
    const requestedSlot = request.inventorySlot;
    const inventorySlot =
      requestedSlot === undefined
        ? beforeInventory.find((entry) => {
            const name = itemName(entry.item);
            if (!name) return false;
            const definition = gameItemDefinition(gameData, name);
            return (
              definition.type === "stand" ||
              definition.stand === true ||
              (typeof definition.stand === "string" &&
                definition.stand.length > 0)
            );
          })?.slot
        : requestedSlot;
    const standItem =
      inventorySlot === undefined
        ? null
        : inventoryItem(beforeInventory, inventorySlot);
    const standName = itemName(standItem);
    const standDefinition = standName
      ? gameItemDefinition(gameData, standName)
      : {};
    const validStand =
      standName !== null &&
      (standDefinition.type === "stand" ||
        standDefinition.stand === true ||
        (typeof standDefinition.stand === "string" &&
          standDefinition.stand.length > 0));

    const transaction = this.ledger.create({
      module: request.module,
      action: "OPEN_STAND",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        standOpen: true,
        inventorySlot: inventorySlot ?? null,
        standItem: standName,
      },
      before: {
        stand: beforeCharacter.stand ?? null,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (
      inventorySlot === undefined ||
      !Number.isInteger(inventorySlot) ||
      inventorySlot < 0 ||
      !validStand
    ) {
      return this.ledger.block(transaction.id, "STAND_ITEM_INVALID");
    }
    if (beforeCharacter.stand) {
      return this.ledger.confirm(transaction.id, {
        why: "STAND_ALREADY_OPEN",
        after: { stand: beforeCharacter.stand },
        evidence: { alreadyOpen: true },
      });
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "open_stand",
      inventorySlot,
      standItem: standName,
    });

    try {
      const result = await this.driver.openStand(inventorySlot);
      const after = this.game.character();
      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "OPEN_STAND_API_REJECTED",
          after: { stand: after.stand ?? null },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (after.stand) {
        return this.ledger.confirm(transaction.id, {
          why: "OPEN_STAND_STATE_CONFIRMED",
          after: { stand: after.stand },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      return this.ledger.unknown(transaction.id, {
        why: "OPEN_STAND_OUTCOME_UNVERIFIED",
        after: { stand: after.stand ?? null },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "OPEN_STAND_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { stand: this.game.character().stand ?? null },
      });
    }
  }

  async closeStand(request: BoundaryRequest): Promise<ActionRecord> {
    const before = this.game.character();
    const transaction = this.ledger.create({
      module: request.module,
      action: "CLOSE_STAND",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: { standOpen: false },
      before: { stand: before.stand ?? null },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!before.stand) {
      return this.ledger.confirm(transaction.id, {
        why: "STAND_ALREADY_CLOSED",
        after: { stand: before.stand ?? null },
        evidence: { alreadyClosed: true },
      });
    }

    this.ledger.dispatch(transaction.id, { mutation: "close_stand" });
    try {
      const result = await this.driver.closeStand();
      const after = this.game.character();
      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "CLOSE_STAND_API_REJECTED",
          after: { stand: after.stand ?? null },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (!after.stand) {
        return this.ledger.confirm(transaction.id, {
          why: "CLOSE_STAND_STATE_CONFIRMED",
          after: { stand: after.stand ?? null },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      return this.ledger.unknown(transaction.id, {
        why: "CLOSE_STAND_OUTCOME_UNVERIFIED",
        after: { stand: after.stand ?? null },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "CLOSE_STAND_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { stand: this.game.character().stand ?? null },
      });
    }
  }

  async tradeList(request: TradeListRequest): Promise<ActionRecord> {
    const slot = normalizeTradeSlot(request.slot);
    const quantity = positiveInteger(request.quantity);
    const beforeInventory = this.game.inventory();
    const beforeTradeSlots = this.game.tradeSlots();
    const item = inventoryItem(beforeInventory, request.inventorySlot);
    const name = itemName(item);
    const available = itemQuantity(item);
    const definition = name
      ? gameItemDefinition(this.game.gameData(), name)
      : {};
    const transaction = this.ledger.create({
      module: request.module,
      action: "TRADE_LIST",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        inventorySlot: request.inventorySlot,
        tradeSlot: slot,
        itemName: name,
        price: request.price,
        quantity,
      },
      before: {
        tradeSlot: slot ? beforeTradeSlots[slot] || null : null,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!slot) {
      return this.ledger.block(transaction.id, "TRADE_SLOT_INVALID");
    }
    if (
      !Number.isInteger(request.inventorySlot) ||
      request.inventorySlot < 0 ||
      !item ||
      !name ||
      Object.keys(definition).length === 0
    ) {
      return this.ledger.block(transaction.id, "TRADE_ITEM_INVALID");
    }
    if (itemLocked(item)) {
      return this.ledger.block(transaction.id, "TRADE_ITEM_LOCKED");
    }
    if (!Number.isInteger(request.price) || request.price <= 0) {
      return this.ledger.block(transaction.id, "TRADE_PRICE_INVALID");
    }
    if (quantity === null || quantity > available) {
      return this.ledger.block(transaction.id, "QUANTITY_INVALID");
    }
    if (beforeTradeSlots[slot]) {
      return this.ledger.block(transaction.id, "TRADE_SLOT_OCCUPIED");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "trade",
      inventorySlot: request.inventorySlot,
      tradeSlot: slot,
      itemName: name,
      price: request.price,
      quantity,
    });

    try {
      const result = await this.driver.tradeList(
        request.inventorySlot,
        slot,
        request.price,
        quantity,
      );
      const after = this.game.tradeSlots()[slot] || null;
      const matched =
        !!after &&
        after.b !== true &&
        after.giveaway === undefined &&
        after.want === undefined &&
        itemName(after) === name &&
        Number(after.price) === request.price &&
        itemQuantity(after) === quantity;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "TRADE_LIST_API_REJECTED",
          after: { tradeSlot: after },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (matched) {
        return this.ledger.confirm(transaction.id, {
          why: "TRADE_LIST_STATE_CONFIRMED",
          after: { tradeSlot: after },
          evidence: {
            matched,
            result: safeResultEvidence(result),
          },
        });
      }
      return this.ledger.unknown(transaction.id, {
        why: "TRADE_LIST_OUTCOME_UNVERIFIED",
        after: { tradeSlot: after },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "TRADE_LIST_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { tradeSlot: this.game.tradeSlots()[slot] || null },
      });
    }
  }

  async tradeUnlist(request: TradeUnlistRequest): Promise<ActionRecord> {
    const slot = normalizeTradeSlot(request.slot);
    const beforeTradeSlots = this.game.tradeSlots();
    const before = slot ? beforeTradeSlots[slot] || null : null;
    const transaction = this.ledger.create({
      module: request.module,
      action: "TRADE_UNLIST",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: { tradeSlot: slot, listed: false },
      before: { tradeSlot: before },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!slot) {
      return this.ledger.block(transaction.id, "TRADE_SLOT_INVALID");
    }
    if (!before) {
      return this.ledger.confirm(transaction.id, {
        why: "TRADE_SLOT_ALREADY_EMPTY",
        after: { tradeSlot: null },
        evidence: { alreadyEmpty: true },
      });
    }
    if (!this.game.inventory().some((entry) => entry.item === null)) {
      return this.ledger.block(transaction.id, "INVENTORY_FULL");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "trade_unlist",
      tradeSlot: slot,
    });

    try {
      const result = await this.driver.tradeUnlist(slot);
      const after = this.game.tradeSlots()[slot] || null;
      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "TRADE_UNLIST_API_REJECTED",
          after: { tradeSlot: after },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (!after) {
        return this.ledger.confirm(transaction.id, {
          why: "TRADE_UNLIST_STATE_CONFIRMED",
          after: { tradeSlot: null },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      return this.ledger.unknown(transaction.id, {
        why: "TRADE_UNLIST_OUTCOME_UNVERIFIED",
        after: { tradeSlot: after },
        evidence: { result: safeResultEvidence(result) },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "TRADE_UNLIST_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { tradeSlot: this.game.tradeSlots()[slot] || null },
      });
    }
  }

  wishlist(request: WishlistRequest): ActionRecord {
    const slot = normalizeTradeSlot(request.slot);
    const itemNameValue = request.itemName?.trim();
    const quantity = positiveInteger(request.quantity);
    const level =
      request.level === undefined ? 0 : Number(request.level);
    const gameData = this.game.gameData();
    const definition = itemNameValue
      ? gameItemDefinition(gameData, itemNameValue)
      : {};
    const beforeTradeSlots = this.game.tradeSlots();
    const transaction = this.ledger.create({
      module: request.module,
      action: "WISHLIST",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        slot,
        itemName: itemNameValue || null,
        price: request.price,
        level,
        quantity,
      },
      before: {
        tradeSlot: slot ? beforeTradeSlots[slot] || null : null,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!slot) {
      return this.ledger.block(transaction.id, "TRADE_SLOT_INVALID");
    }
    if (!itemNameValue || Object.keys(definition).length === 0) {
      return this.ledger.block(transaction.id, "WISHLIST_ITEM_INVALID");
    }
    if (!Number.isInteger(request.price) || request.price <= 0) {
      return this.ledger.block(transaction.id, "WISHLIST_PRICE_INVALID");
    }
    if (quantity === null) {
      return this.ledger.block(transaction.id, "QUANTITY_INVALID");
    }
    if (!Number.isInteger(level) || level < 0) {
      return this.ledger.block(transaction.id, "ITEM_LEVEL_INVALID");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "wishlist",
      slot,
      itemName: itemNameValue,
      price: request.price,
      level,
      quantity,
    });

    try {
      const result = this.driver.wishlist(
        request.slot,
        itemNameValue,
        request.price,
        request.level,
        quantity,
      );
      const afterTradeSlots = this.game.tradeSlots();
      const after = afterTradeSlots[slot] || null;
      const matched =
        !!after &&
        after.b === true &&
        itemName(after) === itemNameValue &&
        Number(after.price) === request.price &&
        itemQuantity(after) === quantity &&
        itemLevel(after) === level;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "WISHLIST_API_REJECTED",
          after: { tradeSlot: after },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (matched) {
        return this.ledger.confirm(transaction.id, {
          why: "WISHLIST_STATE_CONFIRMED",
          after: { tradeSlot: after },
          evidence: {
            matched,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "WISHLIST_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          tradeSlot: this.game.tradeSlots()[slot] || null,
        },
      });
    }
  }


  pontyBuy(request: PontyBuyRequest): ActionRecord {
    const rid = request.rid?.trim();
    const itemNameValue = request.itemName?.trim();
    const beforeCharacter = this.game.character();
    const beforeInventory = this.game.inventory();
    const itemDefinition = itemNameValue
      ? gameItemDefinition(this.game.gameData(), itemNameValue)
      : {};
    const transaction = this.ledger.create({
      module: request.module,
      action: "PONTY_BUY",
      why: request.why,
      correlationId: request.correlationId,
      expectedCost: {
        gold: request.price,
      },
      expectedEffect: {
        rid: rid || null,
        itemName: itemNameValue || null,
      },
      before: {
        gold: beforeCharacter.gold,
        itemQuantity: itemNameValue
          ? totalItemQuantity(beforeInventory, itemNameValue)
          : 0,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!rid) {
      return this.ledger.block(transaction.id, "PONTY_RID_INVALID");
    }
    if (!itemNameValue || !Object.keys(itemDefinition).length) {
      return this.ledger.block(transaction.id, "PONTY_ITEM_INVALID");
    }
    if (!Number.isInteger(request.price) || request.price <= 0) {
      return this.ledger.block(transaction.id, "PONTY_PRICE_INVALID");
    }
    if (
      beforeCharacter.gold !== null &&
      request.price > beforeCharacter.gold
    ) {
      return this.ledger.block(transaction.id, "INSUFFICIENT_GOLD");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "sbuy",
      rid,
      itemName: itemNameValue,
      price: request.price,
    });

    try {
      const result = this.driver.pontyBuy(rid);
      const afterInventory = this.game.inventory();
      const afterCharacter = this.game.character();
      const beforeQuantity = totalItemQuantity(
        beforeInventory,
        itemNameValue,
      );
      const afterQuantity = totalItemQuantity(afterInventory, itemNameValue);
      const goldDelta =
        beforeCharacter.gold !== null && afterCharacter.gold !== null
          ? beforeCharacter.gold - afterCharacter.gold
          : null;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "PONTY_BUY_API_REJECTED",
          after: {
            gold: afterCharacter.gold,
            itemQuantity: afterQuantity,
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (
        afterQuantity > beforeQuantity ||
        (goldDelta !== null && goldDelta >= request.price)
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "PONTY_BUY_STATE_CONFIRMED",
          after: {
            gold: afterCharacter.gold,
            itemQuantity: afterQuantity,
          },
          evidence: {
            itemDelta: afterQuantity - beforeQuantity,
            goldDelta,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "PONTY_BUY_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          gold: this.game.character().gold,
          itemQuantity: totalItemQuantity(
            this.game.inventory(),
            itemNameValue,
          ),
        },
      });
    }
  }


  partyInvite(request: PartyTargetRequest): ActionRecord {
    const target = request.name?.trim();
    const beforeParty = this.game.party();
    const characterName = this.game.character().name;
    const transaction = this.ledger.create({
      module: request.module,
      action: "PARTY_INVITE",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        target: target || null,
        effect: "INVITE_TO_PARTY",
      },
      before: {
        members: partyMembers(beforeParty),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!target) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_INVALID");
    }
    if (characterName && target === characterName) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_SELF");
    }
    if (Object.prototype.hasOwnProperty.call(beforeParty, target)) {
      return this.ledger.block(
        transaction.id,
        "PARTY_MEMBER_ALREADY_PRESENT",
      );
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "send_party_invite",
      target,
    });

    try {
      const result = this.driver.partyInvite(target);
      const afterParty = this.game.party();

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "PARTY_INVITE_API_REJECTED",
          after: { members: partyMembers(afterParty) },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (
        characterName &&
        partyJoined(afterParty, [characterName, target])
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "PARTY_INVITE_STATE_CONFIRMED",
          after: { members: partyMembers(afterParty) },
          evidence: {
            targetJoined: true,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "PARTY_INVITE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { members: partyMembers(this.game.party()) },
      });
    }
  }

  partyRequest(request: PartyTargetRequest): ActionRecord {
    const target = request.name?.trim();
    const beforeParty = this.game.party();
    const characterName = this.game.character().name;
    const transaction = this.ledger.create({
      module: request.module,
      action: "PARTY_REQUEST",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        target: target || null,
        effect: "REQUEST_PARTY_JOIN",
      },
      before: {
        members: partyMembers(beforeParty),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!target) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_INVALID");
    }
    if (characterName && target === characterName) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_SELF");
    }
    if (Object.prototype.hasOwnProperty.call(beforeParty, target)) {
      return this.ledger.block(
        transaction.id,
        "PARTY_MEMBER_ALREADY_PRESENT",
      );
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "send_party_request",
      target,
    });

    try {
      const result = this.driver.partyRequest(target);
      const afterParty = this.game.party();

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "PARTY_REQUEST_API_REJECTED",
          after: { members: partyMembers(afterParty) },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (
        characterName &&
        partyJoined(afterParty, [characterName, target])
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "PARTY_REQUEST_STATE_CONFIRMED",
          after: { members: partyMembers(afterParty) },
          evidence: {
            joined: true,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "PARTY_REQUEST_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { members: partyMembers(this.game.party()) },
      });
    }
  }

  partyAcceptInvite(request: PartyTargetRequest): ActionRecord {
    const inviter = request.name?.trim();
    const characterName = this.game.character().name;
    const beforeParty = this.game.party();
    const transaction = this.ledger.create({
      module: request.module,
      action: "PARTY_ACCEPT_INVITE",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        inviter: inviter || null,
        effect: "JOIN_PARTY",
      },
      before: {
        members: partyMembers(beforeParty),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!inviter) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_INVALID");
    }
    if (characterName && inviter === characterName) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_SELF");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "accept_party_invite",
      inviter,
    });

    try {
      const result = this.driver.partyAcceptInvite(inviter);
      const afterParty = this.game.party();

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "PARTY_ACCEPT_INVITE_API_REJECTED",
          after: { members: partyMembers(afterParty) },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (
        characterName &&
        partyJoined(afterParty, [characterName, inviter])
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "PARTY_ACCEPT_INVITE_STATE_CONFIRMED",
          after: { members: partyMembers(afterParty) },
          evidence: {
            joined: true,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "PARTY_ACCEPT_INVITE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { members: partyMembers(this.game.party()) },
      });
    }
  }

  partyAcceptRequest(request: PartyTargetRequest): ActionRecord {
    const requester = request.name?.trim();
    const characterName = this.game.character().name;
    const beforeParty = this.game.party();
    const transaction = this.ledger.create({
      module: request.module,
      action: "PARTY_ACCEPT_REQUEST",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        requester: requester || null,
        effect: "ADD_PARTY_MEMBER",
      },
      before: {
        members: partyMembers(beforeParty),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!requester) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_INVALID");
    }
    if (characterName && requester === characterName) {
      return this.ledger.block(transaction.id, "PARTY_TARGET_SELF");
    }
    if (Object.prototype.hasOwnProperty.call(beforeParty, requester)) {
      return this.ledger.block(
        transaction.id,
        "PARTY_MEMBER_ALREADY_PRESENT",
      );
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "accept_party_request",
      requester,
    });

    try {
      const result = this.driver.partyAcceptRequest(requester);
      const afterParty = this.game.party();

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "PARTY_ACCEPT_REQUEST_API_REJECTED",
          after: { members: partyMembers(afterParty) },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (
        characterName &&
        partyJoined(afterParty, [characterName, requester])
      ) {
        return this.ledger.confirm(transaction.id, {
          why: "PARTY_ACCEPT_REQUEST_STATE_CONFIRMED",
          after: { members: partyMembers(afterParty) },
          evidence: {
            joined: true,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "PARTY_ACCEPT_REQUEST_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { members: partyMembers(this.game.party()) },
      });
    }
  }

  async partyLeave(request: BoundaryRequest): Promise<ActionRecord> {
    const beforeParty = this.game.party();
    const characterName = this.game.character().name;
    const transaction = this.ledger.create({
      module: request.module,
      action: "PARTY_LEAVE",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        effect: "LEAVE_PARTY",
      },
      before: {
        members: partyMembers(beforeParty),
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!partyMembers(beforeParty).length) {
      return this.ledger.block(transaction.id, "PARTY_NOT_JOINED");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "leave_party",
    });

    try {
      const result = await this.driver.partyLeave();
      const afterParty = this.game.party();
      const left =
        !characterName ||
        !Object.prototype.hasOwnProperty.call(afterParty, characterName) ||
        partyMembers(afterParty).length === 0;

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "PARTY_LEAVE_API_REJECTED",
          after: { members: partyMembers(afterParty) },
          evidence: { result: safeResultEvidence(result) },
        });
      }

      return this.ledger.confirm(transaction.id, {
        why: left
          ? "PARTY_LEAVE_STATE_CONFIRMED"
          : "PARTY_LEAVE_API_CONFIRMED",
        after: { members: partyMembers(afterParty) },
        evidence: {
          apiResolved: true,
          left,
          result: safeResultEvidence(result),
        },
      });
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "PARTY_LEAVE_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: { members: partyMembers(this.game.party()) },
      });
    }
  }

  respawn(request: BoundaryRequest): ActionRecord {
    const before = this.game.character();
    const transaction = this.ledger.create({
      module: request.module,
      action: "RESPAWN",
      why: request.why,
      correlationId: request.correlationId,
      expectedEffect: {
        rip: false,
      },
      before: {
        rip: before.rip,
        map: before.map,
        x: before.x,
        y: before.y,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!before.rip) {
      return this.ledger.block(transaction.id, "CHARACTER_NOT_DEAD");
    }

    this.ledger.dispatch(transaction.id, {
      mutation: "respawn",
    });

    try {
      const result = this.driver.respawn();
      const after = this.game.character();

      if (explicitFailure(result)) {
        return this.ledger.reject(transaction.id, {
          why: "RESPAWN_API_REJECTED",
          after: {
            rip: after.rip,
            map: after.map,
            x: after.x,
            y: after.y,
          },
          evidence: { result: safeResultEvidence(result) },
        });
      }
      if (!after.rip) {
        return this.ledger.confirm(transaction.id, {
          why: "RESPAWN_STATE_CONFIRMED",
          after: {
            rip: after.rip,
            map: after.map,
            x: after.x,
            y: after.y,
          },
          evidence: {
            respawned: true,
            result: safeResultEvidence(result),
          },
        });
      }

      return this.ledger.get(transaction.id)!;
    } catch (error) {
      return this.ledger.unknown(transaction.id, {
        why: "RESPAWN_OUTCOME_UNCERTAIN",
        error: errorMessage(error),
        after: {
          rip: this.game.character().rip,
        },
      });
    }
  }

}

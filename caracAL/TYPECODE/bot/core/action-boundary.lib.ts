import type { ActionRecord } from "./action-ledger.lib";
import type {
  CharacterSnapshot,
  EntitySnapshot,
  InventorySlotSnapshot,
  MapSnapshot,
  SkillSnapshot,
} from "./game-adapter.lib";

interface ActionIntentInput {
  module: string;
  action: string;
  why: string;
  correlationId?: string;
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

export interface AttackRequest extends BoundaryRequest {
  targetId: string;
}

export interface SkillRequest extends BoundaryRequest {
  skill: string;
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

export interface MutationDriver {
  move(x: number, y: number): unknown;
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
}

function runtimeFunction(name: string): (...args: unknown[]) => unknown {
  const scope = globalThis as unknown as Record<string, unknown>;
  const fn = scope[name];

  if (typeof fn !== "function") {
    throw new Error(`Adventure Land mutation function unavailable: ${name}`);
  }

  return fn as (...args: unknown[]) => unknown;
}

export function createRuntimeMutationDriver(): MutationDriver {
  return {
    move: (x, y) => runtimeFunction("move")(x, y),
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
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  for (const key of ["success", "failed", "response", "reason", "place"]) {
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

export const ACTION_BOUNDARY_MUTATION_CAPABILITIES = [
  "MOVE",
  "ATTACK",
  "SKILL",
  "LOOT",
  "BUY",
  "SELL",
  "SEND_ITEM",
  "SEND_GOLD",
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
      },
      before: {
        hp: before.hp,
        mp: before.mp,
        target: before.target,
      },
      metadata: {
        skill: request.skill,
        argCount: args.length,
      },
    });

    if (transaction.status === "BLOCKED") return transaction;
    if (!skill) {
      return this.ledger.block(transaction.id, "UNKNOWN_SKILL");
    }
    if (args.length > 4) {
      return this.ledger.block(transaction.id, "SKILL_ARGUMENTS_INVALID");
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

    this.ledger.dispatch(transaction.id, {
      mutation: "use_skill",
      skill: request.skill,
      argCount: args.length,
    });

    try {
      const result = await this.driver.useSkill(request.skill, ...args);
      return this.ledger.confirm(transaction.id, {
        why: "SKILL_API_CONFIRMED",
        after: {
          character: this.game.character(),
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
}

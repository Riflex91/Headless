import type { ActionBoundary } from "./action-boundary.lib";
import type {
  CombatController,
  CombatControllerStatus,
} from "./combat-controller.lib";
import type {
  CharacterSnapshot,
  EntitySnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";
import type {
  LogisticsClaimExecutor,
  LogisticsExecutionResult,
} from "./logistics-claim-executor.lib";
import type { MovementController } from "./movement-controller.lib";

export interface MaterialGatherTaskOptions {
  requestId?: string;
  itemName: string;
  monsterType: string;
  quantity: number;
  recipient: string;
  recipientPosition: {
    map: string;
    x: number;
    y: number;
  };
  timeoutMs?: number;
  pollMs?: number;
}

export interface MaterialGatherTaskResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  worker: string | null;
  itemName: string;
  monsterType: string;
  quantity: number;
  recipient: string;
  inventory: {
    initialQuantity: number;
    gatheredQuantity: number;
    deliveredQuantity: number;
  };
  evidence: {
    combatControllerUsed: true;
    attackUnknownReconciled: boolean;
    lootConfirmed: boolean;
    materialObserved: boolean;
    deliveryConfirmed: boolean;
    blindRetryUsed: false;
  };
  cleanup: {
    combatOverrideCleared: boolean;
    preferredTargetCleared: boolean;
  };
}

interface MaterialGatherGame {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  entities(): EntitySnapshot[];
  entity(id: string): EntitySnapshot | null;
}

interface MaterialGatherDependencies {
  game: MaterialGatherGame;
  combat: Pick<
    CombatController,
    | "status"
    | "tick"
    | "setPreferredTargetId"
    | "setConfigOverride"
    | "clearConfigOverride"
  >;
  movement: Pick<MovementController, "status" | "smart">;
  actions: Pick<ActionBoundary, "loot">;
  logistics: Pick<LogisticsClaimExecutor, "execute">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MODULE = "MaterialGatheringTask";
const OWNER = "MATERIAL_GATHERING_TASK";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 150;
const ATTACK_UNKNOWN_RECONCILE_MS = 3000;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function itemQuantity(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  const quantity = Number(item.q);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function inventoryQuantity(
  inventory: InventorySlotSnapshot[],
  itemName: string,
): number {
  return inventory.reduce(
    (sum, entry) =>
      entry.item?.name === itemName ? sum + itemQuantity(entry.item) : sum,
    0,
  );
}

function distance(
  character: CharacterSnapshot,
  entity: EntitySnapshot,
): number | null {
  if (
    character.x === null ||
    character.y === null ||
    entity.x === null ||
    entity.y === null
  ) {
    return null;
  }
  return Math.hypot(entity.x - character.x, entity.y - character.y);
}

function nearestMonster(
  character: CharacterSnapshot,
  entities: EntitySnapshot[],
  monsterType: string,
): EntitySnapshot | null {
  return (
    entities
      .filter(
        (entity) =>
          entity.mtype === monsterType &&
          !entity.dead &&
          !entity.rip &&
          entity.x !== null &&
          entity.y !== null,
      )
      .sort((a, b) => {
        const ad = distance(character, a);
        const bd = distance(character, b);
        if (ad === null && bd === null) return a.id.localeCompare(b.id);
        if (ad === null) return 1;
        if (bd === null) return -1;
        return ad - bd;
      })[0] || null
  );
}

function combatOverride(): Record<string, unknown> {
  return {
    combat: {
      enabled: true,
      autoTarget: true,
      avoidKillSteal: true,
      targetMaxDistance: 1500,
      retreat: false,
    },
    potionUsage: {
      enabled: true,
      hpBelowPercent: 55,
      mpBelowPercent: 35,
      criticalHpPercent: 25,
    },
    safety: {
      autoRespawn: false,
    },
  };
}

export class MaterialGatheringTaskRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: MaterialGatherDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: MaterialGatherTaskOptions,
  ): Promise<MaterialGatherTaskResult> {
    const startedAt = this.now();
    const requestId =
      options.requestId || `material-gather-${startedAt}`;
    const quantity = positiveInteger(options.quantity);
    const timeoutMs = Math.max(
      30000,
      Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS,
    );
    const pollMs = Math.max(50, Number(options.pollMs) || DEFAULT_POLL_MS);
    const worker = this.deps.game.character().name;
    const initialQuantity = inventoryQuantity(
      this.deps.game.inventory(),
      options.itemName,
    );
    let outcome: MaterialGatherTaskResult["outcome"] = "FAIL";
    let reason = "MATERIAL_GATHER_NOT_COMPLETED";
    let lootConfirmed = false;
    let attackUnknownReconciled = false;
    let deliveredQuantity = 0;
    let combatOverrideCleared = false;
    let preferredTargetCleared = false;

    const finish = (): MaterialGatherTaskResult => {
      const completedAt = this.now();
      const currentQuantity = inventoryQuantity(
        this.deps.game.inventory(),
        options.itemName,
      );
      return {
        requestId,
        outcome,
        reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        worker,
        itemName: options.itemName,
        monsterType: options.monsterType,
        quantity: quantity || 0,
        recipient: options.recipient,
        inventory: {
          initialQuantity,
          gatheredQuantity: Math.max(
            0,
            currentQuantity + deliveredQuantity - initialQuantity,
          ),
          deliveredQuantity,
        },
        evidence: {
          combatControllerUsed: true,
          attackUnknownReconciled,
          lootConfirmed,
          materialObserved:
            currentQuantity + deliveredQuantity >= (quantity || 0),
          deliveryConfirmed: deliveredQuantity >= (quantity || 0),
          blindRetryUsed: false,
        },
        cleanup: {
          combatOverrideCleared,
          preferredTargetCleared,
        },
      };
    };

    if (
      !options.itemName?.trim() ||
      !options.monsterType?.trim() ||
      !options.recipient?.trim() ||
      !quantity ||
      !options.recipientPosition?.map ||
      !Number.isFinite(options.recipientPosition.x) ||
      !Number.isFinite(options.recipientPosition.y)
    ) {
      reason = "MATERIAL_GATHER_REQUEST_INVALID";
      return finish();
    }

    this.deps.combat.setConfigOverride(combatOverride());

    try {
      while (this.now() - startedAt < timeoutMs) {
        const available = inventoryQuantity(
          this.deps.game.inventory(),
          options.itemName,
        );
        if (available >= quantity) break;

        const character = this.deps.game.character();
        if (character.rip) {
          reason = "MATERIAL_WORKER_DEAD";
          return finish();
        }

        let target = nearestMonster(
          character,
          this.deps.game.entities(),
          options.monsterType,
        );

        if (!target) {
          const moved = await this.deps.movement.smart({
            owner: OWNER,
            module: MODULE,
            why: "MATERIAL_GATHER_FIND_MONSTER",
            correlationId: requestId,
            destination: options.monsterType,
          });
          if (moved.status === "UNKNOWN") {
            outcome = "UNKNOWN";
            reason = "MATERIAL_MONSTER_TRAVEL_UNKNOWN";
            return finish();
          }
          if (moved.status !== "CONFIRMED") {
            reason = `MATERIAL_MONSTER_TRAVEL_${moved.status || "FAILED"}`;
            return finish();
          }
          await this.sleep(pollMs);
          target = nearestMonster(
            this.deps.game.character(),
            this.deps.game.entities(),
            options.monsterType,
          );
          if (!target) continue;
        }

        const current = this.deps.game.character();
        const targetDistance = distance(current, target);
        const attackRange = current.range;
        if (
          targetDistance === null ||
          attackRange === null ||
          targetDistance > Math.max(10, attackRange - 4)
        ) {
          if (
            target.x === null ||
            target.y === null ||
            !target.map
          ) {
            reason = "MATERIAL_TARGET_POSITION_UNKNOWN";
            return finish();
          }
          const moved = await this.deps.movement.smart({
            owner: OWNER,
            module: MODULE,
            why: "MATERIAL_GATHER_APPROACH_MONSTER",
            correlationId: requestId,
            destination: {
              map: target.map,
              x: target.x,
              y: target.y,
            },
          });
          if (moved.status === "UNKNOWN") {
            outcome = "UNKNOWN";
            reason = "MATERIAL_APPROACH_UNKNOWN";
            return finish();
          }
          if (moved.status !== "CONFIRMED") {
            reason = `MATERIAL_APPROACH_${moved.status || "FAILED"}`;
            return finish();
          }
        }

        this.deps.combat.setPreferredTargetId(target.id);
        const beforeHp = this.deps.game.entity(target.id)?.hp ?? null;
        let combatStatus = await this.deps.combat.tick();

        if (
          combatStatus.state === "BLOCKED" &&
          combatStatus.reason === "ATTACK_OUTCOME_UNKNOWN"
        ) {
          const reconcileStarted = this.now();
          while (
            this.now() - reconcileStarted < ATTACK_UNKNOWN_RECONCILE_MS &&
            combatStatus.state === "BLOCKED" &&
            combatStatus.reason === "ATTACK_OUTCOME_UNKNOWN"
          ) {
            await this.sleep(pollMs);
            combatStatus = await this.deps.combat.tick();
          }
          if (
            combatStatus.state === "BLOCKED" &&
            combatStatus.reason === "ATTACK_OUTCOME_UNKNOWN"
          ) {
            outcome = "UNKNOWN";
            reason = "MATERIAL_ATTACK_OUTCOME_UNKNOWN";
            return finish();
          }
          attackUnknownReconciled = true;
        }

        if (
          combatStatus.state === "BLOCKED" &&
          combatStatus.reason !== "ATTACK_COOLDOWN"
        ) {
          reason = `MATERIAL_COMBAT_BLOCKED:${combatStatus.reason}`;
          return finish();
        }

        await this.sleep(pollMs);
        const afterTarget = this.deps.game.entity(target.id);
        const afterHp = afterTarget?.hp ?? null;
        const targetDefeated =
          !afterTarget || afterTarget.dead || afterTarget.rip;

        if (targetDefeated) {
          this.deps.combat.setPreferredTargetId(null);
          const loot = await this.deps.actions.loot({
            module: MODULE,
            why: "MATERIAL_GATHER_LOOT",
            correlationId: requestId,
          });
          if (loot.status === "UNKNOWN") {
            await this.sleep(pollMs * 2);
            if (
              inventoryQuantity(
                this.deps.game.inventory(),
                options.itemName,
              ) < quantity
            ) {
              outcome = "UNKNOWN";
              reason = "MATERIAL_LOOT_OUTCOME_UNKNOWN";
              return finish();
            }
          } else if (
            loot.status === "BLOCKED" ||
            loot.status === "REJECTED"
          ) {
            reason = `MATERIAL_LOOT_${loot.status}`;
            return finish();
          } else {
            lootConfirmed = true;
          }
          await this.sleep(pollMs);
          continue;
        }

        if (
          beforeHp !== null &&
          afterHp !== null &&
          afterHp >= beforeHp &&
          combatStatus.state !== "COOLDOWN"
        ) {
          await this.sleep(pollMs);
        }
      }

      if (
        inventoryQuantity(this.deps.game.inventory(), options.itemName) <
        quantity
      ) {
        outcome = "TIMEOUT";
        reason = "MATERIAL_GATHER_TIMEOUT";
        return finish();
      }

      const toRecipient = await this.deps.movement.smart({
        owner: OWNER,
        module: MODULE,
        why: "MATERIAL_DELIVERY_TRAVEL",
        correlationId: requestId,
        destination: {
          map: options.recipientPosition.map,
          x: options.recipientPosition.x,
          y: options.recipientPosition.y,
        },
      });
      if (toRecipient.status === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "MATERIAL_DELIVERY_TRAVEL_UNKNOWN";
        return finish();
      }
      if (toRecipient.status !== "CONFIRMED") {
        reason = `MATERIAL_DELIVERY_TRAVEL_${
          toRecipient.status || "FAILED"
        }`;
        return finish();
      }

      const delivery: LogisticsExecutionResult =
        await this.deps.logistics.execute({
          id: `${requestId}:delivery`,
          type: "MATERIAL_DELIVERY",
          farmer: worker || "",
          merchant: {
            name: options.recipient,
            live: true,
          },
          itemName: options.itemName,
          quantity,
          reason: "FISHING_MATERIAL_DELIVERY",
          metadata: {
            purpose: "FISHING_MATERIAL",
            authorized: true,
            monsterType: options.monsterType,
          },
        });

      if (delivery.outcome === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "MATERIAL_DELIVERY_OUTCOME_UNKNOWN";
        return finish();
      }
      if (
        delivery.outcome !== "CONFIRMED" ||
        delivery.fulfilled !== true
      ) {
        reason = `MATERIAL_DELIVERY_${delivery.outcome}:${delivery.reason}`;
        return finish();
      }

      deliveredQuantity = delivery.executedQuantity || 0;
      outcome = "PASS";
      reason = "MATERIAL_GATHER_AND_DELIVERY_CONFIRMED";
      return finish();
    } finally {
      this.deps.combat.setPreferredTargetId(null);
      preferredTargetCleared = true;
      this.deps.combat.clearConfigOverride();
      combatOverrideCleared = true;
    }
  }
}

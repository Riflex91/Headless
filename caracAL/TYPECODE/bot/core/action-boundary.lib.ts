import type { ActionRecord } from "./action-ledger.lib";
import type {
  CharacterSnapshot,
  EntitySnapshot,
  MapSnapshot,
} from "./game-adapter.lib";

interface ActionLedgerLike {
  create(intent: {
    module: string;
    action: string;
    why: string;
    correlationId?: string;
    expectedEffect?: Record<string, unknown>;
    before?: Record<string, unknown>;
  }): ActionRecord;
  dispatch(
    actionId: string,
    evidence?: Record<string, unknown>,
  ): ActionRecord;
  confirm(
    actionId: string,
    resolution: {
      why: string;
      after?: Record<string, unknown>;
      evidence?: Record<string, unknown>;
      error?: string;
    },
  ): ActionRecord;
  unknown(
    actionId: string,
    resolution: {
      why: string;
      after?: Record<string, unknown>;
      evidence?: Record<string, unknown>;
      error?: string;
    },
  ): ActionRecord;
  block(actionId: string, why: string): ActionRecord;
  get(actionId: string): ActionRecord | undefined;
}

interface GameReadAdapter {
  character(): CharacterSnapshot;
  entity(id: string): EntitySnapshot | null;
  map(): MapSnapshot;
}

export interface MoveRequest {
  x: number;
  y: number;
  module: string;
  why: string;
  correlationId?: string;
}

export interface AttackRequest {
  targetId: string;
  module: string;
  why: string;
  correlationId?: string;
}

export interface MutationDriver {
  move(x: number, y: number): unknown;
  resolveEntity(id: string): unknown;
  canAttack(entity: unknown): boolean;
  attack(entity: unknown): Promise<unknown> | unknown;
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
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ActionBoundary {
  constructor(
    private readonly ledger: ActionLedgerLike,
    private readonly game: GameReadAdapter,
    private readonly driver: MutationDriver = createRuntimeMutationDriver(),
  ) {}

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
          result:
            result === undefined
              ? null
              : typeof result === "object"
                ? "[object]"
                : result,
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
}

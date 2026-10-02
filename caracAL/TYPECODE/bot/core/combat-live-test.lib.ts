import type { ActionRecord } from "./action-ledger.lib";
import type { CombatController, CombatControllerStatus } from "./combat-controller.lib";
import type { CharacterSnapshot, EntitySnapshot } from "./game-adapter.lib";
import type {
  MovementController,
  MovementControllerStatus,
} from "./movement-controller.lib";

export type CombatLiveTestOutcome = "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";

export interface CombatLiveTestOptions {
  requestId?: string;
  owner?: string;
  navigationTimeoutMs?: number;
  targetTimeoutMs?: number;
  attackTimeoutMs?: number;
  cooldownTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface CombatLiveTestResult {
  requestId: string;
  outcome: CombatLiveTestOutcome;
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  start: {
    map: string;
    x: number;
    y: number;
    hp: number | null;
    maxHp: number | null;
    mp: number | null;
    maxMp: number | null;
  } | null;
  preparation: {
    initialMovementCancelStatus: string | null;
    respawnedAtStart: boolean;
    destinationCandidates: string[];
    selectedMonsterType: string | null;
  };
  navigation: {
    outboundStatus: string | null;
    returnStatus: string | null;
    finalDistanceToStart: number | null;
    returnedToStart: boolean;
  };
  combat: {
    targetId: string | null;
    targetType: string | null;
    targetDistance: number | null;
    attackRange: number | null;
    inRangeObserved: boolean;
    attackActionId: string | null;
    attackActionStatus: string | null;
    cooldownObserved: boolean;
    resourcesVisible: boolean;
  };
  scope: {
    potionMutationForced: false;
    deathMutationForced: false;
    respawnObservedOnlyWhenInitiallyDead: true;
  };
  cleanup: {
    movementCancelStatus: string | null;
    combatOverrideCleared: boolean;
  };
}

interface CombatLiveTestDependencies {
  combat: Pick<
    CombatController,
    "status" | "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  movement: Pick<MovementController, "status" | "smart" | "cancel">;
  character: () => CharacterSnapshot;
  entities: () => EntitySnapshot[];
  gameData: () => Record<string, unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const SAFE_MONSTER_TYPES = [
  "goo",
  "bee",
  "crab",
  "snake",
  "squig",
  "cgoo",
  "rgoo",
  "spider",
];

const DISABLED_TEST_CONFIG = {
  combat: {
    enabled: false,
  },
  potionUsage: {
    enabled: false,
  },
  safety: {
    autoRespawn: false,
  },
};

const ENABLED_TEST_CONFIG = {
  combat: {
    enabled: true,
    autoTarget: true,
    avoidKillSteal: true,
    targetMaxDistance: 1200,
    retreat: false,
  },
  potionUsage: {
    enabled: false,
  },
  safety: {
    autoRespawn: false,
  },
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function actionStatus(record: ActionRecord | null): string | null {
  return record?.status || null;
}

function finitePosition(
  snapshot: CharacterSnapshot,
): snapshot is CharacterSnapshot & { map: string; x: number; y: number } {
  return (
    typeof snapshot.map === "string" &&
    snapshot.map.length > 0 &&
    typeof snapshot.x === "number" &&
    Number.isFinite(snapshot.x) &&
    typeof snapshot.y === "number" &&
    Number.isFinite(snapshot.y)
  );
}

function entityDistance(
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

function resourcesVisible(status: CombatControllerStatus): boolean {
  const resources = status.resources;
  return (
    typeof resources.hp === "number" &&
    typeof resources.maxHp === "number" &&
    typeof resources.mp === "number" &&
    typeof resources.maxMp === "number"
  );
}

function completedMovement(status: MovementControllerStatus): boolean {
  return status.owner === null && status.active === null && status.mode === "IDLE";
}

export class CombatLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly dependencies: CombatLiveTestDependencies) {
    this.now = dependencies.now || (() => Date.now());
    this.sleep =
      dependencies.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(options: CombatLiveTestOptions = {}): Promise<CombatLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `combat-live-${startedAt}`;
    const owner = options.owner?.trim() || "CombatLiveTest";
    const navigationTimeoutMs = Math.max(
      5000,
      Number.isFinite(options.navigationTimeoutMs)
        ? Number(options.navigationTimeoutMs)
        : 20000,
    );
    const targetTimeoutMs = Math.max(
      2000,
      Number.isFinite(options.targetTimeoutMs)
        ? Number(options.targetTimeoutMs)
        : 6000,
    );
    const attackTimeoutMs = Math.max(
      2000,
      Number.isFinite(options.attackTimeoutMs)
        ? Number(options.attackTimeoutMs)
        : 5000,
    );
    const cooldownTimeoutMs = Math.max(
      250,
      Number.isFinite(options.cooldownTimeoutMs)
        ? Number(options.cooldownTimeoutMs)
        : 1500,
    );
    const pollIntervalMs = Math.max(
      25,
      Number.isFinite(options.pollIntervalMs)
        ? Number(options.pollIntervalMs)
        : 75,
    );

    const result: CombatLiveTestResult = {
      requestId,
      outcome: "FAIL",
      reason: "NOT_RUN",
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      character: null,
      start: null,
      preparation: {
        initialMovementCancelStatus: null,
        respawnedAtStart: false,
        destinationCandidates: [],
        selectedMonsterType: null,
      },
      navigation: {
        outboundStatus: null,
        returnStatus: null,
        finalDistanceToStart: null,
        returnedToStart: false,
      },
      combat: {
        targetId: null,
        targetType: null,
        targetDistance: null,
        attackRange: null,
        inRangeObserved: false,
        attackActionId: null,
        attackActionStatus: null,
        cooldownObserved: false,
        resourcesVisible: false,
      },
      scope: {
        potionMutationForced: false,
        deathMutationForced: false,
        respawnObservedOnlyWhenInitiallyDead: true,
      },
      cleanup: {
        movementCancelStatus: null,
        combatOverrideCleared: false,
      },
    };

    let overrideActive = false;

    try {
      this.dependencies.combat.setConfigOverride(DISABLED_TEST_CONFIG);
      overrideActive = true;
      await this.dependencies.combat.tick();

      let startCharacter = this.dependencies.character();
      result.character = startCharacter.name;

      if (startCharacter.rip) {
        this.dependencies.combat.setConfigOverride({
          ...DISABLED_TEST_CONFIG,
          safety: {
            autoRespawn: true,
            respawnRetryMs: 1000,
          },
        });
        await this.dependencies.combat.tick();
        const alive = await this.waitForAlive(8000, pollIntervalMs);
        if (!alive) {
          result.reason = "INITIAL_RESPAWN_NOT_CONFIRMED";
          return this.finish(result);
        }
        result.preparation.respawnedAtStart = true;
        this.dependencies.combat.setConfigOverride(DISABLED_TEST_CONFIG);
        startCharacter = this.dependencies.character();
      }

      if (!finitePosition(startCharacter)) {
        result.reason = "START_POSITION_UNKNOWN";
        return this.finish(result);
      }
      if (
        startCharacter.range === null ||
        !Number.isFinite(startCharacter.range) ||
        startCharacter.range <= 0
      ) {
        result.reason = "ATTACK_RANGE_UNKNOWN";
        return this.finish(result);
      }

      result.start = {
        map: startCharacter.map,
        x: startCharacter.x,
        y: startCharacter.y,
        hp: startCharacter.hp,
        maxHp: startCharacter.maxHp,
        mp: startCharacter.mp,
        maxMp: startCharacter.maxMp,
      };
      result.combat.attackRange = startCharacter.range;

      const initialCancel = await this.cancelMovementIfNeeded(
        owner,
        "COMBAT_LIVE_E2E_PREPARE",
        requestId,
      );
      result.preparation.initialMovementCancelStatus = initialCancel;
      if (initialCancel === "UNKNOWN") {
        result.outcome = "UNKNOWN";
        result.reason = "INITIAL_MOVEMENT_CANCEL_UNKNOWN";
        return this.finish(result);
      }
      if (
        initialCancel !== null &&
        initialCancel !== "CONFIRMED"
      ) {
        result.reason = `INITIAL_MOVEMENT_CANCEL_${initialCancel}`;
        return this.finish(result);
      }

      const destinationCandidates = this.safeDestinationCandidates();
      result.preparation.destinationCandidates = destinationCandidates;

      let target = this.selectSafeTarget();
      if (!target) {
        for (const monsterType of destinationCandidates) {
          const outbound = await this.withTimeout(
            this.dependencies.movement.smart({
              owner,
              module: "CombatLiveTest",
              why: "COMBAT_LIVE_E2E_FIND_TARGET",
              correlationId: requestId,
              destination: monsterType,
            }),
            navigationTimeoutMs,
          );
          if (!outbound) {
            result.outcome = "TIMEOUT";
            result.reason = "TARGET_NAVIGATION_TIMEOUT";
            return this.finish(result);
          }

          result.navigation.outboundStatus = actionStatus(outbound);
          result.preparation.selectedMonsterType = monsterType;
          if (outbound.status === "UNKNOWN") {
            result.outcome = "UNKNOWN";
            result.reason = "TARGET_NAVIGATION_UNKNOWN";
            return this.finish(result);
          }
          if (outbound.status === "BLOCKED" || outbound.status === "REJECTED") {
            continue;
          }

          target = await this.waitForTarget(targetTimeoutMs, pollIntervalMs);
          if (target) break;
        }
      }

      if (!target) {
        result.reason = "NO_SAFE_AUTONOMOUS_TARGET";
        return this.finish(result);
      }

      target = await this.ensureTargetInRange(
        target,
        owner,
        requestId,
        navigationTimeoutMs,
        targetTimeoutMs,
        pollIntervalMs,
        result,
      );
      if (!target) {
        if (result.outcome === "UNKNOWN" || result.outcome === "TIMEOUT") {
          return this.finish(result);
        }
        result.reason = "TARGET_NOT_IN_RANGE";
        return this.finish(result);
      }

      const beforeAttack = this.dependencies.combat.status();
      const baselineActionId = beforeAttack.lastAction?.id || null;

      result.combat.targetId = target.id;
      result.combat.targetType = target.mtype;
      result.combat.targetDistance = entityDistance(
        this.dependencies.character(),
        target,
      );
      result.combat.inRangeObserved = true;
      result.combat.resourcesVisible = resourcesVisible(beforeAttack);

      this.dependencies.combat.setConfigOverride(ENABLED_TEST_CONFIG);

      const attackDeadline = this.now() + attackTimeoutMs;
      let attackStatus: CombatControllerStatus | null = null;
      while (this.now() < attackDeadline) {
        const status = await this.dependencies.combat.tick();
        if (status.target?.inRange === true) {
          result.combat.inRangeObserved = true;
          result.combat.targetId = status.target.id;
          result.combat.targetType = status.target.mtype;
          result.combat.targetDistance = status.target.distance;
          result.combat.attackRange = status.target.attackRange;
        }
        result.combat.resourcesVisible ||= resourcesVisible(status);

        if (
          status.lastAction?.kind === "ATTACK" &&
          status.lastAction.id !== baselineActionId
        ) {
          attackStatus = status;
          result.combat.attackActionId = status.lastAction.id;
          result.combat.attackActionStatus = status.lastAction.status;
          break;
        }

        await this.sleep(pollIntervalMs);
      }

      this.dependencies.combat.setConfigOverride(DISABLED_TEST_CONFIG);

      if (!attackStatus || !result.combat.attackActionId) {
        result.reason = "ATTACK_NOT_OBSERVED";
        return this.finish(result);
      }
      if (result.combat.attackActionStatus === "UNKNOWN") {
        result.outcome = "UNKNOWN";
        result.reason = "ATTACK_OUTCOME_UNKNOWN";
        return this.finish(result);
      }
      if (result.combat.attackActionStatus !== "CONFIRMED") {
        result.reason = `ATTACK_${result.combat.attackActionStatus || "UNSET"}`;
        return this.finish(result);
      }

      const cooldownDeadline = this.now() + cooldownTimeoutMs;
      while (this.now() < cooldownDeadline) {
        const status = this.dependencies.combat.status();
        result.combat.resourcesVisible ||= resourcesVisible(status);
        if (status.cooldowns.attackRemainingMs > 0) {
          result.combat.cooldownObserved = true;
          break;
        }
        await this.sleep(pollIntervalMs);
      }

      if (!result.combat.resourcesVisible) {
        result.reason = "RESOURCE_TELEMETRY_UNAVAILABLE";
      } else if (!result.combat.inRangeObserved) {
        result.reason = "IN_RANGE_EVIDENCE_MISSING";
      } else if (!result.combat.cooldownObserved) {
        result.reason = "ATTACK_COOLDOWN_NOT_OBSERVED";
      } else {
        result.outcome = "PASS";
        result.reason = "COMBAT_LIVE_E2E_CONFIRMED";
      }

      return this.finish(result);
    } catch (error) {
      result.outcome = "FAIL";
      result.reason =
        error instanceof Error
          ? `UNEXPECTED:${error.message}`
          : `UNEXPECTED:${String(error)}`;
      return this.finish(result);
    } finally {
      if (overrideActive) {
        this.dependencies.combat.setConfigOverride(DISABLED_TEST_CONFIG);
      }

      try {
        const cancel = await this.cancelMovementIfNeeded(
          owner,
          "COMBAT_LIVE_E2E_CLEANUP",
          requestId,
        );
        result.cleanup.movementCancelStatus = cancel;
        if (cancel === "UNKNOWN" && result.outcome === "PASS") {
          result.outcome = "UNKNOWN";
          result.reason = "CLEANUP_MOVEMENT_CANCEL_UNKNOWN";
        }
      } catch (_error) {
        result.cleanup.movementCancelStatus = "FAILED";
        if (result.outcome === "PASS") {
          result.outcome = "FAIL";
          result.reason = "CLEANUP_MOVEMENT_CANCEL_FAILED";
        }
      }

      if (result.start) {
        await this.returnToStart(
          owner,
          requestId,
          navigationTimeoutMs,
          result,
        );
      }

      if (overrideActive) {
        this.dependencies.combat.clearConfigOverride();
        result.cleanup.combatOverrideCleared = true;
      }
      this.finish(result);
    }
  }

  private safeDestinationCandidates(): string[] {
    const monsters = objectValue(this.dependencies.gameData().monsters);
    return SAFE_MONSTER_TYPES.filter((monsterType) => monsters[monsterType]);
  }

  private selectSafeTarget(): EntitySnapshot | null {
    const character = this.dependencies.character();
    const preferred = new Map(
      SAFE_MONSTER_TYPES.map((monsterType, index) => [monsterType, index]),
    );

    return (
      this.dependencies
        .entities()
        .filter((entity) => {
          if (entity.type !== "monster" || entity.dead || entity.rip) return false;
          if (!entity.mtype || !preferred.has(entity.mtype)) return false;
          if (entity.hp !== null && entity.hp <= 0) return false;
          if (character.map && entity.map && character.map !== entity.map) {
            return false;
          }
          if (
            entity.target &&
            character.name &&
            entity.target !== character.name
          ) {
            return false;
          }
          return entityDistance(character, entity) !== null;
        })
        .sort((left, right) => {
          const typeOrder =
            (preferred.get(left.mtype || "") ?? Number.MAX_SAFE_INTEGER) -
            (preferred.get(right.mtype || "") ?? Number.MAX_SAFE_INTEGER);
          if (typeOrder !== 0) return typeOrder;
          return (
            (entityDistance(character, left) ?? Number.MAX_SAFE_INTEGER) -
            (entityDistance(character, right) ?? Number.MAX_SAFE_INTEGER)
          );
        })[0] || null
    );
  }

  private async ensureTargetInRange(
    initialTarget: EntitySnapshot,
    owner: string,
    requestId: string,
    navigationTimeoutMs: number,
    targetTimeoutMs: number,
    pollIntervalMs: number,
    result: CombatLiveTestResult,
  ): Promise<EntitySnapshot | null> {
    let target: EntitySnapshot | null = initialTarget;

    for (let attempt = 0; attempt < 2 && target; attempt += 1) {
      const character = this.dependencies.character();
      const currentDistance = entityDistance(character, target);
      if (
        character.range !== null &&
        currentDistance !== null &&
        currentDistance <= character.range
      ) {
        return target;
      }
      if (target.x === null || target.y === null) return null;

      const positioned = await this.withTimeout(
        this.dependencies.movement.smart({
          owner,
          module: "CombatLiveTest",
          why: "COMBAT_LIVE_E2E_POSITION_FOR_ATTACK",
          correlationId: requestId,
          destination: {
            ...(target.map && { map: target.map }),
            x: target.x,
            y: target.y,
          },
        }),
        navigationTimeoutMs,
      );

      if (!positioned) {
        result.outcome = "TIMEOUT";
        result.reason = "ATTACK_POSITION_TIMEOUT";
        return null;
      }
      result.navigation.outboundStatus = actionStatus(positioned);
      if (positioned.status === "UNKNOWN") {
        result.outcome = "UNKNOWN";
        result.reason = "ATTACK_POSITION_UNKNOWN";
        return null;
      }
      if (
        positioned.status === "BLOCKED" ||
        positioned.status === "REJECTED"
      ) {
        return null;
      }

      target = await this.waitForInRangeTarget(
        targetTimeoutMs,
        pollIntervalMs,
      );
    }

    return null;
  }

  private async waitForTarget(
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<EntitySnapshot | null> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const target = this.selectSafeTarget();
      if (target) return target;
      await this.sleep(pollIntervalMs);
    }
    return null;
  }

  private async waitForInRangeTarget(
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<EntitySnapshot | null> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const target = this.selectSafeTarget();
      const character = this.dependencies.character();
      const currentDistance = target
        ? entityDistance(character, target)
        : null;
      if (
        target &&
        character.range !== null &&
        currentDistance !== null &&
        currentDistance <= character.range
      ) {
        return target;
      }
      await this.sleep(pollIntervalMs);
    }
    return null;
  }

  private async waitForAlive(
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<boolean> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      if (!this.dependencies.character().rip) return true;
      await this.sleep(pollIntervalMs);
    }
    return false;
  }

  private async cancelMovementIfNeeded(
    owner: string,
    why: string,
    correlationId: string,
  ): Promise<string | null> {
    const status = this.dependencies.movement.status();
    if (completedMovement(status)) return null;

    const cancelled = await this.dependencies.movement.cancel({
      owner,
      module: "CombatLiveTest",
      why,
      correlationId,
      force: true,
    });
    return actionStatus(cancelled);
  }

  private async returnToStart(
    owner: string,
    requestId: string,
    timeoutMs: number,
    result: CombatLiveTestResult,
  ): Promise<void> {
    if (!result.start) return;
    const current = this.dependencies.character();
    if (current.rip || !finitePosition(current)) return;

    const currentDistance =
      current.map === result.start.map
        ? Math.hypot(current.x - result.start.x, current.y - result.start.y)
        : Number.POSITIVE_INFINITY;
    if (currentDistance <= 20) {
      result.navigation.finalDistanceToStart = currentDistance;
      result.navigation.returnedToStart = true;
      return;
    }

    const returned = await this.withTimeout(
      this.dependencies.movement.smart({
        owner,
        module: "CombatLiveTest",
        why: "COMBAT_LIVE_E2E_RETURN",
        correlationId: requestId,
        destination: {
          map: result.start.map,
          x: result.start.x,
          y: result.start.y,
        },
      }),
      timeoutMs,
    );

    if (!returned) {
      result.navigation.returnStatus = "TIMEOUT";
      if (result.outcome === "PASS") {
        result.outcome = "TIMEOUT";
        result.reason = "RETURN_TIMEOUT";
      }
      return;
    }

    result.navigation.returnStatus = actionStatus(returned);
    if (returned.status === "UNKNOWN") {
      if (result.outcome === "PASS") {
        result.outcome = "UNKNOWN";
        result.reason = "RETURN_UNKNOWN";
      }
      return;
    }
    if (returned.status !== "CONFIRMED") {
      if (result.outcome === "PASS") {
        result.outcome = "FAIL";
        result.reason = `RETURN_${returned.status || "UNSET"}`;
      }
      return;
    }

    const finalCharacter = this.dependencies.character();
    if (!finitePosition(finalCharacter)) return;
    result.navigation.finalDistanceToStart =
      finalCharacter.map === result.start.map
        ? Math.hypot(
            finalCharacter.x - result.start.x,
            finalCharacter.y - result.start.y,
          )
        : null;
    result.navigation.returnedToStart =
      result.navigation.finalDistanceToStart !== null &&
      result.navigation.finalDistanceToStart <= 20;

    if (!result.navigation.returnedToStart && result.outcome === "PASS") {
      result.outcome = "FAIL";
      result.reason = "RETURN_POSITION_NOT_CONFIRMED";
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private finish(result: CombatLiveTestResult): CombatLiveTestResult {
    result.completedAt = this.now();
    result.durationMs = Math.max(0, result.completedAt - result.startedAt);
    return result;
  }
}

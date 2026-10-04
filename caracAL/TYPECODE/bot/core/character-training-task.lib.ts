import type { ActionRecord } from "./action-ledger.lib";
import type { CombatController } from "./combat-controller.lib";
import type { CharacterSnapshot } from "./game-adapter.lib";
import type { MovementController } from "./movement-controller.lib";

export interface CharacterTrainingTaskOptions {
  requestId?: string;
  targetLevel: number;
  monsterType: string;
  timeoutMs?: number;
  pollMs?: number;
}

export interface CharacterTrainingTaskResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  monsterType: string;
  targetLevel: number;
  progress: {
    startLevel: number | null;
    startXp: number | null;
    finalLevel: number | null;
    finalXp: number | null;
    targetReached: boolean;
    levelIncreased: boolean;
    xpIncreased: boolean;
  };
  evidence: {
    schedulerDrivenCombat: true;
    combatStatusObserved: boolean;
    targetMonsterObserved: boolean;
    navigationStatus: string | null;
    blindRetryUsed: false;
  };
  cleanup: {
    combatOverrideCleared: boolean;
  };
}

interface TrainingGame {
  character(): CharacterSnapshot;
}

interface CharacterTrainingDependencies {
  game: TrainingGame;
  combat: Pick<
    CombatController,
    "status" | "setConfigOverride" | "clearConfigOverride"
  >;
  movement: Pick<MovementController, "smart">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MODULE = "CharacterTrainingTask";
const OWNER = "CHARACTER_TRAINING_TASK";
const DEFAULT_TIMEOUT_MS = 90 * 1000;
const DEFAULT_POLL_MS = 150;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trainingCombatOverride(monsterType: string): Record<string, unknown> {
  return {
    combat: {
      enabled: true,
      autoTarget: true,
      avoidKillSteal: true,
      targetMaxDistance: 1500,
      targetMonsterTypes: [monsterType],
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

export class CharacterTrainingTaskRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: CharacterTrainingDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: CharacterTrainingTaskOptions,
  ): Promise<CharacterTrainingTaskResult> {
    const startedAt = this.now();
    const requestId =
      options.requestId || `character-training-${startedAt}`;
    const targetLevel = positiveInteger(options.targetLevel);
    const monsterType = options.monsterType?.trim() || "";
    const timeoutMs = Math.max(
      10000,
      Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS,
    );
    const pollMs = Math.max(50, Number(options.pollMs) || DEFAULT_POLL_MS);
    const initial = this.deps.game.character();
    const startLevel = finite(initial.level);
    const startXp = finite(initial.xp);

    let outcome: CharacterTrainingTaskResult["outcome"] = "FAIL";
    let reason = "CHARACTER_TRAINING_NOT_COMPLETED";
    let combatStatusObserved = false;
    let targetMonsterObserved = false;
    let navigationStatus: string | null = null;
    let combatOverrideCleared = true;

    const finish = (): CharacterTrainingTaskResult => {
      const completedAt = this.now();
      const finalCharacter = this.deps.game.character();
      const finalLevel = finite(finalCharacter.level);
      const finalXp = finite(finalCharacter.xp);
      return {
        requestId,
        outcome,
        reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        character: initial.name,
        monsterType,
        targetLevel: targetLevel || 0,
        progress: {
          startLevel,
          startXp,
          finalLevel,
          finalXp,
          targetReached:
            targetLevel !== null &&
            finalLevel !== null &&
            finalLevel >= targetLevel,
          levelIncreased:
            startLevel !== null &&
            finalLevel !== null &&
            finalLevel > startLevel,
          xpIncreased:
            startLevel !== null &&
            finalLevel !== null &&
            startXp !== null &&
            finalXp !== null &&
            finalLevel === startLevel &&
            finalXp > startXp,
        },
        evidence: {
          schedulerDrivenCombat: true,
          combatStatusObserved,
          targetMonsterObserved,
          navigationStatus,
          blindRetryUsed: false,
        },
        cleanup: {
          combatOverrideCleared,
        },
      };
    };

    if (
      !targetLevel ||
      !monsterType ||
      !initial.name ||
      startLevel === null ||
      startXp === null
    ) {
      reason = "CHARACTER_TRAINING_REQUEST_INVALID";
      return finish();
    }

    if (startLevel >= targetLevel) {
      outcome = "PASS";
      reason = "CHARACTER_TRAINING_TARGET_ALREADY_REACHED";
      return finish();
    }

    this.deps.combat.setConfigOverride(trainingCombatOverride(monsterType));
    combatOverrideCleared = false;

    try {
      const movement: ActionRecord = await this.deps.movement.smart({
        owner: OWNER,
        module: MODULE,
        why: "CHARACTER_TRAINING_FIND_MONSTER",
        correlationId: requestId,
        destination: monsterType,
      });
      navigationStatus = movement.status || null;
      if (movement.status === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "CHARACTER_TRAINING_NAVIGATION_UNKNOWN";
        return finish();
      }
      if (movement.status !== "CONFIRMED") {
        reason = `CHARACTER_TRAINING_NAVIGATION_${movement.status || "FAILED"}`;
        return finish();
      }

      while (this.now() - startedAt < timeoutMs) {
        const character = this.deps.game.character();
        const level = finite(character.level);
        const xp = finite(character.xp);
        const combat = this.deps.combat.status();
        combatStatusObserved = true;
        if (combat.target?.mtype === monsterType) {
          targetMonsterObserved = true;
        }

        if (
          combat.reason === "ATTACK_OUTCOME_UNKNOWN" ||
          combat.reason === "POTION_OUTCOME_UNKNOWN"
        ) {
          outcome = "UNKNOWN";
          reason = `CHARACTER_TRAINING_${combat.reason}`;
          return finish();
        }

        if (character.rip) {
          reason = "CHARACTER_TRAINING_WORKER_DEAD";
          return finish();
        }

        if (level !== null && level >= targetLevel) {
          outcome = "PASS";
          reason = "CHARACTER_TRAINING_TARGET_LEVEL_REACHED";
          return finish();
        }

        if (
          level !== null &&
          xp !== null &&
          (level > startLevel ||
            (level === startLevel && xp > startXp))
        ) {
          outcome = "PASS";
          reason = "CHARACTER_TRAINING_PROGRESS_CONFIRMED";
          return finish();
        }

        await this.sleep(pollMs);
      }

      outcome = "TIMEOUT";
      reason = "CHARACTER_TRAINING_PROGRESS_TIMEOUT";
      return finish();
    } finally {
      this.deps.combat.clearConfigOverride();
      combatOverrideCleared = true;
    }
  }
}

export { trainingCombatOverride };

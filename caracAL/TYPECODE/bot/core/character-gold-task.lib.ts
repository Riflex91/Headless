import type { ActionRecord } from "./action-ledger.lib";
import type { CombatController } from "./combat-controller.lib";
import type { CharacterSnapshot } from "./game-adapter.lib";
import type { MovementController } from "./movement-controller.lib";
import { trainingCombatOverride } from "./character-training-task.lib";

export interface CharacterGoldTaskOptions {
  requestId?: string;
  goalAmount: number;
  scope: "ACCOUNT" | "CHARACTER";
  monsterType: string;
  timeoutMs?: number;
  pollMs?: number;
}

export interface CharacterGoldTaskResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  monsterType: string;
  goalAmount: number;
  scope: "ACCOUNT" | "CHARACTER";
  progress: {
    startGold: number | null;
    finalGold: number | null;
    targetReached: boolean;
    goldIncreased: boolean;
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

interface GoldGame {
  character(): CharacterSnapshot;
}

interface CharacterGoldDependencies {
  game: GoldGame;
  combat: Pick<
    CombatController,
    "status" | "setConfigOverride" | "clearConfigOverride"
  >;
  movement: Pick<MovementController, "smart">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MODULE = "CharacterGoldTask";
const OWNER = "CHARACTER_GOLD_TASK";
const DEFAULT_TIMEOUT_MS = 90 * 1000;
const DEFAULT_POLL_MS = 150;

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class CharacterGoldTaskRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: CharacterGoldDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(options: CharacterGoldTaskOptions): Promise<CharacterGoldTaskResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `character-gold-${startedAt}`;
    const goalAmount = positiveInteger(options.goalAmount);
    const scope =
      options.scope === "CHARACTER"
        ? "CHARACTER"
        : options.scope === "ACCOUNT"
          ? "ACCOUNT"
          : null;
    const monsterType = options.monsterType?.trim() || "";
    const timeoutMs = Math.max(
      10000,
      Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS,
    );
    const pollMs = Math.max(50, Number(options.pollMs) || DEFAULT_POLL_MS);
    const initial = this.deps.game.character();
    const startGold = finite(initial.gold);

    let outcome: CharacterGoldTaskResult["outcome"] = "FAIL";
    let reason = "CHARACTER_GOLD_NOT_COMPLETED";
    let combatStatusObserved = false;
    let targetMonsterObserved = false;
    let navigationStatus: string | null = null;
    let combatOverrideCleared = true;

    const finish = (): CharacterGoldTaskResult => {
      const completedAt = this.now();
      const finalCharacter = this.deps.game.character();
      const finalGold = finite(finalCharacter.gold);
      return {
        requestId,
        outcome,
        reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        character: initial.name,
        monsterType,
        goalAmount: goalAmount || 0,
        scope: scope || "ACCOUNT",
        progress: {
          startGold,
          finalGold,
          targetReached:
            scope === "CHARACTER" &&
            goalAmount !== null &&
            finalGold !== null &&
            finalGold >= goalAmount,
          goldIncreased:
            startGold !== null &&
            finalGold !== null &&
            finalGold > startGold,
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

    const cleanup = (): void => {
      if (!combatOverrideCleared) {
        this.deps.combat.clearConfigOverride();
        combatOverrideCleared = true;
      }
    };
    const finishClean = (): CharacterGoldTaskResult => {
      cleanup();
      return finish();
    };

    if (
      !goalAmount ||
      !scope ||
      !monsterType ||
      !initial.name ||
      startGold === null
    ) {
      reason = "CHARACTER_GOLD_REQUEST_INVALID";
      return finish();
    }

    if (scope === "CHARACTER" && startGold >= goalAmount) {
      outcome = "PASS";
      reason = "CHARACTER_GOLD_TARGET_ALREADY_REACHED";
      return finish();
    }

    this.deps.combat.setConfigOverride(trainingCombatOverride(monsterType));
    combatOverrideCleared = false;

    try {
      const movement: ActionRecord = await this.deps.movement.smart({
        owner: OWNER,
        module: MODULE,
        why: "CHARACTER_GOLD_FIND_MONSTER",
        correlationId: requestId,
        destination: monsterType,
      });
      navigationStatus = movement.status || null;
      if (movement.status === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "CHARACTER_GOLD_NAVIGATION_UNKNOWN";
        return finishClean();
      }
      if (movement.status !== "CONFIRMED") {
        reason = `CHARACTER_GOLD_NAVIGATION_${movement.status || "FAILED"}`;
        return finishClean();
      }

      while (this.now() - startedAt < timeoutMs) {
        const character = this.deps.game.character();
        const gold = finite(character.gold);
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
          reason = `CHARACTER_GOLD_${combat.reason}`;
          return finishClean();
        }

        if (character.rip) {
          reason = "CHARACTER_GOLD_WORKER_DEAD";
          return finishClean();
        }

        if (scope === "CHARACTER" && gold !== null && gold >= goalAmount) {
          outcome = "PASS";
          reason = "CHARACTER_GOLD_TARGET_REACHED";
          return finishClean();
        }

        if (gold !== null && gold > startGold) {
          outcome = "PASS";
          reason = "CHARACTER_GOLD_PROGRESS_CONFIRMED";
          return finishClean();
        }

        await this.sleep(pollMs);
      }

      outcome = "TIMEOUT";
      reason = "CHARACTER_GOLD_PROGRESS_TIMEOUT";
      return finishClean();
    } finally {
      cleanup();
    }
  }
}

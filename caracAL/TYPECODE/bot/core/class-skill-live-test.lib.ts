import type {
  CharacterSnapshot,
  CooldownSnapshot,
  SkillSnapshot,
} from "./game-adapter.lib";
import type {
  ClassSkillController,
  ClassSkillControllerStatus,
} from "./class-skill-controller.lib";
import type { CombatController } from "./combat-controller.lib";

const SAFE_CLASS = "ranger";
const SAFE_SKILL = "track";

const DISABLED_COMBAT_CONFIG = {
  combat: { enabled: false },
  potionUsage: { enabled: false },
  safety: { autoRespawn: false },
};

const DISABLED_CLASS_SKILL_CONFIG = {
  classSkills: {
    ranger: {
      enabled: false,
      skills: {},
    },
  },
};

const ENABLED_CLASS_SKILL_CONFIG = {
  classSkills: {
    ranger: {
      enabled: true,
      skills: {
        track: {
          enabled: true,
          priority: 1000,
        },
      },
    },
  },
};

export type ClassSkillLiveTestOutcome =
  | "PASS"
  | "FAIL"
  | "UNKNOWN"
  | "TIMEOUT";

export interface ClassSkillLiveTestOptions {
  requestId?: string;
  readyTimeoutMs?: number;
  actionTimeoutMs?: number;
  evidenceTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ClassSkillLiveTestResult {
  requestId: string;
  outcome: ClassSkillLiveTestOutcome;
  reason: string;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  character: string | null;
  start: {
    ctype: string | null;
    map: string | null;
    x: number | null;
    y: number | null;
    hp: number | null;
    maxHp: number | null;
    mp: number | null;
    maxMp: number | null;
  };
  preparation: {
    respawnedAtStart: boolean;
    selectedSkill: string | null;
    skillMp: number | null;
    initialCooldownMs: number | null;
  };
  classSkill: {
    module: string | null;
    selectedSkill: string | null;
    actionId: string | null;
    actionStatus: string | null;
    cooldownObserved: boolean;
    mpCostObserved: boolean;
    resourceTelemetryVisible: boolean;
    projectionVisible: boolean;
  };
  scope: {
    testedClass: "ranger";
    safeSkill: "track";
    consumableMutationForced: false;
    combatMutationForced: false;
    targetMutationForced: false;
    respawnObservedOnlyWhenInitiallyDead: true;
  };
  cleanup: {
    classSkillOverrideCleared: boolean;
    combatOverrideCleared: boolean;
  };
}

interface ClassSkillLiveTestDependencies {
  classSkills: Pick<
    ClassSkillController,
    "setConfigOverride" | "clearConfigOverride" | "status" | "tick"
  >;
  combat: Pick<
    CombatController,
    "setConfigOverride" | "clearConfigOverride" | "tick"
  >;
  character(): CharacterSnapshot;
  skills(): SkillSnapshot[];
  cooldowns(): CooldownSnapshot[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cooldownRemaining(
  cooldowns: CooldownSnapshot[],
  skill: string,
): number {
  return cooldowns.find((entry) => entry.skill === skill)?.remainingMs || 0;
}

function resourceTelemetryVisible(character: CharacterSnapshot): boolean {
  return (
    Number.isFinite(character.mp) &&
    Number.isFinite(character.maxMp) &&
    Number.isFinite(character.hp) &&
    Number.isFinite(character.maxHp)
  );
}

export class ClassSkillLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ClassSkillLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep = deps.sleep || defaultSleep;
  }

  async run(
    options: ClassSkillLiveTestOptions = {},
  ): Promise<ClassSkillLiveTestResult> {
    const requestId =
      options.requestId || `class-skill-live-${this.now()}`;
    const readyTimeoutMs = Math.max(1000, options.readyTimeoutMs || 15000);
    const actionTimeoutMs = Math.max(1000, options.actionTimeoutMs || 5000);
    const evidenceTimeoutMs = Math.max(
      500,
      options.evidenceTimeoutMs || 3500,
    );
    const pollIntervalMs = Math.max(25, options.pollIntervalMs || 50);
    const startedAt = this.now();
    const first = this.deps.character();

    const result: ClassSkillLiveTestResult = {
      requestId,
      outcome: "FAIL",
      reason: "CLASS_SKILL_LIVE_E2E_NOT_COMPLETED",
      startedAt,
      completedAt: null,
      durationMs: null,
      character: first.name,
      start: {
        ctype: first.ctype,
        map: first.map,
        x: first.x,
        y: first.y,
        hp: first.hp,
        maxHp: first.maxHp,
        mp: first.mp,
        maxMp: first.maxMp,
      },
      preparation: {
        respawnedAtStart: false,
        selectedSkill: null,
        skillMp: null,
        initialCooldownMs: null,
      },
      classSkill: {
        module: null,
        selectedSkill: null,
        actionId: null,
        actionStatus: null,
        cooldownObserved: false,
        mpCostObserved: false,
        resourceTelemetryVisible: resourceTelemetryVisible(first),
        projectionVisible: false,
      },
      scope: {
        testedClass: SAFE_CLASS,
        safeSkill: SAFE_SKILL,
        consumableMutationForced: false,
        combatMutationForced: false,
        targetMutationForced: false,
        respawnObservedOnlyWhenInitiallyDead: true,
      },
      cleanup: {
        classSkillOverrideCleared: false,
        combatOverrideCleared: false,
      },
    };

    this.deps.classSkills.setConfigOverride(DISABLED_CLASS_SKILL_CONFIG);
    this.deps.combat.setConfigOverride(DISABLED_COMBAT_CONFIG);

    try {
      if (first.rip) {
        this.deps.combat.setConfigOverride({
          combat: { enabled: false },
          potionUsage: { enabled: false },
          safety: { autoRespawn: true, respawnRetryMs: 1000 },
        });
        await this.deps.combat.tick();

        const alive = await this.waitFor(
          () => !this.deps.character().rip,
          readyTimeoutMs,
          pollIntervalMs,
        );
        if (!alive) {
          result.outcome = "TIMEOUT";
          result.reason = "CLASS_SKILL_RESPAWN_TIMEOUT";
          return result;
        }

        result.preparation.respawnedAtStart = true;
        this.deps.combat.setConfigOverride(DISABLED_COMBAT_CONFIG);
      }

      const character = this.deps.character();
      if (character.ctype !== SAFE_CLASS) {
        result.reason = "CLASS_SKILL_LIVE_E2E_REQUIRES_RANGER";
        return result;
      }

      const skill = this.deps
        .skills()
        .find((candidate) => candidate.key === SAFE_SKILL);
      if (!skill || skill.passive || !skill.classes.includes(SAFE_CLASS)) {
        result.reason = "SAFE_RANGER_SKILL_UNAVAILABLE";
        return result;
      }

      result.preparation.selectedSkill = skill.key;
      result.preparation.skillMp = skill.mp;
      result.preparation.initialCooldownMs = cooldownRemaining(
        this.deps.cooldowns(),
        SAFE_SKILL,
      );

      const ready = await this.waitFor(
        () => {
          const current = this.deps.character();
          const mpReady =
            skill.mp === null || current.mp === null || current.mp >= skill.mp;
          const cooldownReady =
            cooldownRemaining(this.deps.cooldowns(), SAFE_SKILL) <= 0;
          return mpReady && cooldownReady && !current.rip;
        },
        readyTimeoutMs,
        pollIntervalMs,
      );

      if (!ready) {
        result.outcome = "TIMEOUT";
        result.reason = "CLASS_SKILL_READY_TIMEOUT";
        return result;
      }

      const baseline = this.deps.classSkills.status().lastAction?.id || null;
      const beforeAction = this.deps.character();
      this.deps.classSkills.setConfigOverride(ENABLED_CLASS_SKILL_CONFIG);

      let status: ClassSkillControllerStatus | null = null;
      const actionSeen = await this.waitFor(
        async () => {
          status = await this.deps.classSkills.tick();
          const action = status.lastAction;
          return (
            !!action && action.id !== baseline && action.skill === SAFE_SKILL
          );
        },
        actionTimeoutMs,
        pollIntervalMs,
      );

      this.deps.classSkills.setConfigOverride(DISABLED_CLASS_SKILL_CONFIG);

      if (!actionSeen || !status?.lastAction) {
        result.outcome = "TIMEOUT";
        result.reason = "CLASS_SKILL_ACTION_TIMEOUT";
        return result;
      }

      result.classSkill.module = status.module;
      result.classSkill.selectedSkill = SAFE_SKILL;
      result.classSkill.actionId = status.lastAction.id;
      result.classSkill.actionStatus = status.lastAction.status;
      result.classSkill.projectionVisible =
        status.className === SAFE_CLASS &&
        status.module === "RangerSkillController";

      if (status.lastAction.status === "UNKNOWN") {
        result.outcome = "UNKNOWN";
        result.reason = "CLASS_SKILL_OUTCOME_UNKNOWN";
        return result;
      }
      if (status.lastAction.status !== "CONFIRMED") {
        result.reason = `CLASS_SKILL_ACTION_${
          status.lastAction.status || "UNRESOLVED"
        }`;
        return result;
      }

      const evidenceSeen = await this.waitFor(
        () => {
          const current = this.deps.character();
          result.classSkill.cooldownObserved =
            cooldownRemaining(this.deps.cooldowns(), SAFE_SKILL) > 0;
          result.classSkill.mpCostObserved =
            beforeAction.mp !== null &&
            current.mp !== null &&
            current.mp < beforeAction.mp;
          result.classSkill.resourceTelemetryVisible =
            resourceTelemetryVisible(current);
          return (
            result.classSkill.cooldownObserved &&
            result.classSkill.mpCostObserved &&
            result.classSkill.resourceTelemetryVisible
          );
        },
        evidenceTimeoutMs,
        pollIntervalMs,
      );

      if (!evidenceSeen) {
        result.reason = !result.classSkill.cooldownObserved
          ? "CLASS_SKILL_COOLDOWN_NOT_OBSERVED"
          : !result.classSkill.mpCostObserved
            ? "CLASS_SKILL_MP_COST_NOT_OBSERVED"
            : "CLASS_SKILL_RESOURCE_TELEMETRY_MISSING";
        return result;
      }

      result.outcome = "PASS";
      result.reason = "CLASS_SKILL_LIVE_E2E_CONFIRMED";
      return result;
    } finally {
      this.deps.classSkills.setConfigOverride(DISABLED_CLASS_SKILL_CONFIG);
      this.deps.combat.setConfigOverride(DISABLED_COMBAT_CONFIG);
      this.deps.classSkills.clearConfigOverride();
      result.cleanup.classSkillOverrideCleared = true;
      this.deps.combat.clearConfigOverride();
      result.cleanup.combatOverrideCleared = true;
      result.completedAt = this.now();
      result.durationMs = Math.max(0, result.completedAt - startedAt);
    }
  }

  private async waitFor(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<boolean> {
    const startedAt = this.now();
    while (this.now() - startedAt <= timeoutMs) {
      if (await predicate()) return true;
      await this.sleep(pollIntervalMs);
    }
    return false;
  }
}

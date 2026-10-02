import type { ActionRecord } from "./action-ledger.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type {
  CharacterSnapshot,
  CooldownSnapshot,
  EntitySnapshot,
  SkillSnapshot,
} from "./game-adapter.lib";

export type ClassSkillState =
  | "DISABLED"
  | "IDLE"
  | "COOLDOWN"
  | "USING"
  | "BLOCKED"
  | "UNSUPPORTED_CLASS";

export type SkillTargetMode = "NONE" | "CURRENT";
export type SkillRangeMode =
  | "NONE"
  | "SKILL"
  | "ATTACK"
  | "TRIPLE_ATTACK_PLUS_20"
  | "ATTACK_1_2_PLUS_32";

export interface ClassSkillPolicy {
  skill: string;
  targetMode: SkillTargetMode;
  rangeMode?: SkillRangeMode;
  sharedCooldown?: string;
}

export interface ClassSkillControllerStatus {
  timestamp: number;
  className: string;
  module: string;
  enabled: boolean;
  state: ClassSkillState;
  reason: string;
  configuredSkills: string[];
  selectedSkill: string | null;
  targetId: string | null;
  lastAction: {
    id: string;
    status: string | null;
    skill: string;
  } | null;
  unknownSkill: {
    skill: string;
    targetId: string | null;
  } | null;
}

export interface ClassSkillControllerEvent {
  type: "CLASS_SKILL_STATE_CHANGED" | "CLASS_SKILL_ACTION";
  timestamp: number;
  module: string;
  className: string;
  state: ClassSkillState;
  reason: string;
  skill?: string | null;
  targetId?: string | null;
  actionId?: string;
  actionStatus?: string | null;
  status: ClassSkillControllerStatus;
}

interface SkillGameAdapter {
  character(): CharacterSnapshot;
  entity(id: string): EntitySnapshot | null;
  skills(characterOnly?: boolean): SkillSnapshot[];
  cooldowns(): CooldownSnapshot[];
}

interface CombatTargetView {
  status(): {
    target: { id: string } | null;
  };
}

export interface ClassSkillControllerOptions {
  config?: () => unknown;
  now?: () => number;
  onEvent?: (event: ClassSkillControllerEvent) => void;
}

interface SkillConfig {
  enabled: boolean;
  priority: number;
}

interface NormalizedConfig {
  enabled: boolean;
  skills: Map<string, SkillConfig>;
}

interface UnknownSkill {
  skill: string;
  targetId: string | null;
  mp: number | null;
  targetHp: number | null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cooldown(cooldowns: CooldownSnapshot[], skill: string): number {
  return cooldowns.find((entry) => entry.skill === skill)?.remainingMs || 0;
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

function rangeFor(
  policy: ClassSkillPolicy,
  skill: SkillSnapshot,
  character: CharacterSnapshot,
): number | null {
  switch (policy.rangeMode || "NONE") {
    case "NONE":
      return null;
    case "SKILL":
      return skill.range ?? character.range;
    case "ATTACK":
      return character.range;
    case "TRIPLE_ATTACK_PLUS_20":
      return character.range === null ? null : character.range * 3 + 20;
    case "ATTACK_1_2_PLUS_32":
      return character.range === null ? null : character.range * 1.2 + 32;
  }
}

function normalizeConfig(
  value: unknown,
  className: string,
  policies: ClassSkillPolicy[],
): NormalizedConfig {
  const root = objectValue(value);
  const classSkills = objectValue(root.classSkills ?? root.class_skills);
  const classConfig = objectValue(classSkills[className]);
  const rawSkills = objectValue(classConfig.skills);
  const skills = new Map<string, SkillConfig>();

  for (const policy of policies) {
    const raw = rawSkills[policy.skill];
    if (raw === true) {
      skills.set(policy.skill, { enabled: true, priority: 0 });
      continue;
    }
    const entry = objectValue(raw);
    skills.set(policy.skill, {
      enabled: entry.enabled === true,
      priority: finite(entry.priority, 0),
    });
  }

  return {
    enabled: classConfig.enabled === true,
    skills,
  };
}

export class ClassSkillController {
  private readonly configSource: () => unknown;
  private readonly now: () => number;
  private readonly onEvent?: (event: ClassSkillControllerEvent) => void;
  private configOverride: unknown | undefined;
  private currentState: ClassSkillState = "DISABLED";
  private currentReason = "CLASS_SKILLS_DISABLED";
  private selectedSkill: string | null = null;
  private targetId: string | null = null;
  private lastAction: ClassSkillControllerStatus["lastAction"] = null;
  private lastStatusTimestamp = 0;
  private unknownSkill: UnknownSkill | null = null;
  private busy = false;
  private readonly blockedUntil = new Map<string, number>();

  constructor(
    readonly className: string,
    readonly module: string,
    readonly policies: ClassSkillPolicy[],
    private readonly game: SkillGameAdapter,
    private readonly actions: ActionBoundary,
    private readonly combat: CombatTargetView,
    options: ClassSkillControllerOptions = {},
  ) {
    this.configSource = options.config || (() => ({}));
    this.now = options.now || (() => Date.now());
    this.onEvent = options.onEvent;
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  private effectiveConfig(): unknown {
    return this.configOverride === undefined
      ? this.configSource()
      : this.configOverride;
  }

  status(): ClassSkillControllerStatus {
    const config = normalizeConfig(
      this.effectiveConfig(),
      this.className,
      this.policies,
    );
    return {
      timestamp: this.lastStatusTimestamp || this.now(),
      className: this.className,
      module: this.module,
      enabled: config.enabled,
      state: this.currentState,
      reason: this.currentReason,
      configuredSkills: this.configuredSkills(config),
      selectedSkill: this.selectedSkill,
      targetId: this.targetId,
      lastAction: this.lastAction ? { ...this.lastAction } : null,
      unknownSkill: this.unknownSkill
        ? {
            skill: this.unknownSkill.skill,
            targetId: this.unknownSkill.targetId,
          }
        : null,
    };
  }

  async tick(): Promise<ClassSkillControllerStatus> {
    if (this.busy) return this.status();
    this.busy = true;

    try {
      const character = this.game.character();
      if (character.ctype !== this.className) {
        this.selectedSkill = null;
        this.targetId = null;
        this.setState("UNSUPPORTED_CLASS", "CHARACTER_CLASS_MISMATCH");
        return this.status();
      }

      const config = normalizeConfig(
        this.effectiveConfig(),
        this.className,
        this.policies,
      );
      if (!config.enabled) {
        this.selectedSkill = null;
        this.targetId = null;
        this.setState("DISABLED", "CLASS_SKILLS_DISABLED");
        return this.status();
      }

      if (this.unknownSkill) {
        const target = this.unknownSkill.targetId
          ? this.game.entity(this.unknownSkill.targetId)
          : null;
        const observed =
          cooldown(this.game.cooldowns(), this.unknownSkill.skill) > 0 ||
          (character.mp !== null &&
            this.unknownSkill.mp !== null &&
            character.mp < this.unknownSkill.mp) ||
          (!!this.unknownSkill.targetId &&
            (!target ||
              target.dead ||
              target.rip ||
              (target.hp !== null &&
                this.unknownSkill.targetHp !== null &&
                target.hp < this.unknownSkill.targetHp)));

        if (!observed) {
          this.selectedSkill = this.unknownSkill.skill;
          this.targetId = this.unknownSkill.targetId;
          this.setState("BLOCKED", "SKILL_OUTCOME_UNKNOWN");
          return this.status();
        }
        this.unknownSkill = null;
      }

      const configured = this.policies
        .map((policy, index) => ({
          policy,
          index,
          config: config.skills.get(policy.skill) || {
            enabled: false,
            priority: 0,
          },
        }))
        .filter((entry) => entry.config.enabled)
        .sort(
          (a, b) =>
            b.config.priority - a.config.priority || a.index - b.index,
        );

      if (configured.length === 0) {
        this.selectedSkill = null;
        this.targetId = null;
        this.setState("IDLE", "NO_CLASS_SKILLS_ENABLED");
        return this.status();
      }

      const skills = this.game.skills(false);
      const cooldowns = this.game.cooldowns();
      let lastReason = "NO_CLASS_SKILL_READY";

      for (const entry of configured) {
        const policy = entry.policy;
        const skill = skills.find((candidate) => candidate.key === policy.skill);
        if (
          !skill ||
          skill.passive ||
          !skill.classes.includes(this.className)
        ) {
          lastReason = "SKILL_NOT_AVAILABLE_FOR_CLASS";
          continue;
        }
        if ((this.blockedUntil.get(policy.skill) || 0) > this.now()) {
          lastReason = "SKILL_RETRY_BACKOFF";
          continue;
        }

        const cooldownSkill = policy.sharedCooldown || policy.skill;
        if (
          cooldown(cooldowns, policy.skill) > 0 ||
          cooldown(cooldowns, cooldownSkill) > 0
        ) {
          lastReason = "SKILL_COOLDOWN";
          continue;
        }
        if (
          character.mp !== null &&
          skill.mp !== null &&
          character.mp < skill.mp
        ) {
          lastReason = "SKILL_MP_INSUFFICIENT";
          continue;
        }

        let target: EntitySnapshot | null = null;
        if (policy.targetMode === "CURRENT") {
          const candidateId =
            this.combat.status().target?.id || character.target || null;
          target = candidateId ? this.game.entity(candidateId) : null;
          if (!target || target.type !== "monster" || target.dead || target.rip) {
            lastReason = "SKILL_TARGET_REQUIRED";
            continue;
          }

          const maximumRange = rangeFor(policy, skill, character);
          const targetDistance = distance(character, target);
          if (
            maximumRange !== null &&
            targetDistance !== null &&
            targetDistance > maximumRange
          ) {
            lastReason = "SKILL_TARGET_OUT_OF_RANGE";
            continue;
          }
        }

        this.selectedSkill = policy.skill;
        this.targetId = target?.id || null;
        const action = await this.actions.useSkill({
          skill: policy.skill,
          ...(target && { targetId: target.id }),
          module: this.module,
          why: "CONFIGURED_CLASS_SKILL_READY",
        });
        this.recordAction(policy.skill, action);

        if (action.status === "UNKNOWN") {
          this.unknownSkill = {
            skill: policy.skill,
            targetId: target?.id || null,
            mp: character.mp,
            targetHp: target?.hp || null,
          };
          this.setState("BLOCKED", "SKILL_OUTCOME_UNKNOWN");
          return this.status();
        }

        if (action.status === "BLOCKED" || action.status === "REJECTED") {
          this.blockedUntil.set(policy.skill, this.now() + 1000);
          this.setState(
            "BLOCKED",
            action.status === "BLOCKED"
              ? "SKILL_ACTION_BLOCKED"
              : "SKILL_ACTION_REJECTED",
          );
          return this.status();
        }

        this.setState("USING", "CLASS_SKILL_DISPATCHED");
        return this.status();
      }

      this.selectedSkill = null;
      this.targetId = null;
      this.setState(
        lastReason === "SKILL_COOLDOWN" ? "COOLDOWN" : "IDLE",
        lastReason,
      );
      return this.status();
    } finally {
      this.busy = false;
    }
  }

  private configuredSkills(config: NormalizedConfig): string[] {
    return this.policies
      .filter((policy) => config.skills.get(policy.skill)?.enabled === true)
      .map((policy) => policy.skill);
  }

  private recordAction(skill: string, action: ActionRecord): void {
    this.lastAction = {
      id: action.id,
      status: action.status,
      skill,
    };
    this.emit("CLASS_SKILL_ACTION", "CLASS_SKILL_ACTION", skill, action);
  }

  private setState(state: ClassSkillState, reason: string): void {
    const changed = this.currentState !== state || this.currentReason !== reason;
    this.currentState = state;
    this.currentReason = reason;
    this.lastStatusTimestamp = this.now();
    if (changed) {
      this.emit("CLASS_SKILL_STATE_CHANGED", reason, this.selectedSkill);
    }
  }

  private emit(
    type: ClassSkillControllerEvent["type"],
    reason: string,
    skill: string | null = null,
    action?: ActionRecord,
  ): void {
    this.onEvent?.({
      type,
      timestamp: this.now(),
      module: this.module,
      className: this.className,
      state: this.currentState,
      reason,
      skill,
      targetId: this.targetId,
      ...(action && {
        actionId: action.id,
        actionStatus: action.status,
      }),
      status: this.status(),
    });
  }
}

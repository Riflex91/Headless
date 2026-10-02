import type { ActionRecord } from "./action-ledger.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type { CharacterSnapshot, CooldownSnapshot, EntitySnapshot } from "./game-adapter.lib";
import type { MovementControllerStatus } from "./movement-controller.lib";

const MODULE = "CombatController";
const MOVEMENT_OWNER = "CombatController";

export type CombatState =
  | "DISABLED"
  | "IDLE"
  | "RECOVERING"
  | "TARGETING"
  | "OUT_OF_RANGE"
  | "COOLDOWN"
  | "ATTACKING"
  | "RETREATING"
  | "DEAD"
  | "RESPAWNING"
  | "BLOCKED";

export interface CombatControllerStatus {
  timestamp: number;
  state: CombatState;
  reason: string;
  enabled: boolean;
  resources: {
    hp: number | null;
    maxHp: number | null;
    hpPercent: number | null;
    mp: number | null;
    maxMp: number | null;
    mpPercent: number | null;
    criticalHp: boolean;
  };
  target: {
    id: string;
    name: string | null;
    mtype: string | null;
    hp: number | null;
    maxHp: number | null;
    distance: number | null;
    attackRange: number | null;
    inRange: boolean | null;
  } | null;
  cooldowns: {
    attackRemainingMs: number;
    hpPotionRemainingMs: number;
    mpPotionRemainingMs: number;
  };
  movement: {
    owner: string | null;
    mode: string;
    safePoint: { map: string; x: number; y: number; tolerance: number } | null;
  };
  lastAction: { id: string; status: string | null; kind: string } | null;
}

export interface CombatControllerEvent {
  type: "COMBAT_STATE_CHANGED" | "COMBAT_TARGET_CHANGED" | "COMBAT_ACTION";
  timestamp: number;
  state: CombatState;
  reason: string;
  targetId?: string | null;
  actionId?: string;
  actionStatus?: string | null;
  status: CombatControllerStatus;
}

interface CombatGameAdapter {
  character(): CharacterSnapshot;
  entities(): EntitySnapshot[];
  entity(id: string): EntitySnapshot | null;
  cooldowns(): CooldownSnapshot[];
}

interface CombatMovement {
  status(): MovementControllerStatus;
  captureSafePoint(tolerance?: number, source?: string): unknown;
  cancel(request: {
    owner: string;
    module: string;
    why: string;
    correlationId?: string;
    force?: boolean;
  }): Promise<ActionRecord>;
  returnToSafePoint(request: {
    owner: string;
    module: string;
    why: string;
    correlationId?: string;
  }): Promise<ActionRecord>;
}

export interface CombatControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: CombatControllerEvent) => void;
}

interface NormalizedCombatConfig {
  enabled: boolean;
  autoTarget: boolean;
  avoidKillSteal: boolean;
  targetMaxDistance: number;
  potionEnabled: boolean;
  hpPotionPercent: number;
  mpPotionPercent: number;
  criticalHpPercent: number;
  retreatEnabled: boolean;
  retreatHpPercent: number;
  autoRespawn: boolean;
  respawnRetryMs: number;
}

interface UnknownPotion {
  skill: "use_hp" | "use_mp";
  hp: number | null;
  mp: number | null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function first(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (source[key] !== undefined) return source[key];
  return undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function percent(value: unknown, fallback: number): number {
  const number = finite(value, fallback);
  const normalized = number >= 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, normalized));
}

function ratio(value: number | null, maximum: number | null): number | null {
  if (value === null || maximum === null || maximum <= 0) return null;
  return Math.max(0, Math.min(100, (value / maximum) * 100));
}

function distance(character: CharacterSnapshot, entity: EntitySnapshot): number | null {
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

function cooldown(cooldowns: CooldownSnapshot[], skill: string): number {
  return cooldowns.find((entry) => entry.skill === skill)?.remainingMs || 0;
}

function normalizeConfig(value: unknown): NormalizedCombatConfig {
  const root = objectValue(value);
  const combat = objectValue(root.combat);
  const potion = objectValue(
    root.potionUsage ?? root.potion_usage ?? root.potions ?? root.potion,
  );
  const safety = objectValue(root.safety);
  const enabled = bool(first(combat, ["enabled", "active"]), false);

  return {
    enabled,
    autoTarget: bool(first(combat, ["autoTarget", "auto_target"]), true),
    avoidKillSteal: bool(
      first(combat, ["avoidKillSteal", "avoid_kill_steal"]),
      true,
    ),
    targetMaxDistance: Math.max(
      0,
      finite(first(combat, ["targetMaxDistance", "target_max_distance"]), 800),
    ),
    potionEnabled: bool(first(potion, ["enabled", "active"]), enabled),
    hpPotionPercent: percent(
      first(potion, ["hpBelowPercent", "hp_below_percent", "hpThreshold", "hp_threshold"]),
      50,
    ),
    mpPotionPercent: percent(
      first(potion, ["mpBelowPercent", "mp_below_percent", "mpThreshold", "mp_threshold"]),
      40,
    ),
    criticalHpPercent: percent(
      first(potion, ["criticalHpPercent", "critical_hp_percent"]) ??
        first(safety, ["criticalHpPercent", "critical_hp_percent"]),
      30,
    ),
    retreatEnabled:
      first(combat, ["retreat", "autoRetreat", "auto_retreat"]) === true ||
      first(safety, ["autoRetreat", "auto_retreat"]) === true,
    retreatHpPercent: percent(
      first(combat, ["retreatHpPercent", "retreat_hp_percent"]) ??
        first(safety, ["retreatHpPercent", "retreat_hp_percent"]),
      35,
    ),
    autoRespawn:
      first(safety, ["autoRespawn", "auto_respawn"]) === true ||
      first(root, ["autoRespawn", "auto_respawn"]) === true,
    respawnRetryMs: Math.max(
      1000,
      finite(first(safety, ["respawnRetryMs", "respawn_retry_ms"]), 3000),
    ),
  };
}

export class CombatController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: CombatControllerEvent) => void;
  private currentState: CombatState = "DISABLED";
  private currentReason = "COMBAT_DISABLED";
  private targetId: string | null = null;
  private lastAction: CombatControllerStatus["lastAction"] = null;
  private lastStatusTimestamp = 0;
  private busy = false;
  private lastRespawnAt: number | null = null;
  private unknownPotion: UnknownPotion | null = null;
  private configOverride: unknown | undefined;

  constructor(
    private readonly game: CombatGameAdapter,
    private readonly actions: ActionBoundary,
    private readonly movement: CombatMovement,
    options: CombatControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
  }

  status(): CombatControllerStatus {
    const character = this.game.character();
    const cooldowns = this.game.cooldowns();
    const movement = this.movement.status();
    const target = this.targetId ? this.game.entity(this.targetId) : null;
    const attackRange = character.range;
    const targetDistance = target ? distance(character, target) : null;
    const hpPercent = ratio(character.hp, character.maxHp);
    const mpPercent = ratio(character.mp, character.maxMp);
    const config = normalizeConfig(this.effectiveConfig());

    return {
      timestamp: this.lastStatusTimestamp || this.now(),
      state: this.currentState,
      reason: this.currentReason,
      enabled: config.enabled,
      resources: {
        hp: character.hp,
        maxHp: character.maxHp,
        hpPercent,
        mp: character.mp,
        maxMp: character.maxMp,
        mpPercent,
        criticalHp: hpPercent !== null && hpPercent <= config.criticalHpPercent,
      },
      target: target
        ? {
            id: target.id,
            name: target.name,
            mtype: target.mtype,
            hp: target.hp,
            maxHp: target.maxHp,
            distance: targetDistance,
            attackRange,
            inRange:
              targetDistance === null || attackRange === null
                ? null
                : targetDistance <= attackRange,
          }
        : null,
      cooldowns: {
        attackRemainingMs: cooldown(cooldowns, "attack"),
        hpPotionRemainingMs: cooldown(cooldowns, "use_hp"),
        mpPotionRemainingMs: cooldown(cooldowns, "use_mp"),
      },
      movement: {
        owner: movement.owner,
        mode: movement.mode,
        safePoint: movement.safePoint
          ? {
              map: movement.safePoint.map,
              x: movement.safePoint.x,
              y: movement.safePoint.y,
              tolerance: movement.safePoint.tolerance ?? 12,
            }
          : null,
      },
      lastAction: this.lastAction ? { ...this.lastAction } : null,
    };
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

  async tick(): Promise<CombatControllerStatus> {
    if (this.busy) return this.status();
    this.busy = true;

    try {
      const config = normalizeConfig(this.effectiveConfig());
      const character = this.game.character();
      const hpPercent = ratio(character.hp, character.maxHp);
      const mpPercent = ratio(character.mp, character.maxMp);

      if (character.rip) {
        this.setTarget(null);
        this.setState("DEAD", "CHARACTER_DEAD");
        if (
          config.autoRespawn &&
          (this.lastRespawnAt === null ||
            this.now() - this.lastRespawnAt >= config.respawnRetryMs)
        ) {
          this.lastRespawnAt = this.now();
          const action = this.actions.respawn({
            module: MODULE,
            why: "AUTO_RESPAWN",
          });
          this.recordAction("RESPAWN", action);
          this.setState(
            action.status === "BLOCKED" || action.status === "REJECTED"
              ? "DEAD"
              : "RESPAWNING",
            action.status === "BLOCKED"
              ? "RESPAWN_BLOCKED"
              : action.status === "REJECTED"
                ? "RESPAWN_REJECTED"
                : "RESPAWN_DISPATCHED",
          );
        }
        return this.status();
      }

      this.lastRespawnAt = null;

      if (!config.enabled) {
        this.setTarget(null);
        this.setState("DISABLED", "COMBAT_DISABLED");
        return this.status();
      }

      if (this.unknownPotion) {
        const cooldowns = this.game.cooldowns();
        const observed =
          (this.unknownPotion.skill === "use_hp" &&
            character.hp !== null &&
            this.unknownPotion.hp !== null &&
            character.hp > this.unknownPotion.hp) ||
          (this.unknownPotion.skill === "use_mp" &&
            character.mp !== null &&
            this.unknownPotion.mp !== null &&
            character.mp > this.unknownPotion.mp) ||
          cooldown(cooldowns, this.unknownPotion.skill) > 0;

        if (!observed) {
          this.setState("BLOCKED", "POTION_OUTCOME_UNKNOWN");
          return this.status();
        }
        this.unknownPotion = null;
      }

      this.ensureCombatSafePoint(config, hpPercent);

      const potion = this.choosePotion(config, character, hpPercent, mpPercent);
      if (potion && cooldown(this.game.cooldowns(), potion) <= 0) {
        const action = await this.actions.useSkill({
          skill: potion,
          module: MODULE,
          why: potion === "use_hp" ? "HP_BELOW_THRESHOLD" : "MP_BELOW_THRESHOLD",
        });
        this.recordAction(potion === "use_hp" ? "HP_POTION" : "MP_POTION", action);

        if (action.status === "UNKNOWN") {
          this.unknownPotion = {
            skill: potion,
            hp: character.hp,
            mp: character.mp,
          };
          this.setState("BLOCKED", "POTION_OUTCOME_UNKNOWN");
          return this.status();
        }
        if (action.status !== "BLOCKED" && action.status !== "REJECTED") {
          this.setState(
            "RECOVERING",
            potion === "use_hp" ? "HP_POTION_USED" : "MP_POTION_USED",
          );
          return this.status();
        }
      }

      if (
        config.retreatEnabled &&
        hpPercent !== null &&
        hpPercent <= config.retreatHpPercent
      ) {
        await this.retreat();
        return this.status();
      }

      const target = this.selectTarget(config, character);
      this.setTarget(target?.id || null);
      if (!target) {
        this.setState("IDLE", "NO_ELIGIBLE_TARGET");
        return this.status();
      }

      this.setState("TARGETING", "TARGET_SELECTED");
      const targetDistance = distance(character, target);
      if (
        character.range !== null &&
        targetDistance !== null &&
        targetDistance > character.range
      ) {
        this.setState("OUT_OF_RANGE", "TARGET_OUT_OF_ATTACK_RANGE");
        return this.status();
      }

      const attackCooldown = cooldown(this.game.cooldowns(), "attack");
      if (attackCooldown > 0) {
        this.setState("COOLDOWN", "ATTACK_COOLDOWN");
        return this.status();
      }

      const action = await this.actions.attack({
        targetId: target.id,
        module: MODULE,
        why: "TARGET_IN_RANGE_AND_READY",
      });
      this.recordAction("ATTACK", action);
      this.setState(
        action.status === "BLOCKED" || action.status === "REJECTED"
          ? "BLOCKED"
          : "ATTACKING",
        action.status === "BLOCKED"
          ? "ATTACK_BLOCKED"
          : action.status === "REJECTED"
            ? "ATTACK_REJECTED"
            : action.status === "UNKNOWN"
              ? "ATTACK_OUTCOME_UNKNOWN"
              : "ATTACK_DISPATCHED",
      );
      return this.status();
    } finally {
      this.busy = false;
    }
  }

  private choosePotion(
    config: NormalizedCombatConfig,
    character: CharacterSnapshot,
    hpPercent: number | null,
    mpPercent: number | null,
  ): "use_hp" | "use_mp" | null {
    if (!config.potionEnabled) return null;

    if (
      character.hp !== null &&
      character.maxHp !== null &&
      character.hp < character.maxHp &&
      hpPercent !== null &&
      hpPercent <= config.hpPotionPercent
    ) {
      return "use_hp";
    }

    if (
      character.mp !== null &&
      character.maxMp !== null &&
      character.mp < character.maxMp &&
      mpPercent !== null &&
      mpPercent <= config.mpPotionPercent
    ) {
      return "use_mp";
    }

    return null;
  }

  private ensureCombatSafePoint(
    config: NormalizedCombatConfig,
    hpPercent: number | null,
  ): void {
    if (!config.retreatEnabled) return;
    const movement = this.movement.status();
    if (movement.safePoint) return;
    if (hpPercent !== null && hpPercent <= config.retreatHpPercent) return;

    try {
      this.movement.captureSafePoint(undefined, "COMBAT_ANCHOR");
    } catch (_error) {
      // Retreat will report the missing safe point if it becomes necessary.
    }
  }

  private async retreat(): Promise<void> {
    const movement = this.movement.status();
    const character = this.game.character();
    const safePoint = movement.safePoint;

    if (!safePoint) {
      this.setState("BLOCKED", "RETREAT_SAFE_POINT_UNAVAILABLE");
      return;
    }

    const safePointTolerance = safePoint.tolerance ?? 12;

    if (
      character.map === safePoint.map &&
      character.x !== null &&
      character.y !== null &&
      Math.hypot(character.x - safePoint.x, character.y - safePoint.y) <=
        safePointTolerance
    ) {
      this.setState("RETREATING", "RETREAT_AT_SAFE_POINT");
      return;
    }

    if (movement.owner === MOVEMENT_OWNER && movement.mode === "RETURN") {
      this.setState("RETREATING", "RETREAT_IN_PROGRESS");
      return;
    }

    if (movement.owner || movement.active) {
      const cancelled = await this.movement.cancel({
        owner: MOVEMENT_OWNER,
        module: MODULE,
        why: "RETREAT_LOW_HP",
        force: true,
      });
      this.recordAction("RETREAT_CANCEL_MOVEMENT", cancelled);
      if (cancelled.status !== "CONFIRMED") {
        this.setState("BLOCKED", "RETREAT_CANCEL_NOT_CONFIRMED");
        return;
      }
    }

    const action = await this.movement.returnToSafePoint({
      owner: MOVEMENT_OWNER,
      module: MODULE,
      why: "RETREAT_LOW_HP",
    });
    this.recordAction("RETREAT_RETURN", action);
    this.setState(
      action.status === "BLOCKED" || action.status === "REJECTED"
        ? "BLOCKED"
        : "RETREATING",
      action.status === "UNKNOWN" ? "RETREAT_OUTCOME_UNKNOWN" : "RETREAT_LOW_HP",
    );
  }

  private selectTarget(
    config: NormalizedCombatConfig,
    character: CharacterSnapshot,
  ): EntitySnapshot | null {
    const eligible = (entity: EntitySnapshot): boolean => {
      if (entity.type !== "monster" || entity.dead || entity.rip) return false;
      if (entity.hp !== null && entity.hp <= 0) return false;
      if (character.map && entity.map && character.map !== entity.map) return false;
      if (
        config.avoidKillSteal &&
        entity.target &&
        character.name &&
        entity.target !== character.name
      ) {
        return false;
      }
      const targetDistance = distance(character, entity);
      return targetDistance !== null && targetDistance <= config.targetMaxDistance;
    };

    if (config.autoTarget && character.target) {
      const current = this.game.entity(character.target);
      if (current && eligible(current)) return current;
    }
    if (!config.autoTarget) return null;

    const candidates = this.game
      .entities()
      .filter(eligible)
      .map((entity) => ({
        entity,
        distance: distance(character, entity) as number,
      }))
      .sort(
        (a, b) =>
          a.distance - b.distance || a.entity.id.localeCompare(b.entity.id),
      );

    return candidates[0]?.entity || null;
  }

  private setTarget(targetId: string | null): void {
    if (this.targetId === targetId) return;
    this.targetId = targetId;
    this.emit("COMBAT_TARGET_CHANGED", "TARGET_CHANGED");
  }

  private setState(state: CombatState, reason: string): void {
    const changed = this.currentState !== state || this.currentReason !== reason;
    this.currentState = state;
    this.currentReason = reason;
    this.lastStatusTimestamp = this.now();
    if (changed) this.emit("COMBAT_STATE_CHANGED", reason);
  }

  private recordAction(kind: string, action: ActionRecord): void {
    this.lastAction = { id: action.id, status: action.status, kind };
    this.emit("COMBAT_ACTION", kind, action);
  }

  private emit(
    type: CombatControllerEvent["type"],
    reason: string,
    action?: ActionRecord,
  ): void {
    if (!this.onEvent) return;
    this.onEvent({
      type,
      timestamp: this.now(),
      state: this.currentState,
      reason,
      targetId: this.targetId,
      ...(action && { actionId: action.id, actionStatus: action.status }),
      status: this.status(),
    });
  }
}

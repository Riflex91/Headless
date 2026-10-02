import type { ActionRecord } from "./action-ledger.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type {
  CharacterSnapshot,
  CooldownSnapshot,
  EntitySnapshot,
  SkillSnapshot,
} from "./game-adapter.lib";
import type {
  MovementController,
  MovementControllerStatus,
} from "./movement-controller.lib";
import type {
  CombatController,
  CombatControllerStatus,
} from "./combat-controller.lib";

const MODULE = "GroupCombatController";
const MOVEMENT_OWNER = "GroupCombatController";

export type GroupRole = "NONE" | "LEADER" | "FOLLOWER";
export type GroupCombatState =
  | "DISABLED"
  | "IDLE"
  | "FORMING"
  | "FOCUSING"
  | "REGROUPING"
  | "HEALING"
  | "SUPPORTING"
  | "AOE"
  | "ANCHORING"
  | "KITING"
  | "BLOCKED";

export interface GroupCombatStatus {
  timestamp: number;
  enabled: boolean;
  state: GroupCombatState;
  reason: string;
  role: GroupRole;
  leader: string | null;
  configuredMembers: string[];
  partyMembers: string[];
  missingMembers: string[];
  focusTargetId: string | null;
  party: {
    formationEnabled: boolean;
    pendingAction: {
      kind: string;
      target: string;
      actionId: string;
      status: string | null;
      startedAt: number;
    } | null;
  };
  tether: {
    leaderVisible: boolean;
    distance: number | null;
    softDistance: number;
    hardDistance: number;
    hardExceeded: boolean;
  };
  anchor: {
    active: boolean;
    map: string | null;
    x: number | null;
    y: number | null;
  };
  healing: {
    enabled: boolean;
    lastTargetId: string | null;
  };
  support: {
    enabled: boolean;
    lastSkill: string | null;
    lastTargetId: string | null;
  };
  aoe: {
    enabled: boolean;
    nearbyTargets: number;
    lastSkill: string | null;
  };
  kiting: {
    enabled: boolean;
    active: boolean;
    targetDistance: number | null;
  };
  movement: {
    owner: string | null;
    mode: string;
  };
  lastAction: {
    id: string;
    status: string | null;
    kind: string;
    skill?: string | null;
    target?: string | null;
  } | null;
  unknownSkill: {
    skill: string;
    targetId: string | null;
  } | null;
}

export interface GroupCombatControllerEvent {
  type:
    | "GROUP_COMBAT_STATE_CHANGED"
    | "GROUP_COMBAT_ACTION"
    | "GROUP_COMBAT_FOCUS_CHANGED";
  timestamp: number;
  state: GroupCombatState;
  reason: string;
  actionId?: string;
  actionStatus?: string | null;
  status: GroupCombatStatus;
}

export interface GroupCombatControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: GroupCombatControllerEvent) => void;
}

interface GroupGameAdapter {
  character(): CharacterSnapshot;
  entities(): EntitySnapshot[];
  entity(id: string): EntitySnapshot | null;
  party(): Record<string, unknown>;
  skills(characterOnly?: boolean): SkillSnapshot[];
  cooldowns(): CooldownSnapshot[];
}

interface NormalizedGroupConfig {
  enabled: boolean;
  role: GroupRole;
  leader: string | null;
  members: string[];
  partyFormation: boolean;
  focusEnabled: boolean;
  healingEnabled: boolean;
  healBelowPercent: number;
  partyHealMinTargets: number;
  supportEnabled: boolean;
  absorbAggroCount: number;
  aoeEnabled: boolean;
  aoeMinTargets: number;
  regroupEnabled: boolean;
  softTether: number;
  hardTether: number;
  warriorAnchorEnabled: boolean;
  rangerKitingEnabled: boolean;
  kiteMinDistance: number;
  kiteStep: number;
  partyReconcileMs: number;
  partyRetryMs: number;
}

interface PendingPartyAction {
  kind: string;
  target: string;
  actionId: string;
  status: string | null;
  startedAt: number;
}

interface UnknownSkill {
  skill: string;
  targetId: string | null;
  beforeMp: number | null;
  beforeTargetHp: number | null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function first(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function percent(value: unknown, fallback: number): number {
  const raw = finite(value, fallback);
  const normalized = raw >= 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, normalized));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

function normalizeConfig(
  value: unknown,
  characterName: string | null,
): NormalizedGroupConfig {
  const root = objectValue(value);
  const group = objectValue(
    root.groupCombat ?? root.group_combat ?? root.partyCombat ?? root.party_combat,
  );
  const party = objectValue(group.party);
  const healing = objectValue(group.healing);
  const support = objectValue(group.support);
  const aoe = objectValue(group.aoe);
  const tether = objectValue(group.tether);
  const anchor = objectValue(group.warriorAnchor ?? group.warrior_anchor);
  const kiting = objectValue(group.rangerKiting ?? group.ranger_kiting);
  const leader = stringValue(first(group, ["leader", "leaderName", "leader_name"]));
  const members = stringList(first(group, ["members", "partyMembers", "party_members"]));
  const configuredRole = stringValue(group.role)?.toLowerCase();
  let role: GroupRole = "NONE";
  if (configuredRole === "leader") role = "LEADER";
  else if (configuredRole === "follower") role = "FOLLOWER";
  else if (leader && characterName) {
    role = leader === characterName ? "LEADER" : "FOLLOWER";
  }

  const softTether = Math.max(
    0,
    finite(first(tether, ["soft", "softDistance", "soft_distance"]), 180),
  );
  const hardTether = Math.max(
    softTether,
    finite(first(tether, ["hard", "hardDistance", "hard_distance"]), 420),
  );

  return {
    enabled: bool(first(group, ["enabled", "active"]), false),
    role,
    leader,
    members,
    partyFormation: bool(
      first(party, ["enabled", "formation", "autoFormation", "auto_formation"]),
      true,
    ),
    focusEnabled: bool(first(group, ["focus", "focusEnabled", "focus_enabled"]), true),
    healingEnabled: bool(first(healing, ["enabled", "active"]), false),
    healBelowPercent: percent(
      first(healing, ["belowPercent", "below_percent", "hpBelowPercent", "hp_below_percent"]),
      70,
    ),
    partyHealMinTargets: Math.max(
      2,
      Math.floor(
        finite(first(healing, ["partyHealMinTargets", "party_heal_min_targets"]), 2),
      ),
    ),
    supportEnabled: bool(first(support, ["enabled", "active"]), false),
    absorbAggroCount: Math.max(
      1,
      Math.floor(
        finite(first(support, ["absorbAggroCount", "absorb_aggro_count"]), 2),
      ),
    ),
    aoeEnabled: bool(first(aoe, ["enabled", "active"]), false),
    aoeMinTargets: Math.max(
      2,
      Math.floor(finite(first(aoe, ["minTargets", "min_targets"]), 3)),
    ),
    regroupEnabled: bool(
      first(tether, ["enabled", "regroup", "regroupEnabled", "regroup_enabled"]),
      true,
    ),
    softTether,
    hardTether,
    warriorAnchorEnabled: bool(first(anchor, ["enabled", "active"]), true),
    rangerKitingEnabled: bool(first(kiting, ["enabled", "active"]), false),
    kiteMinDistance: Math.max(
      0,
      finite(first(kiting, ["minDistance", "min_distance"]), 90),
    ),
    kiteStep: Math.max(10, finite(first(kiting, ["step", "stepDistance", "step_distance"]), 80)),
    partyReconcileMs: Math.max(
      500,
      finite(first(party, ["reconcileMs", "reconcile_ms"]), 2500),
    ),
    partyRetryMs: Math.max(
      500,
      finite(first(party, ["retryMs", "retry_ms"]), 1500),
    ),
  };
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

function ratio(value: number | null, maximum: number | null): number | null {
  if (value === null || maximum === null || maximum <= 0) return null;
  return Math.max(0, Math.min(100, (value / maximum) * 100));
}

function cooldown(cooldowns: CooldownSnapshot[], skill: string): number {
  return cooldowns.find((entry) => entry.skill === skill)?.remainingMs || 0;
}

function partyMembers(party: Record<string, unknown>): string[] {
  return Object.keys(party).sort((a, b) => a.localeCompare(b));
}

function memberEntity(
  entities: EntitySnapshot[],
  name: string | null,
): EntitySnapshot | null {
  if (!name) return null;
  return (
    entities.find(
      (entity) =>
        entity.type === "character" &&
        (entity.id === name || entity.name === name),
    ) || null
  );
}

export class GroupCombatController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: GroupCombatControllerEvent) => void;
  private configOverride: unknown | undefined;
  private currentState: GroupCombatState = "DISABLED";
  private currentReason = "GROUP_COMBAT_DISABLED";
  private lastStatusTimestamp = 0;
  private focusTargetId: string | null = null;
  private lastAction: GroupCombatStatus["lastAction"] = null;
  private pendingPartyAction: PendingPartyAction | null = null;
  private partyRetryAt = 0;
  private partyAttemptSequence = 0;
  private unknownSkill: UnknownSkill | null = null;
  private healingTargetId: string | null = null;
  private supportSkill: string | null = null;
  private supportTargetId: string | null = null;
  private aoeSkill: string | null = null;
  private nearbyTargets = 0;
  private kitingActive = false;
  private kiteTargetDistance: number | null = null;
  private busy = false;

  constructor(
    private readonly game: GroupGameAdapter,
    private readonly actions: ActionBoundary,
    private readonly movement: MovementController,
    private readonly combat: CombatController,
    options: GroupCombatControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  status(): GroupCombatStatus {
    const character = this.game.character();
    const config = normalizeConfig(this.effectiveConfig(), character.name);
    const party = partyMembers(this.game.party());
    const configured = this.configuredMembers(config, character.name);
    const missing = configured.filter((name) => !party.includes(name));
    const entities = this.game.entities();
    const leaderEntity = memberEntity(entities, config.leader);
    const tetherDistance =
      config.role === "FOLLOWER" && leaderEntity
        ? entityDistance(character, leaderEntity)
        : null;
    const movement = this.movement.status();
    const anchorActive =
      config.enabled &&
      config.warriorAnchorEnabled &&
      config.role === "LEADER" &&
      character.ctype === "warrior";

    return {
      timestamp: this.lastStatusTimestamp || this.now(),
      enabled: config.enabled,
      state: this.currentState,
      reason: this.currentReason,
      role: config.role,
      leader: config.leader,
      configuredMembers: configured,
      partyMembers: party,
      missingMembers: missing,
      focusTargetId: this.focusTargetId,
      party: {
        formationEnabled: config.partyFormation,
        pendingAction: this.pendingPartyAction
          ? { ...this.pendingPartyAction }
          : null,
      },
      tether: {
        leaderVisible: !!leaderEntity,
        distance: tetherDistance,
        softDistance: config.softTether,
        hardDistance: config.hardTether,
        hardExceeded:
          tetherDistance !== null && tetherDistance > config.hardTether,
      },
      anchor: {
        active: anchorActive,
        map: anchorActive ? character.map : null,
        x: anchorActive ? character.x : null,
        y: anchorActive ? character.y : null,
      },
      healing: {
        enabled: config.healingEnabled,
        lastTargetId: this.healingTargetId,
      },
      support: {
        enabled: config.supportEnabled,
        lastSkill: this.supportSkill,
        lastTargetId: this.supportTargetId,
      },
      aoe: {
        enabled: config.aoeEnabled,
        nearbyTargets: this.nearbyTargets,
        lastSkill: this.aoeSkill,
      },
      kiting: {
        enabled: config.rangerKitingEnabled,
        active: this.kitingActive,
        targetDistance: this.kiteTargetDistance,
      },
      movement: {
        owner: movement.owner,
        mode: movement.mode,
      },
      lastAction: this.lastAction ? { ...this.lastAction } : null,
      unknownSkill: this.unknownSkill
        ? {
            skill: this.unknownSkill.skill,
            targetId: this.unknownSkill.targetId,
          }
        : null,
    };
  }

  async tick(): Promise<GroupCombatStatus> {
    if (this.busy) return this.status();
    this.busy = true;

    try {
      const character = this.game.character();
      const config = normalizeConfig(this.effectiveConfig(), character.name);
      this.kitingActive = false;
      this.kiteTargetDistance = null;
      this.nearbyTargets = 0;

      if (!config.enabled) {
        this.combat.setPreferredTargetId(null);
        this.focusTargetId = null;
        this.pendingPartyAction = null;
        this.setState("DISABLED", "GROUP_COMBAT_DISABLED");
        return this.status();
      }

      if (config.role === "NONE") {
        this.combat.setPreferredTargetId(null);
        this.setState("BLOCKED", "GROUP_ROLE_UNRESOLVED");
        return this.status();
      }

      if (this.unknownSkill && !this.reconcileUnknownSkill()) {
        this.setState("BLOCKED", "GROUP_SKILL_OUTCOME_UNKNOWN");
        return this.status();
      }

      const partyResult = this.reconcilePendingParty(config);
      if (partyResult === "UNKNOWN") {
        this.setState("BLOCKED", "PARTY_ACTION_OUTCOME_UNKNOWN");
        return this.status();
      }
      if (partyResult === "WAIT") {
        this.setState("FORMING", "PARTY_ACTION_RECONCILING");
        return this.status();
      }

      if (config.partyFormation) {
        const formation = this.formParty(config, character);
        if (formation) return formation;
      }

      this.updateFocus(config, character);

      const tether = await this.reconcileTether(config, character);
      if (tether) return tether;

      const healing = await this.tryHealing(config, character);
      if (healing) return healing;

      const support = await this.trySupport(config, character);
      if (support) return support;

      const aoe = await this.tryAoe(config, character);
      if (aoe) return aoe;

      const kiting = await this.tryRangerKiting(config, character);
      if (kiting) return kiting;

      if (
        config.warriorAnchorEnabled &&
        config.role === "LEADER" &&
        character.ctype === "warrior"
      ) {
        this.setState("ANCHORING", "WARRIOR_ANCHOR_ACTIVE");
        return this.status();
      }

      this.setState(
        this.focusTargetId ? "FOCUSING" : "IDLE",
        this.focusTargetId ? "GROUP_FOCUS_ACTIVE" : "GROUP_READY",
      );
      return this.status();
    } finally {
      this.busy = false;
    }
  }

  private effectiveConfig(): unknown {
    return this.configOverride === undefined
      ? this.configSource()
      : this.configOverride;
  }

  private configuredMembers(
    config: NormalizedGroupConfig,
    characterName: string | null,
  ): string[] {
    const members = new Set(config.members);
    if (config.leader) members.add(config.leader);
    if (characterName) members.add(characterName);
    return [...members].sort((a, b) => a.localeCompare(b));
  }

  private reconcilePendingParty(
    config: NormalizedGroupConfig,
  ): "CLEAR" | "WAIT" | "UNKNOWN" {
    const pending = this.pendingPartyAction;
    if (!pending) return "CLEAR";

    const members = partyMembers(this.game.party());
    if (members.includes(pending.target)) {
      this.pendingPartyAction = null;
      return "CLEAR";
    }

    if (pending.status === "UNKNOWN") return "UNKNOWN";
    if (this.now() - pending.startedAt < config.partyReconcileMs) {
      return "WAIT";
    }

    this.pendingPartyAction = null;
    this.partyRetryAt = this.now() + config.partyRetryMs;
    return "CLEAR";
  }

  private formParty(
    config: NormalizedGroupConfig,
    character: CharacterSnapshot,
  ): GroupCombatStatus | null {
    if (this.now() < this.partyRetryAt) {
      this.setState("FORMING", "PARTY_RETRY_BACKOFF");
      return this.status();
    }

    const members = partyMembers(this.game.party());
    if (config.role === "LEADER") {
      const missing = config.members.filter(
        (name) => name !== character.name && !members.includes(name),
      );
      if (!missing.length) return null;

      const target = missing[0];
      this.partyAttemptSequence += 1;
      const acceptRequest = this.partyAttemptSequence % 2 === 0;
      const action = acceptRequest
        ? this.actions.partyAcceptRequest({
            name: target,
            module: MODULE,
            why: "TRUSTED_MEMBER_PARTY_REQUEST",
          })
        : this.actions.partyInvite({
            name: target,
            module: MODULE,
            why: "FORM_CONFIGURED_PARTY",
          });
      this.recordAction(
        acceptRequest ? "PARTY_ACCEPT_REQUEST" : "PARTY_INVITE",
        action,
        null,
        target,
      );
      this.trackPartyAction(
        acceptRequest ? "ACCEPT_REQUEST" : "INVITE",
        target,
        action,
        config,
      );
      this.setState("FORMING", "LEADER_FORMING_PARTY");
      return this.status();
    }

    if (!config.leader || members.includes(config.leader)) return null;

    this.partyAttemptSequence += 1;
    const request = this.partyAttemptSequence % 2 === 0;
    const action = request
      ? this.actions.partyRequest({
          name: config.leader,
          module: MODULE,
          why: "REQUEST_CONFIGURED_LEADER",
        })
      : this.actions.partyAcceptInvite({
          name: config.leader,
          module: MODULE,
          why: "ACCEPT_CONFIGURED_LEADER_INVITE",
        });
    this.recordAction(
      request ? "PARTY_REQUEST" : "PARTY_ACCEPT_INVITE",
      action,
      null,
      config.leader,
    );
    this.trackPartyAction(
      request ? "REQUEST" : "ACCEPT_INVITE",
      config.leader,
      action,
      config,
    );
    this.setState("FORMING", "FOLLOWER_FORMING_PARTY");
    return this.status();
  }

  private trackPartyAction(
    kind: string,
    target: string,
    action: ActionRecord,
    config: NormalizedGroupConfig,
  ): void {
    if (
      action.status === "DISPATCHED" ||
      action.status === "UNKNOWN"
    ) {
      this.pendingPartyAction = {
        kind,
        target,
        actionId: action.id,
        status: action.status,
        startedAt: this.now(),
      };
      return;
    }

    this.pendingPartyAction = null;
    if (action.status === "BLOCKED" || action.status === "REJECTED") {
      this.partyRetryAt = this.now() + config.partyRetryMs;
    }
  }

  private updateFocus(
    config: NormalizedGroupConfig,
    character: CharacterSnapshot,
  ): void {
    let next: string | null = null;
    if (config.focusEnabled) {
      if (config.role === "LEADER") {
        next = this.combat.status().target?.id || character.target || null;
      } else {
        const leader = memberEntity(this.game.entities(), config.leader);
        const leaderTarget = leader?.target || null;
        const target = leaderTarget ? this.game.entity(leaderTarget) : null;
        if (
          target &&
          target.type === "monster" &&
          !target.dead &&
          !target.rip
        ) {
          next = target.id;
        }
      }
    }

    this.combat.setPreferredTargetId(next);
    if (this.focusTargetId !== next) {
      this.focusTargetId = next;
      this.emit("GROUP_COMBAT_FOCUS_CHANGED", "GROUP_FOCUS_CHANGED");
    }
  }

  private async reconcileTether(
    config: NormalizedGroupConfig,
    character: CharacterSnapshot,
  ): Promise<GroupCombatStatus | null> {
    if (
      config.role !== "FOLLOWER" ||
      !config.regroupEnabled ||
      !config.leader
    ) {
      return null;
    }

    const leader = memberEntity(this.game.entities(), config.leader);
    if (!leader) return null;
    const distance = entityDistance(character, leader);
    if (distance === null) return null;

    const movement = this.movement.status();
    const hardExceeded = distance > config.hardTether;
    const softExceeded = distance > config.softTether;
    if (!hardExceeded && !softExceeded) {
      if (
        movement.owner === MOVEMENT_OWNER &&
        movement.active === null
      ) {
        this.movement.release(MOVEMENT_OWNER, "GROUP_TETHER_SATISFIED");
      }
      return null;
    }

    if (!hardExceeded && (movement.owner || movement.active)) {
      return null;
    }

    if (hardExceeded && (movement.owner || movement.active)) {
      const cancelled = await this.movement.cancel({
        owner: MOVEMENT_OWNER,
        module: MODULE,
        why: "HARD_TETHER_REGROUP",
        force: true,
      });
      this.recordAction("HARD_TETHER_CANCEL", cancelled);
      if (cancelled.status !== "CONFIRMED") {
        this.setState(
          "BLOCKED",
          cancelled.status === "UNKNOWN"
            ? "HARD_TETHER_CANCEL_UNKNOWN"
            : "HARD_TETHER_CANCEL_FAILED",
        );
        return this.status();
      }
    }

    const action = await this.movement.smart({
      owner: MOVEMENT_OWNER,
      module: MODULE,
      why: hardExceeded ? "HARD_TETHER_REGROUP" : "SOFT_TETHER_REGROUP",
      destination: {
        ...(leader.map && { map: leader.map }),
        x: leader.x as number,
        y: leader.y as number,
      },
    });
    this.recordAction(
      hardExceeded ? "HARD_TETHER_REGROUP" : "SOFT_TETHER_REGROUP",
      action,
    );
    this.setState(
      action.status === "BLOCKED" || action.status === "REJECTED"
        ? "BLOCKED"
        : "REGROUPING",
      action.status === "UNKNOWN"
        ? "REGROUP_OUTCOME_UNKNOWN"
        : hardExceeded
          ? "HARD_TETHER_EXCEEDED"
          : "SOFT_TETHER_EXCEEDED",
    );
    return this.status();
  }

  private async tryHealing(
    config: NormalizedGroupConfig,
    character: CharacterSnapshot,
  ): Promise<GroupCombatStatus | null> {
    if (!config.healingEnabled || character.ctype !== "priest") return null;

    const members = new Set(partyMembers(this.game.party()));
    if (character.name) members.add(character.name);
    const entities = this.game.entities();
    const visible = entities.filter(
      (entity) =>
        entity.type === "character" &&
        !!entity.name &&
        members.has(entity.name),
    );

    const lowCount =
      (ratio(character.hp, character.maxHp) !== null &&
      (ratio(character.hp, character.maxHp) as number) <=
        config.healBelowPercent
        ? 1
        : 0) +
      visible.filter((entity) => {
        const hp = ratio(entity.hp, entity.maxHp);
        return hp !== null && hp <= config.healBelowPercent;
      }).length;

    if (lowCount >= config.partyHealMinTargets) {
      const action = await this.useGroupSkill(
        "partyheal",
        "PARTY_HEAL_THRESHOLD",
        undefined,
        undefined,
        "attack",
      );
      if (action) {
        this.healingTargetId = null;
        this.setStateFromSkill("HEALING", "PARTY_HEAL_DISPATCHED", action);
        return this.status();
      }
    }

    const target = visible
      .map((entity) => ({ entity, hp: ratio(entity.hp, entity.maxHp) }))
      .filter(
        (entry): entry is { entity: EntitySnapshot; hp: number } =>
          entry.hp !== null && entry.hp <= config.healBelowPercent,
      )
      .sort((a, b) => a.hp - b.hp)[0]?.entity;

    if (!target) return null;
    const action = await this.useGroupSkill(
      "heal",
      "LOWEST_PARTY_MEMBER_HP",
      target.id,
      undefined,
      "attack",
    );
    if (!action) return null;

    this.healingTargetId = target.id;
    this.setStateFromSkill("HEALING", "PARTY_MEMBER_HEAL_DISPATCHED", action);
    return this.status();
  }

  private async trySupport(
    config: NormalizedGroupConfig,
    character: CharacterSnapshot,
  ): Promise<GroupCombatStatus | null> {
    if (!config.supportEnabled) return null;
    const entities = this.game.entities();
    const members = new Set(partyMembers(this.game.party()));

    if (character.ctype === "priest") {
      const candidates = entities
        .filter(
          (entity) =>
            entity.type === "character" &&
            !!entity.name &&
            members.has(entity.name),
        )
        .map((entity) => ({
          entity,
          aggro: entities.filter(
            (monster) =>
              monster.type === "monster" &&
              !monster.dead &&
              !monster.rip &&
              (monster.target === entity.id ||
                (!!entity.name && monster.target === entity.name)),
          ).length,
        }))
        .filter((entry) => entry.aggro >= config.absorbAggroCount)
        .sort((a, b) => b.aggro - a.aggro);
      const target = candidates[0]?.entity;
      if (target) {
        const action = await this.useGroupSkill(
          "absorb",
          "PARTY_MEMBER_AGGRO_PRESSURE",
          target.id,
        );
        if (action) {
          this.supportSkill = "absorb";
          this.supportTargetId = target.id;
          this.setStateFromSkill("SUPPORTING", "ABSORB_DISPATCHED", action);
          return this.status();
        }
      }
    }

    if (character.ctype === "mage") {
      const leader = memberEntity(entities, config.leader);
      if (leader) {
        const action = await this.useGroupSkill(
          "reflection",
          "PROTECT_GROUP_LEADER",
          leader.id,
        );
        if (action) {
          this.supportSkill = "reflection";
          this.supportTargetId = leader.id;
          this.setStateFromSkill("SUPPORTING", "REFLECTION_DISPATCHED", action);
          return this.status();
        }
      }
    }

    return null;
  }

  private async tryAoe(
    config: NormalizedGroupConfig,
    character: CharacterSnapshot,
  ): Promise<GroupCombatStatus | null> {
    if (!config.aoeEnabled) return null;

    const monsters = this.game
      .entities()
      .filter(
        (entity) =>
          entity.type === "monster" &&
          !entity.dead &&
          !entity.rip &&
          (!character.map || !entity.map || entity.map === character.map),
      )
      .map((entity) => ({
        entity,
        distance: entityDistance(character, entity),
      }))
      .filter(
        (entry): entry is { entity: EntitySnapshot; distance: number } =>
          entry.distance !== null,
      )
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.entity.id.localeCompare(b.entity.id),
      );

    this.nearbyTargets = monsters.length;

    if (character.ctype === "ranger") {
      if (monsters.length >= 5) {
        const action = await this.useGroupSkill(
          "5shot",
          "AOE_TARGET_THRESHOLD",
          undefined,
          monsters.slice(0, 5).map((entry) => entry.entity.id),
          "attack",
        );
        if (action) {
          this.aoeSkill = "5shot";
          this.setStateFromSkill("AOE", "RANGER_5SHOT_DISPATCHED", action);
          return this.status();
        }
      }
      if (monsters.length >= Math.max(3, config.aoeMinTargets)) {
        const action = await this.useGroupSkill(
          "3shot",
          "AOE_TARGET_THRESHOLD",
          undefined,
          monsters.slice(0, 3).map((entry) => entry.entity.id),
          "attack",
        );
        if (action) {
          this.aoeSkill = "3shot";
          this.setStateFromSkill("AOE", "RANGER_3SHOT_DISPATCHED", action);
          return this.status();
        }
      }
    }

    if (character.ctype === "warrior") {
      const party = new Set(partyMembers(this.game.party()));
      const pressure = monsters.filter(
        (entry) =>
          !!entry.entity.target &&
          party.has(entry.entity.target) &&
          entry.entity.target !== character.name,
      ).length;

      if (pressure >= config.aoeMinTargets) {
        const agitate = await this.useGroupSkill(
          "agitate",
          "GROUP_AGGRO_PRESSURE",
        );
        if (agitate) {
          this.aoeSkill = "agitate";
          this.setStateFromSkill("AOE", "WARRIOR_AGITATE_DISPATCHED", agitate);
          return this.status();
        }
      }

      const cleaveRange =
        this.game.skills(false).find((skill) => skill.key === "cleave")?.range ??
        160;
      const cleaveTargets = monsters.filter(
        (entry) => entry.distance <= (cleaveRange || 160),
      );
      if (cleaveTargets.length >= config.aoeMinTargets) {
        const cleave = await this.useGroupSkill(
          "cleave",
          "AOE_TARGET_THRESHOLD",
        );
        if (cleave) {
          this.aoeSkill = "cleave";
          this.setStateFromSkill("AOE", "WARRIOR_CLEAVE_DISPATCHED", cleave);
          return this.status();
        }
      }
    }

    return null;
  }

  private async tryRangerKiting(
    config: NormalizedGroupConfig,
    character: CharacterSnapshot,
  ): Promise<GroupCombatStatus | null> {
    if (
      !config.rangerKitingEnabled ||
      character.ctype !== "ranger" ||
      character.x === null ||
      character.y === null
    ) {
      return null;
    }

    const targetId =
      this.focusTargetId || this.combat.status().target?.id || character.target;
    const target = targetId ? this.game.entity(targetId) : null;
    if (!target || target.x === null || target.y === null) return null;

    const targetDistance = entityDistance(character, target);
    this.kiteTargetDistance = targetDistance;
    if (
      targetDistance === null ||
      targetDistance >= config.kiteMinDistance
    ) {
      return null;
    }

    const movement = this.movement.status();
    if (movement.owner || movement.active) return null;

    let dx = character.x - target.x;
    let dy = character.y - target.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) {
      dx = 1;
      dy = 0;
    } else {
      dx /= length;
      dy /= length;
    }

    const action = this.movement.direct({
      owner: MOVEMENT_OWNER,
      module: MODULE,
      why: "RANGER_KITE_MIN_DISTANCE",
      x: character.x + dx * config.kiteStep,
      y: character.y + dy * config.kiteStep,
    });
    this.recordAction("RANGER_KITE", action, null, target.id);
    this.kitingActive = true;
    this.setState(
      action.status === "BLOCKED" || action.status === "REJECTED"
        ? "BLOCKED"
        : "KITING",
      action.status === "UNKNOWN"
        ? "RANGER_KITE_OUTCOME_UNKNOWN"
        : "RANGER_KITE_ACTIVE",
    );
    return this.status();
  }

  private async useGroupSkill(
    skillName: string,
    why: string,
    targetId?: string,
    targetIds?: string[],
    sharedCooldown?: string,
  ): Promise<ActionRecord | null> {
    const character = this.game.character();
    const skill = this.game
      .skills(false)
      .find((candidate) => candidate.key === skillName);
    if (
      !skill ||
      skill.passive ||
      !character.ctype ||
      !skill.classes.includes(character.ctype)
    ) {
      return null;
    }

    const cooldowns = this.game.cooldowns();
    if (
      cooldown(cooldowns, skillName) > 0 ||
      (!!sharedCooldown && cooldown(cooldowns, sharedCooldown) > 0)
    ) {
      return null;
    }
    if (
      character.mp !== null &&
      skill.mp !== null &&
      character.mp < skill.mp
    ) {
      return null;
    }

    const target = targetId ? this.game.entity(targetId) : null;
    const action = await this.actions.useSkill({
      skill: skillName,
      ...(targetId && { targetId }),
      ...(targetIds?.length && { targetIds }),
      module: MODULE,
      why,
    });
    this.recordAction("GROUP_SKILL", action, skillName, targetId || null);

    if (action.status === "UNKNOWN") {
      this.unknownSkill = {
        skill: skillName,
        targetId: targetId || null,
        beforeMp: character.mp,
        beforeTargetHp: target?.hp ?? null,
      };
    }
    return action;
  }

  private reconcileUnknownSkill(): boolean {
    const pending = this.unknownSkill;
    if (!pending) return true;

    const character = this.game.character();
    const target = pending.targetId
      ? this.game.entity(pending.targetId)
      : null;
    const observed =
      cooldown(this.game.cooldowns(), pending.skill) > 0 ||
      (character.mp !== null &&
        pending.beforeMp !== null &&
        character.mp < pending.beforeMp) ||
      (!!pending.targetId &&
        (!target ||
          target.dead ||
          target.rip ||
          (target.hp !== null &&
            pending.beforeTargetHp !== null &&
            target.hp !== pending.beforeTargetHp)));

    if (!observed) return false;
    this.unknownSkill = null;
    return true;
  }

  private setStateFromSkill(
    state: GroupCombatState,
    reason: string,
    action: ActionRecord,
  ): void {
    if (action.status === "UNKNOWN") {
      this.setState("BLOCKED", "GROUP_SKILL_OUTCOME_UNKNOWN");
    } else if (
      action.status === "BLOCKED" ||
      action.status === "REJECTED"
    ) {
      this.setState("BLOCKED", "GROUP_SKILL_NOT_DISPATCHED");
    } else {
      this.setState(state, reason);
    }
  }

  private recordAction(
    kind: string,
    action: ActionRecord,
    skill: string | null = null,
    target: string | null = null,
  ): void {
    this.lastAction = {
      id: action.id,
      status: action.status,
      kind,
      ...(skill && { skill }),
      ...(target && { target }),
    };
    this.emit("GROUP_COMBAT_ACTION", kind, action);
  }

  private setState(state: GroupCombatState, reason: string): void {
    const changed = this.currentState !== state || this.currentReason !== reason;
    this.currentState = state;
    this.currentReason = reason;
    this.lastStatusTimestamp = this.now();
    if (changed) {
      this.emit("GROUP_COMBAT_STATE_CHANGED", reason);
    }
  }

  private emit(
    type: GroupCombatControllerEvent["type"],
    reason: string,
    action?: ActionRecord,
  ): void {
    this.onEvent?.({
      type,
      timestamp: this.now(),
      state: this.currentState,
      reason,
      ...(action && {
        actionId: action.id,
        actionStatus: action.status,
      }),
      status: this.status(),
    });
  }
}

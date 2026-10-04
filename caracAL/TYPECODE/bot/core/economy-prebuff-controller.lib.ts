import type {
  CharacterSnapshot,
  CooldownSnapshot,
  SkillSnapshot,
} from "./game-adapter.lib";
import type {
  RiskPolicyStatus,
} from "./risk-policy-controller.lib";

export type EconomyPrebuffState =
  | "DISABLED"
  | "IDLE"
  | "READY"
  | "BLOCKED"
  | "UNSUPPORTED_CLASS";

export type EconomyPrebuffEconomyKind =
  | "UPGRADE"
  | "COMPOUND"
  | "EXCHANGE";

export type EconomyPrebuffSkill =
  | "massproduction"
  | "massproductionpp"
  | "massexchange"
  | "massexchangepp";

export interface EconomyPrebuffCandidate {
  skill: EconomyPrebuffSkill;
  family: "UPGRADE_COMPOUND" | "EXCHANGE";
  tier: "BASE" | "ENHANCED";
  reductionPercent: 50 | 90;
  configured: boolean;
  available: boolean;
  ready: boolean;
  reason: string;
  levelRequired: number | null;
  mpCost: number | null;
  cooldownRemainingMs: number;
}

export interface EconomyPrebuffStatus {
  timestamp: number;
  enabled: boolean;
  state: EconomyPrebuffState;
  reason: string;
  characterClass: string | null;
  demand: {
    kind: EconomyPrebuffEconomyKind | null;
    name: string | null;
    riskPolicyState: RiskPolicyStatus["state"];
    unknown: number;
  };
  selectedSkill: EconomyPrebuffSkill | null;
  candidates: EconomyPrebuffCandidate[];
  policy: {
    preferEnhanced: boolean;
    buffLifetimeMs: 10000;
    upgradeCompoundSkills: [
      "massproductionpp",
      "massproduction",
    ];
    exchangeSkills: ["massexchangepp", "massexchange"];
    exchangeDemandSupported: false;
    arbiterLaneActivationEnabled: false;
    executionEnabled: false;
    valueMutationForced: false;
    sourceRepository: "kaansoral/adventureland_mongodb";
    sourceCommit: "c0f405fd356d99d762ad44644ebfdbab8b4d12e4";
  };
}

export interface EconomyPrebuffEvent {
  type: "ECONOMY_PREBUFF_UPDATED";
  timestamp: number;
  reason: string;
  status: EconomyPrebuffStatus;
}

interface EconomyPrebuffGame {
  character(): CharacterSnapshot;
  skills(characterOnly?: boolean): SkillSnapshot[];
  cooldowns(): CooldownSnapshot[];
}

interface EconomyPrebuffRiskPolicy {
  status(): RiskPolicyStatus;
}

export interface EconomyPrebuffControllerOptions {
  config?: () => unknown;
  now?: () => number;
  onEvent?: (event: EconomyPrebuffEvent) => void;
}

interface NormalizedConfig {
  enabled: boolean;
  preferEnhanced: boolean;
  merchantSkillsEnabled: boolean;
  configuredSkills: Set<EconomyPrebuffSkill>;
}

const SOURCE_REPOSITORY = "kaansoral/adventureland_mongodb" as const;
const SOURCE_COMMIT =
  "c0f405fd356d99d762ad44644ebfdbab8b4d12e4" as const;

const SKILL_DEFINITIONS: Record<
  EconomyPrebuffSkill,
  {
    family: "UPGRADE_COMPOUND" | "EXCHANGE";
    tier: "BASE" | "ENHANCED";
    reductionPercent: 50 | 90;
  }
> = {
  massproduction: {
    family: "UPGRADE_COMPOUND",
    tier: "BASE",
    reductionPercent: 50,
  },
  massproductionpp: {
    family: "UPGRADE_COMPOUND",
    tier: "ENHANCED",
    reductionPercent: 90,
  },
  massexchange: {
    family: "EXCHANGE",
    tier: "BASE",
    reductionPercent: 50,
  },
  massexchangepp: {
    family: "EXCHANGE",
    tier: "ENHANCED",
    reductionPercent: 90,
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function configured(value: unknown): boolean {
  if (value === true) return true;
  return record(value).enabled === true;
}

function normalizeConfig(value: unknown): NormalizedConfig {
  const root = record(value);
  const prebuff = record(
    root.economyPrebuff ?? root.economy_prebuff,
  );
  const classSkills = record(root.classSkills ?? root.class_skills);
  const merchant = record(classSkills.merchant);
  const rawSkills = record(merchant.skills);
  const configuredSkills = new Set<EconomyPrebuffSkill>();

  for (const skill of Object.keys(SKILL_DEFINITIONS) as EconomyPrebuffSkill[]) {
    if (configured(rawSkills[skill])) configuredSkills.add(skill);
  }

  return {
    enabled: prebuff.enabled !== false,
    preferEnhanced: prebuff.preferEnhanced !== false,
    merchantSkillsEnabled: merchant.enabled === true,
    configuredSkills,
  };
}

function cooldownRemaining(
  cooldowns: CooldownSnapshot[],
  skill: EconomyPrebuffSkill,
): number {
  return (
    cooldowns.find((entry) => entry.skill === skill)?.remainingMs || 0
  );
}

export function economyPrebuffSkillsForKind(
  kind: EconomyPrebuffEconomyKind,
  preferEnhanced = true,
): EconomyPrebuffSkill[] {
  const base =
    kind === "EXCHANGE"
      ? (["massexchange", "massexchangepp"] as EconomyPrebuffSkill[])
      : (["massproduction", "massproductionpp"] as EconomyPrebuffSkill[]);

  return preferEnhanced ? [...base].reverse() : base;
}

export class EconomyPrebuffController {
  private readonly configSource: () => unknown;
  private readonly now: () => number;
  private readonly onEvent?: (event: EconomyPrebuffEvent) => void;
  private configOverride: unknown | undefined;
  private lastEventSignature: string | null = null;
  private lastStatus: EconomyPrebuffStatus;

  constructor(
    private readonly game: EconomyPrebuffGame,
    private readonly riskPolicy: EconomyPrebuffRiskPolicy,
    options: EconomyPrebuffControllerOptions = {},
  ) {
    this.configSource = options.config || (() => ({}));
    this.now = options.now || (() => Date.now());
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      true,
      "IDLE",
      "ECONOMY_PREBUFF_NO_ECONOMY_SELECTION",
      null,
      null,
      "EMPTY",
      0,
      normalizeConfig({}),
    );
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  status(): EconomyPrebuffStatus {
    return this.lastStatus;
  }

  tick(): EconomyPrebuffStatus {
    const timestamp = this.now();
    const config = normalizeConfig(
      this.configOverride === undefined
        ? this.configSource()
        : this.configOverride,
    );
    const risk = this.riskPolicy.status();
    const character = this.game.character();

    if (!config.enabled) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          false,
          "DISABLED",
          "ECONOMY_PREBUFF_DISABLED",
          null,
          null,
          risk.state,
          risk.summary.unknown,
          config,
        ),
      );
    }

    if (character.ctype !== "merchant") {
      return this.publish(
        this.emptyStatus(
          timestamp,
          true,
          "UNSUPPORTED_CLASS",
          "ECONOMY_PREBUFF_REQUIRES_MERCHANT",
          risk.selected?.kind || null,
          risk.selected?.name || null,
          risk.state,
          risk.summary.unknown,
          config,
        ),
      );
    }

    if (risk.state === "PARTIAL" || risk.summary.unknown > 0) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          true,
          "BLOCKED",
          "ECONOMY_PREBUFF_RISK_POLICY_UNKNOWN",
          risk.selected?.kind || null,
          risk.selected?.name || null,
          risk.state,
          risk.summary.unknown,
          config,
        ),
      );
    }

    if (!risk.selected) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          true,
          "IDLE",
          "ECONOMY_PREBUFF_NO_ECONOMY_SELECTION",
          null,
          null,
          risk.state,
          risk.summary.unknown,
          config,
        ),
      );
    }

    const kind = risk.selected.kind;
    const skills = economyPrebuffSkillsForKind(
      kind,
      config.preferEnhanced,
    );
    const skillSnapshots = this.game.skills(false);
    const cooldowns = this.game.cooldowns();
    const candidates = skills.map((skill) =>
      this.candidate(
        skill,
        character,
        skillSnapshots,
        cooldowns,
        config,
      ),
    );
    const selected =
      candidates.find((candidate) => candidate.ready) || null;
    const demand = {
      kind,
      name: risk.selected.name,
      riskPolicyState: risk.state,
      unknown: risk.summary.unknown,
    };

    if (!config.merchantSkillsEnabled || !candidates.some((entry) => entry.configured)) {
      return this.publish({
        timestamp,
        enabled: true,
        state: "BLOCKED",
        reason: "ECONOMY_PREBUFF_NO_CONFIGURED_SKILL",
        characterClass: character.ctype,
        demand,
        selectedSkill: null,
        candidates,
        policy: this.policy(config),
      });
    }

    if (!selected) {
      return this.publish({
        timestamp,
        enabled: true,
        state: "BLOCKED",
        reason: "ECONOMY_PREBUFF_SKILL_NOT_READY",
        characterClass: character.ctype,
        demand,
        selectedSkill: null,
        candidates,
        policy: this.policy(config),
      });
    }

    return this.publish({
      timestamp,
      enabled: true,
      state: "READY",
      reason: "ECONOMY_PREBUFF_READY",
      characterClass: character.ctype,
      demand,
      selectedSkill: selected.skill,
      candidates,
      policy: this.policy(config),
    });
  }

  private candidate(
    skill: EconomyPrebuffSkill,
    character: CharacterSnapshot,
    skills: SkillSnapshot[],
    cooldowns: CooldownSnapshot[],
    config: NormalizedConfig,
  ): EconomyPrebuffCandidate {
    const definition = SKILL_DEFINITIONS[skill];
    const snapshot = skills.find((entry) => entry.key === skill) || null;
    const isConfigured =
      config.merchantSkillsEnabled && config.configuredSkills.has(skill);
    const remaining = cooldownRemaining(cooldowns, skill);
    let available = true;
    let ready = true;
    let reason = "ECONOMY_PREBUFF_SKILL_READY";

    if (!isConfigured) {
      available = false;
      ready = false;
      reason = "ECONOMY_PREBUFF_SKILL_NOT_CONFIGURED";
    } else if (
      !snapshot ||
      snapshot.passive ||
      !snapshot.classes.includes("merchant")
    ) {
      available = false;
      ready = false;
      reason = "ECONOMY_PREBUFF_SKILL_UNAVAILABLE";
    } else if (
      snapshot.level !== null &&
      character.level !== null &&
      character.level < snapshot.level
    ) {
      ready = false;
      reason = "ECONOMY_PREBUFF_LEVEL_INSUFFICIENT";
    } else if (
      snapshot.mp !== null &&
      character.mp !== null &&
      character.mp < snapshot.mp
    ) {
      ready = false;
      reason = "ECONOMY_PREBUFF_MP_INSUFFICIENT";
    } else if (remaining > 0) {
      ready = false;
      reason = "ECONOMY_PREBUFF_COOLDOWN";
    }

    return {
      skill,
      ...definition,
      configured: isConfigured,
      available,
      ready,
      reason,
      levelRequired: snapshot?.level ?? null,
      mpCost: snapshot?.mp ?? null,
      cooldownRemainingMs: remaining,
    };
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: EconomyPrebuffState,
    reason: string,
    kind: EconomyPrebuffEconomyKind | null,
    name: string | null,
    riskPolicyState: RiskPolicyStatus["state"],
    unknown: number,
    config: NormalizedConfig,
  ): EconomyPrebuffStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      characterClass: this.game.character().ctype,
      demand: {
        kind,
        name,
        riskPolicyState,
        unknown,
      },
      selectedSkill: null,
      candidates: [],
      policy: this.policy(config),
    };
  }

  private policy(config: NormalizedConfig): EconomyPrebuffStatus["policy"] {
    return {
      preferEnhanced: config.preferEnhanced,
      buffLifetimeMs: 10000,
      upgradeCompoundSkills: [
        "massproductionpp",
        "massproduction",
      ],
      exchangeSkills: ["massexchangepp", "massexchange"],
      exchangeDemandSupported: false,
      arbiterLaneActivationEnabled: false,
      executionEnabled: false,
      valueMutationForced: false,
      sourceRepository: SOURCE_REPOSITORY,
      sourceCommit: SOURCE_COMMIT,
    };
  }

  private publish(status: EconomyPrebuffStatus): EconomyPrebuffStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      characterClass: status.characterClass,
      demand: status.demand,
      selectedSkill: status.selectedSkill,
      candidates: status.candidates,
      policy: status.policy,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "ECONOMY_PREBUFF_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

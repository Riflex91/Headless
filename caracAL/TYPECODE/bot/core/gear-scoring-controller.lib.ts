import type {
  CharacterSnapshot,
  EquipmentSnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";

export const GEAR_SCORE_STAT_KEYS = [
  "attack",
  "armor",
  "resistance",
  "str",
  "int",
  "dex",
  "vit",
  "hp",
  "mp",
  "frequency",
  "range",
  "speed",
  "crit",
  "evasion",
  "reflection",
  "apiercing",
  "rpiercing",
  "lifesteal",
] as const;

export type GearScoreStat = (typeof GEAR_SCORE_STAT_KEYS)[number];

export const DEFAULT_GEAR_SCORE_WEIGHTS: Record<GearScoreStat, number> = {
  attack: 1,
  armor: 0.5,
  resistance: 0.5,
  str: 2,
  int: 2,
  dex: 2,
  vit: 1.5,
  hp: 0.05,
  mp: 0.03,
  frequency: 50,
  range: 0.1,
  speed: 0.1,
  crit: 5,
  evasion: 5,
  reflection: 5,
  apiercing: 0.5,
  rpiercing: 0.5,
  lifesteal: 5,
};

export type GearScoringState = "DISABLED" | "EMPTY" | "READY";
export type GearScoringLocation = "INVENTORY" | "EQUIPMENT";

export interface GearScoringEntry {
  location: GearScoringLocation;
  slot: number | string;
  name: string | null;
  level: number;
  definitionKnown: boolean;
  itemType: string | null;
  slotGroup: string | null;
  score: number | null;
  stats: Partial<Record<GearScoreStat, number>>;
  contributions: Partial<Record<GearScoreStat, number>>;
  why: string;
}

export interface GearScoringSummary {
  inventoryGear: number;
  equippedGear: number;
  scoredItems: number;
  unknownItems: number;
  equipmentScore: number;
  bestInventoryScore: number | null;
}

export interface GearScoringStatus {
  timestamp: number;
  enabled: boolean;
  state: GearScoringState;
  reason: string;
  characterClass: string | null;
  profile: string;
  weights: Record<GearScoreStat, number>;
  entries: GearScoringEntry[];
  summary: GearScoringSummary;
}

export interface GearScoringEvent {
  type: "GEAR_SCORING_UPDATED";
  timestamp: number;
  reason: string;
  status: GearScoringStatus;
}

export interface GearScoringControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: GearScoringEvent) => void;
}

interface GearScoringGameAdapter {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  equipment(): EquipmentSnapshot;
  gameData(): Record<string, unknown>;
}

interface NormalizedGearScoringConfig {
  enabled: boolean;
  profile: string;
  weights: Record<GearScoreStat, number>;
}

const EQUIPMENT_TYPES = new Set([
  "weapon",
  "armor",
  "helmet",
  "earring",
  "amulet",
  "cape",
  "chest",
  "ring",
  "belt",
  "orb",
  "pants",
  "gloves",
  "shoes",
  "shield",
  "source",
  "quiver",
  "elixir",
]);

const SLOT_GROUP_BY_TYPE: Record<string, string> = {
  weapon: "weapon",
  armor: "armor",
  helmet: "helmet",
  earring: "earring",
  amulet: "amulet",
  cape: "cape",
  chest: "chest",
  ring: "ring",
  belt: "belt",
  orb: "orb",
  pants: "pants",
  gloves: "gloves",
  shoes: "shoes",
  shield: "offhand",
  source: "offhand",
  quiver: "offhand",
  elixir: "elixir",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeWeights(
  value: unknown,
  base: Record<GearScoreStat, number>,
): Record<GearScoreStat, number> {
  const configured = record(value);
  const result = { ...base };

  for (const key of GEAR_SCORE_STAT_KEYS) {
    const weight = finite(configured[key]);
    if (weight !== null) result[key] = weight;
  }

  return result;
}

function normalizeConfig(
  value: unknown,
  characterClass: string | null,
): NormalizedGearScoringConfig {
  const root = record(value);
  const gear = record(root.gear);
  const scoring = record(gear.scoring);
  const classWeights = record(scoring.classWeights);
  const genericWeights = normalizeWeights(
    scoring.weights,
    DEFAULT_GEAR_SCORE_WEIGHTS,
  );
  const classSpecific = characterClass
    ? normalizeWeights(classWeights[characterClass], genericWeights)
    : genericWeights;

  return {
    enabled: bool(scoring.enabled ?? gear.scoringEnabled, true),
    profile: text(scoring.profile) || characterClass || "generic",
    weights: classSpecific,
  };
}

function definitionType(
  definition: Record<string, unknown>,
): string | null {
  return text(definition.type)?.toLowerCase() || null;
}

function isGearDefinition(definition: Record<string, unknown>): boolean {
  const type = definitionType(definition);
  return (
    (type !== null && EQUIPMENT_TYPES.has(type)) ||
    text(definition.wtype) !== null ||
    text(definition.slot) !== null
  );
}

function slotGroup(definition: Record<string, unknown>): string | null {
  const explicit = text(definition.slot);
  if (explicit) return explicit.toLowerCase();

  const type = definitionType(definition);
  if (type && SLOT_GROUP_BY_TYPE[type]) return SLOT_GROUP_BY_TYPE[type];
  if (text(definition.wtype)) return "weapon";
  return null;
}

function effectiveStats(
  item: Record<string, unknown>,
  definition: Record<string, unknown>,
): Partial<Record<GearScoreStat, number>> {
  const result: Partial<Record<GearScoreStat, number>> = {};
  const level = Math.max(0, Math.floor(finite(item.level) ?? 0));
  const upgrade = record(definition.upgrade);

  for (const key of GEAR_SCORE_STAT_KEYS) {
    const base = finite(definition[key]) ?? 0;
    const perLevel = finite(upgrade[key]) ?? 0;
    const value = round(base + perLevel * level);
    if (value !== 0) result[key] = value;
  }

  return result;
}

function scoreStats(
  stats: Partial<Record<GearScoreStat, number>>,
  weights: Record<GearScoreStat, number>,
): {
  score: number;
  contributions: Partial<Record<GearScoreStat, number>>;
} {
  const contributions: Partial<Record<GearScoreStat, number>> = {};
  let score = 0;

  for (const key of GEAR_SCORE_STAT_KEYS) {
    const stat = stats[key];
    if (stat === undefined) continue;
    const contribution = round(stat * weights[key]);
    contributions[key] = contribution;
    score += contribution;
  }

  return {
    score: round(score),
    contributions,
  };
}

function knownDefinition(
  itemDefinitions: Record<string, unknown>,
  name: string | null,
): Record<string, unknown> | null {
  if (!name) return null;
  const value = itemDefinitions[name];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function entryFor(
  location: GearScoringLocation,
  slot: number | string,
  rawItem: unknown,
  itemDefinitions: Record<string, unknown>,
  weights: Record<GearScoreStat, number>,
  forceGear: boolean,
): GearScoringEntry | null {
  const item = record(rawItem);
  const name = text(item.name);
  const definition = knownDefinition(itemDefinitions, name);

  if (!forceGear && (!definition || !isGearDefinition(definition))) {
    return null;
  }

  const level = Math.max(0, Math.floor(finite(item.level) ?? 0));
  if (!definition) {
    return {
      location,
      slot,
      name,
      level,
      definitionKnown: false,
      itemType: null,
      slotGroup: location === "EQUIPMENT" ? String(slot) : null,
      score: null,
      stats: {},
      contributions: {},
      why: "GEAR_SCORE_UNKNOWN_ITEM_METADATA",
    };
  }

  const stats = effectiveStats(item, definition);
  const scored = scoreStats(stats, weights);

  return {
    location,
    slot,
    name,
    level,
    definitionKnown: true,
    itemType: definitionType(definition),
    slotGroup:
      location === "EQUIPMENT" ? String(slot) : slotGroup(definition),
    score: scored.score,
    stats,
    contributions: scored.contributions,
    why:
      Object.keys(stats).length > 0
        ? "GEAR_SCORE_WEIGHTED_ADVENTURE_LAND_STATS"
        : "GEAR_SCORE_NO_SCORABLE_STATS",
  };
}

function emptySummary(): GearScoringSummary {
  return {
    inventoryGear: 0,
    equippedGear: 0,
    scoredItems: 0,
    unknownItems: 0,
    equipmentScore: 0,
    bestInventoryScore: null,
  };
}

export class GearScoringController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: GearScoringEvent) => void;
  private lastEventSignature: string | null = null;
  private lastStatus: GearScoringStatus;

  constructor(
    private readonly game: GearScoringGameAdapter,
    options: GearScoringControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    const characterClass = this.game.character().ctype;
    const config = normalizeConfig(this.configSource(), characterClass);
    this.lastStatus = this.emptyStatus(
      this.now(),
      config.enabled,
      config.enabled ? "EMPTY" : "DISABLED",
      config.enabled ? "GEAR_SCORING_EMPTY" : "GEAR_SCORING_DISABLED",
      characterClass,
      config,
    );
  }

  status(): GearScoringStatus {
    return this.lastStatus;
  }

  tick(): GearScoringStatus {
    const timestamp = this.now();
    const characterClass = this.game.character().ctype;
    const config = normalizeConfig(this.configSource(), characterClass);

    if (!config.enabled) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          false,
          "DISABLED",
          "GEAR_SCORING_DISABLED",
          characterClass,
          config,
        ),
      );
    }

    const gameData = record(this.game.gameData());
    const itemDefinitions = record(gameData.items);
    const entries: GearScoringEntry[] = [];

    for (const inventorySlot of this.game.inventory()) {
      if (!inventorySlot.item) continue;
      const entry = entryFor(
        "INVENTORY",
        inventorySlot.slot,
        inventorySlot.item,
        itemDefinitions,
        config.weights,
        false,
      );
      if (entry) entries.push(entry);
    }

    for (const [slot, item] of Object.entries(this.game.equipment())) {
      if (!item) continue;
      const entry = entryFor(
        "EQUIPMENT",
        slot,
        item,
        itemDefinitions,
        config.weights,
        true,
      );
      if (entry) entries.push(entry);
    }

    const inventoryEntries = entries.filter(
      (entry) => entry.location === "INVENTORY",
    );
    const equipmentEntries = entries.filter(
      (entry) => entry.location === "EQUIPMENT",
    );
    const inventoryScores = inventoryEntries
      .map((entry) => entry.score)
      .filter((score): score is number => score !== null);
    const summary: GearScoringSummary = {
      inventoryGear: inventoryEntries.length,
      equippedGear: equipmentEntries.length,
      scoredItems: entries.filter((entry) => entry.score !== null).length,
      unknownItems: entries.filter((entry) => !entry.definitionKnown).length,
      equipmentScore: round(
        equipmentEntries.reduce(
          (sum, entry) => sum + (entry.score ?? 0),
          0,
        ),
      ),
      bestInventoryScore:
        inventoryScores.length > 0
          ? Math.max(...inventoryScores)
          : null,
    };

    const status: GearScoringStatus = {
      timestamp,
      enabled: true,
      state: entries.length > 0 ? "READY" : "EMPTY",
      reason:
        entries.length > 0 ? "GEAR_SCORING_READY" : "GEAR_SCORING_EMPTY",
      characterClass,
      profile: config.profile,
      weights: { ...config.weights },
      entries,
      summary,
    };

    return this.publish(status);
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: GearScoringState,
    reason: string,
    characterClass: string | null,
    config: NormalizedGearScoringConfig,
  ): GearScoringStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      characterClass,
      profile: config.profile,
      weights: { ...config.weights },
      entries: [],
      summary: emptySummary(),
    };
  }

  private publish(status: GearScoringStatus): GearScoringStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      characterClass: status.characterClass,
      profile: status.profile,
      weights: status.weights,
      entries: status.entries,
      summary: status.summary,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "GEAR_SCORING_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

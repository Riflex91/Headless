import type {
  CharacterSnapshot,
  EntitySnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";

const MODULE = "FarmIntelligence";
const HOUR_MS = 60 * 60 * 1000;

export type FarmIntelligenceState = "DISABLED" | "NO_CANDIDATES" | "READY";

export interface FarmWeights {
  xp: number;
  gold: number;
  drops: number;
  goal: number;
  danger: number;
  travel: number;
  respawn: number;
  partyDps: number;
  tankSafety: number;
  observed: number;
}

export interface FarmObservedPerformance {
  sampleMs: number;
  xpPerHour: number;
  goldPerHour: number;
  dropsPerHour: number;
  updatedAt: number;
}

export interface FarmCandidateStatus {
  farmKey: string;
  monster: string;
  map: string;
  x: number | null;
  y: number | null;
  spawnCount: number;
  score: number;
  components: {
    xpPerHourPotential: number | null;
    goldPerHourPotential: number | null;
    dropPotential: number | null;
    goalUtility: number | null;
    danger: number | null;
    travelCost: number | null;
    respawnEfficiency: number | null;
    partyDpsFit: number | null;
    tankSafety: number | null;
    observedPerformance: number | null;
  };
  componentScores: {
    xp: number;
    gold: number;
    drops: number;
    goal: number;
    danger: number;
    travel: number;
    respawn: number;
    partyDps: number;
    tankSafety: number;
    observed: number;
  };
  estimated: {
    monsterHp: number | null;
    monsterAttack: number | null;
    monsterFrequency: number | null;
    xpPerKill: number | null;
    goldPerKill: number | null;
    respawnSeconds: number | null;
    killsPerHour: number | null;
    partyDps: number | null;
    tankHp: number | null;
    dropItems: string[];
  };
  observed: FarmObservedPerformance | null;
  whyMonster: string;
  whySpot: string;
}

export interface FarmIntelligenceStatus {
  timestamp: number;
  enabled: boolean;
  state: FarmIntelligenceState;
  reason: string;
  selected: FarmCandidateStatus | null;
  candidates: FarmCandidateStatus[];
  weights: FarmWeights;
  preferredMonsters: string[];
  forbiddenMonsters: string[];
  goalMonster: string | null;
  goalItems: string[];
}

export interface FarmIntelligenceSample {
  farmKey: string;
  monster: string;
  map: string;
  startedAt: number;
  endedAt: number;
  stats: FarmObservedPerformance & {
    xpDelta: number;
    goldDelta: number;
    dropDelta: number;
  };
}

export interface FarmIntelligenceEvent {
  type: "FARM_INTELLIGENCE_UPDATED" | "FARM_INTELLIGENCE_SAMPLE";
  timestamp: number;
  reason: string;
  status: FarmIntelligenceStatus;
  sample?: FarmIntelligenceSample;
}

export interface FarmIntelligenceControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: FarmIntelligenceEvent) => void;
}

interface FarmGameAdapter {
  character(): CharacterSnapshot;
  entities(): EntitySnapshot[];
  party(): Record<string, unknown>;
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
}

interface NormalizedFarmConfig {
  enabled: boolean;
  preferredMonsters: string[];
  forbiddenMonsters: string[];
  goalMonster: string | null;
  goalItems: string[];
  weights: FarmWeights;
  mapChangePenalty: number;
  observationSampleMs: number;
  observationWindowMs: number;
  maxCandidates: number;
}

interface MonsterDefinition {
  monster: string;
  hp: number | null;
  xp: number | null;
  attack: number | null;
  frequency: number | null;
  respawnSeconds: number | null;
  gold: number | null;
  dropItems: string[];
}

interface FarmSpot {
  farmKey: string;
  monster: string;
  map: string;
  x: number | null;
  y: number | null;
  count: number;
  respawnSeconds: number | null;
}

interface FarmCatalog {
  monsters: Map<string, MonsterDefinition>;
  spots: FarmSpot[];
}

interface RawCandidate {
  spot: FarmSpot;
  definition: MonsterDefinition;
  observed: FarmObservedPerformance | null;
  raw: FarmCandidateStatus["components"];
  estimated: FarmCandidateStatus["estimated"];
}

interface ObservationBaseline {
  farmKey: string;
  monster: string;
  map: string;
  timestamp: number;
  xp: number | null;
  gold: number | null;
  itemQuantity: number;
}

const DEFAULT_WEIGHTS: FarmWeights = Object.freeze({
  xp: 1,
  gold: 1,
  drops: 0.8,
  goal: 1.2,
  danger: 1.2,
  travel: 0.6,
  respawn: 0.6,
  partyDps: 0.8,
  tankSafety: 1,
  observed: 1.4,
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown, fallback: number): number {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function weight(value: unknown, fallback: number): number {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : fallback;
}

function normalizeConfig(value: unknown): NormalizedFarmConfig {
  const root = record(value);
  const farming = record(root.farming);
  const weights = record(farming.weights);

  return {
    enabled: bool(farming.enabled ?? farming.autoFarming, false),
    preferredMonsters: stringList(
      farming.preferredMonsters ?? farming.preferred_monsters,
    ),
    forbiddenMonsters: stringList(
      farming.forbiddenMonsters ?? farming.forbidden_monsters,
    ),
    goalMonster: text(
      farming.goalMonster ?? farming.farmTarget ?? farming.farmziel,
    ),
    goalItems: stringList(farming.goalItems ?? farming.goal_items),
    weights: {
      xp: weight(weights.xp, DEFAULT_WEIGHTS.xp),
      gold: weight(weights.gold, DEFAULT_WEIGHTS.gold),
      drops: weight(weights.drops ?? weights.drop, DEFAULT_WEIGHTS.drops),
      goal: weight(weights.goal ?? weights.goalUtility, DEFAULT_WEIGHTS.goal),
      danger: weight(weights.danger, DEFAULT_WEIGHTS.danger),
      travel: weight(weights.travel ?? weights.travelCost, DEFAULT_WEIGHTS.travel),
      respawn: weight(weights.respawn, DEFAULT_WEIGHTS.respawn),
      partyDps: weight(weights.partyDps ?? weights.party_dps, DEFAULT_WEIGHTS.partyDps),
      tankSafety: weight(
        weights.tankSafety ?? weights.tank_safety,
        DEFAULT_WEIGHTS.tankSafety,
      ),
      observed: weight(
        weights.observed ?? weights.observedPerformance,
        DEFAULT_WEIGHTS.observed,
      ),
    },
    mapChangePenalty: positive(
      farming.mapChangePenalty ?? farming.map_change_penalty,
      2500,
    ),
    observationSampleMs: Math.max(
      1000,
      positive(
        farming.observationSampleMs ?? farming.observation_sample_ms,
        5000,
      ),
    ),
    observationWindowMs: Math.max(
      5000,
      positive(
        farming.observationWindowMs ?? farming.observation_window_ms,
        60000,
      ),
    ),
    maxCandidates: Math.max(
      1,
      Math.min(100, Math.floor(positive(farming.maxCandidates, 12))),
    ),
  };
}

function firstFinite(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = finite(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function goldValue(value: unknown): number | null {
  const direct = finite(value);
  if (direct !== null) return direct;
  const source = record(value);
  const average = firstFinite(source, ["average", "avg", "gold"]);
  if (average !== null) return average;
  const min = firstFinite(source, ["min", "minimum"]);
  const max = firstFinite(source, ["max", "maximum"]);
  if (min !== null && max !== null) return (min + max) / 2;
  return min ?? max;
}

function seconds(value: unknown): number | null {
  const raw = finite(value);
  if (raw === null || raw <= 0) return null;
  return raw > 1000 ? raw / 1000 : raw;
}

function pointFrom(value: unknown): { x: number; y: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = finite(value[0]);
  const y = finite(value[1]);
  return x === null || y === null ? null : { x, y };
}

function spawnPoint(spawn: Record<string, unknown>): { x: number; y: number } | null {
  const x = finite(spawn.x);
  const y = finite(spawn.y);
  if (x !== null && y !== null) return { x, y };

  const position = pointFrom(spawn.position);
  if (position) return position;

  const boundary = spawn.boundary;
  if (Array.isArray(boundary)) {
    if (boundary.length >= 4) {
      const x1 = finite(boundary[0]);
      const y1 = finite(boundary[1]);
      const x2 = finite(boundary[2]);
      const y2 = finite(boundary[3]);
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      }
    }
    const points = boundary
      .map((entry) => pointFrom(entry))
      .filter((entry): entry is { x: number; y: number } => entry !== null);
    if (points.length) {
      return {
        x: points.reduce((sum, entry) => sum + entry.x, 0) / points.length,
        y: points.reduce((sum, entry) => sum + entry.y, 0) / points.length,
      };
    }
  }

  const boundaries = Array.isArray(spawn.boundaries) ? spawn.boundaries : [];
  const boundaryEntries: unknown[] = [];
  for (const entry of boundaries) {
    if (Array.isArray(entry)) boundaryEntries.push(...entry);
  }
  const points = boundaryEntries
    .map((entry) => pointFrom(entry))
    .filter((entry): entry is { x: number; y: number } => entry !== null);
  if (points.length) {
    return {
      x: points.reduce((sum, entry) => sum + entry.x, 0) / points.length,
      y: points.reduce((sum, entry) => sum + entry.y, 0) / points.length,
    };
  }

  return null;
}

function spawnTypes(spawn: Record<string, unknown>): string[] {
  const direct = spawn.type;
  if (typeof direct === "string" && direct.trim()) return [direct.trim()];
  if (Array.isArray(direct)) return stringList(direct);
  const types = stringList(spawn.types);
  if (types.length) return types;
  return stringList(spawn.monsters);
}

function collectDropItems(
  value: unknown,
  knownItems: Set<string>,
  result = new Set<string>(),
  depth = 0,
): Set<string> {
  if (depth > 6 || value === null || value === undefined) return result;
  if (typeof value === "string") {
    if (knownItems.has(value)) result.add(value);
    return result;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectDropItems(entry, knownItems, result, depth + 1);
    return result;
  }
  if (typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (knownItems.has(key)) result.add(key);
    collectDropItems(entry, knownItems, result, depth + 1);
  }
  return result;
}

function inventoryQuantity(inventory: InventorySlotSnapshot[]): number {
  let total = 0;
  for (const slot of inventory) {
    if (!slot.item) continue;
    const q = finite(slot.item.q);
    total += q !== null && q > 0 ? q : 1;
  }
  return total;
}

function dps(attack: number | null, frequency: number | null): number | null {
  if (attack === null || attack <= 0) return null;
  return attack * (frequency !== null && frequency > 0 ? frequency : 1);
}

function distance(
  x1: number | null,
  y1: number | null,
  x2: number | null,
  y2: number | null,
): number | null {
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  return Math.hypot(x2 - x1, y2 - y1);
}

function normalizedBenefit(values: Array<number | null>, index: number): number {
  const value = values[index];
  if (value === null) return 50;
  const known = values.filter((entry): entry is number => entry !== null);
  if (!known.length) return 50;
  const min = Math.min(...known);
  const max = Math.max(...known);
  if (max === min) return max === 0 ? 50 : 100;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function normalizedCost(values: Array<number | null>, index: number): number {
  const value = values[index];
  if (value === null) return 50;
  const known = values.filter((entry): entry is number => entry !== null);
  if (!known.length) return 50;
  const min = Math.min(...known);
  const max = Math.max(...known);
  if (max === min) return max === 0 ? 100 : 75;
  return Math.max(0, Math.min(100, ((max - value) / (max - min)) * 100));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function observedValue(observed: FarmObservedPerformance | null): number | null {
  if (!observed) return null;
  return (
    Math.log1p(Math.max(0, observed.xpPerHour)) +
    Math.log1p(Math.max(0, observed.goldPerHour)) +
    Math.log1p(Math.max(0, observed.dropsPerHour) * 100)
  );
}

function whyMonster(candidate: FarmCandidateStatus): string {
  const entries: Array<[string, number]> = [
    ["XP", candidate.componentScores.xp],
    ["Gold", candidate.componentScores.gold],
    ["Drops", candidate.componentScores.drops],
    ["Goal", candidate.componentScores.goal],
    ["Safety", candidate.componentScores.danger],
    ["Respawn", candidate.componentScores.respawn],
    ["Party DPS", candidate.componentScores.partyDps],
    ["Tank", candidate.componentScores.tankSafety],
    ["Observed", candidate.componentScores.observed],
  ];
  const strongest = entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([label, score]) => `${label} ${Math.round(score)}`)
    .join(" · ");
  return `${candidate.monster}: Score ${candidate.score} · ${strongest}`;
}

function whySpot(candidate: FarmCandidateStatus, currentMap: string | null): string {
  const place =
    candidate.x !== null && candidate.y !== null
      ? `${candidate.map} @ ${Math.round(candidate.x)}, ${Math.round(candidate.y)}`
      : candidate.map;
  const locality = candidate.map === currentMap ? "same map" : "map travel";
  const travel =
    candidate.components.travelCost === null
      ? "travel unknown"
      : `travel ${Math.round(candidate.components.travelCost)}`;
  return `${place} · ${locality} · ${travel} · spawn ${candidate.spawnCount}`;
}

export class FarmIntelligenceController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: FarmIntelligenceEvent) => void;
  private catalog: FarmCatalog | null = null;
  private observed = new Map<string, FarmObservedPerformance>();
  private observationBaseline: ObservationBaseline | null = null;
  private selectedFarmKey: string | null = null;
  private lastSelectionSignature = "";
  private currentStatus: FarmIntelligenceStatus;

  constructor(
    private readonly game: FarmGameAdapter,
    options: FarmIntelligenceControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.currentStatus = {
      timestamp: this.now(),
      enabled: false,
      state: "DISABLED",
      reason: "FARM_INTELLIGENCE_DISABLED",
      selected: null,
      candidates: [],
      weights: { ...DEFAULT_WEIGHTS },
      preferredMonsters: [],
      forbiddenMonsters: [],
      goalMonster: null,
      goalItems: [],
    };
  }

  status(): FarmIntelligenceStatus {
    return {
      ...this.currentStatus,
      weights: { ...this.currentStatus.weights },
      preferredMonsters: [...this.currentStatus.preferredMonsters],
      forbiddenMonsters: [...this.currentStatus.forbiddenMonsters],
      goalItems: [...this.currentStatus.goalItems],
      selected: this.currentStatus.selected
        ? this.cloneCandidate(this.currentStatus.selected)
        : null,
      candidates: this.currentStatus.candidates.map((candidate) =>
        this.cloneCandidate(candidate),
      ),
    };
  }

  tick(): FarmIntelligenceStatus {
    const now = this.now();
    const config = normalizeConfig(this.configSource());
    const character = this.game.character();

    if (!config.enabled) {
      this.selectedFarmKey = null;
      this.observationBaseline = null;
      this.currentStatus = {
        timestamp: now,
        enabled: false,
        state: "DISABLED",
        reason: "FARM_INTELLIGENCE_DISABLED",
        selected: null,
        candidates: [],
        weights: { ...config.weights },
        preferredMonsters: [...config.preferredMonsters],
        forbiddenMonsters: [...config.forbiddenMonsters],
        goalMonster: config.goalMonster,
        goalItems: [...config.goalItems],
      };
      this.emitUpdateIfChanged();
      return this.status();
    }

    const pendingSample = this.observe(now, config, character);
    const rawCandidates = this.buildCandidates(config, character);
    const candidates = this.scoreCandidates(rawCandidates, config, character)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.monster.localeCompare(b.monster) ||
          a.farmKey.localeCompare(b.farmKey),
      )
      .slice(0, config.maxCandidates);
    const selected = candidates[0] || null;

    this.currentStatus = {
      timestamp: now,
      enabled: true,
      state: selected ? "READY" : "NO_CANDIDATES",
      reason: selected ? "FARM_CANDIDATE_SELECTED" : "NO_FARM_CANDIDATES",
      selected,
      candidates,
      weights: { ...config.weights },
      preferredMonsters: [...config.preferredMonsters],
      forbiddenMonsters: [...config.forbiddenMonsters],
      goalMonster: config.goalMonster,
      goalItems: [...config.goalItems],
    };

    this.armObservationBaseline(now, character, selected);
    this.emitUpdateIfChanged();
    if (pendingSample) {
      this.onEvent?.({
        type: "FARM_INTELLIGENCE_SAMPLE",
        timestamp: now,
        reason: "OBSERVED_FARM_PERFORMANCE",
        status: this.status(),
        sample: pendingSample,
      });
    }
    return this.status();
  }

  private ensureCatalog(): FarmCatalog {
    if (this.catalog) return this.catalog;

    const data = this.game.gameData();
    const monsterData = record(data.monsters);
    const maps = record(data.maps);
    const monsterGold = record(data.monster_gold);
    const drops = record(data.drops);
    const knownItems = new Set(Object.keys(record(data.items)));
    const monsters = new Map<string, MonsterDefinition>();

    for (const [monster, rawDefinition] of Object.entries(monsterData)) {
      const definition = record(rawDefinition);
      const dropKey = text(definition.drop);
      const dropSource =
        (dropKey && drops[dropKey] !== undefined ? drops[dropKey] : null) ??
        definition.drops ??
        definition.drop;
      monsters.set(monster, {
        monster,
        hp: firstFinite(definition, ["hp", "max_hp"]),
        xp: firstFinite(definition, ["xp", "experience"]),
        attack: firstFinite(definition, ["attack", "damage"]),
        frequency: firstFinite(definition, ["frequency", "attack_frequency"]),
        respawnSeconds: seconds(
          definition.respawn ?? definition.respawn_ms ?? definition.respawn_time,
        ),
        gold:
          goldValue(monsterGold[monster]) ??
          firstFinite(definition, ["gold", "gold_value"]),
        dropItems: [...collectDropItems(dropSource, knownItems)].sort((a, b) =>
          a.localeCompare(b),
        ),
      });
    }

    const spots: FarmSpot[] = [];
    for (const [map, rawMap] of Object.entries(maps)) {
      const mapDefinition = record(rawMap);
      const spawns = Array.isArray(mapDefinition.monsters)
        ? mapDefinition.monsters
        : [];
      spawns.forEach((rawSpawn, index) => {
        const spawn = record(rawSpawn);
        const point = spawnPoint(spawn);
        for (const monster of spawnTypes(spawn)) {
          const definition = monsters.get(monster);
          if (!definition) continue;
          spots.push({
            farmKey: `${monster}@${map}:${index}`,
            monster,
            map,
            x: point?.x ?? null,
            y: point?.y ?? null,
            count: Math.max(
              1,
              Math.floor(
                firstFinite(spawn, ["count", "population", "num"]) ?? 1,
              ),
            ),
            respawnSeconds:
              seconds(spawn.respawn ?? spawn.respawn_ms) ??
              definition.respawnSeconds,
          });
        }
      });
    }

    this.catalog = { monsters, spots };
    return this.catalog;
  }

  private buildCandidates(
    config: NormalizedFarmConfig,
    character: CharacterSnapshot,
  ): RawCandidate[] {
    const catalog = this.ensureCatalog();
    const forbidden = new Set(config.forbiddenMonsters);
    const spots = [...catalog.spots];
    const spotTypes = new Set(spots.map((spot) => spot.monster));

    for (const entity of this.game.entities()) {
      if (
        entity.type !== "monster" ||
        !entity.mtype ||
        entity.dead ||
        entity.rip ||
        spotTypes.has(entity.mtype)
      ) {
        continue;
      }
      const definition = catalog.monsters.get(entity.mtype);
      if (!definition) continue;
      spots.push({
        farmKey: `${entity.mtype}@${entity.map || character.map || "unknown"}:visible`,
        monster: entity.mtype,
        map: entity.map || character.map || "unknown",
        x: entity.x,
        y: entity.y,
        count: 1,
        respawnSeconds: definition.respawnSeconds,
      });
      spotTypes.add(entity.mtype);
    }

    const party = this.partyMetrics(character);
    const candidates: RawCandidate[] = [];

    for (const spot of spots) {
      if (forbidden.has(spot.monster)) continue;
      const definition = catalog.monsters.get(spot.monster);
      if (!definition) continue;

      const respawn = spot.respawnSeconds ?? definition.respawnSeconds;
      const monsterDps = dps(definition.attack, definition.frequency);
      const timeToKill =
        definition.hp !== null &&
        definition.hp > 0 &&
        party.partyDps !== null &&
        party.partyDps > 0
          ? definition.hp / party.partyDps
          : null;
      const combatKills =
        timeToKill !== null && timeToKill > 0
          ? 3600 / Math.max(0.25, timeToKill)
          : null;
      const respawnKills =
        respawn !== null && respawn > 0
          ? (spot.count * 3600) / respawn
          : null;
      const killsPerHour =
        combatKills !== null && respawnKills !== null
          ? Math.min(combatKills, respawnKills)
          : combatKills ?? respawnKills;
      const travelDistance =
        spot.map === character.map
          ? distance(character.x, character.y, spot.x, spot.y) ?? 500
          : config.mapChangePenalty +
            (spot.x !== null && spot.y !== null
              ? Math.hypot(spot.x, spot.y) * 0.05
              : 0);
      const goalUtility = this.goalUtility(config, definition);
      const observed = this.observed.get(spot.farmKey) || null;

      candidates.push({
        spot,
        definition,
        observed,
        raw: {
          xpPerHourPotential:
            killsPerHour !== null && definition.xp !== null
              ? killsPerHour * definition.xp
              : null,
          goldPerHourPotential:
            killsPerHour !== null && definition.gold !== null
              ? killsPerHour * definition.gold
              : null,
          dropPotential:
            killsPerHour !== null
              ? killsPerHour * definition.dropItems.length
              : null,
          goalUtility,
          danger:
            monsterDps !== null && party.tankHp !== null && party.tankHp > 0
              ? (monsterDps * Math.max(1, timeToKill ?? 1)) / party.tankHp
              : null,
          travelCost: travelDistance,
          respawnEfficiency:
            respawn !== null && respawn > 0
              ? (spot.count * 3600) / respawn
              : null,
          partyDpsFit:
            party.partyDps !== null &&
            definition.hp !== null &&
            definition.hp > 0
              ? party.partyDps / definition.hp
              : null,
          tankSafety:
            party.tankHp !== null && monsterDps !== null && monsterDps > 0
              ? party.tankHp / monsterDps
              : null,
          observedPerformance: observedValue(observed),
        },
        estimated: {
          monsterHp: definition.hp,
          monsterAttack: definition.attack,
          monsterFrequency: definition.frequency,
          xpPerKill: definition.xp,
          goldPerKill: definition.gold,
          respawnSeconds: respawn,
          killsPerHour,
          partyDps: party.partyDps,
          tankHp: party.tankHp,
          dropItems: [...definition.dropItems],
        },
      });
    }

    return candidates;
  }

  private scoreCandidates(
    rawCandidates: RawCandidate[],
    config: NormalizedFarmConfig,
    character: CharacterSnapshot,
  ): FarmCandidateStatus[] {
    const raw = rawCandidates.map((candidate) => candidate.raw);
    const component = <K extends keyof FarmCandidateStatus["components"]>(
      key: K,
    ): Array<number | null> => raw.map((entry) => entry[key]);

    const xp = component("xpPerHourPotential");
    const gold = component("goldPerHourPotential");
    const drops = component("dropPotential");
    const goal = component("goalUtility");
    const danger = component("danger");
    const travel = component("travelCost");
    const respawn = component("respawnEfficiency");
    const partyDps = component("partyDpsFit");
    const tankSafety = component("tankSafety");
    const observed = component("observedPerformance");

    return rawCandidates.map((candidate, index) => {
      const componentScores = {
        xp: normalizedBenefit(xp, index),
        gold: normalizedBenefit(gold, index),
        drops: normalizedBenefit(drops, index),
        goal: normalizedBenefit(goal, index),
        danger: normalizedCost(danger, index),
        travel: normalizedCost(travel, index),
        respawn: normalizedBenefit(respawn, index),
        partyDps: normalizedBenefit(partyDps, index),
        tankSafety: normalizedBenefit(tankSafety, index),
        observed: normalizedBenefit(observed, index),
      };
      const weights = config.weights;
      const weighted =
        componentScores.xp * weights.xp +
        componentScores.gold * weights.gold +
        componentScores.drops * weights.drops +
        componentScores.goal * weights.goal +
        componentScores.danger * weights.danger +
        componentScores.travel * weights.travel +
        componentScores.respawn * weights.respawn +
        componentScores.partyDps * weights.partyDps +
        componentScores.tankSafety * weights.tankSafety +
        componentScores.observed * weights.observed;
      const weightTotal = Object.values(weights).reduce(
        (sum, value) => sum + value,
        0,
      );
      const status: FarmCandidateStatus = {
        farmKey: candidate.spot.farmKey,
        monster: candidate.spot.monster,
        map: candidate.spot.map,
        x: candidate.spot.x,
        y: candidate.spot.y,
        spawnCount: candidate.spot.count,
        score: round(weightTotal > 0 ? weighted / weightTotal : 0),
        components: { ...candidate.raw },
        componentScores,
        estimated: {
          ...candidate.estimated,
          dropItems: [...candidate.estimated.dropItems],
          killsPerHour:
            candidate.estimated.killsPerHour === null
              ? null
              : round(candidate.estimated.killsPerHour),
          partyDps:
            candidate.estimated.partyDps === null
              ? null
              : round(candidate.estimated.partyDps),
        },
        observed: candidate.observed ? { ...candidate.observed } : null,
        whyMonster: "",
        whySpot: "",
      };
      status.whyMonster = whyMonster(status);
      status.whySpot = whySpot(status, character.map);
      return status;
    });
  }

  private goalUtility(
    config: NormalizedFarmConfig,
    definition: MonsterDefinition,
  ): number | null {
    const hasGoal =
      !!config.goalMonster ||
      config.goalItems.length > 0 ||
      config.preferredMonsters.length > 0;
    if (!hasGoal) return null;

    let score = 0;
    if (config.goalMonster === definition.monster) score += 70;
    if (config.preferredMonsters.includes(definition.monster)) score += 30;
    const drops = new Set(definition.dropItems);
    score += Math.min(
      40,
      config.goalItems.filter((item) => drops.has(item)).length * 20,
    );
    return Math.min(100, score);
  }

  private partyMetrics(character: CharacterSnapshot): {
    partyDps: number | null;
    tankHp: number | null;
  } {
    const memberNames = new Set(Object.keys(this.game.party()));
    if (character.name) memberNames.add(character.name);

    let totalDps = dps(character.attack, character.frequency) || 0;
    let tankHp = character.maxHp || 0;
    const seen = new Set<string>();
    if (character.name) seen.add(character.name);

    for (const entity of this.game.entities()) {
      if (
        entity.type !== "character" ||
        !entity.name ||
        !memberNames.has(entity.name) ||
        seen.has(entity.name)
      ) {
        continue;
      }
      seen.add(entity.name);
      totalDps += dps(entity.attack, entity.frequency) || 0;
      tankHp = Math.max(tankHp, entity.maxHp || 0);
    }

    return {
      partyDps: totalDps > 0 ? totalDps : null,
      tankHp: tankHp > 0 ? tankHp : null,
    };
  }

  private observe(
    now: number,
    config: NormalizedFarmConfig,
    character: CharacterSnapshot,
  ): FarmIntelligenceSample | null {
    const baseline = this.observationBaseline;
    if (!baseline || !this.selectedFarmKey || baseline.farmKey !== this.selectedFarmKey) {
      return null;
    }
    const elapsed = now - baseline.timestamp;
    if (elapsed < config.observationSampleMs) return null;

    const xpDelta =
      character.xp !== null && baseline.xp !== null
        ? Math.max(0, character.xp - baseline.xp)
        : 0;
    const goldDelta =
      character.gold !== null && baseline.gold !== null
        ? Math.max(0, character.gold - baseline.gold)
        : 0;
    const itemQuantity = inventoryQuantity(this.game.inventory());
    const dropDelta = Math.max(0, itemQuantity - baseline.itemQuantity);
    const scale = HOUR_MS / Math.max(1, elapsed);
    const next: FarmObservedPerformance = {
      sampleMs: elapsed,
      xpPerHour: round(xpDelta * scale),
      goldPerHour: round(goldDelta * scale),
      dropsPerHour: round(dropDelta * scale),
      updatedAt: now,
    };

    const previous = this.observed.get(baseline.farmKey);
    const alpha = Math.max(
      0.05,
      Math.min(1, elapsed / config.observationWindowMs),
    );
    const blended: FarmObservedPerformance = previous
      ? {
          sampleMs: previous.sampleMs + elapsed,
          xpPerHour: round(
            previous.xpPerHour * (1 - alpha) + next.xpPerHour * alpha,
          ),
          goldPerHour: round(
            previous.goldPerHour * (1 - alpha) + next.goldPerHour * alpha,
          ),
          dropsPerHour: round(
            previous.dropsPerHour * (1 - alpha) + next.dropsPerHour * alpha,
          ),
          updatedAt: now,
        }
      : next;
    this.observed.set(baseline.farmKey, blended);

    return {
      farmKey: baseline.farmKey,
      monster: baseline.monster,
      map: baseline.map,
      startedAt: baseline.timestamp,
      endedAt: now,
      stats: {
        ...blended,
        xpDelta,
        goldDelta,
        dropDelta,
      },
    };
  }

  private armObservationBaseline(
    now: number,
    character: CharacterSnapshot,
    selected: FarmCandidateStatus | null,
  ): void {
    if (!selected) {
      this.selectedFarmKey = null;
      this.observationBaseline = null;
      return;
    }

    const shouldReset =
      this.selectedFarmKey !== selected.farmKey ||
      !this.observationBaseline ||
      this.observationBaseline.farmKey !== selected.farmKey ||
      now - this.observationBaseline.timestamp >=
        normalizeConfig(this.configSource()).observationSampleMs;

    this.selectedFarmKey = selected.farmKey;
    if (!shouldReset) return;

    this.observationBaseline = {
      farmKey: selected.farmKey,
      monster: selected.monster,
      map: selected.map,
      timestamp: now,
      xp: character.xp,
      gold: character.gold,
      itemQuantity: inventoryQuantity(this.game.inventory()),
    };
  }

  private emitUpdateIfChanged(): void {
    const selected = this.currentStatus.selected;
    const signature = [
      this.currentStatus.state,
      this.currentStatus.reason,
      selected?.farmKey || "",
      selected?.score ?? "",
      selected?.whyMonster || "",
      selected?.whySpot || "",
    ].join("|");
    if (signature === this.lastSelectionSignature) return;
    this.lastSelectionSignature = signature;
    this.onEvent?.({
      type: "FARM_INTELLIGENCE_UPDATED",
      timestamp: this.currentStatus.timestamp,
      reason: this.currentStatus.reason,
      status: this.status(),
    });
  }

  private cloneCandidate(candidate: FarmCandidateStatus): FarmCandidateStatus {
    return {
      ...candidate,
      components: { ...candidate.components },
      componentScores: { ...candidate.componentScores },
      estimated: {
        ...candidate.estimated,
        dropItems: [...candidate.estimated.dropItems],
      },
      observed: candidate.observed ? { ...candidate.observed } : null,
    };
  }
}

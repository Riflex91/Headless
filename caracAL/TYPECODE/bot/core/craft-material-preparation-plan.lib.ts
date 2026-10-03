import type {
  CraftRequirement,
  CraftStatus,
} from "./craft-controller.lib";
import {
  findMonsterDropSources,
  type MonsterDropSource,
} from "./compound-gather-plan.lib";

const MAX_MONSTER_HP = 100_000;
const MAX_MONSTER_ATTACK = 600;
const MAX_EXPECTED_KILLS = 50;
const MAX_EXPECTED_MONSTER_HP = 1_000_000;

export interface CraftMaterialSourcePolicy {
  safe: boolean;
  reasons: string[];
  spawnMaps: string[];
  monsterAttack: number | null;
  monsterRespawn: number | null;
  stationary: boolean;
  cooperative: boolean;
  special: boolean;
  expectedKills: number | null;
  expectedMonsterHp: number | null;
}

export interface CraftMaterialPreparationCandidate {
  recipe: string;
  cost: number | null;
  existingItemSlots: number[];
  missingRequirement: CraftRequirement;
  source: MonsterDropSource;
  sourcePolicy: CraftMaterialSourcePolicy;
  score: number;
}

export interface CraftMaterialRejectedSource {
  recipe: string;
  missingRequirement: CraftRequirement;
  source: MonsterDropSource;
  sourcePolicy: CraftMaterialSourcePolicy;
}

export interface CraftMaterialPreparationPlan {
  outcome: "PASS" | "FAIL";
  reason:
    | "CRAFT_MATERIAL_TARGET_SELECTED"
    | "CRAFT_MATERIAL_TARGET_NOT_FOUND"
    | "CRAFT_MATERIAL_SAFE_SOURCE_NOT_FOUND"
    | "CRAFT_MATERIAL_RECIPE_ALREADY_READY";
  requestedRecipe: string | null;
  observerPosition: {
    map: string;
    x: number;
    y: number;
  } | null;
  selected: CraftMaterialPreparationCandidate | null;
  candidates: CraftMaterialPreparationCandidate[];
  rejectedSources: CraftMaterialRejectedSource[];
}

export interface CraftMaterialPreparationPlanOptions {
  recipe?: string | null;
  observerPosition?: {
    map: string;
    x: number;
    y: number;
  } | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function spawnTypes(value: unknown): string[] {
  const spawn = record(value);
  const direct = spawn.type;
  if (typeof direct === "string" && direct.trim()) {
    return [direct.trim()];
  }
  if (Array.isArray(direct)) {
    return direct.filter(
      (entry): entry is string =>
        typeof entry === "string" && !!entry.trim(),
    );
  }
  for (const key of ["types", "monsters"]) {
    if (!Array.isArray(spawn[key])) continue;
    const values = (spawn[key] as unknown[]).filter(
      (entry): entry is string =>
        typeof entry === "string" && !!entry.trim(),
    );
    if (values.length) return values;
  }
  return [];
}

function unsafeMap(mapName: string, rawMap: unknown): boolean {
  const map = record(rawMap);
  const normalized = mapName.toLowerCase();
  return (
    map.instance === true ||
    map.pvp === true ||
    map.ignore === true ||
    map.unlist === true ||
    map.event === true ||
    typeof map.event === "string" ||
    normalized.includes("instance") ||
    normalized.startsWith("event")
  );
}

function normalSpawnMaps(
  gameData: Record<string, unknown>,
  monsterType: string,
): string[] {
  const maps = record(gameData.maps);
  const result: string[] = [];
  for (const [mapName, rawMap] of Object.entries(maps)) {
    if (unsafeMap(mapName, rawMap)) continue;
    const map = record(rawMap);
    const spawns = Array.isArray(map.monsters) ? map.monsters : [];
    if (
      spawns.some((spawn) => spawnTypes(spawn).includes(monsterType))
    ) {
      result.push(mapName);
    }
  }
  return result.sort();
}

function evaluateSource(
  gameData: Record<string, unknown>,
  missing: CraftRequirement,
  source: MonsterDropSource,
): CraftMaterialSourcePolicy {
  const monster = record(record(gameData.monsters)[source.monsterType]);
  const monsterAttack = finite(monster.attack);
  const monsterRespawn = finite(monster.respawn);
  const stationary = monster.stationary === true;
  const cooperative = monster.cooperative === true;
  const special =
    monster.special === true ||
    monster.boss === true ||
    monster.achievement === true;
  const spawnMaps = normalSpawnMaps(gameData, source.monsterType);
  const dropChance =
    source.dropChance !== null && source.dropChance > 0
      ? source.dropChance
      : null;
  const expectedKills =
    dropChance !== null ? missing.quantity / dropChance : null;
  const expectedMonsterHp =
    expectedKills !== null &&
    source.monsterHp !== null &&
    source.monsterHp > 0
      ? expectedKills * source.monsterHp
      : null;
  const reasons: string[] = [];

  if (!spawnMaps.length) reasons.push("NO_SAFE_REGULAR_SPAWN");
  if (
    source.monsterHp === null ||
    source.monsterHp <= 0 ||
    source.monsterHp > MAX_MONSTER_HP
  ) {
    reasons.push("MONSTER_HP_OUT_OF_POLICY");
  }
  if (monsterAttack !== null && monsterAttack > MAX_MONSTER_ATTACK) {
    reasons.push("MONSTER_ATTACK_OUT_OF_POLICY");
  }
  if (monsterRespawn !== null && monsterRespawn < 0) {
    reasons.push("MONSTER_RESPAWN_OUT_OF_POLICY");
  }
  if (stationary) reasons.push("STATIONARY_MONSTER_BLOCKED");
  if (cooperative) reasons.push("COOPERATIVE_MONSTER_BLOCKED");
  if (special) reasons.push("SPECIAL_MONSTER_BLOCKED");
  if (expectedKills === null || expectedKills > MAX_EXPECTED_KILLS) {
    reasons.push("EXPECTED_KILLS_OUT_OF_POLICY");
  }
  if (
    expectedMonsterHp === null ||
    expectedMonsterHp > MAX_EXPECTED_MONSTER_HP
  ) {
    reasons.push("EXPECTED_MONSTER_HP_OUT_OF_POLICY");
  }

  return {
    safe: reasons.length === 0,
    reasons,
    spawnMaps,
    monsterAttack,
    monsterRespawn,
    stationary,
    cooperative,
    special,
    expectedKills,
    expectedMonsterHp,
  };
}

function candidateScore(
  missing: CraftRequirement,
  cost: number | null,
  source: MonsterDropSource,
): number {
  const quantityWeight = Math.max(1, missing.quantity);
  const costWeight =
    cost !== null && Number.isFinite(cost) && cost > 0 ? cost : 1;
  const sourceWeight = source.score > 0 ? source.score : 1e-12;
  return sourceWeight / quantityWeight / Math.log10(costWeight + 10);
}

function clonePolicy(
  sourcePolicy: CraftMaterialSourcePolicy,
): CraftMaterialSourcePolicy {
  return {
    ...sourcePolicy,
    reasons: [...sourcePolicy.reasons],
    spawnMaps: [...sourcePolicy.spawnMaps],
  };
}

export function planCraftMaterialPreparation(
  gameData: Record<string, unknown>,
  craft: CraftStatus,
  options: CraftMaterialPreparationPlanOptions = {},
): CraftMaterialPreparationPlan {
  const requestedRecipe = text(options.recipe);
  const observerPosition = options.observerPosition
    ? { ...options.observerPosition }
    : null;

  if (
    requestedRecipe &&
    craft.selected?.recipe === requestedRecipe &&
    craft.state === "READY"
  ) {
    return {
      outcome: "PASS",
      reason: "CRAFT_MATERIAL_RECIPE_ALREADY_READY",
      requestedRecipe,
      observerPosition,
      selected: null,
      candidates: [],
      rejectedSources: [],
    };
  }

  const decisions = craft.decisions.filter((decision) => {
    if (requestedRecipe && decision.recipe !== requestedRecipe) return false;
    if (decision.eligible) return false;
    if (decision.reason !== "CRAFT_INGREDIENTS_INSUFFICIENT") return false;
    if (decision.requirements.length < 1) return false;
    return decision.itemSlots.length === decision.requirements.length - 1;
  });

  const candidates: CraftMaterialPreparationCandidate[] = [];
  const rejectedSources: CraftMaterialRejectedSource[] = [];

  for (const decision of decisions) {
    const missing = decision.requirements[decision.itemSlots.length];
    if (!missing) continue;

    // Missing upgraded ingredients require their explicit Upgrade/Compound path.
    if (missing.level !== null && missing.level !== 0) continue;

    const sources = findMonsterDropSources(gameData, missing.name);
    for (const source of sources) {
      const sourcePolicy = evaluateSource(gameData, missing, source);
      if (!sourcePolicy.safe) {
        rejectedSources.push({
          recipe: decision.recipe,
          missingRequirement: { ...missing },
          source: { ...source },
          sourcePolicy: clonePolicy(sourcePolicy),
        });
        continue;
      }

      candidates.push({
        recipe: decision.recipe,
        cost: decision.cost,
        existingItemSlots: [...decision.itemSlots],
        missingRequirement: { ...missing },
        source: { ...source },
        sourcePolicy: clonePolicy(sourcePolicy),
        score: candidateScore(missing, decision.cost, source),
      });
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.missingRequirement.quantity - right.missingRequirement.quantity ||
      (left.cost ?? Number.MAX_SAFE_INTEGER) -
        (right.cost ?? Number.MAX_SAFE_INTEGER) ||
      left.recipe.localeCompare(right.recipe) ||
      left.source.monsterType.localeCompare(right.source.monsterType),
  );

  rejectedSources.sort(
    (left, right) =>
      left.recipe.localeCompare(right.recipe) ||
      left.source.monsterType.localeCompare(right.source.monsterType),
  );

  return candidates.length
    ? {
        outcome: "PASS",
        reason: "CRAFT_MATERIAL_TARGET_SELECTED",
        requestedRecipe,
        observerPosition,
        selected: {
          ...candidates[0],
          existingItemSlots: [...candidates[0].existingItemSlots],
          missingRequirement: { ...candidates[0].missingRequirement },
          source: { ...candidates[0].source },
          sourcePolicy: clonePolicy(candidates[0].sourcePolicy),
        },
        candidates: candidates.map((entry) => ({
          ...entry,
          existingItemSlots: [...entry.existingItemSlots],
          missingRequirement: { ...entry.missingRequirement },
          source: { ...entry.source },
          sourcePolicy: clonePolicy(entry.sourcePolicy),
        })),
        rejectedSources: rejectedSources.map((entry) => ({
          ...entry,
          missingRequirement: { ...entry.missingRequirement },
          source: { ...entry.source },
          sourcePolicy: clonePolicy(entry.sourcePolicy),
        })),
      }
    : {
        outcome: "FAIL",
        reason: rejectedSources.length
          ? "CRAFT_MATERIAL_SAFE_SOURCE_NOT_FOUND"
          : "CRAFT_MATERIAL_TARGET_NOT_FOUND",
        requestedRecipe,
        observerPosition,
        selected: null,
        candidates: [],
        rejectedSources: rejectedSources.map((entry) => ({
          ...entry,
          missingRequirement: { ...entry.missingRequirement },
          source: { ...entry.source },
          sourcePolicy: clonePolicy(entry.sourcePolicy),
        })),
      };
}

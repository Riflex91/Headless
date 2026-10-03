import type {
  CraftRequirement,
  CraftStatus,
} from "./craft-controller.lib";
import {
  findMonsterDropSources,
  type MonsterDropSource,
} from "./compound-gather-plan.lib";

export interface CraftMaterialPreparationCandidate {
  recipe: string;
  cost: number | null;
  existingItemSlots: number[];
  missingRequirement: CraftRequirement;
  source: MonsterDropSource;
  score: number;
}

export interface CraftMaterialPreparationPlan {
  outcome: "PASS" | "FAIL";
  reason:
    | "CRAFT_MATERIAL_TARGET_SELECTED"
    | "CRAFT_MATERIAL_TARGET_NOT_FOUND"
    | "CRAFT_MATERIAL_RECIPE_ALREADY_READY";
  requestedRecipe: string | null;
  selected: CraftMaterialPreparationCandidate | null;
  candidates: CraftMaterialPreparationCandidate[];
}

export interface CraftMaterialPreparationPlanOptions {
  recipe?: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export function planCraftMaterialPreparation(
  gameData: Record<string, unknown>,
  craft: CraftStatus,
  options: CraftMaterialPreparationPlanOptions = {},
): CraftMaterialPreparationPlan {
  const requestedRecipe = text(options.recipe);

  if (
    requestedRecipe &&
    craft.selected?.recipe === requestedRecipe &&
    craft.state === "READY"
  ) {
    return {
      outcome: "PASS",
      reason: "CRAFT_MATERIAL_RECIPE_ALREADY_READY",
      requestedRecipe,
      selected: null,
      candidates: [],
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

  for (const decision of decisions) {
    const missing = decision.requirements[decision.itemSlots.length];
    if (!missing) continue;

    // Material workers gather normal monster drops. Missing upgraded recipe
    // ingredients must be prepared through their own explicit Upgrade/Compound
    // path instead of silently substituting a level-0 drop.
    if (missing.level !== null && missing.level !== 0) continue;

    const sources = findMonsterDropSources(gameData, missing.name);
    const source = sources[0];
    if (!source) continue;

    candidates.push({
      recipe: decision.recipe,
      cost: decision.cost,
      existingItemSlots: [...decision.itemSlots],
      missingRequirement: { ...missing },
      source: { ...source },
      score: candidateScore(missing, decision.cost, source),
    });
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

  return candidates.length
    ? {
        outcome: "PASS",
        reason: "CRAFT_MATERIAL_TARGET_SELECTED",
        requestedRecipe,
        selected: { ...candidates[0] },
        candidates: candidates.map((entry) => ({
          ...entry,
          existingItemSlots: [...entry.existingItemSlots],
          missingRequirement: { ...entry.missingRequirement },
          source: { ...entry.source },
        })),
      }
    : {
        outcome: "FAIL",
        reason: "CRAFT_MATERIAL_TARGET_NOT_FOUND",
        requestedRecipe,
        selected: null,
        candidates: [],
      };
}

import type {
  CharacterSnapshot,
  InventorySlotSnapshot,
  NpcSnapshot,
} from "./game-adapter.lib";
import type {
  InventoryIntelligenceController,
  InventoryIntelligenceEntry,
} from "./inventory-intelligence-controller.lib";
import type { MovementController } from "./movement-controller.lib";
import type {
  CraftController,
  CraftRequirement,
  CraftStatus,
} from "./craft-controller.lib";

export interface CraftLiveTestOptions {
  requestId?: string;
  recipe: string;
  itemSlots: number[];
  settleTimeoutMs?: number;
  settlePollMs?: number;
}

export interface CraftLiveRuntimePreflight {
  map: string | null;
  craftInProgress: boolean;
}

export interface CraftLiveItemState {
  slot: number;
  name: string | null;
  level: number | null;
  quantity: number;
  property: unknown;
  locked: boolean;
  present: boolean;
}

export interface CraftLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  target: {
    recipe: string;
    itemSlots: number[];
    cost: number | null;
    outputName: string | null;
    requirements: CraftRequirement[];
  };
  before: {
    gold: number | null;
    outputQuantity: number;
    ingredients: CraftLiveItemState[];
    ingredientTotals: number[];
  };
  after: {
    gold: number | null;
    outputQuantity: number;
    ingredients: CraftLiveItemState[];
    ingredientTotals: number[];
  };
  craft: CraftStatus | null;
  evidence: {
    inventoryIntelligenceReady: boolean;
    recipeMetadataObserved: boolean;
    explicitSlotsValid: boolean;
    exactIngredientsObserved: boolean;
    quantitiesSufficient: boolean;
    ingredientLevelsMatch: boolean;
    ingredientLocksClear: boolean;
    allIngredientsUnprotectedBefore: boolean;
    goldSufficientBefore: boolean;
    exactCandidateSelected: boolean;
    stationLocated: boolean;
    stationId: string | null;
    stationMap: string | null;
    stationX: number | null;
    stationY: number | null;
    stationDistanceBefore: number | null;
    stationTravelRequired: boolean;
    stationTravelConfirmed: boolean;
    stationTravelActionId: string | null;
    stationTravelStatus: string | null;
    stationDistanceAfter: number | null;
    stationProximityReady: boolean;
    localPreflightReadOnly: boolean;
    movementIdleBeforeDispatch: boolean;
    craftOperationIdle: boolean;
    mapAllowsCraft: boolean;
    ingredientsStillExactBeforeDispatch: boolean;
    quantitiesStillSufficientBeforeDispatch: boolean;
    ingredientLocksStillClearBeforeDispatch: boolean;
    goldStillSufficientBeforeDispatch: boolean;
    exactCandidateStillSelected: boolean;
    actionDispatchedOnce: boolean;
    actionConfirmed: boolean;
    ingredientConsumed: boolean;
    outputIncreased: boolean;
    goldSpent: boolean;
    mutationObserved: boolean;
    blindRetryAvoided: boolean;
  };
  scope: {
    movementMutationAllowed: true;
    upgradeMutationAllowed: false;
    compoundMutationAllowed: false;
    exchangeMutationAllowed: false;
    craftMutationAllowed: true;
    irreversibleMutation: true;
    blindRetryAllowed: false;
    mutationScope: "single-craft-attempt-only";
  };
  cleanup: {
    inventoryConfigOverrideCleared: boolean;
    craftConfigOverrideCleared: boolean;
  };
}

interface CraftLiveGameAdapter {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  npcs(mapName?: string | null): NpcSnapshot[];
  gameData(): Record<string, unknown>;
}

interface CraftLiveTestDependencies {
  game: CraftLiveGameAdapter;
  inventoryIntelligence: Pick<
    InventoryIntelligenceController,
    "status" | "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  craft: Pick<
    CraftController,
    "status" | "tick" | "executeNext" | "setConfigOverride" | "clearConfigOverride"
  >;
  movement: Pick<MovementController, "smart" | "status">;
  runtimePreflight: () => CraftLiveRuntimePreflight;
  characterName?: () => string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface RecipeMetadata {
  cost: number | null;
  outputName: string;
  requirements: CraftRequirement[];
}

const CRAFT_STATION_ID = "craftsman";
const CRAFT_STATION_MAP = "main";
const CRAFT_STATION_MAX_DISTANCE = 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  const normalized = nonNegativeInteger(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inventoryItem(
  inventory: InventorySlotSnapshot[],
  slot: number,
): Record<string, unknown> | null {
  const raw = inventory.find((entry) => entry.slot === slot)?.item;
  return raw ? record(raw) : null;
}

function itemQuantity(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  return Math.max(1, nonNegativeInteger(item.q) ?? 1);
}

function itemLevel(item: Record<string, unknown> | null): number {
  if (!item) return 0;
  return nonNegativeInteger(item.level) ?? 0;
}

function itemLocked(item: Record<string, unknown> | null): boolean {
  if (!item) return false;
  return item.locked === true || (typeof item.l === "string" && item.l.length > 0);
}

function itemState(
  inventory: InventorySlotSnapshot[],
  slot: number,
): CraftLiveItemState {
  const item = inventoryItem(inventory, slot);
  return {
    slot,
    name: item ? text(item.name) : null,
    level: item ? itemLevel(item) : null,
    quantity: itemQuantity(item),
    property: item?.p ?? null,
    locked: itemLocked(item),
    present: !!item,
  };
}

function totalItemQuantity(
  inventory: InventorySlotSnapshot[],
  name: string,
): number {
  return inventory.reduce((total, entry) => {
    const item = entry.item ? record(entry.item) : null;
    if (!item || text(item.name) !== name) return total;
    return total + itemQuantity(item);
  }, 0);
}

function parseRecipe(
  gameData: Record<string, unknown>,
  recipeName: string,
): RecipeMetadata | null {
  const recipe = record(record(gameData.craft)[recipeName]);
  if (!Array.isArray(recipe.items) || recipe.items.length < 1) return null;

  const requirements: CraftRequirement[] = [];
  for (const raw of recipe.items) {
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const quantity = positiveInteger(Number(raw[0]));
    const name = text(raw[1]);
    const level =
      raw.length >= 3 ? nonNegativeInteger(Number(raw[2])) : null;
    if (
      quantity === null ||
      !name ||
      (raw.length >= 3 && level === null)
    ) {
      return null;
    }
    requirements.push({ quantity, name, level });
  }

  const output = record(recipe.output);
  return {
    cost: finite(recipe.cost),
    outputName: text(output.name) || recipeName,
    requirements,
  };
}

function stationDistance(
  character: CharacterSnapshot,
  station: NpcSnapshot,
): number | null {
  if (
    character.map !== station.map ||
    typeof character.x !== "number" ||
    !Number.isFinite(character.x) ||
    typeof character.y !== "number" ||
    !Number.isFinite(character.y) ||
    typeof station.x !== "number" ||
    !Number.isFinite(station.x) ||
    typeof station.y !== "number" ||
    !Number.isFinite(station.y)
  ) {
    return null;
  }
  return Math.hypot(character.x - station.x, character.y - station.y);
}

function slotsValid(slots: number[], requirementCount: number): boolean {
  return (
    slots.length === requirementCount &&
    slots.length > 0 &&
    slots.every((slot) => Number.isInteger(slot) && slot >= 0) &&
    new Set(slots).size === slots.length
  );
}

function exactCandidate(
  craft: CraftStatus,
  recipe: string,
  slots: number[],
): boolean {
  return (
    craft.state === "READY" &&
    craft.selected?.recipe === recipe &&
    JSON.stringify(craft.selected.itemSlots) === JSON.stringify(slots)
  );
}

function entriesUnprotected(
  entries: InventoryIntelligenceEntry[],
  recipe: RecipeMetadata,
  slots: number[],
): boolean {
  return recipe.requirements.every((requirement, index) => {
    const entry = entries.find(
      (candidate) =>
        candidate.slot === slots[index] &&
        candidate.name === requirement.name &&
        candidate.disposition === "CRAFT",
    );
    return !!entry && !entry.protected && entry.protections.length === 0;
  });
}

function baseEvidence(): CraftLiveTestResult["evidence"] {
  return {
    inventoryIntelligenceReady: false,
    recipeMetadataObserved: false,
    explicitSlotsValid: false,
    exactIngredientsObserved: false,
    quantitiesSufficient: false,
    ingredientLevelsMatch: false,
    ingredientLocksClear: false,
    allIngredientsUnprotectedBefore: false,
    goldSufficientBefore: false,
    exactCandidateSelected: false,
    stationLocated: false,
    stationId: null,
    stationMap: null,
    stationX: null,
    stationY: null,
    stationDistanceBefore: null,
    stationTravelRequired: false,
    stationTravelConfirmed: false,
    stationTravelActionId: null,
    stationTravelStatus: null,
    stationDistanceAfter: null,
    stationProximityReady: false,
    localPreflightReadOnly: false,
    movementIdleBeforeDispatch: false,
    craftOperationIdle: false,
    mapAllowsCraft: false,
    ingredientsStillExactBeforeDispatch: false,
    quantitiesStillSufficientBeforeDispatch: false,
    ingredientLocksStillClearBeforeDispatch: false,
    goldStillSufficientBeforeDispatch: false,
    exactCandidateStillSelected: false,
    actionDispatchedOnce: false,
    actionConfirmed: false,
    ingredientConsumed: false,
    outputIncreased: false,
    goldSpent: false,
    mutationObserved: false,
    blindRetryAvoided: true,
  };
}

export class CraftLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: CraftLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(options: CraftLiveTestOptions): Promise<CraftLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `craft-live-${startedAt}`;
    const recipeName = text(options.recipe);
    const itemSlots = Array.isArray(options.itemSlots)
      ? options.itemSlots.map((slot) => Number(slot))
      : [];
    const settleTimeoutMs = Math.max(500, options.settleTimeoutMs || 3000);
    const settlePollMs = Math.max(25, options.settlePollMs || 100);
    const evidence = baseEvidence();

    let metadata: RecipeMetadata | null = null;
    let beforeGold: number | null = null;
    let afterGold: number | null = null;
    let beforeOutputQuantity = 0;
    let afterOutputQuantity = 0;
    let beforeIngredients: CraftLiveItemState[] = [];
    let afterIngredients: CraftLiveItemState[] = [];
    let beforeIngredientTotals: number[] = [];
    let afterIngredientTotals: number[] = [];
    let craftStatus: CraftStatus | null = null;
    let outcome: CraftLiveTestResult["outcome"] = "FAIL";
    let reason = "CRAFT_LIVE_EVIDENCE_INCOMPLETE";
    let inventoryConfigOverrideCleared = false;
    let craftConfigOverrideCleared = false;
    let executionAttempts = 0;
    let finalResult: CraftLiveTestResult | null = null;

    const finish = (): CraftLiveTestResult => {
      const completedAt = this.now();
      return {
        requestId,
        outcome,
        reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        character: this.deps.characterName?.() || null,
        target: {
          recipe: recipeName || "",
          itemSlots: [...itemSlots],
          cost: metadata?.cost ?? null,
          outputName: metadata?.outputName ?? null,
          requirements:
            metadata?.requirements.map((requirement) => ({ ...requirement })) ||
            [],
        },
        before: {
          gold: beforeGold,
          outputQuantity: beforeOutputQuantity,
          ingredients: beforeIngredients.map((entry) => ({ ...entry })),
          ingredientTotals: [...beforeIngredientTotals],
        },
        after: {
          gold: afterGold,
          outputQuantity: afterOutputQuantity,
          ingredients: afterIngredients.map((entry) => ({ ...entry })),
          ingredientTotals: [...afterIngredientTotals],
        },
        craft: craftStatus,
        evidence: {
          ...evidence,
          actionDispatchedOnce:
            executionAttempts === 1 && !!craftStatus?.lastAction?.id,
          actionConfirmed: craftStatus?.lastAction?.status === "CONFIRMED",
          blindRetryAvoided: executionAttempts <= 1,
        },
        scope: {
          movementMutationAllowed: true,
          upgradeMutationAllowed: false,
          compoundMutationAllowed: false,
          exchangeMutationAllowed: false,
          craftMutationAllowed: true,
          irreversibleMutation: true,
          blindRetryAllowed: false,
          mutationScope: "single-craft-attempt-only",
        },
        cleanup: {
          inventoryConfigOverrideCleared,
          craftConfigOverrideCleared,
        },
      };
    };

    if (!recipeName) {
      reason = "CRAFT_LIVE_EXPLICIT_RECIPE_REQUIRED";
      return (finalResult = finish());
    }

    try {
      const gameData = this.deps.game.gameData();
      metadata = parseRecipe(gameData, recipeName);
      evidence.recipeMetadataObserved = metadata !== null;
      if (!metadata) {
        reason = "CRAFT_LIVE_RECIPE_UNKNOWN_OR_INVALID";
        return (finalResult = finish());
      }

      evidence.explicitSlotsValid = slotsValid(
        itemSlots,
        metadata.requirements.length,
      );
      if (!evidence.explicitSlotsValid) {
        reason = "CRAFT_LIVE_EXPLICIT_INGREDIENT_SLOTS_REQUIRED";
        return (finalResult = finish());
      }

      const originalIntelligence = this.deps.inventoryIntelligence.tick();
      evidence.inventoryIntelligenceReady = ["READY", "EMPTY"].includes(
        originalIntelligence.state,
      );
      if (!evidence.inventoryIntelligenceReady) {
        reason = "CRAFT_LIVE_INVENTORY_INTELLIGENCE_NOT_READY";
        return (finalResult = finish());
      }

      const rules = Object.fromEntries(
        metadata.requirements.map((requirement) => [
          requirement.name,
          "CRAFT",
        ]),
      );
      this.deps.inventoryIntelligence.setConfigOverride({
        inventory: {
          intelligence: { enabled: true },
          rules,
        },
      });
      const intelligence = this.deps.inventoryIntelligence.tick();

      const initialInventory = this.deps.game.inventory();
      const initialCharacter = this.deps.game.character();
      beforeGold = initialCharacter.gold;
      afterGold = beforeGold;
      beforeOutputQuantity = totalItemQuantity(
        initialInventory,
        metadata.outputName,
      );
      afterOutputQuantity = beforeOutputQuantity;
      beforeIngredients = itemSlots.map((slot) =>
        itemState(initialInventory, slot),
      );
      afterIngredients = beforeIngredients.map((entry) => ({ ...entry }));
      beforeIngredientTotals = metadata.requirements.map((requirement) =>
        totalItemQuantity(initialInventory, requirement.name),
      );
      afterIngredientTotals = [...beforeIngredientTotals];

      evidence.exactIngredientsObserved = metadata.requirements.every(
        (requirement, index) =>
          beforeIngredients[index]?.name === requirement.name,
      );
      evidence.quantitiesSufficient = metadata.requirements.every(
        (requirement, index) =>
          beforeIngredients[index]?.quantity >= requirement.quantity,
      );
      evidence.ingredientLevelsMatch = metadata.requirements.every(
        (requirement, index) =>
          requirement.level === null ||
          beforeIngredients[index]?.level === requirement.level,
      );
      evidence.ingredientLocksClear = beforeIngredients.every(
        (entry) => !entry.locked,
      );
      evidence.allIngredientsUnprotectedBefore = entriesUnprotected(
        intelligence.entries,
        metadata,
        itemSlots,
      );
      evidence.goldSufficientBefore =
        metadata.cost === null ||
        (beforeGold !== null && beforeGold >= metadata.cost);

      if (
        !evidence.exactIngredientsObserved ||
        !evidence.quantitiesSufficient ||
        !evidence.ingredientLevelsMatch ||
        !evidence.ingredientLocksClear ||
        !evidence.allIngredientsUnprotectedBefore ||
        !evidence.goldSufficientBefore
      ) {
        reason = "CRAFT_LIVE_SAFE_INGREDIENTS_NOT_READY";
        return (finalResult = finish());
      }

      this.deps.craft.setConfigOverride({
        craft: {
          enabled: true,
          allowedRecipes: [recipeName],
        },
      });
      const planned = this.deps.craft.tick();
      evidence.exactCandidateSelected = exactCandidate(
        planned,
        recipeName,
        itemSlots,
      );
      if (!evidence.exactCandidateSelected) {
        craftStatus = planned;
        reason = planned.reason || "CRAFT_LIVE_EXACT_CANDIDATE_NOT_READY";
        return (finalResult = finish());
      }

      const station =
        this.deps.game
          .npcs(CRAFT_STATION_MAP)
          .find(
            (npc) =>
              npc.id === CRAFT_STATION_ID &&
              npc.map === CRAFT_STATION_MAP &&
              typeof npc.x === "number" &&
              Number.isFinite(npc.x) &&
              typeof npc.y === "number" &&
              Number.isFinite(npc.y),
          ) || null;

      evidence.stationLocated = !!station;
      evidence.stationId = station?.id || null;
      evidence.stationMap = station?.map || null;
      evidence.stationX = station?.x ?? null;
      evidence.stationY = station?.y ?? null;
      if (!station) {
        craftStatus = planned;
        reason = "CRAFT_LIVE_STATION_NOT_FOUND";
        return (finalResult = finish());
      }

      evidence.stationDistanceBefore = stationDistance(
        this.deps.game.character(),
        station,
      );
      evidence.stationTravelRequired =
        evidence.stationDistanceBefore === null ||
        evidence.stationDistanceBefore > CRAFT_STATION_MAX_DISTANCE;

      if (evidence.stationTravelRequired) {
        try {
          const travel = await this.deps.movement.smart({
            owner: "CraftLiveTest",
            module: "CraftLiveTest",
            why: "CRAFT_STATION_REQUIRED",
            correlationId: requestId,
            destination: {
              map: station.map,
              x: station.x as number,
              y: station.y as number,
            },
          });
          evidence.stationTravelActionId = travel.id;
          evidence.stationTravelStatus = travel.status || null;
          evidence.stationTravelConfirmed = travel.status === "CONFIRMED";

          if (travel.status === "UNKNOWN") {
            craftStatus = planned;
            outcome = "UNKNOWN";
            reason = "CRAFT_LIVE_STATION_TRAVEL_UNKNOWN_NO_CRAFT_DISPATCH";
            return (finalResult = finish());
          }
          if (!evidence.stationTravelConfirmed) {
            craftStatus = planned;
            reason = "CRAFT_LIVE_STATION_TRAVEL_NOT_CONFIRMED";
            return (finalResult = finish());
          }
        } catch (_error) {
          craftStatus = planned;
          reason = "CRAFT_LIVE_STATION_TRAVEL_ERROR";
          return (finalResult = finish());
        }
      } else {
        evidence.stationTravelConfirmed = true;
      }

      let dispatchCharacter = this.deps.game.character();
      evidence.stationDistanceAfter = stationDistance(dispatchCharacter, station);
      evidence.stationProximityReady =
        evidence.stationDistanceAfter !== null &&
        evidence.stationDistanceAfter <= CRAFT_STATION_MAX_DISTANCE &&
        dispatchCharacter.moving !== true;
      if (!evidence.stationProximityReady) {
        craftStatus = planned;
        reason = "CRAFT_LIVE_STATION_PROXIMITY_NOT_CONFIRMED";
        return (finalResult = finish());
      }

      const runtimePreflight = this.deps.runtimePreflight();
      const movementStatus = this.deps.movement.status();
      const dispatchInventory = this.deps.game.inventory();
      const dispatchIngredients = itemSlots.map((slot) =>
        itemState(dispatchInventory, slot),
      );
      dispatchCharacter = this.deps.game.character();

      evidence.localPreflightReadOnly = true;
      evidence.movementIdleBeforeDispatch =
        movementStatus.owner === null && movementStatus.active === null;
      evidence.craftOperationIdle = runtimePreflight.craftInProgress !== true;
      evidence.mapAllowsCraft =
        !!text(runtimePreflight.map) &&
        !text(runtimePreflight.map)!.toLowerCase().startsWith("bank");
      evidence.ingredientsStillExactBeforeDispatch =
        metadata.requirements.every(
          (requirement, index) =>
            dispatchIngredients[index]?.name === requirement.name &&
            (requirement.level === null ||
              dispatchIngredients[index]?.level === requirement.level),
        );
      evidence.quantitiesStillSufficientBeforeDispatch =
        metadata.requirements.every(
          (requirement, index) =>
            dispatchIngredients[index]?.quantity >= requirement.quantity,
        );
      evidence.ingredientLocksStillClearBeforeDispatch =
        dispatchIngredients.every((entry) => !entry.locked);
      evidence.goldStillSufficientBeforeDispatch =
        metadata.cost === null ||
        (dispatchCharacter.gold !== null &&
          dispatchCharacter.gold >= metadata.cost);

      const dispatchIntelligence = this.deps.inventoryIntelligence.tick();
      const dispatchPlan = this.deps.craft.tick();
      evidence.exactCandidateStillSelected =
        entriesUnprotected(
          dispatchIntelligence.entries,
          metadata,
          itemSlots,
        ) && exactCandidate(dispatchPlan, recipeName, itemSlots);

      if (
        !evidence.movementIdleBeforeDispatch ||
        !evidence.craftOperationIdle ||
        !evidence.mapAllowsCraft ||
        !evidence.ingredientsStillExactBeforeDispatch ||
        !evidence.quantitiesStillSufficientBeforeDispatch ||
        !evidence.ingredientLocksStillClearBeforeDispatch ||
        !evidence.goldStillSufficientBeforeDispatch ||
        !evidence.exactCandidateStillSelected
      ) {
        craftStatus = dispatchPlan;
        reason = "CRAFT_LIVE_JIT_PREFLIGHT_FAILED";
        return (finalResult = finish());
      }

      executionAttempts += 1;
      craftStatus = await this.deps.craft.executeNext();

      if (craftStatus.lastAction?.status === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "CRAFT_LIVE_OUTCOME_UNKNOWN_NO_RETRY";
        return (finalResult = finish());
      }

      if (craftStatus.lastAction?.status !== "CONFIRMED") {
        reason =
          craftStatus.lastAction?.why || "CRAFT_LIVE_ACTION_NOT_CONFIRMED";
        return (finalResult = finish());
      }

      const settleStartedAt = this.now();
      do {
        const observedInventory = this.deps.game.inventory();
        const observedCharacter = this.deps.game.character();
        afterGold = observedCharacter.gold;
        afterOutputQuantity = totalItemQuantity(
          observedInventory,
          metadata.outputName,
        );
        afterIngredients = itemSlots.map((slot) =>
          itemState(observedInventory, slot),
        );
        afterIngredientTotals = metadata.requirements.map((requirement) =>
          totalItemQuantity(observedInventory, requirement.name),
        );

        evidence.ingredientConsumed = metadata.requirements.every(
          (requirement, index) =>
            afterIngredientTotals[index] <=
            beforeIngredientTotals[index] - requirement.quantity,
        );
        evidence.outputIncreased =
          afterOutputQuantity >= beforeOutputQuantity + 1;
        evidence.goldSpent =
          metadata.cost === null ||
          metadata.cost === 0 ||
          (beforeGold !== null &&
            afterGold !== null &&
            afterGold <= beforeGold - metadata.cost);
        evidence.mutationObserved =
          evidence.ingredientConsumed &&
          evidence.outputIncreased &&
          evidence.goldSpent;

        if (evidence.mutationObserved) break;
        await this.sleep(settlePollMs);
      } while (this.now() - settleStartedAt < settleTimeoutMs);

      if (!evidence.mutationObserved) {
        outcome = "TIMEOUT";
        reason = "CRAFT_LIVE_CONFIRMED_BUT_MUTATION_NOT_FULLY_OBSERVED";
        return (finalResult = finish());
      }

      outcome = "PASS";
      reason = "CRAFT_LIVE_E2E_CONFIRMED";
      return (finalResult = finish());
    } finally {
      this.deps.inventoryIntelligence.clearConfigOverride();
      inventoryConfigOverrideCleared = true;
      this.deps.craft.clearConfigOverride();
      craftConfigOverrideCleared = true;
      this.deps.inventoryIntelligence.tick();
      this.deps.craft.tick();

      if (finalResult) {
        finalResult.cleanup.inventoryConfigOverrideCleared =
          inventoryConfigOverrideCleared;
        finalResult.cleanup.craftConfigOverrideCleared =
          craftConfigOverrideCleared;
      }
    }
  }
}

export {
  itemState as craftLiveItemState,
  totalItemQuantity as craftLiveTotalItemQuantity,
};

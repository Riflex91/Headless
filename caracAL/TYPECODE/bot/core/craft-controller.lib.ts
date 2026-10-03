import type { ActionRecord } from "./action-ledger.lib";
import type { CraftRequest } from "./action-boundary.lib";
import type {
  CharacterSnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";
import type {
  InventoryIntelligenceEntry,
  InventoryIntelligenceStatus,
} from "./inventory-intelligence-controller.lib";

export type CraftState =
  | "DISABLED"
  | "EMPTY"
  | "READY"
  | "EXECUTING"
  | "UNKNOWN_HOLD";

export interface CraftRequirement {
  quantity: number;
  name: string;
  level: number | null;
}

export interface CraftDecision {
  recipe: string;
  cost: number | null;
  requirements: CraftRequirement[];
  itemSlots: number[];
  eligible: boolean;
  reason: string;
}

export interface CraftCandidate {
  recipe: string;
  cost: number | null;
  requirements: CraftRequirement[];
  itemSlots: number[];
  reason: "CRAFT_POLICY_ELIGIBLE";
}

export interface CraftUnknownHold {
  actionId: string;
  fingerprint: string;
  recipe: string;
  itemSlots: number[];
  reason: string;
  createdAt: number;
}

export interface CraftActionSummary {
  id: string;
  status: ActionRecord["status"];
  why: string;
  error: string | null;
  recipe: string;
  itemSlots: number[];
}

export interface CraftStatus {
  timestamp: number;
  enabled: boolean;
  state: CraftState;
  reason: string;
  executionMode: "EXPLICIT_ONE_SHOT";
  selected: CraftCandidate | null;
  candidates: CraftCandidate[];
  decisions: CraftDecision[];
  unknownHold: CraftUnknownHold | null;
  lastAction: CraftActionSummary | null;
  summary: {
    configuredRecipes: number;
    eligibleCandidates: number;
    protectedIngredients: number;
    insufficientIngredients: number;
    insufficientGoldRecipes: number;
  };
}

export interface CraftEvent {
  type: "CRAFT_UPDATED";
  timestamp: number;
  reason: string;
  actionId?: string;
  status: CraftStatus;
}

export interface CraftControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: CraftEvent) => void;
}

interface CraftGameAdapter {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
}

interface CraftActionBoundary {
  craft(request: CraftRequest): Promise<ActionRecord>;
}

interface CraftInventoryIntelligence {
  status(): InventoryIntelligenceStatus;
}

interface NormalizedCraftConfig {
  enabled: boolean;
  allowedRecipes: Set<string>;
}

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

function normalizeConfig(value: unknown): NormalizedCraftConfig {
  const root = record(value);
  const craft = record(root.craft);
  const allowedRecipes = new Set(
    (Array.isArray(craft.allowedRecipes) ? craft.allowedRecipes : [])
      .map((entry) => text(entry))
      .filter((entry): entry is string => entry !== null),
  );
  return {
    enabled: typeof craft.enabled === "boolean" ? craft.enabled : true,
    allowedRecipes,
  };
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

function itemFingerprint(
  inventory: InventorySlotSnapshot[],
  slots: number[],
): string {
  return JSON.stringify(
    slots.map((slot) => {
      const item = inventoryItem(inventory, slot);
      return [
        slot,
        item ? text(item.name) : null,
        itemLevel(item),
        itemQuantity(item),
        item?.p ?? null,
      ];
    }),
  );
}

function parseRequirements(rawRecipe: unknown): CraftRequirement[] | null {
  const recipe = record(rawRecipe);
  if (!Array.isArray(recipe.items) || recipe.items.length < 1) return null;

  const requirements: CraftRequirement[] = [];
  for (const rawRequirement of recipe.items) {
    if (!Array.isArray(rawRequirement) || rawRequirement.length < 2) {
      return null;
    }

    const quantity = positiveInteger(Number(rawRequirement[0]));
    const name = text(rawRequirement[1]);
    const level =
      rawRequirement.length >= 3
        ? nonNegativeInteger(Number(rawRequirement[2]))
        : null;

    if (quantity === null || !name) return null;
    if (
      rawRequirement.length >= 3 &&
      nonNegativeInteger(Number(rawRequirement[2])) === null
    ) {
      return null;
    }

    requirements.push({ quantity, name, level });
  }

  return requirements;
}

function actionSummary(
  action: ActionRecord,
  candidate: CraftCandidate,
): CraftActionSummary {
  return {
    id: action.id,
    status: action.status,
    why: action.why,
    error: action.error || null,
    recipe: candidate.recipe,
    itemSlots: [...candidate.itemSlots],
  };
}

export class CraftController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: CraftEvent) => void;
  private configOverride: unknown | undefined;
  private busy = false;
  private unknownHold: CraftUnknownHold | null = null;
  private lastAction: CraftActionSummary | null = null;
  private lastEventSignature: string | null = null;
  private lastStatus: CraftStatus;

  constructor(
    private readonly game: CraftGameAdapter,
    private readonly actions: CraftActionBoundary,
    private readonly inventoryIntelligence: CraftInventoryIntelligence,
    options: CraftControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      true,
      "EMPTY",
      "CRAFT_POLICY_NO_ALLOWED_RECIPES",
    );
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  status(): CraftStatus {
    return this.lastStatus;
  }

  tick(): CraftStatus {
    return this.publish(this.plan());
  }

  async executeNext(): Promise<CraftStatus> {
    if (this.busy) {
      return this.publish({
        ...this.plan(),
        state: "EXECUTING",
        reason: "CRAFT_ACTION_ALREADY_RUNNING",
      });
    }

    const plan = this.plan();
    if (!plan.enabled || plan.state === "UNKNOWN_HOLD" || !plan.selected) {
      return this.publish(plan);
    }

    const candidate = plan.selected;
    const fingerprint = itemFingerprint(
      this.game.inventory(),
      candidate.itemSlots,
    );

    this.busy = true;
    this.publish({
      ...plan,
      state: "EXECUTING",
      reason: "CRAFT_ACTION_DISPATCHING",
    });

    try {
      const action = await this.actions.craft({
        module: "CraftController",
        why: "CRAFT_POLICY_SELECTED",
        recipe: candidate.recipe,
        itemSlots: [...candidate.itemSlots],
      });
      this.lastAction = actionSummary(action, candidate);

      if (action.status === "UNKNOWN") {
        this.unknownHold = {
          actionId: action.id,
          fingerprint,
          recipe: candidate.recipe,
          itemSlots: [...candidate.itemSlots],
          reason: action.error || action.why || "CRAFT_OUTCOME_UNKNOWN",
          createdAt: this.now(),
        };
      }
    } finally {
      this.busy = false;
    }

    return this.publish(this.plan());
  }

  private plan(): CraftStatus {
    const now = this.now();
    const config = normalizeConfig(
      this.configOverride === undefined
        ? this.configSource()
        : this.configOverride,
    );

    if (!config.enabled) {
      return this.emptyStatus(now, false, "DISABLED", "CRAFT_DISABLED");
    }

    const inventory = this.game.inventory();
    this.reconcileUnknownHold(inventory);

    if (config.allowedRecipes.size === 0) {
      return this.emptyStatus(
        now,
        true,
        this.unknownHold ? "UNKNOWN_HOLD" : "EMPTY",
        this.unknownHold
          ? "CRAFT_UNKNOWN_HOLD_ACTIVE"
          : "CRAFT_POLICY_NO_ALLOWED_RECIPES",
      );
    }

    const character = this.game.character();
    const gameData = record(this.game.gameData());
    const recipes = record(gameData.craft);
    const intelligence = this.inventoryIntelligence.status();
    const craftEntries = intelligence.entries
      .filter((entry) => entry.disposition === "CRAFT")
      .sort((left, right) => left.slot - right.slot);

    const decisions = [...config.allowedRecipes]
      .sort((left, right) => left.localeCompare(right))
      .map((recipe) =>
        this.decideRecipe(
          recipe,
          recipes[recipe],
          character,
          inventory,
          craftEntries,
        ),
      );

    const candidates = decisions
      .filter((decision) => decision.eligible)
      .map((decision) => ({
        recipe: decision.recipe,
        cost: decision.cost,
        requirements: decision.requirements.map((entry) => ({ ...entry })),
        itemSlots: [...decision.itemSlots],
        reason: "CRAFT_POLICY_ELIGIBLE" as const,
      }));

    const selected = this.unknownHold ? null : candidates[0] || null;
    const state: CraftState = this.unknownHold
      ? "UNKNOWN_HOLD"
      : selected
        ? "READY"
        : "EMPTY";
    const reason = this.unknownHold
      ? "CRAFT_UNKNOWN_HOLD_ACTIVE"
      : selected
        ? "CRAFT_CANDIDATE_READY"
        : "CRAFT_NO_ELIGIBLE_CANDIDATE";

    return {
      timestamp: now,
      enabled: true,
      state,
      reason,
      executionMode: "EXPLICIT_ONE_SHOT",
      selected,
      candidates,
      decisions,
      unknownHold: this.unknownHold ? { ...this.unknownHold } : null,
      lastAction: this.lastAction ? { ...this.lastAction } : null,
      summary: {
        configuredRecipes: config.allowedRecipes.size,
        eligibleCandidates: candidates.length,
        protectedIngredients: decisions.filter(
          (decision) => decision.reason === "CRAFT_INGREDIENT_PROTECTED",
        ).length,
        insufficientIngredients: decisions.filter(
          (decision) => decision.reason === "CRAFT_INGREDIENTS_INSUFFICIENT",
        ).length,
        insufficientGoldRecipes: decisions.filter(
          (decision) => decision.reason === "CRAFT_GOLD_INSUFFICIENT",
        ).length,
      },
    };
  }

  private decideRecipe(
    recipeName: string,
    rawRecipe: unknown,
    character: CharacterSnapshot,
    inventory: InventorySlotSnapshot[],
    craftEntries: InventoryIntelligenceEntry[],
  ): CraftDecision {
    const recipe = record(rawRecipe);
    const requirements = parseRequirements(recipe);
    const cost = finite(recipe.cost);
    const base: CraftDecision = {
      recipe: recipeName,
      cost,
      requirements: requirements || [],
      itemSlots: [],
      eligible: false,
      reason: "CRAFT_NOT_ELIGIBLE",
    };

    if (!requirements) {
      return { ...base, reason: "CRAFT_RECIPE_UNKNOWN_OR_INVALID" };
    }

    if (
      cost !== null &&
      character.gold !== null &&
      character.gold < cost
    ) {
      return { ...base, reason: "CRAFT_GOLD_INSUFFICIENT" };
    }

    const usedSlots = new Set<number>();
    const selectedSlots: number[] = [];

    for (const requirement of requirements) {
      const matchingEntries = craftEntries.filter((entry) => {
        if (usedSlots.has(entry.slot)) return false;
        if (entry.name !== requirement.name) return false;

        const item = inventoryItem(inventory, entry.slot);
        if (!item || text(item.name) !== requirement.name) return false;
        if (
          requirement.level !== null &&
          itemLevel(item) !== requirement.level
        ) {
          return false;
        }
        return itemQuantity(item) >= requirement.quantity;
      });

      const safeEntry = matchingEntries.find(
        (entry) => !entry.protected && entry.protections.length === 0,
      );

      if (!safeEntry) {
        const protectedMatch = matchingEntries.some(
          (entry) => entry.protected || entry.protections.length > 0,
        );
        return {
          ...base,
          itemSlots: [...selectedSlots],
          reason: protectedMatch
            ? "CRAFT_INGREDIENT_PROTECTED"
            : "CRAFT_INGREDIENTS_INSUFFICIENT",
        };
      }

      usedSlots.add(safeEntry.slot);
      selectedSlots.push(safeEntry.slot);
    }

    return {
      ...base,
      itemSlots: selectedSlots,
      eligible: true,
      reason: "CRAFT_POLICY_ELIGIBLE",
    };
  }

  private reconcileUnknownHold(inventory: InventorySlotSnapshot[]): void {
    if (!this.unknownHold) return;
    const currentFingerprint = itemFingerprint(
      inventory,
      this.unknownHold.itemSlots,
    );
    if (currentFingerprint !== this.unknownHold.fingerprint) {
      this.unknownHold = null;
    }
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: CraftState,
    reason: string,
  ): CraftStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      executionMode: "EXPLICIT_ONE_SHOT",
      selected: null,
      candidates: [],
      decisions: [],
      unknownHold: this.unknownHold ? { ...this.unknownHold } : null,
      lastAction: this.lastAction ? { ...this.lastAction } : null,
      summary: {
        configuredRecipes: 0,
        eligibleCandidates: 0,
        protectedIngredients: 0,
        insufficientIngredients: 0,
        insufficientGoldRecipes: 0,
      },
    };
  }

  private publish(status: CraftStatus): CraftStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      selected: status.selected,
      candidates: status.candidates,
      decisions: status.decisions,
      unknownHold: status.unknownHold,
      lastAction: status.lastAction,
      summary: status.summary,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "CRAFT_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        ...(status.lastAction?.id && { actionId: status.lastAction.id }),
        status,
      });
    }

    return status;
  }
}

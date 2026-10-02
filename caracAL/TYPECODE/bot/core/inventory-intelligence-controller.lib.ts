import type {
  EquipmentSnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";

export const INVENTORY_DISPOSITIONS = [
  "KEEP",
  "BANK",
  "SELL",
  "EXCHANGE",
  "CRAFT",
  "GEAR",
  "UPGRADE",
  "CONSUMABLE",
  "QUEST",
  "RESERVED",
  "UNKNOWN",
] as const;

export type InventoryDisposition =
  (typeof INVENTORY_DISPOSITIONS)[number];

export const INVENTORY_PROTECTIONS = [
  "LOCKED",
  "EVENT",
  "QUEST",
  "FUTURE_GEAR",
  "RESERVED",
  "UNKNOWN",
  "VALUABLE",
] as const;

export type InventoryProtection =
  (typeof INVENTORY_PROTECTIONS)[number];

export type InventoryIntelligenceState =
  | "DISABLED"
  | "EMPTY"
  | "READY";

export interface InventoryIntelligenceEntry {
  slot: number;
  name: string | null;
  level: number | null;
  quantity: number;
  definitionKnown: boolean;
  itemType: string | null;
  disposition: InventoryDisposition;
  protected: boolean;
  protections: InventoryProtection[];
  why: string;
}

export interface InventoryIntelligenceSummary {
  totalItems: number;
  protectedItems: number;
  dispositions: Record<InventoryDisposition, number>;
  protections: Record<InventoryProtection, number>;
}

export interface InventoryIntelligenceStatus {
  timestamp: number;
  enabled: boolean;
  state: InventoryIntelligenceState;
  reason: string;
  entries: InventoryIntelligenceEntry[];
  summary: InventoryIntelligenceSummary;
}

export interface InventoryIntelligenceEvent {
  type: "INVENTORY_INTELLIGENCE_UPDATED";
  timestamp: number;
  reason: string;
  status: InventoryIntelligenceStatus;
}

export interface InventoryIntelligenceControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: InventoryIntelligenceEvent) => void;
}

interface InventoryGameAdapter {
  inventory(): InventorySlotSnapshot[];
  equipment(): EquipmentSnapshot;
  gameData(): Record<string, unknown>;
}

interface NormalizedInventoryConfig {
  enabled: boolean;
  explicitDispositionByItem: Map<string, InventoryDisposition>;
  reservedItems: Set<string>;
  futureGearItems: Set<string>;
  valuableItems: Set<string>;
  eventItems: Set<string>;
  questItems: Set<string>;
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
]);

const CONSUMABLE_TYPES = new Set([
  "pot",
  "potion",
  "elixir",
  "food",
  "scroll",
]);

const DISPOSITION_SET = new Set<string>(INVENTORY_DISPOSITIONS);

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

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function nameSet(...values: unknown[]): Set<string> {
  return new Set(values.flatMap((value) => names(value)));
}

function normalizeDisposition(value: unknown): InventoryDisposition | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return DISPOSITION_SET.has(normalized)
    ? (normalized as InventoryDisposition)
    : null;
}

function addDispositionLists(
  target: Map<string, InventoryDisposition>,
  value: unknown,
): void {
  const dispositions = record(value);
  for (const disposition of INVENTORY_DISPOSITIONS) {
    const configured =
      dispositions[disposition] ??
      dispositions[disposition.toLowerCase()];
    for (const itemName of names(configured)) {
      target.set(itemName, disposition);
    }
  }
}

function normalizeConfig(value: unknown): NormalizedInventoryConfig {
  const root = record(value);
  const inventory = record(root.inventory);
  const intelligence = record(inventory.intelligence);
  const gear = record(root.gear);
  const explicitDispositionByItem = new Map<string, InventoryDisposition>();

  addDispositionLists(
    explicitDispositionByItem,
    inventory.dispositions ?? intelligence.dispositions,
  );

  const rules = record(inventory.rules ?? intelligence.rules);
  for (const [itemName, rawDisposition] of Object.entries(rules)) {
    const disposition = normalizeDisposition(rawDisposition);
    if (disposition) explicitDispositionByItem.set(itemName, disposition);
  }

  return {
    enabled: bool(
      intelligence.enabled ?? inventory.intelligenceEnabled,
      true,
    ),
    explicitDispositionByItem,
    reservedItems: nameSet(
      inventory.reservedItems,
      intelligence.reservedItems,
      gear.reservedItems,
      gear.reserved,
    ),
    futureGearItems: nameSet(
      inventory.futureGearItems,
      intelligence.futureGearItems,
      gear.futureGearItems,
      gear.futureGear,
    ),
    valuableItems: nameSet(
      inventory.valuableItems,
      intelligence.valuableItems,
    ),
    eventItems: nameSet(
      inventory.eventItems,
      intelligence.eventItems,
    ),
    questItems: nameSet(
      inventory.questItems,
      intelligence.questItems,
    ),
  };
}

function isLocked(item: Record<string, unknown>): boolean {
  const lock = item.locked ?? item.l;
  return (
    lock === true ||
    lock === 1 ||
    lock === "l" ||
    lock === "locked" ||
    (typeof lock === "string" && lock.trim().length > 0)
  );
}

function isDefinitionFlag(
  definition: Record<string, unknown>,
  flag: string,
): boolean {
  return definition[flag] === true;
}

function definitionType(
  definition: Record<string, unknown>,
): string | null {
  return text(definition.type)?.toLowerCase() || null;
}

function recipeIngredientNames(gameData: Record<string, unknown>): Set<string> {
  const result = new Set<string>();
  const craft = record(gameData.craft);

  for (const rawRecipe of Object.values(craft)) {
    const recipe = record(rawRecipe);
    const ingredients = Array.isArray(recipe.items)
      ? recipe.items
      : Array.isArray(recipe.ingredients)
      ? recipe.ingredients
      : [];

    for (const rawIngredient of ingredients) {
      if (Array.isArray(rawIngredient)) {
        for (const entry of rawIngredient) {
          const itemName = text(entry);
          if (itemName) result.add(itemName);
        }
        continue;
      }

      const ingredient = record(rawIngredient);
      const itemName =
        text(ingredient.name) ||
        text(ingredient.item) ||
        text(ingredient.id);
      if (itemName) result.add(itemName);
    }
  }

  return result;
}

function initializedDispositionCounts(): Record<InventoryDisposition, number> {
  return Object.fromEntries(
    INVENTORY_DISPOSITIONS.map((disposition) => [disposition, 0]),
  ) as Record<InventoryDisposition, number>;
}

function initializedProtectionCounts(): Record<InventoryProtection, number> {
  return Object.fromEntries(
    INVENTORY_PROTECTIONS.map((protection) => [protection, 0]),
  ) as Record<InventoryProtection, number>;
}

function inferredDisposition(
  name: string,
  definition: Record<string, unknown>,
  definitionKnown: boolean,
  protections: InventoryProtection[],
  config: NormalizedInventoryConfig,
  craftIngredients: Set<string>,
): InventoryDisposition {
  if (protections.includes("QUEST")) return "QUEST";
  if (protections.includes("RESERVED")) return "RESERVED";
  if (protections.includes("FUTURE_GEAR")) return "GEAR";
  if (!definitionKnown) return "UNKNOWN";

  const configured = config.explicitDispositionByItem.get(name);
  if (configured) return configured;

  const type = definitionType(definition);
  if (type && CONSUMABLE_TYPES.has(type)) return "CONSUMABLE";

  if (
    finite(definition.e) !== null ||
    definition.exchange === true ||
    definition.exchangeable === true
  ) {
    return "EXCHANGE";
  }

  if (craftIngredients.has(name) || definition.craft === true) {
    return "CRAFT";
  }

  if (definition.upgrade === true) return "UPGRADE";

  if (
    (type && EQUIPMENT_TYPES.has(type)) ||
    typeof definition.wtype === "string" ||
    typeof definition.slot === "string"
  ) {
    return "GEAR";
  }

  return "KEEP";
}

function protectionsFor(
  name: string,
  item: Record<string, unknown>,
  definition: Record<string, unknown>,
  definitionKnown: boolean,
  config: NormalizedInventoryConfig,
): InventoryProtection[] {
  const result: InventoryProtection[] = [];
  const type = definitionType(definition);

  if (isLocked(item)) result.push("LOCKED");
  if (
    config.eventItems.has(name) ||
    isDefinitionFlag(definition, "event") ||
    type === "event"
  ) {
    result.push("EVENT");
  }
  if (
    config.questItems.has(name) ||
    isDefinitionFlag(definition, "quest") ||
    type === "quest"
  ) {
    result.push("QUEST");
  }
  if (config.futureGearItems.has(name)) result.push("FUTURE_GEAR");
  if (config.reservedItems.has(name)) result.push("RESERVED");
  if (!definitionKnown) result.push("UNKNOWN");
  if (config.valuableItems.has(name)) result.push("VALUABLE");

  return result;
}

function itemWhy(
  disposition: InventoryDisposition,
  protections: InventoryProtection[],
  definitionKnown: boolean,
  configured: boolean,
): string {
  const source = configured
    ? "explicit config"
    : definitionKnown
    ? "Adventure Land item metadata"
    : "unknown item metadata";
  const protection =
    protections.length > 0
      ? ` · protected: ${protections.join(", ")}`
      : "";
  return `${disposition} via ${source}${protection}`;
}

export class InventoryIntelligenceController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: InventoryIntelligenceEvent) => void;
  private configOverride: unknown | undefined;
  private lastEventSignature: string | null = null;
  private lastStatus: InventoryIntelligenceStatus;

  constructor(
    private readonly game: InventoryGameAdapter,
    options: InventoryIntelligenceControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      false,
      "DISABLED",
      "INVENTORY_INTELLIGENCE_DISABLED",
    );
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
  }

  status(): InventoryIntelligenceStatus {
    return this.lastStatus;
  }

  tick(): InventoryIntelligenceStatus {
    const now = this.now();
    const config = normalizeConfig(
      this.configOverride === undefined
        ? this.configSource()
        : this.configOverride,
    );

    if (!config.enabled) {
      return this.publish(
        this.emptyStatus(
          now,
          false,
          "DISABLED",
          "INVENTORY_INTELLIGENCE_DISABLED",
        ),
      );
    }

    const gameData = record(this.game.gameData());
    const itemDefinitions = record(gameData.items);
    const craftIngredients = recipeIngredientNames(gameData);
    const entries: InventoryIntelligenceEntry[] = [];

    for (const inventorySlot of this.game.inventory()) {
      if (!inventorySlot.item) continue;

      const item = record(inventorySlot.item);
      const name = text(item.name);
      const definitionKnown =
        !!name &&
        Object.prototype.hasOwnProperty.call(itemDefinitions, name) &&
        itemDefinitions[name] !== null &&
        typeof itemDefinitions[name] === "object";
      const definition = definitionKnown
        ? record(itemDefinitions[name as string])
        : {};
      const protections = name
        ? protectionsFor(
            name,
            item,
            definition,
            definitionKnown,
            config,
          )
        : (["UNKNOWN"] as InventoryProtection[]);
      const configured =
        !!name && config.explicitDispositionByItem.has(name);
      const disposition = name
        ? inferredDisposition(
            name,
            definition,
            definitionKnown,
            protections,
            config,
            craftIngredients,
          )
        : "UNKNOWN";

      entries.push({
        slot: inventorySlot.slot,
        name,
        level: finite(item.level),
        quantity: Math.max(1, Math.floor(finite(item.q) ?? 1)),
        definitionKnown,
        itemType: definitionType(definition),
        disposition,
        protected: protections.length > 0,
        protections,
        why: itemWhy(
          disposition,
          protections,
          definitionKnown,
          configured,
        ),
      });
    }

    const summary: InventoryIntelligenceSummary = {
      totalItems: entries.length,
      protectedItems: entries.filter((entry) => entry.protected).length,
      dispositions: initializedDispositionCounts(),
      protections: initializedProtectionCounts(),
    };

    for (const entry of entries) {
      summary.dispositions[entry.disposition] += 1;
      for (const protection of entry.protections) {
        summary.protections[protection] += 1;
      }
    }

    const status: InventoryIntelligenceStatus = {
      timestamp: now,
      enabled: true,
      state: entries.length > 0 ? "READY" : "EMPTY",
      reason:
        entries.length > 0
          ? "INVENTORY_INTELLIGENCE_READY"
          : "INVENTORY_INTELLIGENCE_EMPTY",
      entries,
      summary,
    };

    return this.publish(status);
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: InventoryIntelligenceState,
    reason: string,
  ): InventoryIntelligenceStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      entries: [],
      summary: {
        totalItems: 0,
        protectedItems: 0,
        dispositions: initializedDispositionCounts(),
        protections: initializedProtectionCounts(),
      },
    };
  }

  private publish(
    status: InventoryIntelligenceStatus,
  ): InventoryIntelligenceStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      entries: status.entries,
      summary: status.summary,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "INVENTORY_INTELLIGENCE_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

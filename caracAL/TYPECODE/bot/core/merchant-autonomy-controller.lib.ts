import type {
  CharacterSnapshot,
  EquipmentSnapshot,
  InventorySlotSnapshot,
  MarketListingSnapshot,
  SkillSnapshot,
  TradeSlotsSnapshot,
} from "./game-adapter.lib";

export type MerchantAutonomyFeature =
  | "MERRIT"
  | "FISHING"
  | "MINING"
  | "WISHLIST"
  | "GIVEAWAYS"
  | "PONTY"
  | "MERCHANT_SKILLS";

export type MerchantAutonomyState =
  | "DISABLED"
  | "READY"
  | "UNSUPPORTED_CLASS";

export interface GatheringZoneEvidence {
  map: string;
  type: "fishing" | "mining";
  drop: string | null;
  points: number;
}

export interface MerchantAutonomyStatus {
  timestamp: number;
  enabled: boolean;
  state: MerchantAutonomyState;
  reason: string;
  character: {
    name: string | null;
    ctype: string | null;
    map: string | null;
  };
  featureOrder: MerchantAutonomyFeature[];
  merrit: {
    npcPresent: boolean;
    mainMapPresent: boolean;
    standItems: string[];
    activeListings: number;
  };
  gathering: {
    fishing: {
      skillPresent: boolean;
      toolPresent: boolean;
      zones: GatheringZoneEvidence[];
    };
    mining: {
      skillPresent: boolean;
      toolPresent: boolean;
      zones: GatheringZoneEvidence[];
    };
  };
  wishlist: {
    boundarySupported: boolean;
    activeSlots: string[];
  };
  giveaways: {
    joinOnly: true;
    visibleCount: number;
    visible: Array<{
      merchantId: string;
      merchantName: string | null;
      slot: string;
      rid: string | null;
      itemName: string | null;
      minutes: number | null;
    }>;
  };
  ponty: {
    boundarySupported: boolean;
    npcPresent: boolean;
  };
  merchantSkills: {
    available: string[];
  };
  mutationPolicy: {
    executionEnabled: false;
    valueMutationForced: false;
    giveawayCreationSupported: false;
  };
}

export interface MerchantAutonomyEvent {
  type: "MERCHANT_AUTONOMY_STATUS";
  reason: string;
  status: MerchantAutonomyStatus;
}

interface MerchantAutonomyGame {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  equipment(): EquipmentSnapshot;
  tradeSlots(): TradeSlotsSnapshot;
  market(): MarketListingSnapshot[];
  skills(characterOnly?: boolean): SkillSnapshot[];
  gameData(): Record<string, unknown>;
}

interface MerchantAutonomyActions {
  capabilities(): readonly string[];
}

export interface MerchantAutonomyControllerOptions {
  config?: () => unknown;
  now?: () => number;
  onEvent?: (event: MerchantAutonomyEvent) => void;
}

interface NormalizedConfig {
  enabled: boolean;
}

const FEATURE_ORDER: MerchantAutonomyFeature[] = [
  "MERRIT",
  "FISHING",
  "MINING",
  "WISHLIST",
  "GIVEAWAYS",
  "PONTY",
  "MERCHANT_SKILLS",
];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeConfig(value: unknown): NormalizedConfig {
  const root = objectValue(value);
  const autonomy = objectValue(
    root.merchantAutonomy ?? root.merchant_autonomy,
  );
  return {
    enabled: autonomy.enabled === true,
  };
}

function itemName(value: unknown): string | null {
  const item = objectValue(value);
  return typeof item.name === "string" && item.name ? item.name : null;
}

function toolPresent(
  name: string,
  inventory: InventorySlotSnapshot[],
  equipment: EquipmentSnapshot,
): boolean {
  return (
    inventory.some((entry) => itemName(entry.item) === name) ||
    Object.values(equipment).some((item) => itemName(item) === name)
  );
}

function listingIsBuy(value: Record<string, unknown> | null): boolean {
  return value?.b === true;
}

function gameDefinitions(
  gameData: Record<string, unknown>,
): {
  items: Record<string, unknown>;
  npcs: Record<string, unknown>;
  maps: Record<string, unknown>;
} {
  return {
    items: objectValue(gameData.items),
    npcs: objectValue(gameData.npcs),
    maps: objectValue(gameData.maps),
  };
}

function npcNameContains(
  npcs: Record<string, unknown>,
  needle: string,
): boolean {
  return Object.values(npcs).some((value) => {
    const name = objectValue(value).name;
    return typeof name === "string" && name.toLowerCase().includes(needle);
  });
}

function gatheringZones(
  maps: Record<string, unknown>,
  type: "fishing" | "mining",
): GatheringZoneEvidence[] {
  const result: GatheringZoneEvidence[] = [];
  for (const [map, rawMap] of Object.entries(maps)) {
    const zones = objectValue(rawMap).zones;
    if (!Array.isArray(zones)) continue;
    for (const rawZone of zones) {
      const zone = objectValue(rawZone);
      if (zone.type !== type) continue;
      const polygon = Array.isArray(zone.polygon) ? zone.polygon : [];
      result.push({
        map,
        type,
        drop:
          typeof zone.drop === "string" && zone.drop ? zone.drop : null,
        points: polygon.length,
      });
    }
  }
  return result.sort(
    (a, b) => a.map.localeCompare(b.map) || a.type.localeCompare(b.type),
  );
}

function standItemNames(items: Record<string, unknown>): string[] {
  return Object.entries(items)
    .filter(([, raw]) => objectValue(raw).stand === true)
    .map(([name]) => name)
    .sort();
}

export class MerchantAutonomyController {
  private readonly configSource: () => unknown;
  private readonly now: () => number;
  private readonly onEvent?: (event: MerchantAutonomyEvent) => void;
  private configOverride: unknown | undefined;
  private lastStatus: MerchantAutonomyStatus | null = null;

  constructor(
    private readonly game: MerchantAutonomyGame,
    private readonly actions: MerchantAutonomyActions,
    options: MerchantAutonomyControllerOptions = {},
  ) {
    this.configSource = options.config || (() => ({}));
    this.now = options.now || (() => Date.now());
    this.onEvent = options.onEvent;
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

  status(): MerchantAutonomyStatus {
    return this.lastStatus || this.buildStatus();
  }

  tick(): MerchantAutonomyStatus {
    const status = this.buildStatus();
    this.lastStatus = status;
    this.onEvent?.({
      type: "MERCHANT_AUTONOMY_STATUS",
      reason: status.reason,
      status,
    });
    return status;
  }

  private buildStatus(): MerchantAutonomyStatus {
    const config = normalizeConfig(this.effectiveConfig());
    const character = this.game.character();
    const gameData = this.game.gameData();
    const { items, npcs, maps } = gameDefinitions(gameData);
    const inventory = this.game.inventory();
    const equipment = this.game.equipment();
    const tradeSlots = this.game.tradeSlots();
    const capabilities = new Set(this.actions.capabilities());
    const market = this.game.market();
    const skills = this.game.skills(true);

    const visibleGiveaways = market
      .filter(
        (listing) =>
          listing.item.giveaway !== null &&
          listing.item.giveaway > 0 &&
          listing.item.rid !== null &&
          listing.merchantName !== character.name,
      )
      .map((listing) => ({
        merchantId: listing.merchantId,
        merchantName: listing.merchantName,
        slot: listing.slot,
        rid: listing.item.rid,
        itemName: listing.item.name,
        minutes: listing.item.giveaway,
      }));

    let state: MerchantAutonomyState = "READY";
    let reason = "MERCHANT_AUTONOMY_READY";
    if (character.ctype !== "merchant") {
      state = "UNSUPPORTED_CLASS";
      reason = "MERCHANT_AUTONOMY_MERCHANT_REQUIRED";
    } else if (!config.enabled) {
      state = "DISABLED";
      reason = "MERCHANT_AUTONOMY_DISABLED";
    }

    return {
      timestamp: this.now(),
      enabled: config.enabled,
      state,
      reason,
      character: {
        name: character.name,
        ctype: character.ctype,
        map: character.map,
      },
      featureOrder: [...FEATURE_ORDER],
      merrit: {
        npcPresent: npcNameContains(npcs, "merrit"),
        mainMapPresent: Object.prototype.hasOwnProperty.call(maps, "main"),
        standItems: standItemNames(items),
        activeListings: Object.values(tradeSlots).filter(
          (slot) => !!slot && !listingIsBuy(slot),
        ).length,
      },
      gathering: {
        fishing: {
          skillPresent: skills.some((skill) => skill.key === "fishing"),
          toolPresent: toolPresent("rod", inventory, equipment),
          zones: gatheringZones(maps, "fishing"),
        },
        mining: {
          skillPresent: skills.some((skill) => skill.key === "mining"),
          toolPresent: toolPresent("pickaxe", inventory, equipment),
          zones: gatheringZones(maps, "mining"),
        },
      },
      wishlist: {
        boundarySupported: capabilities.has("WISHLIST"),
        activeSlots: Object.entries(tradeSlots)
          .filter(([, slot]) => !!slot && listingIsBuy(slot))
          .map(([slot]) => slot)
          .sort(),
      },
      giveaways: {
        joinOnly: true,
        visibleCount: visibleGiveaways.length,
        visible: visibleGiveaways,
      },
      ponty: {
        boundarySupported: capabilities.has("PONTY_BUY"),
        npcPresent: npcNameContains(npcs, "ponty"),
      },
      merchantSkills: {
        available: skills
          .filter((skill) =>
            [
              "mcourage",
              "mfrenzy",
              "massproduction",
              "massproductionpp",
              "massexchange",
              "massexchangepp",
              "throw",
              "fishing",
              "mining",
            ].includes(skill.key),
          )
          .map((skill) => skill.key)
          .sort(),
      },
      mutationPolicy: {
        executionEnabled: false,
        valueMutationForced: false,
        giveawayCreationSupported: false,
      },
    };
  }
}

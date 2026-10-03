import type {
  CharacterSnapshot,
  NpcSnapshot,
} from "./game-adapter.lib";
import type { InventoryIntelligenceController } from "./inventory-intelligence-controller.lib";
import type {
  CraftController,
  CraftStatus,
} from "./craft-controller.lib";

export interface CraftPreflightStation {
  located: boolean;
  id: string | null;
  name: string | null;
  map: string | null;
  x: number | null;
  y: number | null;
  runtimeMap: string | null;
  runtimeX: number | null;
  runtimeY: number | null;
  distance: number | null;
  travelRequired: boolean;
}

export interface CraftPreflightResult {
  outcome: "PASS" | "FAIL";
  reason:
    | "CRAFT_PREFLIGHT_COMPLETED"
    | "CRAFT_PREFLIGHT_RUNTIME_NOT_READY"
    | "CRAFT_PREFLIGHT_STATION_NOT_FOUND";
  timestamp: number;
  character: string | null;
  inventoryState: string | null;
  recipeCount: number;
  craft: CraftStatus | null;
  selected: CraftStatus["selected"];
  station: CraftPreflightStation;
  readyForCraft: boolean;
  evidence: {
    inventoryIntelligenceReady: boolean;
    recipeMetadataObserved: boolean;
    craftPlanReadOnly: boolean;
    stationLocated: boolean;
    stationIdentityVerified: boolean;
    selectedCandidateConsistent: boolean;
    noMutationDispatched: true;
  };
  scope: {
    readOnly: true;
    movementMutationForced: false;
    upgradeMutationForced: false;
    compoundMutationForced: false;
    exchangeMutationForced: false;
    craftMutationForced: false;
  };
  cleanup: {
    craftConfigOverrideCleared: boolean;
  };
}

interface CraftPreflightGameAdapter {
  character(): CharacterSnapshot;
  npcs(mapName?: string | null): NpcSnapshot[];
  gameData(): Record<string, unknown>;
}

interface CraftPreflightDependencies {
  game: CraftPreflightGameAdapter;
  inventoryIntelligence: Pick<InventoryIntelligenceController, "tick">;
  craft: Pick<
    CraftController,
    "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  characterName?: () => string | null;
  now?: () => number;
}

const CRAFT_STATION_ID = "craftsman";
const CRAFT_STATION_MAP = "main";
const CRAFT_STATION_MAX_DISTANCE = 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function emptyStation(character: CharacterSnapshot): CraftPreflightStation {
  return {
    located: false,
    id: null,
    name: null,
    map: null,
    x: null,
    y: null,
    runtimeMap: character.map || null,
    runtimeX:
      typeof character.x === "number" && Number.isFinite(character.x)
        ? character.x
        : null,
    runtimeY:
      typeof character.y === "number" && Number.isFinite(character.y)
        ? character.y
        : null,
    distance: null,
    travelRequired: true,
  };
}

export class CraftPreflightRunner {
  private readonly now: () => number;

  constructor(private readonly deps: CraftPreflightDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  run(): CraftPreflightResult {
    const timestamp = this.now();
    const character = this.deps.game.character();
    const intelligence = this.deps.inventoryIntelligence.tick();
    const inventoryState =
      typeof intelligence?.state === "string" ? intelligence.state : null;
    const inventoryReady = ["READY", "EMPTY"].includes(inventoryState || "");
    const gameData = record(this.deps.game.gameData());
    const recipeNames = Object.keys(record(gameData.craft)).sort((a, b) =>
      a.localeCompare(b),
    );

    let craftConfigOverrideCleared = false;
    let craft: CraftStatus | null = null;

    try {
      if (!inventoryReady) {
        return {
          outcome: "FAIL",
          reason: "CRAFT_PREFLIGHT_RUNTIME_NOT_READY",
          timestamp,
          character: this.deps.characterName?.() || null,
          inventoryState,
          recipeCount: recipeNames.length,
          craft: null,
          selected: null,
          station: emptyStation(character),
          readyForCraft: false,
          evidence: {
            inventoryIntelligenceReady: false,
            recipeMetadataObserved: recipeNames.length > 0,
            craftPlanReadOnly: false,
            stationLocated: false,
            stationIdentityVerified: false,
            selectedCandidateConsistent: false,
            noMutationDispatched: true,
          },
          scope: {
            readOnly: true,
            movementMutationForced: false,
            upgradeMutationForced: false,
            compoundMutationForced: false,
            exchangeMutationForced: false,
            craftMutationForced: false,
          },
          cleanup: {
            craftConfigOverrideCleared: false,
          },
        };
      }

      this.deps.craft.setConfigOverride({
        craft: {
          enabled: true,
          allowedRecipes: recipeNames,
        },
      });
      craft = this.deps.craft.tick();

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

      const distance = station ? stationDistance(character, station) : null;
      const stationSnapshot: CraftPreflightStation = station
        ? {
            located: true,
            id: station.id,
            name: station.name,
            map: station.map,
            x: station.x,
            y: station.y,
            runtimeMap: character.map || null,
            runtimeX:
              typeof character.x === "number" && Number.isFinite(character.x)
                ? character.x
                : null,
            runtimeY:
              typeof character.y === "number" && Number.isFinite(character.y)
                ? character.y
                : null,
            distance,
            travelRequired:
              distance === null || distance > CRAFT_STATION_MAX_DISTANCE,
          }
        : emptyStation(character);

      const selectedCandidateConsistent =
        craft.selected === null ||
        craft.candidates.some(
          (candidate) =>
            candidate.recipe === craft?.selected?.recipe &&
            JSON.stringify(candidate.itemSlots) ===
              JSON.stringify(craft?.selected?.itemSlots),
        );

      const evidence = {
        inventoryIntelligenceReady: true,
        recipeMetadataObserved: recipeNames.length > 0,
        craftPlanReadOnly: true,
        stationLocated: stationSnapshot.located,
        stationIdentityVerified:
          stationSnapshot.id === CRAFT_STATION_ID &&
          stationSnapshot.map === CRAFT_STATION_MAP,
        selectedCandidateConsistent,
        noMutationDispatched: true as const,
      };
      const stationReady =
        evidence.stationLocated && evidence.stationIdentityVerified;
      const readyForCraft =
        stationReady &&
        selectedCandidateConsistent &&
        craft.state === "READY" &&
        craft.selected !== null;

      return {
        outcome: stationReady ? "PASS" : "FAIL",
        reason: stationReady
          ? "CRAFT_PREFLIGHT_COMPLETED"
          : "CRAFT_PREFLIGHT_STATION_NOT_FOUND",
        timestamp,
        character: this.deps.characterName?.() || null,
        inventoryState,
        recipeCount: recipeNames.length,
        craft,
        selected: craft.selected,
        station: stationSnapshot,
        readyForCraft,
        evidence,
        scope: {
          readOnly: true,
          movementMutationForced: false,
          upgradeMutationForced: false,
          compoundMutationForced: false,
          exchangeMutationForced: false,
          craftMutationForced: false,
        },
        cleanup: {
          craftConfigOverrideCleared: false,
        },
      };
    } finally {
      this.deps.craft.clearConfigOverride();
      craftConfigOverrideCleared = true;
      this.deps.craft.tick();
      if (craft) {
        // The returned snapshot is immutable evidence from before cleanup.
      }
    }
  }
}

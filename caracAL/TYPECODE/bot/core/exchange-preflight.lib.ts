import type {
  CharacterSnapshot,
  NpcSnapshot,
} from "./game-adapter.lib";
import type { InventoryIntelligenceController } from "./inventory-intelligence-controller.lib";
import type {
  ExchangeController,
  ExchangeStatus,
} from "./exchange-controller.lib";

export interface ExchangePreflightCandidate {
  itemSlot: number;
  itemName: string;
  quantity: number;
  requiredQuantity: number | null;
  protected: boolean;
  protections: string[];
  eligible: boolean;
  reason: string;
}

export interface ExchangePreflightStation {
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

export interface ExchangePreflightResult {
  outcome: "PASS" | "FAIL";
  reason:
    | "EXCHANGE_PREFLIGHT_COMPLETED"
    | "EXCHANGE_PREFLIGHT_RUNTIME_NOT_READY"
    | "EXCHANGE_PREFLIGHT_STATION_NOT_FOUND";
  timestamp: number;
  character: string | null;
  inventoryState: string | null;
  exchange: ExchangeStatus | null;
  selected: ExchangeStatus["selected"];
  candidates: ExchangePreflightCandidate[];
  station: ExchangePreflightStation;
  readyForExchange: boolean;
  summary: {
    exchangeDispositionItems: number;
    eligibleCandidates: number;
    protectedItems: number;
    insufficientQuantityItems: number;
  };
  evidence: {
    inventoryIntelligenceReady: boolean;
    exchangePlanReadOnly: boolean;
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
}

interface ExchangePreflightGameAdapter {
  character(): CharacterSnapshot;
  npcs(mapName?: string | null): NpcSnapshot[];
}

interface ExchangePreflightDependencies {
  game: ExchangePreflightGameAdapter;
  inventoryIntelligence: Pick<InventoryIntelligenceController, "tick">;
  exchange: Pick<ExchangeController, "tick">;
  characterName?: () => string | null;
  now?: () => number;
}

const EXCHANGE_STATION_ID = "exchange";
const EXCHANGE_STATION_MAP = "main";
const EXCHANGE_STATION_MAX_DISTANCE = 60;

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

function emptyStation(character: CharacterSnapshot): ExchangePreflightStation {
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

export class ExchangePreflightRunner {
  private readonly now: () => number;

  constructor(private readonly deps: ExchangePreflightDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  run(): ExchangePreflightResult {
    const timestamp = this.now();
    const character = this.deps.game.character();
    const intelligence = this.deps.inventoryIntelligence.tick();
    const inventoryState =
      typeof intelligence?.state === "string" ? intelligence.state : null;
    const inventoryReady = ["READY", "EMPTY"].includes(inventoryState || "");

    if (!inventoryReady) {
      return {
        outcome: "FAIL",
        reason: "EXCHANGE_PREFLIGHT_RUNTIME_NOT_READY",
        timestamp,
        character: this.deps.characterName?.() || null,
        inventoryState,
        exchange: null,
        selected: null,
        candidates: [],
        station: emptyStation(character),
        readyForExchange: false,
        summary: {
          exchangeDispositionItems: 0,
          eligibleCandidates: 0,
          protectedItems: 0,
          insufficientQuantityItems: 0,
        },
        evidence: {
          inventoryIntelligenceReady: false,
          exchangePlanReadOnly: false,
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
      };
    }

    const exchange = this.deps.exchange.tick();
    const intelligenceBySlot = new Map(
      intelligence.entries.map((entry) => [entry.slot, entry]),
    );
    const candidates: ExchangePreflightCandidate[] = exchange.decisions.map(
      (decision) => {
        const entry = intelligenceBySlot.get(decision.itemSlot);
        return {
          itemSlot: decision.itemSlot,
          itemName: decision.name || "",
          quantity: decision.quantity,
          requiredQuantity: decision.requiredQuantity,
          protected:
            entry?.protected === true || decision.protections.length > 0,
          protections: [...decision.protections],
          eligible: decision.eligible,
          reason: decision.reason,
        };
      },
    );

    const station =
      this.deps.game
        .npcs(EXCHANGE_STATION_MAP)
        .find(
          (npc) =>
            npc.id === EXCHANGE_STATION_ID &&
            npc.map === EXCHANGE_STATION_MAP &&
            typeof npc.x === "number" &&
            Number.isFinite(npc.x) &&
            typeof npc.y === "number" &&
            Number.isFinite(npc.y),
        ) || null;

    const distance = station ? stationDistance(character, station) : null;
    const stationSnapshot: ExchangePreflightStation = station
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
            distance === null || distance > EXCHANGE_STATION_MAX_DISTANCE,
        }
      : emptyStation(character);

    const selectedCandidateConsistent =
      exchange.selected === null ||
      candidates.some(
        (candidate) =>
          candidate.eligible &&
          candidate.itemSlot === exchange.selected?.itemSlot &&
          candidate.itemName === exchange.selected?.name &&
          candidate.requiredQuantity === exchange.selected?.requiredQuantity,
      );

    const evidence = {
      inventoryIntelligenceReady: true,
      exchangePlanReadOnly: true,
      stationLocated: stationSnapshot.located,
      stationIdentityVerified:
        stationSnapshot.id === EXCHANGE_STATION_ID &&
        stationSnapshot.map === EXCHANGE_STATION_MAP,
      selectedCandidateConsistent,
      noMutationDispatched: true as const,
    };
    const stationReady =
      evidence.stationLocated && evidence.stationIdentityVerified;
    const readyForExchange =
      stationReady &&
      selectedCandidateConsistent &&
      exchange.state === "READY" &&
      exchange.selected !== null;

    return {
      outcome: stationReady ? "PASS" : "FAIL",
      reason: stationReady
        ? "EXCHANGE_PREFLIGHT_COMPLETED"
        : "EXCHANGE_PREFLIGHT_STATION_NOT_FOUND",
      timestamp,
      character: this.deps.characterName?.() || null,
      inventoryState,
      exchange,
      selected: exchange.selected,
      candidates,
      station: stationSnapshot,
      readyForExchange,
      summary: {
        exchangeDispositionItems: candidates.length,
        eligibleCandidates: candidates.filter((entry) => entry.eligible).length,
        protectedItems: candidates.filter((entry) => entry.protected).length,
        insufficientQuantityItems: candidates.filter(
          (entry) => entry.reason === "EXCHANGE_QUANTITY_INSUFFICIENT",
        ).length,
      },
      evidence,
      scope: {
        readOnly: true,
        movementMutationForced: false,
        upgradeMutationForced: false,
        compoundMutationForced: false,
        exchangeMutationForced: false,
        craftMutationForced: false,
      },
    };
  }
}

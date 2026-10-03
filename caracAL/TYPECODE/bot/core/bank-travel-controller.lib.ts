import type { ActionRecord } from "./action-ledger.lib";
import type {
  BankPackAccessSnapshot,
  BankSnapshot,
  CharacterSnapshot,
} from "./game-adapter.lib";
import type { MovementController } from "./movement-controller.lib";

const OWNER = "BankTravelController";
const MODULE = "BankTravelController";

export type BankTravelState =
  | "DISABLED"
  | "LOCATING"
  | "TRAVEL"
  | "READY"
  | "BLOCKED"
  | "UNKNOWN";

export type BankTravelRoadmapStage =
  | "Bank finden"
  | "Travel"
  | "Bank bereit";

export interface BankTravelStatus {
  timestamp: number;
  enabled: boolean;
  state: BankTravelState;
  reason: string;
  roadmapStage: BankTravelRoadmapStage;
  character: {
    name: string | null;
    map: string | null;
    x: number | null;
    y: number | null;
    moving: boolean;
  };
  bank: {
    available: boolean;
    gold: number | null;
    packs: string[];
  };
  target: {
    map: string | null;
    pack: string | null;
    goldPrice: number | null;
    shellPrice: number | null;
    source: "bank_packs" | null;
  };
  movement: {
    owner: string | null;
    mode: string;
  };
  lastAction: {
    id: string;
    status: string | null;
    destination: string;
  } | null;
}

export interface BankTravelEvent {
  type: "BANK_TRAVEL_STATUS";
  reason: string;
  status: BankTravelStatus;
}

interface BankTravelGame {
  character(): CharacterSnapshot;
  bank(): BankSnapshot;
}

interface BankTravelMovement {
  status(): ReturnType<MovementController["status"]>;
  smart(
    request: Parameters<MovementController["smart"]>[0],
  ): Promise<ActionRecord>;
}

export interface BankTravelControllerOptions {
  config?: () => unknown;
  now?: () => number;
  onEvent?: (event: BankTravelEvent) => void;
}

interface NormalizedConfig {
  enabled: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeConfig(value: unknown): NormalizedConfig {
  const root = record(value);
  const bank = record(root.bank);
  return {
    enabled: bank.enabled === true,
  };
}

function accessCostFree(access: BankPackAccessSnapshot): boolean {
  const goldFree = access.goldPrice === null || access.goldPrice <= 0;
  const shellFree = access.shellPrice === null || access.shellPrice <= 0;
  return goldFree && shellFree;
}

export function selectBankAccess(
  bank: BankSnapshot,
): BankPackAccessSnapshot | null {
  const candidates = bank.access.filter(
    (access) => typeof access.map === "string" && access.map.length > 0,
  );
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    const aPrimary = a.map === "bank" ? 0 : 1;
    const bPrimary = b.map === "bank" ? 0 : 1;
    if (aPrimary !== bPrimary) return aPrimary - bPrimary;

    const aFree = accessCostFree(a) ? 0 : 1;
    const bFree = accessCostFree(b) ? 0 : 1;
    if (aFree !== bFree) return aFree - bFree;

    return (
      String(a.map).localeCompare(String(b.map)) ||
      a.name.localeCompare(b.name)
    );
  })[0];
}

export class BankTravelController {
  private readonly configSource: () => unknown;
  private readonly now: () => number;
  private readonly onEvent?: (event: BankTravelEvent) => void;
  private configOverride: unknown | undefined;
  private lastStatus: BankTravelStatus | null = null;
  private lastAction: BankTravelStatus["lastAction"] = null;
  private unknownActionId: string | null = null;
  private busy = false;

  constructor(
    private readonly game: BankTravelGame,
    private readonly movement: BankTravelMovement,
    options: BankTravelControllerOptions = {},
  ) {
    this.configSource = options.config || (() => ({}));
    this.now = options.now || (() => Date.now());
    this.onEvent = options.onEvent;
  }

  setConfigOverride(config: unknown): void {
    this.configOverride = config;
    this.unknownActionId = null;
  }

  clearConfigOverride(): void {
    this.configOverride = undefined;
    this.unknownActionId = null;
  }

  status(): BankTravelStatus {
    return this.lastStatus || this.buildStatus();
  }

  async tick(): Promise<BankTravelStatus> {
    if (this.busy) return this.status();
    this.busy = true;

    try {
      const config = normalizeConfig(this.effectiveConfig());
      if (!config.enabled) {
        return this.commitStatus("DISABLED", "BANK_TRAVEL_DISABLED");
      }

      const bank = this.game.bank();
      if (bank.available) {
        return this.commitStatus("READY", "BANK_AVAILABLE");
      }

      if (this.unknownActionId) {
        return this.commitStatus("UNKNOWN", "BANK_TRAVEL_OUTCOME_UNKNOWN");
      }

      const target = selectBankAccess(bank);
      if (!target?.map) {
        return this.commitStatus("BLOCKED", "BANK_ACCESS_NOT_FOUND");
      }

      const movement = this.movement.status();
      if (movement.owner && movement.owner !== OWNER) {
        return this.commitStatus("BLOCKED", "BANK_TRAVEL_MOVEMENT_OWNED");
      }
      if (movement.owner === OWNER && movement.active) {
        return this.commitStatus("TRAVEL", "BANK_TRAVEL_IN_PROGRESS");
      }

      let action: ActionRecord;
      try {
        action = await this.movement.smart({
          owner: OWNER,
          module: MODULE,
          why: "BANK_ACCESS_REQUIRED",
          destination: target.map,
        });
      } catch (error) {
        return this.commitStatus(
          "BLOCKED",
          `BANK_TRAVEL_MOVEMENT_ERROR:${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      this.lastAction = {
        id: action.id,
        status: action.status || null,
        destination: target.map,
      };

      if (action.status === "UNKNOWN") {
        this.unknownActionId = action.id;
        return this.commitStatus("UNKNOWN", "BANK_TRAVEL_OUTCOME_UNKNOWN");
      }
      if (action.status === "BLOCKED" || action.status === "REJECTED") {
        return this.commitStatus(
          "BLOCKED",
          action.status === "BLOCKED"
            ? "BANK_TRAVEL_ACTION_BLOCKED"
            : "BANK_TRAVEL_ACTION_REJECTED",
        );
      }

      if (this.game.bank().available) {
        return this.commitStatus("READY", "BANK_AVAILABLE");
      }

      return this.commitStatus(
        "TRAVEL",
        "BANK_TRAVEL_SETTLED_WAITING_FOR_BANK_STATE",
      );
    } finally {
      this.busy = false;
    }
  }

  private effectiveConfig(): unknown {
    return this.configOverride === undefined
      ? this.configSource()
      : this.configOverride;
  }

  private buildStatus(
    state: BankTravelState = "LOCATING",
    reason = "BANK_ACCESS_LOCATING",
  ): BankTravelStatus {
    const config = normalizeConfig(this.effectiveConfig());
    const character = this.game.character();
    const bank = this.game.bank();
    const target = selectBankAccess(bank);
    const movement = this.movement.status();

    return {
      timestamp: this.now(),
      enabled: config.enabled,
      state,
      reason,
      roadmapStage:
        state === "READY"
          ? "Bank bereit"
          : state === "TRAVEL" || state === "UNKNOWN"
            ? "Travel"
            : "Bank finden",
      character: {
        name: character.name,
        map: character.map,
        x: character.x,
        y: character.y,
        moving: character.moving,
      },
      bank: {
        available: bank.available,
        gold: bank.gold,
        packs: bank.packs.map((pack) => pack.name),
      },
      target: {
        map: target?.map || null,
        pack: target?.name || null,
        goldPrice: target?.goldPrice ?? null,
        shellPrice: target?.shellPrice ?? null,
        source: target ? "bank_packs" : null,
      },
      movement: {
        owner: movement.owner,
        mode: movement.mode,
      },
      lastAction: this.lastAction ? { ...this.lastAction } : null,
    };
  }

  private commitStatus(
    state: BankTravelState,
    reason: string,
  ): BankTravelStatus {
    const status = this.buildStatus(state, reason);
    this.lastStatus = status;
    this.onEvent?.({
      type: "BANK_TRAVEL_STATUS",
      reason,
      status,
    });
    return status;
  }
}

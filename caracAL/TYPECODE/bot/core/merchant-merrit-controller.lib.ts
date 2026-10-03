import type { ActionRecord } from "./action-ledger.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type {
  CharacterSnapshot,
  InventorySlotSnapshot,
  MarketListingSnapshot,
  NpcSnapshot,
  TradeSlotsSnapshot,
} from "./game-adapter.lib";
import type { MovementController } from "./movement-controller.lib";

export type MerchantMerritState =
  | "DISABLED"
  | "UNSUPPORTED_CLASS"
  | "SYNCING"
  | "COOLDOWN"
  | "ZONE"
  | "TRAVEL"
  | "POSITION"
  | "STAND"
  | "LISTING"
  | "SETTLING"
  | "HANDOFF"
  | "PARCEL"
  | "BLOCKED"
  | "UNKNOWN";

export interface MerchantMerritStatus {
  timestamp: number;
  enabled: boolean;
  state: MerchantMerritState;
  reason: string;
  roadmapStage:
    | "Cooldown"
    | "Zone"
    | "Travel"
    | "Position"
    | "Stand"
    | "Listing"
    | "120 s settle"
    | "Handoff"
    | "Parcel"
    | "Cooldown persistieren";
  character: {
    name: string | null;
    map: string | null;
    instance: string | null;
    x: number | null;
    y: number | null;
  };
  server: {
    statusKnown: boolean;
    reasonCodes: string[];
    serverNow: number | null;
    nextAt: number | null;
    lastReceipt: {
      name: string | null;
      at: number | null;
      shells: number;
    } | null;
  };
  target: {
    map: "main";
    x: number | null;
    y: number | null;
    candidateIndex: number;
    candidateCount: number;
    inEligibleArea: boolean;
    positioned: boolean;
  };
  stand: {
    open: boolean;
    itemPresent: boolean;
    openedByController: boolean;
  };
  listing: {
    valid: boolean;
    activeSlots: string[];
    temporarySlot: string | null;
    itemName: string;
  };
  settle: {
    requiredMs: number;
    remainingMs: number | null;
  };
  parcel: {
    confirmedAt: number | null;
    readyAt: number | null;
  };
  lastAction: {
    action: string;
    status: string | null;
    id: string;
  } | null;
}

export interface MerchantMerritEvent {
  type:
    | "MERRIT_STATUS"
    | "MERRIT_PARCEL_CONFIRMED"
    | "MERRIT_ACTION_UNKNOWN";
  reason: string;
  status: MerchantMerritStatus;
  actionId?: string;
  data?: Record<string, unknown>;
}

interface MerchantMerritGame {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  tradeSlots(): TradeSlotsSnapshot;
  market(): MarketListingSnapshot[];
  npcs(mapName?: string | null): NpcSnapshot[];
  gameData(): Record<string, unknown>;
}

type MerritActions = Pick<
  ActionBoundary,
  | "capabilities"
  | "requestMerritStatus"
  | "buy"
  | "openStand"
  | "closeStand"
  | "tradeList"
  | "tradeUnlist"
>;

type MerritMovement = Pick<MovementController, "smart" | "status">;

export interface MerchantMerritControllerOptions {
  config?: () => unknown;
  now?: () => number;
  onEvent?: (event: MerchantMerritEvent) => void;
}

interface MerritConfig {
  enabled: boolean;
  statusRefreshMs: number;
  listingItem: string;
  listingQuantity: number;
  listingPrice: number;
  goldReserve: number;
  autoAcquireStand: boolean;
  autoAcquireListingItem: boolean;
}

interface MerritRules {
  areas: number[][];
  stops: number[][];
  settleMs: number;
  handoff: number;
  hourMs: number;
  anchorTolerance: number;
  npcClearance: number;
  standClearance: number;
  frontClearance: number;
  frontWidth: number;
}

interface ParsedMerritStatus {
  reasonCodes: string[];
  reasons: Array<Record<string, unknown>>;
  serverNow: number | null;
  nextAt: number | null;
  lastReceipt: {
    name: string | null;
    at: number | null;
    shells: number;
  } | null;
}

const OWNER = "MERCHANT_MERRIT";
const MODULE = "MerchantMerritController";
const DEFAULT_RULES: MerritRules = {
  areas: [
    [-240, -120, 240, 144],
    [-88, 144, 88, 360],
  ],
  stops: [
    [0, 0],
    [-96, 0],
    [-192, 104],
    [0, 120],
    [0, 320],
    [32, 200],
    [96, 104],
  ],
  settleMs: 120000,
  handoff: 32,
  hourMs: 3600000,
  anchorTolerance: 4,
  npcClearance: 40,
  standClearance: 10,
  frontClearance: 15,
  frontWidth: 10,
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeConfig(value: unknown): MerritConfig {
  const root = objectValue(value);
  const autonomy = objectValue(
    root.merchantAutonomy ?? root.merchant_autonomy,
  );
  const merrit = objectValue(autonomy.merrit);

  return {
    enabled: autonomy.enabled === true && merrit.enabled === true,
    statusRefreshMs: Math.max(
      1000,
      positiveInteger(merrit.statusRefreshMs, 3000),
    ),
    listingItem:
      typeof merrit.listingItem === "string" && merrit.listingItem.trim()
        ? merrit.listingItem.trim()
        : "hpot0",
    listingQuantity: positiveInteger(merrit.listingQuantity, 1),
    listingPrice: positiveInteger(merrit.listingPrice, 999999999),
    goldReserve: Math.max(0, finiteNumber(merrit.goldReserve) ?? 1000),
    autoAcquireStand: merrit.autoAcquireStand !== false,
    autoAcquireListingItem: merrit.autoAcquireListingItem !== false,
  };
}

function numberPairs(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      Array.isArray(entry) && entry.length >= 2
        ? [finiteNumber(entry[0]), finiteNumber(entry[1])]
        : [null, null],
    )
    .filter(
      (entry): entry is number[] =>
        entry[0] !== null && entry[1] !== null,
    );
}

function areaRows(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      Array.isArray(entry) && entry.length >= 4
        ? [
            finiteNumber(entry[0]),
            finiteNumber(entry[1]),
            finiteNumber(entry[2]),
            finiteNumber(entry[3]),
          ]
        : [null, null, null, null],
    )
    .filter(
      (entry): entry is number[] =>
        entry.every((part) => part !== null),
    );
}

function merritRules(gameData: Record<string, unknown>): MerritRules {
  const npcs = objectValue(gameData.npcs);
  const citizen = objectValue(npcs.citizen22);
  const market = objectValue(citizen.market);

  return {
    areas: areaRows(market.areas).length
      ? areaRows(market.areas)
      : DEFAULT_RULES.areas,
    stops: numberPairs(market.stops).length
      ? numberPairs(market.stops)
      : DEFAULT_RULES.stops,
    settleMs: positiveInteger(market.settle_ms, DEFAULT_RULES.settleMs),
    handoff: positiveNumber(market.handoff, DEFAULT_RULES.handoff),
    hourMs: positiveInteger(market.hour_ms, DEFAULT_RULES.hourMs),
    anchorTolerance: positiveNumber(
      market.anchor_tolerance,
      DEFAULT_RULES.anchorTolerance,
    ),
    npcClearance: positiveNumber(
      market.npc_clearance,
      DEFAULT_RULES.npcClearance,
    ),
    standClearance: positiveNumber(
      market.stand_clearance,
      DEFAULT_RULES.standClearance,
    ),
    frontClearance: positiveNumber(
      market.front_clearance,
      DEFAULT_RULES.frontClearance,
    ),
    frontWidth: positiveNumber(
      market.front_width,
      DEFAULT_RULES.frontWidth,
    ),
  };
}

function timestampValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseServerStatus(character: CharacterSnapshot): ParsedMerritStatus {
  const merrit = objectValue(character.merrit);
  const reasons = Array.isArray(merrit.reasons)
    ? merrit.reasons.map(objectValue)
    : [];
  const receipt = objectValue(merrit.last);
  const hasReceipt = Object.keys(receipt).length > 0;

  return {
    reasonCodes: reasons
      .map((reason) =>
        typeof reason.code === "string" ? reason.code : "",
      )
      .filter(Boolean),
    reasons,
    serverNow: timestampValue(merrit.server_now),
    nextAt: timestampValue(merrit.next_at),
    lastReceipt: hasReceipt
      ? {
          name:
            typeof receipt.name === "string" ? receipt.name : null,
          at: timestampValue(receipt.at),
          shells: Math.max(0, finiteNumber(receipt.shells) ?? 0),
        }
      : null,
  };
}

function receiptKey(
  receipt: ParsedMerritStatus["lastReceipt"],
): string | null {
  if (!receipt) return null;
  return `${receipt.name || ""}:${receipt.at || 0}:${receipt.shells}`;
}

function itemName(value: Record<string, unknown> | null): string | null {
  return value && typeof value.name === "string" ? value.name : null;
}

function itemQuantity(value: Record<string, unknown> | null): number {
  if (!value) return 0;
  const quantity = finiteNumber(value.q);
  return quantity !== null && quantity > 0 ? quantity : 1;
}

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function inAreas(
  x: number | null,
  y: number | null,
  areas: number[][],
): boolean {
  if (x === null || y === null) return false;
  return areas.some(
    ([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2,
  );
}

function inventorySlotFor(
  inventory: InventorySlotSnapshot[],
  name: string,
): number | null {
  const entry = inventory.find((candidate) => itemName(candidate.item) === name);
  return entry ? entry.slot : null;
}

function inventoryHasFreeSlot(inventory: InventorySlotSnapshot[]): boolean {
  return inventory.some((entry) => entry.item === null);
}

function standInventorySlot(
  inventory: InventorySlotSnapshot[],
  gameData: Record<string, unknown>,
): number | null {
  const items = objectValue(gameData.items);
  for (const entry of inventory) {
    const name = itemName(entry.item);
    if (!name) continue;
    const definition = objectValue(items[name]);
    if (
      definition.type === "stand" ||
      definition.stand === true ||
      (typeof definition.stand === "string" && definition.stand.length > 0)
    ) {
      return entry.slot;
    }
  }
  return null;
}

function validListing(
  item: Record<string, unknown> | null,
  gold: number | null,
  gameData: Record<string, unknown>,
): boolean {
  if (!item) return false;
  const name = itemName(item);
  const definition = name
    ? objectValue(objectValue(gameData.items)[name])
    : {};
  if (!name || Object.keys(definition).length === 0) return false;
  if (item.name === "placeholder") return false;
  if (item.l || item.locked === true || item.acl) return false;
  if (item.v || item.giveaway || item.want) return false;
  const price = finiteNumber(item.price);
  if (price === null || price <= 0 || itemQuantity(item) <= 0) return false;
  return item.b !== true || gold === null || gold >= price;
}

function activeValidListings(
  slots: TradeSlotsSnapshot,
  gold: number | null,
  gameData: Record<string, unknown>,
): string[] {
  return Object.entries(slots)
    .filter(([, item]) => validListing(item, gold, gameData))
    .map(([slot]) => slot)
    .sort();
}

function firstFreeTradeSlot(slots: TradeSlotsSnapshot): string | null {
  for (let index = 1; index <= 16; index += 1) {
    const slot = `trade${index}`;
    if (!slots[slot]) return slot;
  }
  return null;
}

function npcById(npcs: NpcSnapshot[], id: string): NpcSnapshot | null {
  return npcs.find((npc) => npc.id === id) || null;
}

function actionSummary(
  action: ActionRecord | null,
): MerchantMerritStatus["lastAction"] {
  return action
    ? {
        action: action.action,
        status: action.status,
        id: action.id,
      }
    : null;
}

export class MerchantMerritController {
  private readonly configSource: () => unknown;
  private readonly now: () => number;
  private readonly onEvent?: (event: MerchantMerritEvent) => void;
  private configOverride: unknown | undefined;
  private lastStatus: MerchantMerritStatus | null = null;
  private lastStatusRequestAt = 0;
  private lastReceiptKey: string | null | undefined;
  private lastMutationAt = 0;
  private candidateIndex = 0;
  private temporaryListingSlot: string | null = null;
  private openedStandByController = false;
  private lastAction: ActionRecord | null = null;
  private parcelConfirmedAt: number | null = null;
  private parcelReadyAt: number | null = null;
  private sessionEnabled = false;

  constructor(
    private readonly game: MerchantMerritGame,
    private readonly actions: MerritActions,
    private readonly movement: MerritMovement,
    options: MerchantMerritControllerOptions = {},
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

  status(): MerchantMerritStatus {
    return this.lastStatus || this.buildStatus(
      normalizeConfig(this.effectiveConfig()),
      "DISABLED",
      "MERRIT_NOT_TICKED",
      "Cooldown",
    );
  }

  async tick(): Promise<MerchantMerritStatus> {
    const config = normalizeConfig(this.effectiveConfig());
    const character = this.game.character();

    if (!config.enabled) {
      this.sessionEnabled = false;
      return this.publish(
        this.buildStatus(config, "DISABLED", "MERRIT_DISABLED", "Cooldown"),
      );
    }
    if (character.ctype !== "merchant") {
      return this.publish(
        this.buildStatus(
          config,
          "UNSUPPORTED_CLASS",
          "MERRIT_MERCHANT_REQUIRED",
          "Cooldown",
        ),
      );
    }

    if (!this.sessionEnabled) {
      this.beginSession(character);
    }

    this.requestStatusIfDue(config);
    const rules = merritRules(this.game.gameData());
    const server = parseServerStatus(character);
    const currentReceiptKey = receiptKey(server.lastReceipt);

    if (
      this.lastReceiptKey !== undefined &&
      currentReceiptKey !== this.lastReceiptKey &&
      server.lastReceipt?.name === character.name &&
      server.lastReceipt.at !== null
    ) {
      this.lastReceiptKey = currentReceiptKey;
      this.parcelConfirmedAt = server.lastReceipt.at;
      this.parcelReadyAt =
        server.nextAt || server.lastReceipt.at + rules.hourMs;
      const status = this.buildStatus(
        config,
        "PARCEL",
        "MERRIT_PARCEL_CONFIRMED",
        "Cooldown persistieren",
      );
      this.publish(status);
      this.onEvent?.({
        type: "MERRIT_PARCEL_CONFIRMED",
        reason: "MERRIT_PARCEL_CONFIRMED",
        status,
        data: {
          recipient: character.name,
          receiptAt: this.parcelConfirmedAt,
          readyAt: this.parcelReadyAt,
          cooldownMs: rules.hourMs,
          shells: server.lastReceipt.shells,
        },
      });
      return status;
    }
    this.lastReceiptKey = currentReceiptKey;

    if (server.reasonCodes.includes("cooldown")) {
      this.parcelReadyAt = server.nextAt;
      return this.publish(
        this.buildStatus(
          config,
          "COOLDOWN",
          "MERRIT_ACCOUNT_COOLDOWN_ACTIVE",
          "Cooldown",
        ),
      );
    }

    const gameData = this.game.gameData();
    const candidate = this.selectCandidate(rules);
    if (!candidate) {
      return this.publish(
        this.buildStatus(
          config,
          "BLOCKED",
          "MERRIT_NO_SAFE_POSITION",
          "Position",
        ),
      );
    }

    if (
      character.map !== "main" ||
      (character.instance !== null &&
        character.instance !== undefined &&
        character.instance !== "main") ||
      !inAreas(character.x, character.y, rules.areas)
    ) {
      return await this.moveToCandidate(
        config,
        candidate,
        "MERRIT_TRAVEL_TO_ZONE",
        "TRAVEL",
        "Travel",
      );
    }

    const positioned =
      character.x !== null &&
      character.y !== null &&
      distance(
        { x: character.x, y: character.y },
        candidate,
      ) <= rules.anchorTolerance;

    if (!positioned) {
      if (character.stand) {
        const closed = await this.actions.closeStand({
          module: MODULE,
          why: "MERRIT_REPOSITION_CLOSE_STAND",
        });
        this.recordMutation(closed);
        if (closed.status !== "CONFIRMED") {
          return this.actionFailureStatus(
            config,
            closed,
            "Position",
            "MERRIT_REPOSITION_CLOSE_STAND_FAILED",
          );
        }
      }
      return await this.moveToCandidate(
        config,
        candidate,
        "MERRIT_POSITION_FOR_HANDOFF",
        "POSITION",
        "Position",
      );
    }

    let standSlot = standInventorySlot(this.game.inventory(), gameData);
    if (!character.stand && standSlot === null) {
      if (!config.autoAcquireStand) {
        return this.publish(
          this.buildStatus(
            config,
            "BLOCKED",
            "MERRIT_STAND_ITEM_REQUIRED",
            "Stand",
          ),
        );
      }
      const acquired = await this.acquireItem(
        config,
        "stand0",
        "standmerchant",
        "MERRIT_ACQUIRE_STAND",
      );
      if (acquired) return acquired;
      standSlot = standInventorySlot(this.game.inventory(), gameData);
    }

    if (!this.game.character().stand) {
      if (standSlot === null) {
        return this.publish(
          this.buildStatus(
            config,
            "BLOCKED",
            "MERRIT_STAND_ITEM_REQUIRED",
            "Stand",
          ),
        );
      }
      const opened = await this.actions.openStand({
        inventorySlot: standSlot,
        module: MODULE,
        why: "MERRIT_OPEN_STAND",
      });
      this.recordMutation(opened);
      if (opened.status !== "CONFIRMED") {
        return this.actionFailureStatus(
          config,
          opened,
          "Stand",
          "MERRIT_OPEN_STAND_FAILED",
        );
      }
      this.openedStandByController = true;
      this.requestStatusIfDue(config, true);
      return this.publish(
        this.buildStatus(
          config,
          "STAND",
          "MERRIT_STAND_CONFIRMED",
          "Stand",
        ),
      );
    }

    let validSlots = activeValidListings(
      this.game.tradeSlots(),
      this.game.character().gold,
      gameData,
    );
    if (!validSlots.length) {
      let listingSlot = inventorySlotFor(
        this.game.inventory(),
        config.listingItem,
      );
      if (listingSlot === null) {
        if (!config.autoAcquireListingItem) {
          return this.publish(
            this.buildStatus(
              config,
              "BLOCKED",
              "MERRIT_LISTING_ITEM_REQUIRED",
              "Listing",
            ),
          );
        }
        const acquired = await this.acquireItem(
          config,
          config.listingItem,
          "fancypots",
          "MERRIT_ACQUIRE_LISTING_ITEM",
        );
        if (acquired) return acquired;
        listingSlot = inventorySlotFor(
          this.game.inventory(),
          config.listingItem,
        );
      }
      const tradeSlot = firstFreeTradeSlot(this.game.tradeSlots());
      if (listingSlot === null || !tradeSlot) {
        return this.publish(
          this.buildStatus(
            config,
            "BLOCKED",
            !tradeSlot
              ? "MERRIT_NO_FREE_TRADE_SLOT"
              : "MERRIT_LISTING_ITEM_REQUIRED",
            "Listing",
          ),
        );
      }
      const listed = await this.actions.tradeList({
        inventorySlot: listingSlot,
        slot: tradeSlot,
        price: config.listingPrice,
        quantity: config.listingQuantity,
        module: MODULE,
        why: "MERRIT_CREATE_VALID_LISTING",
      });
      this.recordMutation(listed);
      if (listed.status !== "CONFIRMED") {
        return this.actionFailureStatus(
          config,
          listed,
          "Listing",
          "MERRIT_LISTING_FAILED",
        );
      }
      this.temporaryListingSlot = tradeSlot;
      validSlots = [tradeSlot];
      this.requestStatusIfDue(config, true);
      return this.publish(
        this.buildStatus(
          config,
          "LISTING",
          "MERRIT_LISTING_CONFIRMED",
          "Listing",
        ),
      );
    }

    if (
      server.serverNow !== null &&
      this.lastMutationAt > 0 &&
      server.serverNow < this.lastMutationAt
    ) {
      return this.publish(
        this.buildStatus(
          config,
          "SYNCING",
          "MERRIT_WAITING_FOR_FRESH_SERVER_STATUS",
          "120 s settle",
        ),
      );
    }

    if (server.reasonCodes.includes("warming")) {
      return this.publish(
        this.buildStatus(
          config,
          "SETTLING",
          "MERRIT_SETTLING",
          "120 s settle",
        ),
      );
    }

    const positionalBlocker = server.reasonCodes.find((code) =>
      ["npc", "stand_close", "stand_front", "unreachable"].includes(code),
    );
    if (positionalBlocker) {
      this.candidateIndex += 1;
      const current = this.game.character();
      if (current.stand) {
        const closed = await this.actions.closeStand({
          module: MODULE,
          why: `MERRIT_REPOSITION_${positionalBlocker.toUpperCase()}`,
        });
        this.recordMutation(closed);
        if (closed.status !== "CONFIRMED") {
          return this.actionFailureStatus(
            config,
            closed,
            "Position",
            "MERRIT_REPOSITION_CLOSE_STAND_FAILED",
          );
        }
      }
      return this.publish(
        this.buildStatus(
          config,
          "POSITION",
          `MERRIT_REPOSITION_${positionalBlocker.toUpperCase()}`,
          "Position",
        ),
      );
    }

    if (server.reasonCodes.includes("inventory")) {
      return this.publish(
        this.buildStatus(
          config,
          "BLOCKED",
          "MERRIT_PARCEL_INVENTORY_SPACE_REQUIRED",
          "Parcel",
        ),
      );
    }

    if (
      server.reasonCodes.includes("closed") ||
      server.reasonCodes.includes("listing") ||
      server.reasonCodes.includes("area")
    ) {
      this.requestStatusIfDue(config, true);
      return this.publish(
        this.buildStatus(
          config,
          "SYNCING",
          "MERRIT_SERVER_STATUS_CATCHING_UP",
          server.reasonCodes.includes("closed") ? "Stand" : "Listing",
        ),
      );
    }

    if (server.reasonCodes.length === 0 && server.serverNow !== null) {
      return this.publish(
        this.buildStatus(
          config,
          "HANDOFF",
          "MERRIT_READY_FOR_HANDOFF",
          "Handoff",
        ),
      );
    }

    return this.publish(
      this.buildStatus(
        config,
        "SYNCING",
        "MERRIT_WAITING_FOR_SERVER_STATUS",
        "Cooldown",
      ),
    );
  }

  async cleanupTemporaryState(): Promise<{
    listing: ActionRecord | null;
    stand: ActionRecord | null;
  }> {
    let listing: ActionRecord | null = null;
    let stand: ActionRecord | null = null;

    if (this.temporaryListingSlot) {
      listing = await this.actions.tradeUnlist({
        slot: this.temporaryListingSlot,
        module: MODULE,
        why: "MERRIT_TEST_RESTORE_TEMPORARY_LISTING",
      });
      this.lastAction = listing;
      if (listing.status === "CONFIRMED") {
        this.temporaryListingSlot = null;
      } else if (listing.status === "UNKNOWN") {
        this.emitUnknown(listing);
        return { listing, stand };
      }
    }

    if (this.openedStandByController && this.game.character().stand) {
      stand = await this.actions.closeStand({
        module: MODULE,
        why: "MERRIT_TEST_RESTORE_STAND",
      });
      this.lastAction = stand;
      if (stand.status === "CONFIRMED") {
        this.openedStandByController = false;
      } else if (stand.status === "UNKNOWN") {
        this.emitUnknown(stand);
      }
    }

    return { listing, stand };
  }

  private effectiveConfig(): unknown {
    return this.configOverride === undefined
      ? this.configSource()
      : this.configOverride;
  }

  private beginSession(character: CharacterSnapshot): void {
    this.sessionEnabled = true;
    this.lastReceiptKey = receiptKey(parseServerStatus(character).lastReceipt);
    this.parcelConfirmedAt = null;
    this.parcelReadyAt = null;
    this.lastMutationAt = 0;
    this.lastAction = null;
    this.temporaryListingSlot = null;
    this.openedStandByController = false;
    this.candidateIndex = 0;
  }

  private requestStatusIfDue(config: MerritConfig, force = false): void {
    const now = this.now();
    if (
      !force &&
      this.lastStatusRequestAt > 0 &&
      now - this.lastStatusRequestAt < config.statusRefreshMs
    ) {
      return;
    }
    const action = this.actions.requestMerritStatus({
      module: MODULE,
      why: "MERRIT_REFRESH_SERVER_STATUS",
    });
    this.lastStatusRequestAt = now;
    this.lastAction = action;
    if (action.status === "UNKNOWN") this.emitUnknown(action);
  }

  private selectCandidate(
    rules: MerritRules,
  ): { x: number; y: number } | null {
    const npcs = this.game.npcs("main").filter(
      (npc) => npc.id !== "citizen22" && npc.x !== null && npc.y !== null,
    );
    const market = this.game.market();
    if (!rules.stops.length) return null;

    for (let offset = 0; offset < rules.stops.length; offset += 1) {
      const index = (this.candidateIndex + offset) % rules.stops.length;
      const [x, y] = rules.stops[index];
      if (!inAreas(x, y, rules.areas)) continue;

      const npcBlocked = npcs.some(
        (npc) =>
          distance(
            { x, y },
            { x: npc.x as number, y: npc.y as number },
          ) < rules.npcClearance,
      );
      if (npcBlocked) continue;

      const merchantBlocked = market.some((listing) => {
        const dx = Math.abs(listing.x - x);
        const dy = Math.abs(listing.y - y);
        return (
          Math.hypot(dx, dy) < rules.standClearance ||
          (dx <= rules.frontWidth && dy <= rules.frontClearance)
        );
      });
      if (merchantBlocked) continue;

      this.candidateIndex = index;
      return { x, y };
    }

    return null;
  }

  private async moveToCandidate(
    config: MerritConfig,
    candidate: { x: number; y: number },
    reason: string,
    state: "TRAVEL" | "POSITION",
    stage: "Travel" | "Position",
  ): Promise<MerchantMerritStatus> {
    const movementStatus = this.movement.status();
    if (movementStatus.owner && movementStatus.owner !== OWNER) {
      return this.publish(
        this.buildStatus(
          config,
          "BLOCKED",
          "MERRIT_MOVEMENT_OWNED_BY_OTHER",
          stage,
        ),
      );
    }

    try {
      const action = await this.movement.smart({
        owner: OWNER,
        module: MODULE,
        why: reason,
        destination: {
          map: "main",
          x: candidate.x,
          y: candidate.y,
        },
      });
      this.recordMutation(action);
      if (action.status === "UNKNOWN") {
        return this.actionFailureStatus(
          config,
          action,
          stage,
          "MERRIT_MOVEMENT_UNKNOWN",
        );
      }
      if (action.status !== "CONFIRMED") {
        return this.actionFailureStatus(
          config,
          action,
          stage,
          "MERRIT_MOVEMENT_FAILED",
        );
      }
      return this.publish(
        this.buildStatus(
          config,
          state,
          state === "TRAVEL"
            ? "MERRIT_ZONE_REACHED"
            : "MERRIT_POSITION_REACHED",
          stage,
        ),
      );
    } catch (error) {
      return this.publish(
        this.buildStatus(
          config,
          "BLOCKED",
          error instanceof Error
            ? `MERRIT_MOVEMENT_BLOCKED:${error.message}`
            : "MERRIT_MOVEMENT_BLOCKED",
          stage,
        ),
      );
    }
  }

  private async acquireItem(
    config: MerritConfig,
    itemNameValue: string,
    npcId: string,
    why: string,
  ): Promise<MerchantMerritStatus | null> {
    if (inventorySlotFor(this.game.inventory(), itemNameValue) !== null) {
      return null;
    }
    if (!inventoryHasFreeSlot(this.game.inventory())) {
      return this.publish(
        this.buildStatus(
          config,
          "BLOCKED",
          "MERRIT_INVENTORY_SLOT_REQUIRED",
          itemNameValue === "stand0" ? "Stand" : "Listing",
        ),
      );
    }

    const definition = objectValue(
      objectValue(this.game.gameData().items)[itemNameValue],
    );
    const cost = finiteNumber(definition.g);
    const gold = this.game.character().gold;
    if (
      cost !== null &&
      gold !== null &&
      gold - cost < config.goldReserve
    ) {
      return this.publish(
        this.buildStatus(
          config,
          "BLOCKED",
          "MERRIT_GOLD_RESERVE_PROTECTED",
          itemNameValue === "stand0" ? "Stand" : "Listing",
        ),
      );
    }

    const npc = npcById(this.game.npcs("main"), npcId);
    if (!npc || npc.x === null || npc.y === null) {
      return this.publish(
        this.buildStatus(
          config,
          "BLOCKED",
          `MERRIT_VENDOR_NOT_FOUND:${npcId}`,
          itemNameValue === "stand0" ? "Stand" : "Listing",
        ),
      );
    }

    const character = this.game.character();
    if (
      character.map !== "main" ||
      character.x === null ||
      character.y === null ||
      distance(
        { x: character.x, y: character.y },
        { x: npc.x, y: npc.y },
      ) > 80
    ) {
      try {
        const moved = await this.movement.smart({
          owner: OWNER,
          module: MODULE,
          why: `${why}_TRAVEL`,
          destination: { map: "main", x: npc.x, y: npc.y },
        });
        this.recordMutation(moved);
        if (moved.status !== "CONFIRMED") {
          return this.actionFailureStatus(
            config,
            moved,
            itemNameValue === "stand0" ? "Stand" : "Listing",
            `${why}_TRAVEL_FAILED`,
          );
        }
      } catch (error) {
        return this.publish(
          this.buildStatus(
            config,
            "BLOCKED",
            `${why}_TRAVEL_BLOCKED`,
            itemNameValue === "stand0" ? "Stand" : "Listing",
          ),
        );
      }
    }

    const bought = await this.actions.buy({
      itemName: itemNameValue,
      quantity: 1,
      module: MODULE,
      why,
    });
    this.recordMutation(bought);
    if (bought.status !== "CONFIRMED") {
      return this.actionFailureStatus(
        config,
        bought,
        itemNameValue === "stand0" ? "Stand" : "Listing",
        `${why}_FAILED`,
      );
    }

    return this.publish(
      this.buildStatus(
        config,
        itemNameValue === "stand0" ? "STAND" : "LISTING",
        `${why}_CONFIRMED`,
        itemNameValue === "stand0" ? "Stand" : "Listing",
      ),
    );
  }

  private recordMutation(action: ActionRecord): void {
    this.lastAction = action;
    if (action.status === "CONFIRMED") this.lastMutationAt = this.now();
    if (action.status === "UNKNOWN") this.emitUnknown(action);
  }

  private actionFailureStatus(
    config: MerritConfig,
    action: ActionRecord,
    stage: MerchantMerritStatus["roadmapStage"],
    fallback: string,
  ): MerchantMerritStatus {
    if (action.status === "UNKNOWN") {
      return this.publish(
        this.buildStatus(
          config,
          "UNKNOWN",
          `${fallback}:UNKNOWN`,
          stage,
        ),
      );
    }
    return this.publish(
      this.buildStatus(
        config,
        "BLOCKED",
        `${fallback}:${action.status || "NO_STATUS"}`,
        stage,
      ),
    );
  }

  private emitUnknown(action: ActionRecord): void {
    const config = normalizeConfig(this.effectiveConfig());
    const status = this.buildStatus(
      config,
      "UNKNOWN",
      "MERRIT_ACTION_OUTCOME_UNKNOWN",
      "Handoff",
    );
    this.onEvent?.({
      type: "MERRIT_ACTION_UNKNOWN",
      reason: "MERRIT_ACTION_OUTCOME_UNKNOWN",
      actionId: action.id,
      status,
      data: {
        action: action.action,
        actionStatus: action.status,
      },
    });
  }

  private buildStatus(
    config: MerritConfig,
    state: MerchantMerritState,
    reason: string,
    roadmapStage: MerchantMerritStatus["roadmapStage"],
  ): MerchantMerritStatus {
    const character = this.game.character();
    const gameData = this.game.gameData();
    const rules = merritRules(gameData);
    const server = parseServerStatus(character);
    const candidate = this.selectCandidate(rules);
    const inventory = this.game.inventory();
    const slots = this.game.tradeSlots();
    const activeSlots = activeValidListings(slots, character.gold, gameData);
    const warming = server.reasons.find(
      (entry) => entry.code === "warming",
    );
    const remainingMs = warming
      ? Math.max(0, finiteNumber(warming.remaining_ms) ?? 0)
      : null;
    const positioned =
      !!candidate &&
      character.map === "main" &&
      character.x !== null &&
      character.y !== null &&
      distance(
        { x: character.x, y: character.y },
        candidate,
      ) <= rules.anchorTolerance;

    return {
      timestamp: this.now(),
      enabled: config.enabled,
      state,
      reason,
      roadmapStage,
      character: {
        name: character.name,
        map: character.map,
        instance: character.instance ?? null,
        x: character.x,
        y: character.y,
      },
      server: {
        statusKnown: !!character.merrit,
        reasonCodes: [...server.reasonCodes],
        serverNow: server.serverNow,
        nextAt: server.nextAt,
        lastReceipt: server.lastReceipt
          ? { ...server.lastReceipt }
          : null,
      },
      target: {
        map: "main",
        x: candidate?.x ?? null,
        y: candidate?.y ?? null,
        candidateIndex: this.candidateIndex,
        candidateCount: rules.stops.length,
        inEligibleArea: inAreas(
          character.x,
          character.y,
          rules.areas,
        ),
        positioned,
      },
      stand: {
        open: !!character.stand,
        itemPresent:
          standInventorySlot(inventory, gameData) !== null,
        openedByController: this.openedStandByController,
      },
      listing: {
        valid: activeSlots.length > 0,
        activeSlots,
        temporarySlot: this.temporaryListingSlot,
        itemName: config.listingItem,
      },
      settle: {
        requiredMs: rules.settleMs,
        remainingMs,
      },
      parcel: {
        confirmedAt: this.parcelConfirmedAt,
        readyAt: this.parcelReadyAt,
      },
      lastAction: actionSummary(this.lastAction),
    };
  }

  private publish(status: MerchantMerritStatus): MerchantMerritStatus {
    this.lastStatus = status;
    this.onEvent?.({
      type: "MERRIT_STATUS",
      reason: status.reason,
      status,
    });
    return status;
  }
}

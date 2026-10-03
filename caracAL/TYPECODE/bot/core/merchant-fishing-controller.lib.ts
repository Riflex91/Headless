import type { ActionRecord } from "./action-ledger.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type {
  CharacterSnapshot,
  CooldownSnapshot,
  EquipmentSnapshot,
  InventorySlotSnapshot,
} from "./game-adapter.lib";
import type { MovementController } from "./movement-controller.lib";

export type MerchantFishingState =
  | "DISABLED"
  | "UNSUPPORTED_CLASS"
  | "SKILL"
  | "TOOL"
  | "TOOL_ACQUIRE"
  | "ZONE"
  | "TRAVEL"
  | "EQUIP"
  | "USE_SKILL"
  | "RESULT"
  | "RESTORE"
  | "COMPLETE"
  | "BLOCKED"
  | "UNKNOWN";

export interface MerchantFishingStatus {
  timestamp: number;
  enabled: boolean;
  state: MerchantFishingState;
  reason: string;
  roadmapStage:
    | "Skill"
    | "Tool"
    | "Tool beschaffen"
    | "Zone"
    | "Travel"
    | "Equip"
    | "Skill ausführen"
    | "Ergebnis"
    | "alte Waffe restaurieren";
  character: {
    name: string | null;
    level: number | null;
    map: string | null;
    x: number | null;
    y: number | null;
    mp: number | null;
    moving: boolean;
  };
  skill: {
    present: boolean;
    requiredLevel: number | null;
    requiredMp: number | null;
    cooldownRemainingMs: number;
  };
  tool: {
    name: "rod";
    equipped: boolean;
    inventorySlot: number | null;
    acquiredByController: boolean;
  };
  zone: {
    map: string | null;
    x: number | null;
    y: number | null;
    inside: boolean;
    source: "fisherman" | "polygon" | null;
  };
  result: {
    attempted: boolean;
    found: boolean | null;
    response: string | null;
  };
  materialRequest: {
    itemName: string | null;
    quantity: number;
    pending: boolean;
  };
  restore: {
    required: boolean;
    restored: boolean;
    originalMainhand: Record<string, unknown> | null;
  };
  lastAction: {
    id: string;
    action: string;
    status: string | null;
    why: string;
  } | null;
}

export interface MerchantFishingEvent {
  type:
    | "FISHING_STATUS"
    | "FISHING_RESULT_CONFIRMED"
    | "FISHING_MATERIAL_REQUESTED"
    | "FISHING_ACTION_UNKNOWN";
  reason: string;
  status: MerchantFishingStatus;
  actionId?: string;
  data?: Record<string, unknown>;
}

interface MerchantFishingGame {
  character(): CharacterSnapshot;
  inventory(): InventorySlotSnapshot[];
  equipment(): EquipmentSnapshot;
  cooldowns(): CooldownSnapshot[];
  gameData(): Record<string, unknown>;
}

type FishingActions = Pick<
  ActionBoundary,
  "useSkill" | "equip" | "unequip" | "buy" | "craft"
>;

type FishingMovement = Pick<MovementController, "smart" | "status">;

export interface MerchantFishingControllerOptions {
  config?: () => unknown;
  now?: () => number;
  onEvent?: (event: MerchantFishingEvent) => void;
}

interface FishingConfig {
  enabled: boolean;
  goldReserve: number;
  acquireTool: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface FishingZone {
  map: string;
  polygon: Point[];
}

interface ToolRecipeRequirement {
  quantity: number;
  name: string;
  level: number;
}

const MODULE = "MerchantFishingController";
const OWNER = "MERCHANT_FISHING";
const TOOL = "rod";
const MATERIAL = "spidersilk";
const STAFF = "staff";
const SKILL = "fishing";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeConfig(value: unknown): FishingConfig {
  const root = objectValue(value);
  const autonomy = objectValue(
    root.merchantAutonomy ?? root.merchant_autonomy,
  );
  const fishing = objectValue(autonomy.fishing);
  return {
    enabled: autonomy.enabled === true && fishing.enabled === true,
    goldReserve: Math.max(0, finiteNumber(fishing.goldReserve) ?? 1000),
    acquireTool: fishing.acquireTool !== false,
  };
}

function itemName(item: Record<string, unknown> | null): string | null {
  return item && typeof item.name === "string" ? item.name : null;
}

function itemLevel(item: Record<string, unknown> | null): number {
  const value = finiteNumber(item?.level);
  return value !== null && value >= 0 ? value : 0;
}

function itemQuantity(item: Record<string, unknown> | null): number {
  const value = finiteNumber(item?.q);
  return value !== null && value > 0 ? value : item ? 1 : 0;
}

function itemWtype(
  item: Record<string, unknown> | null,
  gameData: Record<string, unknown>,
): string | null {
  const name = itemName(item);
  const definition = name
    ? objectValue(objectValue(gameData.items)[name])
    : {};
  return typeof definition.wtype === "string" ? definition.wtype : null;
}

function inventorySlotFor(
  inventory: InventorySlotSnapshot[],
  name: string,
  level?: number,
): number | null {
  const entry = inventory.find(
    (candidate) =>
      itemName(candidate.item) === name &&
      (level === undefined || itemLevel(candidate.item) === level),
  );
  return entry ? entry.slot : null;
}

function inventoryQuantity(
  inventory: InventorySlotSnapshot[],
  name: string,
  level = 0,
): number {
  return inventory.reduce(
    (sum, entry) =>
      itemName(entry.item) === name && itemLevel(entry.item) === level
        ? sum + itemQuantity(entry.item)
        : sum,
    0,
  );
}

function freeInventorySlots(inventory: InventorySlotSnapshot[]): number {
  return inventory.filter((entry) => entry.item === null).length;
}

function itemSignature(
  item: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!item || !itemName(item)) return null;
  return {
    name: itemName(item),
    level: itemLevel(item),
    p: typeof item.p === "string" ? item.p : null,
    stat_type:
      typeof item.stat_type === "string" ? item.stat_type : null,
    rid: typeof item.rid === "string" ? item.rid : null,
  };
}

function signatureMatches(
  item: Record<string, unknown> | null,
  signature: Record<string, unknown> | null,
): boolean {
  if (!item || !signature) return false;
  if (itemName(item) !== signature.name) return false;
  if (itemLevel(item) !== signature.level) return false;
  if (
    signature.rid &&
    typeof signature.rid === "string" &&
    item.rid !== signature.rid
  ) {
    return false;
  }
  if (
    signature.p &&
    typeof signature.p === "string" &&
    item.p !== signature.p
  ) {
    return false;
  }
  if (
    signature.stat_type &&
    typeof signature.stat_type === "string" &&
    item.stat_type !== signature.stat_type
  ) {
    return false;
  }
  return true;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let i = 0, j = polygon.length - 1;
    i < polygon.length;
    j = i++
  ) {
    const pi = polygon[i];
    const pj = polygon[j];
    const crosses =
      pi.y > point.y !== pj.y > point.y &&
      point.x <
        ((pj.x - pi.x) * (point.y - pi.y)) /
          (pj.y - pi.y || Number.EPSILON) +
          pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function zonesFromGameData(gameData: Record<string, unknown>): FishingZone[] {
  const maps = objectValue(gameData.maps);
  const result: FishingZone[] = [];
  for (const [map, rawMap] of Object.entries(maps)) {
    const zones = objectValue(rawMap).zones;
    if (!Array.isArray(zones)) continue;
    for (const rawZone of zones) {
      const zone = objectValue(rawZone);
      if (zone.type !== SKILL || !Array.isArray(zone.polygon)) continue;
      const polygon = zone.polygon
        .map((rawPoint) => {
          if (!Array.isArray(rawPoint) || rawPoint.length < 2) return null;
          const x = finiteNumber(rawPoint[0]);
          const y = finiteNumber(rawPoint[1]);
          return x === null || y === null ? null : { x, y };
        })
        .filter((point): point is Point => point !== null);
      if (polygon.length >= 3) result.push({ map, polygon });
    }
  }
  return result;
}

function npcLocation(
  gameData: Record<string, unknown>,
  id: string,
): { map: string; x: number; y: number } | null {
  const maps = objectValue(gameData.maps);
  for (const [map, rawMap] of Object.entries(maps)) {
    const npcs = objectValue(rawMap).npcs;
    if (!Array.isArray(npcs)) continue;
    for (const rawNpc of npcs) {
      const npc = objectValue(rawNpc);
      if (npc.id !== id || !Array.isArray(npc.position)) continue;
      const x = finiteNumber(npc.position[0]);
      const y = finiteNumber(npc.position[1]);
      if (x !== null && y !== null) return { map, x, y };
    }
  }
  return null;
}

function zoneTarget(
  gameData: Record<string, unknown>,
): {
  zone: FishingZone;
  point: Point;
  source: "fisherman" | "polygon";
} | null {
  const zones = zonesFromGameData(gameData);
  const fisherman = npcLocation(gameData, "fisherman");
  if (fisherman) {
    const zone = zones.find(
      (candidate) =>
        candidate.map === fisherman.map &&
        pointInPolygon(fisherman, candidate.polygon),
    );
    if (zone) {
      return {
        zone,
        point: { x: fisherman.x, y: fisherman.y },
        source: "fisherman",
      };
    }
  }

  for (const zone of zones) {
    const xs = zone.polygon.map((point) => point.x);
    const ys = zone.polygon.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (let rows = 2; rows <= 12; rows += 1) {
      for (let yIndex = 1; yIndex < rows; yIndex += 1) {
        for (let xIndex = 1; xIndex < rows; xIndex += 1) {
          const point = {
            x: minX + ((maxX - minX) * xIndex) / rows,
            y: minY + ((maxY - minY) * yIndex) / rows,
          };
          if (pointInPolygon(point, zone.polygon)) {
            return { zone, point, source: "polygon" };
          }
        }
      }
    }
  }
  return null;
}

function characterInsideZone(
  character: CharacterSnapshot,
  zone: FishingZone | null,
): boolean {
  return (
    !!zone &&
    character.map === zone.map &&
    character.x !== null &&
    character.y !== null &&
    pointInPolygon({ x: character.x, y: character.y }, zone.polygon)
  );
}

function skillDefinition(
  gameData: Record<string, unknown>,
): Record<string, unknown> {
  return objectValue(objectValue(gameData.skills)[SKILL]);
}

function skillCooldown(
  cooldowns: CooldownSnapshot[],
): number {
  return (
    cooldowns.find((cooldown) => cooldown.skill === SKILL)?.remainingMs || 0
  );
}

function recipeRequirements(
  gameData: Record<string, unknown>,
): ToolRecipeRequirement[] {
  const recipe = objectValue(objectValue(gameData.craft)[TOOL]);
  const rawItems = Array.isArray(recipe.items) ? recipe.items : [];
  return rawItems
    .map((raw) => {
      if (!Array.isArray(raw) || raw.length < 2) return null;
      const quantity = finiteNumber(raw[0]);
      const name = typeof raw[1] === "string" ? raw[1] : null;
      const level = raw.length >= 3 ? finiteNumber(raw[2]) : 0;
      if (
        quantity === null ||
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        !name ||
        level === null ||
        !Number.isInteger(level) ||
        level < 0
      ) {
        return null;
      }
      return { quantity, name, level };
    })
    .filter(
      (requirement): requirement is ToolRecipeRequirement =>
        requirement !== null,
    );
}

function recipeSlots(
  inventory: InventorySlotSnapshot[],
  requirements: ToolRecipeRequirement[],
): number[] | null {
  const used = new Set<number>();
  const slots: number[] = [];
  for (const requirement of requirements) {
    const entry = inventory.find(
      (candidate) =>
        !used.has(candidate.slot) &&
        itemName(candidate.item) === requirement.name &&
        itemLevel(candidate.item) === requirement.level &&
        itemQuantity(candidate.item) >= requirement.quantity &&
        candidate.item?.l !== true &&
        candidate.item?.locked !== true,
    );
    if (!entry) return null;
    used.add(entry.slot);
    slots.push(entry.slot);
  }
  return slots;
}

function itemCost(
  gameData: Record<string, unknown>,
  name: string,
): number | null {
  return finiteNumber(objectValue(objectValue(gameData.items)[name]).g);
}

function recipeCost(gameData: Record<string, unknown>): number {
  return Math.max(
    0,
    finiteNumber(objectValue(objectValue(gameData.craft)[TOOL]).cost) || 0,
  );
}

function resultEvidence(
  action: ActionRecord | null,
): { found: boolean | null; response: string | null } {
  const evidence = objectValue(action?.evidence);
  const result = objectValue(evidence.result);
  return {
    found: typeof result.found === "boolean" ? result.found : null,
    response:
      typeof result.response === "string" ? result.response : null,
  };
}

function actionSummary(
  action: ActionRecord | null,
): MerchantFishingStatus["lastAction"] {
  return action
    ? {
        id: action.id,
        action: action.action,
        status: action.status,
        why: action.why,
      }
    : null;
}

export class MerchantFishingController {
  private readonly configSource: () => unknown;
  private readonly now: () => number;
  private readonly onEvent?: (event: MerchantFishingEvent) => void;
  private configOverride: unknown | undefined;
  private lastStatus: MerchantFishingStatus | null = null;
  private lastAction: ActionRecord | null = null;
  private unknownAction: ActionRecord | null = null;
  private sessionActive = false;
  private originalMainhand: Record<string, unknown> | null = null;
  private originalMainhandSignature: Record<string, unknown> | null = null;
  private restoreRequired = false;
  private restored = false;
  private acquiredTool = false;
  private resultAttempted = false;
  private resultFound: boolean | null = null;
  private resultResponse: string | null = null;
  private materialRequestPending = false;
  private materialRequestQuantity = 0;

  constructor(
    private readonly game: MerchantFishingGame,
    private readonly actions: FishingActions,
    private readonly movement: FishingMovement,
    options: MerchantFishingControllerOptions = {},
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

  status(): MerchantFishingStatus {
    const config = normalizeConfig(this.effectiveConfig());
    return (
      this.lastStatus ||
      this.buildStatus(config, "DISABLED", "FISHING_NOT_TICKED", "Skill")
    );
  }

  async tick(): Promise<MerchantFishingStatus> {
    const config = normalizeConfig(this.effectiveConfig());
    const character = this.game.character();
    const gameData = this.game.gameData();

    if (!config.enabled) {
      this.sessionActive = false;
      return this.publish(
        this.buildStatus(config, "DISABLED", "FISHING_DISABLED", "Skill"),
      );
    }
    if (character.ctype !== "merchant") {
      return this.publish(
        this.buildStatus(
          config,
          "UNSUPPORTED_CLASS",
          "FISHING_MERCHANT_REQUIRED",
          "Skill",
        ),
      );
    }
    if (!this.sessionActive) this.beginSession();
    if (this.unknownAction) {
      return this.publish(
        this.buildStatus(
          config,
          "UNKNOWN",
          "FISHING_ACTION_OUTCOME_UNKNOWN_REQUIRES_RECONCILIATION",
          "Ergebnis",
        ),
      );
    }

    const skill = skillDefinition(gameData);
    const requiredLevel = finiteNumber(skill.level);
    const requiredMp = finiteNumber(skill.mp);
    if (!Object.keys(skill).length) {
      return this.block(config, "FISHING_SKILL_MISSING", "Skill");
    }
    if (
      requiredLevel !== null &&
      character.level !== null &&
      character.level < requiredLevel
    ) {
      return this.block(config, "FISHING_LEVEL_TOO_LOW", "Skill");
    }
    if (skillCooldown(this.game.cooldowns()) > 0 && !this.resultAttempted) {
      return this.publish(
        this.buildStatus(
          config,
          "SKILL",
          "FISHING_COOLDOWN_ACTIVE",
          "Skill",
        ),
      );
    }

    if (this.resultAttempted) {
      if (!this.restored) {
        const restoreStatus = await this.restoreMainhand(config);
        if (restoreStatus) return restoreStatus;
      }

      const complete = this.buildStatus(
        config,
        "COMPLETE",
        "FISHING_ROADMAP_COMPLETE",
        "alte Waffe restaurieren",
      );
      this.sessionActive = false;
      return this.publish(complete);
    }

    const equipment = this.game.equipment();
    const inventory = this.game.inventory();
    const mainhand = equipment.mainhand || null;
    const toolEquipped = itemWtype(mainhand, gameData) === TOOL;
    let toolSlot = inventory.find(
      (entry) => itemWtype(entry.item, gameData) === TOOL,
    )?.slot;

    if (!toolEquipped && toolSlot === undefined) {
      if (!config.acquireTool) {
        return this.block(config, "FISHING_TOOL_REQUIRED", "Tool");
      }
      const acquired = await this.acquireTool(config);
      if (acquired) return acquired;
      toolSlot = this.game
        .inventory()
        .find((entry) => itemWtype(entry.item, gameData) === TOOL)?.slot;
      if (toolSlot === undefined) {
        return this.block(
          config,
          "FISHING_TOOL_ACQUISITION_INCOMPLETE",
          "Tool beschaffen",
        );
      }
    }

    const target = zoneTarget(gameData);
    if (!target) {
      return this.block(config, "FISHING_ZONE_NOT_FOUND", "Zone");
    }

    const current = this.game.character();
    if (!characterInsideZone(current, target.zone)) {
      const moved = await this.smartMove(
        config,
        {
          map: target.zone.map,
          x: target.point.x,
          y: target.point.y,
        },
        "FISHING_TRAVEL_TO_ZONE",
        "Travel",
      );
      if (moved) return moved;
    }

    const positioned = this.game.character();
    if (
      positioned.map !== target.zone.map ||
      positioned.x === null ||
      positioned.y === null ||
      !pointInPolygon(
        { x: positioned.x, y: positioned.y },
        target.zone.polygon,
      )
    ) {
      return this.publish(
        this.buildStatus(
          config,
          "TRAVEL",
          "FISHING_ZONE_TRAVEL_PENDING",
          "Travel",
        ),
      );
    }
    if (positioned.moving) {
      return this.publish(
        this.buildStatus(
          config,
          "ZONE",
          "FISHING_WAITING_FOR_STILLNESS",
          "Zone",
        ),
      );
    }

    const afterTravelEquipment = this.game.equipment();
    const afterTravelMainhand = afterTravelEquipment.mainhand || null;
    const rodEquipped = itemWtype(afterTravelMainhand, gameData) === TOOL;

    if (!rodEquipped) {
      if (!this.restoreRequired && !this.resultAttempted) {
        this.originalMainhand = afterTravelMainhand
          ? { ...afterTravelMainhand }
          : null;
        this.originalMainhandSignature = itemSignature(afterTravelMainhand);
        this.restoreRequired = true;
      }
      const rodSlot = this.game
        .inventory()
        .find((entry) => itemWtype(entry.item, gameData) === TOOL)?.slot;
      if (rodSlot === undefined) {
        return this.block(config, "FISHING_ROD_DISAPPEARED", "Equip");
      }
      const equipped = await this.actions.equip({
        inventorySlot: rodSlot,
        slot: "mainhand",
        module: MODULE,
        why: "FISHING_EQUIP_ROD",
      });
      this.recordAction(equipped);
      if (equipped.status === "CONFIRMED") {
        return this.publish(
          this.buildStatus(
            config,
            "EQUIP",
            "FISHING_ROD_EQUIPPED",
            "Equip",
          ),
        );
      }
      return this.actionFailure(
        config,
        equipped,
        "Equip",
        "FISHING_EQUIP_FAILED",
      );
    }

    const readyCharacter = this.game.character();
      if (
        requiredMp !== null &&
        readyCharacter.mp !== null &&
        readyCharacter.mp < requiredMp
      ) {
        return this.block(config, "FISHING_MP_TOO_LOW", "Skill ausführen");
      }
      if (freeInventorySlots(this.game.inventory()) < 1) {
        return this.block(
          config,
          "FISHING_FREE_INVENTORY_SLOT_REQUIRED",
          "Skill ausführen",
        );
      }
      if (
        !characterInsideZone(readyCharacter, target.zone) ||
        readyCharacter.moving
      ) {
        return this.publish(
          this.buildStatus(
            config,
            "ZONE",
            "FISHING_POSITION_CHANGED_BEFORE_SKILL",
            "Zone",
          ),
        );
      }

      const action = await this.actions.useSkill({
        skill: SKILL,
        module: MODULE,
        why: "FISHING_EXECUTE_SKILL",
      });
      this.recordAction(action);
      if (action.status !== "CONFIRMED") {
        return this.actionFailure(
          config,
          action,
          "Skill ausführen",
          "FISHING_SKILL_FAILED",
        );
      }

      const result = resultEvidence(action);
      this.resultAttempted = true;
      this.resultFound = result.found;
      this.resultResponse = result.response;
      if (result.found === null) {
        return this.block(
          config,
          "FISHING_RESULT_NOT_OBSERVED",
          "Ergebnis",
        );
      }
      const status = this.buildStatus(
        config,
        "RESULT",
        result.found ? "FISHING_FOUND_ITEM" : "FISHING_FOUND_NOTHING",
        "Ergebnis",
      );
      this.publish(status);
      this.onEvent?.({
        type: "FISHING_RESULT_CONFIRMED",
        reason: status.reason,
        status,
        actionId: action.id,
        data: {
          found: result.found,
          response: result.response,
        },
      });
      return status;
  }

  async cleanupTemporaryState(): Promise<ActionRecord | null> {
    if (!this.restoreRequired || this.restored) return null;
    const config = normalizeConfig(this.effectiveConfig());
    const status = await this.restoreMainhand(config);
    return this.lastAction &&
      (status?.state === "RESTORE" || status?.state === "COMPLETE")
      ? this.lastAction
      : this.lastAction;
  }

  private effectiveConfig(): unknown {
    return this.configOverride === undefined
      ? this.configSource()
      : this.configOverride;
  }

  private beginSession(): void {
    this.sessionActive = true;
    this.lastAction = null;
    this.unknownAction = null;
    this.originalMainhand = null;
    this.originalMainhandSignature = null;
    this.restoreRequired = false;
    this.restored = false;
    this.acquiredTool = false;
    this.resultAttempted = false;
    this.resultFound = null;
    this.resultResponse = null;
    this.materialRequestPending = false;
    this.materialRequestQuantity = 0;
  }

  private async acquireTool(
    config: FishingConfig,
  ): Promise<MerchantFishingStatus | null> {
    const gameData = this.game.gameData();
    const inventory = this.game.inventory();
    if (
      inventory.some((entry) => itemWtype(entry.item, gameData) === TOOL) ||
      itemWtype(this.game.equipment().mainhand || null, gameData) === TOOL
    ) {
      return null;
    }

    const requirements = recipeRequirements(gameData);
    if (!requirements.length) {
      return this.block(
        config,
        "FISHING_ROD_RECIPE_MISSING",
        "Tool beschaffen",
      );
    }

    const missingStaff = requirements.some(
      (requirement) =>
        requirement.name === STAFF &&
        inventoryQuantity(
          inventory,
          requirement.name,
          requirement.level,
        ) < requirement.quantity,
    );
    if (missingStaff) {
      const staffCost = itemCost(gameData, STAFF);
      const gold = this.game.character().gold;
      if (
        staffCost !== null &&
        gold !== null &&
        gold - staffCost < config.goldReserve
      ) {
        return this.block(
          config,
          "FISHING_GOLD_RESERVE_PROTECTED",
          "Tool beschaffen",
        );
      }
      const ready = await this.ensureNearNpc(
        config,
        "basics",
        "FISHING_TRAVEL_TO_STAFF_VENDOR",
      );
      if (ready) return ready;
      const bought = await this.actions.buy({
        itemName: STAFF,
        quantity: 1,
        module: MODULE,
        why: "FISHING_ACQUIRE_STAFF",
      });
      this.recordAction(bought);
      if (bought.status === "CONFIRMED") {
        return this.publish(
          this.buildStatus(
            config,
            "TOOL_ACQUIRE",
            "FISHING_STAFF_ACQUIRED",
            "Tool beschaffen",
          ),
        );
      }
      return this.actionFailure(
        config,
        bought,
        "Tool beschaffen",
        "FISHING_STAFF_ACQUIRE_FAILED",
      );
    }

    const silkRequirement = requirements.find(
      (requirement) => requirement.name === MATERIAL,
    );
    const currentSilk = silkRequirement
      ? inventoryQuantity(
          inventory,
          silkRequirement.name,
          silkRequirement.level,
        )
      : 0;
    if (silkRequirement && currentSilk < silkRequirement.quantity) {
      const missingQuantity = silkRequirement.quantity - currentSilk;
      this.materialRequestQuantity = missingQuantity;
      if (!this.materialRequestPending) {
        this.materialRequestPending = true;
        const status = this.buildStatus(
          config,
          "TOOL_ACQUIRE",
          "FISHING_WAITING_FOR_MATERIAL",
          "Tool beschaffen",
        );
        this.publish(status);
        this.onEvent?.({
          type: "FISHING_MATERIAL_REQUESTED",
          reason: "FISHING_MATERIAL_REQUIRED",
          status,
          data: {
            itemName: MATERIAL,
            quantity: missingQuantity,
            recipient: this.game.character().name,
            purpose: "FISHING_ROD",
          },
        });
        return status;
      }
      return this.publish(
        this.buildStatus(
          config,
          "TOOL_ACQUIRE",
          "FISHING_WAITING_FOR_MATERIAL",
          "Tool beschaffen",
        ),
      );
    }
    this.materialRequestPending = false;
    this.materialRequestQuantity = 0;

    const craftCost = recipeCost(gameData);
    const gold = this.game.character().gold;
    if (
      gold !== null &&
      gold - craftCost < config.goldReserve
    ) {
      return this.block(
        config,
        "FISHING_GOLD_RESERVE_PROTECTED",
        "Tool beschaffen",
      );
    }

    const nearCraftsman = await this.ensureNearNpc(
      config,
      "craftsman",
      "FISHING_TRAVEL_TO_CRAFTSMAN",
    );
    if (nearCraftsman) return nearCraftsman;

    const slots = recipeSlots(this.game.inventory(), requirements);
    if (!slots) {
      return this.block(
        config,
        "FISHING_ROD_RECIPE_INGREDIENTS_CHANGED",
        "Tool beschaffen",
      );
    }
    const crafted = await this.actions.craft({
      recipe: TOOL,
      itemSlots: slots,
      module: MODULE,
      why: "FISHING_CRAFT_ROD",
    });
    this.recordAction(crafted);
    if (crafted.status === "CONFIRMED") {
      this.acquiredTool = true;
      return this.publish(
        this.buildStatus(
          config,
          "TOOL_ACQUIRE",
          "FISHING_ROD_CRAFTED",
          "Tool beschaffen",
        ),
      );
    }
    return this.actionFailure(
      config,
      crafted,
      "Tool beschaffen",
      "FISHING_ROD_CRAFT_FAILED",
    );
  }

  private async ensureNearNpc(
    config: FishingConfig,
    npcId: string,
    why: string,
  ): Promise<MerchantFishingStatus | null> {
    const location = npcLocation(this.game.gameData(), npcId);
    if (!location) {
      return this.block(
        config,
        `FISHING_NPC_NOT_FOUND:${npcId}`,
        "Tool beschaffen",
      );
    }
    const character = this.game.character();
    if (
      character.map === location.map &&
      character.x !== null &&
      character.y !== null &&
      distance(
        { x: character.x, y: character.y },
        { x: location.x, y: location.y },
      ) <= 80
    ) {
      return null;
    }
    return await this.smartMove(
      config,
      location,
      why,
      "Tool beschaffen",
    );
  }

  private async smartMove(
    config: FishingConfig,
    destination: string | { map: string; x: number; y: number },
    why: string,
    stage: MerchantFishingStatus["roadmapStage"],
  ): Promise<MerchantFishingStatus | null> {
    const movementStatus = this.movement.status();
    if (movementStatus.owner && movementStatus.owner !== OWNER) {
      return this.block(config, "FISHING_MOVEMENT_OWNED_BY_OTHER", stage);
    }
    try {
      const action = await this.movement.smart({
        owner: OWNER,
        module: MODULE,
        why,
        destination,
      });
      this.recordAction(action);
      if (action.status === "UNKNOWN") {
        return this.actionFailure(
          config,
          action,
          stage,
          "FISHING_MOVEMENT_UNKNOWN",
        );
      }
      if (action.status !== "CONFIRMED") {
        return this.actionFailure(
          config,
          action,
          stage,
          "FISHING_MOVEMENT_FAILED",
        );
      }
      return this.publish(
        this.buildStatus(
          config,
          stage === "Travel" ? "TRAVEL" : "TOOL_ACQUIRE",
          `${why}_CONFIRMED`,
          stage,
        ),
      );
    } catch (error) {
      return this.block(
        config,
        `${why}_BLOCKED:${
          error instanceof Error ? error.message : String(error)
        }`,
        stage,
      );
    }
  }

  private async restoreMainhand(
    config: FishingConfig,
  ): Promise<MerchantFishingStatus | null> {
    if (!this.restoreRequired) {
      this.restored = true;
      return null;
    }

    const currentMainhand = this.game.equipment().mainhand || null;
    if (this.originalMainhandSignature) {
      if (
        signatureMatches(currentMainhand, this.originalMainhandSignature)
      ) {
        this.restored = true;
        return null;
      }
      const oldWeapon = this.game
        .inventory()
        .find((entry) =>
          signatureMatches(entry.item, this.originalMainhandSignature),
        );
      if (!oldWeapon) {
        return this.block(
          config,
          "FISHING_ORIGINAL_MAINHAND_MISSING",
          "alte Waffe restaurieren",
        );
      }
      const action = await this.actions.equip({
        inventorySlot: oldWeapon.slot,
        slot: "mainhand",
        module: MODULE,
        why: "FISHING_RESTORE_ORIGINAL_MAINHAND",
      });
      this.recordAction(action);
      if (action.status !== "CONFIRMED") {
        return this.actionFailure(
          config,
          action,
          "alte Waffe restaurieren",
          "FISHING_RESTORE_MAINHAND_FAILED",
        );
      }
      this.restored = true;
      return this.publish(
        this.buildStatus(
          config,
          "RESTORE",
          "FISHING_ORIGINAL_MAINHAND_RESTORED",
          "alte Waffe restaurieren",
        ),
      );
    }

    if (currentMainhand && itemWtype(currentMainhand, this.game.gameData()) === TOOL) {
      const action = await this.actions.unequip({
        slot: "mainhand",
        module: MODULE,
        why: "FISHING_RESTORE_EMPTY_MAINHAND",
      });
      this.recordAction(action);
      if (action.status !== "CONFIRMED") {
        return this.actionFailure(
          config,
          action,
          "alte Waffe restaurieren",
          "FISHING_RESTORE_EMPTY_MAINHAND_FAILED",
        );
      }
    }
    this.restored = true;
    return this.publish(
      this.buildStatus(
        config,
        "RESTORE",
        "FISHING_EMPTY_MAINHAND_RESTORED",
        "alte Waffe restaurieren",
      ),
    );
  }

  private recordAction(action: ActionRecord): void {
    this.lastAction = action;
    if (action.status === "UNKNOWN") {
      this.unknownAction = action;
      const config = normalizeConfig(this.effectiveConfig());
      const status = this.buildStatus(
        config,
        "UNKNOWN",
        "FISHING_ACTION_OUTCOME_UNKNOWN",
        "Ergebnis",
      );
      this.onEvent?.({
        type: "FISHING_ACTION_UNKNOWN",
        reason: status.reason,
        actionId: action.id,
        status,
        data: {
          action: action.action,
          why: action.why,
        },
      });
    }
  }

  private actionFailure(
    config: FishingConfig,
    action: ActionRecord,
    stage: MerchantFishingStatus["roadmapStage"],
    fallback: string,
  ): MerchantFishingStatus {
    return this.publish(
      this.buildStatus(
        config,
        action.status === "UNKNOWN" ? "UNKNOWN" : "BLOCKED",
        `${fallback}:${action.status || "NO_STATUS"}`,
        stage,
      ),
    );
  }

  private block(
    config: FishingConfig,
    reason: string,
    stage: MerchantFishingStatus["roadmapStage"],
  ): MerchantFishingStatus {
    return this.publish(
      this.buildStatus(config, "BLOCKED", reason, stage),
    );
  }

  private buildStatus(
    config: FishingConfig,
    state: MerchantFishingState,
    reason: string,
    roadmapStage: MerchantFishingStatus["roadmapStage"],
  ): MerchantFishingStatus {
    const character = this.game.character();
    const gameData = this.game.gameData();
    const skill = skillDefinition(gameData);
    const target = zoneTarget(gameData);
    const inventory = this.game.inventory();
    const mainhand = this.game.equipment().mainhand || null;
    const cooldownRemainingMs = skillCooldown(this.game.cooldowns());
    return {
      timestamp: this.now(),
      enabled: config.enabled,
      state,
      reason,
      roadmapStage,
      character: {
        name: character.name,
        level: character.level,
        map: character.map,
        x: character.x,
        y: character.y,
        mp: character.mp,
        moving: character.moving,
      },
      skill: {
        present: Object.keys(skill).length > 0,
        requiredLevel: finiteNumber(skill.level),
        requiredMp: finiteNumber(skill.mp),
        cooldownRemainingMs,
      },
      tool: {
        name: TOOL,
        equipped: itemWtype(mainhand, gameData) === TOOL,
        inventorySlot:
          inventory.find((entry) => itemWtype(entry.item, gameData) === TOOL)
            ?.slot ?? null,
        acquiredByController: this.acquiredTool,
      },
      zone: {
        map: target?.zone.map || null,
        x: target?.point.x ?? null,
        y: target?.point.y ?? null,
        inside: target
          ? characterInsideZone(character, target.zone)
          : false,
        source: target?.source || null,
      },
      result: {
        attempted: this.resultAttempted,
        found: this.resultFound,
        response: this.resultResponse,
      },
      materialRequest: {
        itemName: this.materialRequestPending ? MATERIAL : null,
        quantity: this.materialRequestQuantity,
        pending: this.materialRequestPending,
      },
      restore: {
        required: this.restoreRequired,
        restored: this.restored,
        originalMainhand: this.originalMainhand
          ? { ...this.originalMainhand }
          : null,
      },
      lastAction: actionSummary(this.lastAction),
    };
  }

  private publish(
    status: MerchantFishingStatus,
  ): MerchantFishingStatus {
    this.lastStatus = status;
    this.onEvent?.({
      type: "FISHING_STATUS",
      reason: status.reason,
      status,
    });
    return status;
  }
}

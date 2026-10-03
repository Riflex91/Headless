export interface CharacterSnapshot {
  name: string | null;
  ctype: string | null;
  map: string | null;
  instance?: string | null;
  stand?: string | boolean | null;
  merrit?: Record<string, unknown> | null;
  x: number | null;
  y: number | null;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
  level: number | null;
  xp: number | null;
  attack: number | null;
  frequency: number | null;
  armor: number | null;
  resistance: number | null;
  range: number | null;
  gold: number | null;
  target: string | null;
  rip: boolean;
  moving: boolean;
}

export interface EntitySnapshot {
  id: string;
  type: string | null;
  name: string | null;
  mtype: string | null;
  map: string | null;
  x: number | null;
  y: number | null;
  hp: number | null;
  maxHp: number | null;
  level: number | null;
  attack: number | null;
  frequency: number | null;
  armor: number | null;
  resistance: number | null;
  range: number | null;
  target: string | null;
  dead: boolean;
  rip: boolean;
}

export interface InventorySlotSnapshot {
  slot: number;
  item: Record<string, unknown> | null;
}

export interface EquipmentSnapshot {
  [slot: string]: Record<string, unknown> | null;
}

export interface TradeSlotsSnapshot {
  [slot: string]: Record<string, unknown> | null;
}

export interface MapSnapshot {
  name: string | null;
  x: number | null;
  y: number | null;
}

export interface NpcPositionSnapshot {
  x: number;
  y: number;
}

export interface NpcSnapshot {
  id: string;
  name: string | null;
  role: string | null;
  map: string;
  x: number | null;
  y: number | null;
  visible: boolean;
  positions: NpcPositionSnapshot[];
  items: string[];
}

export interface BankPackSnapshot {
  name: string;
  items: InventorySlotSnapshot[];
}

export interface BankPackAccessSnapshot {
  name: string;
  map: string | null;
  goldPrice: number | null;
  shellPrice: number | null;
}

export interface BankSnapshot {
  available: boolean;
  gold: number | null;
  packs: BankPackSnapshot[];
  access: BankPackAccessSnapshot[];
}

export interface MarketListingSnapshot {
  merchantId: string;
  merchantName: string | null;
  map: string | null;
  x: number | null;
  y: number | null;
  stand: string | boolean | null;
  slot: string;
  side: "BUY" | "SELL";
  item: {
    name: string | null;
    level: number | null;
    quantity: number | null;
    price: number | null;
    rid: string | null;
    giveaway: number | null;
  };
}

export interface SkillSnapshot {
  key: string;
  name: string | null;
  classes: string[];
  level: number | null;
  mp: number | null;
  cooldown: number | null;
  range: number | null;
  hostile: boolean;
  party: boolean;
  passive: boolean;
}

export interface CooldownSnapshot {
  skill: string;
  readyAt: number;
  remainingMs: number;
  ready: boolean;
}

export interface ZoneSnapshot {
  map: string;
  type: string | null;
  drop: string | null;
  polygon: Array<[number, number]>;
}

export interface GameAdapterSource {
  character(): unknown;
  entities(): unknown;
  party(): unknown;
  gameData(): unknown;
  nextSkill(): unknown;
  bankPacks(): unknown;
  itemGrade?(item: unknown): unknown;
  now(): number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateMsOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object Date]"
  ) {
    const timestamp = (
      value as unknown as {
        getTime(): number;
      }
    ).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function cloneJsonValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 8) return "[max-depth]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const result = value.map((item) =>
      cloneJsonValue(item, depth + 1, seen),
    );
    seen.delete(value);
    return result;
  }
  if (typeof value !== "object") return undefined;

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const cloned = cloneJsonValue(child, depth + 1, seen);
    if (cloned !== undefined) result[key] = cloned;
  }
  seen.delete(value);
  return result;
}

function runtimeValue(name: string): unknown {
  const local = globalThis as unknown as Record<string, unknown>;
  if (local[name] !== undefined) return local[name];

  const parentScope =
    typeof parent === "undefined"
      ? null
      : (parent as unknown as Record<string, unknown>);
  return parentScope?.[name];
}

function positionsFromMapNpc(value: unknown): NpcPositionSnapshot[] {
  const npc = record(value);
  const positions: NpcPositionSnapshot[] = [];
  const add = (candidate: unknown): void => {
    if (!Array.isArray(candidate) || candidate.length < 2) return;
    const x = numberOrNull(candidate[0]);
    const y = numberOrNull(candidate[1]);
    if (x === null || y === null) return;
    positions.push({ x, y });
  };

  add(npc.position);
  if (Array.isArray(npc.positions)) {
    for (const candidate of npc.positions) add(candidate);
  }

  return positions;
}

export function createRuntimeGameAdapterSource(): GameAdapterSource {
  return {
    character: () => runtimeValue("character"),
    entities: () => runtimeValue("entities"),
    party: () => runtimeValue("party"),
    gameData: () => runtimeValue("G"),
    nextSkill: () => runtimeValue("next_skill"),
    bankPacks: () => runtimeValue("bank_packs"),
    itemGrade: (item: unknown) => {
      const candidate = runtimeValue("item_grade");
      return typeof candidate === "function"
        ? (candidate as (value: unknown) => unknown)(item)
        : null;
    },
    now: () => Date.now(),
  };
}

export const GAME_ADAPTER_READ_CAPABILITIES = [
  "CHARACTER",
  "ENTITIES",
  "PARTY",
  "INVENTORY",
  "EQUIPMENT",
  "NPC",
  "BANK",
  "MARKET",
  "SKILLS",
  "COOLDOWNS",
  "MAP",
  "ZONES",
  "G",
  "ITEM_GRADE",
] as const;

export class GameAdapter {
  constructor(
    private readonly source: GameAdapterSource = createRuntimeGameAdapterSource(),
  ) {}

  capabilities(): readonly string[] {
    return GAME_ADAPTER_READ_CAPABILITIES;
  }

  character(): CharacterSnapshot {
    const current = record(this.source.character());
    return {
      name: stringOrNull(current.name),
      ctype: stringOrNull(current.ctype),
      map: stringOrNull(current.map),
      instance: stringOrNull(current.in),
      stand:
        typeof current.stand === "string"
          ? current.stand
          : typeof current.stand === "boolean"
            ? current.stand
            : null,
      merrit:
        current.merrit && typeof current.merrit === "object"
          ? ((cloneJsonValue(current.merrit) as Record<string, unknown>) || null)
          : null,
      x: numberOrNull(current.x),
      y: numberOrNull(current.y),
      hp: numberOrNull(current.hp),
      maxHp: numberOrNull(current.max_hp),
      mp: numberOrNull(current.mp),
      maxMp: numberOrNull(current.max_mp),
      level: numberOrNull(current.level),
      xp: numberOrNull(current.xp),
      attack: numberOrNull(current.attack),
      frequency: numberOrNull(current.frequency),
      armor: numberOrNull(current.armor),
      resistance: numberOrNull(current.resistance),
      range: numberOrNull(current.range),
      gold: numberOrNull(current.gold),
      target: stringOrNull(current.target),
      rip: current.rip === true,
      moving: current.moving === true,
    };
  }

  entities(): EntitySnapshot[] {
    const entities = record(this.source.entities());
    return Object.entries(entities)
      .map(([fallbackId, value]) => {
        const entity = record(value);
        return {
          id: stringOrNull(entity.id) || fallbackId,
          type: stringOrNull(entity.type),
          name: stringOrNull(entity.name),
          mtype: stringOrNull(entity.mtype),
          map: stringOrNull(entity.map),
          x: numberOrNull(entity.x),
          y: numberOrNull(entity.y),
          hp: numberOrNull(entity.hp),
          maxHp: numberOrNull(entity.max_hp),
          level: numberOrNull(entity.level),
          attack: numberOrNull(entity.attack),
          frequency: numberOrNull(entity.frequency),
          armor: numberOrNull(entity.armor),
          resistance: numberOrNull(entity.resistance),
          range: numberOrNull(entity.range),
          target: stringOrNull(entity.target),
          dead: entity.dead === true,
          rip: entity.rip === true,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  entity(id: string): EntitySnapshot | null {
    return this.entities().find((entity) => entity.id === id) || null;
  }

  party(): Record<string, unknown> {
    return record(cloneJsonValue(this.source.party()));
  }

  inventory(): InventorySlotSnapshot[] {
    const current = record(this.source.character());
    const items = Array.isArray(current.items) ? current.items : [];
    return items.map((item, slot) => ({
      slot,
      item:
        item && typeof item === "object"
          ? ((cloneJsonValue(item) as Record<string, unknown>) || null)
          : null,
    }));
  }

  equipment(): EquipmentSnapshot {
    const current = record(this.source.character());
    const slots = record(current.slots);
    const result: EquipmentSnapshot = {};

    for (const [slot, item] of Object.entries(slots)) {
      if (slot.startsWith("trade")) continue;
      result[slot] =
        item && typeof item === "object"
          ? ((cloneJsonValue(item) as Record<string, unknown>) || null)
          : null;
    }

    return result;
  }

  tradeSlots(): TradeSlotsSnapshot {
    const current = record(this.source.character());
    const slots = record(current.slots);
    const result: TradeSlotsSnapshot = {};

    for (const [slot, item] of Object.entries(slots)) {
      if (!/^trade\d+$/.test(slot)) continue;
      result[slot] =
        item && typeof item === "object"
          ? ((cloneJsonValue(item) as Record<string, unknown>) || null)
          : null;
    }

    return result;
  }

  npcs(mapName = this.character().map): NpcSnapshot[] {
    if (!mapName) return [];

    const gameData = record(this.source.gameData());
    const maps = record(gameData.maps);
    const npcDefinitions = record(gameData.npcs);
    const mapDefinition = record(maps[mapName]);
    const mapNpcs = Array.isArray(mapDefinition.npcs)
      ? mapDefinition.npcs
      : [];
    const entities = record(this.source.entities());
    const result: NpcSnapshot[] = [];

    for (const mapNpcValue of mapNpcs) {
      const mapNpc = record(mapNpcValue);
      const id = stringOrNull(mapNpc.id);
      if (!id) continue;

      const definition = record(npcDefinitions[id]);
      const visibleEntry = Object.entries(entities).find(([, rawEntity]) => {
        const entity = record(rawEntity);
        return entity.type === "npc" && entity.npc === id;
      });
      const visible = visibleEntry ? record(visibleEntry[1]) : null;
      const positions = positionsFromMapNpc(mapNpc);
      const firstPosition = positions[0] || null;
      const items = Array.isArray(definition.items)
        ? definition.items.filter(
            (item): item is string => typeof item === "string",
          )
        : [];

      result.push({
        id,
        name:
          stringOrNull(visible?.name) ||
          stringOrNull(definition.name) ||
          stringOrNull(mapNpc.name),
        role: stringOrNull(visible?.role) || stringOrNull(definition.role),
        map: mapName,
        x: numberOrNull(visible?.x) ?? firstPosition?.x ?? null,
        y: numberOrNull(visible?.y) ?? firstPosition?.y ?? null,
        visible: !!visible,
        positions,
        items,
      });
    }

    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  bank(): BankSnapshot {
    const current = record(this.source.character());
    const bankValue = current.bank;
    const bank = record(bankValue);
    const packs = Object.entries(bank)
      .filter(([name, value]) => name.startsWith("items") && Array.isArray(value))
      .map(([name, value]) => ({
        name,
        items: (value as unknown[]).map((item, slot) => ({
          slot,
          item:
            item && typeof item === "object"
              ? ((cloneJsonValue(item) as Record<string, unknown>) || null)
              : null,
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const access = Object.entries(record(this.source.bankPacks()))
      .map(([name, value]) => {
        const metadata = Array.isArray(value) ? value : [];
        return {
          name,
          map: stringOrNull(metadata[0]),
          goldPrice: numberOrNull(metadata[1]),
          shellPrice: numberOrNull(metadata[2]),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      available: !!bankValue && typeof bankValue === "object",
      gold: numberOrNull(bank.gold),
      packs,
      access,
    };
  }

  market(): MarketListingSnapshot[] {
    const listings: MarketListingSnapshot[] = [];

    for (const [fallbackId, rawEntity] of Object.entries(
      record(this.source.entities()),
    )) {
      const entity = record(rawEntity);
      if (entity.type !== "character" || !entity.stand) continue;

      const merchantId = stringOrNull(entity.id) || fallbackId;
      const slots = record(entity.slots);
      for (const [slot, rawItem] of Object.entries(slots)) {
        if (!/^trade\d+$/.test(slot)) continue;
        if (!rawItem || typeof rawItem !== "object") continue;

        const item = record(rawItem);
        listings.push({
          merchantId,
          merchantName: stringOrNull(entity.name),
          map: stringOrNull(entity.map),
          x: numberOrNull(entity.x),
          y: numberOrNull(entity.y),
          stand:
            typeof entity.stand === "string" ||
            typeof entity.stand === "boolean"
              ? entity.stand
              : null,
          slot,
          side: item.b === true ? "BUY" : "SELL",
          item: {
            name: stringOrNull(item.name),
            level: numberOrNull(item.level),
            quantity: numberOrNull(item.q),
            price: numberOrNull(item.price),
            rid: stringOrNull(item.rid),
            giveaway: numberOrNull(item.giveaway),
          },
        });
      }
    }

    return listings.sort(
      (a, b) =>
        a.merchantId.localeCompare(b.merchantId) ||
        a.slot.localeCompare(b.slot),
    );
  }

  skills(characterOnly = true): SkillSnapshot[] {
    const gameData = record(this.source.gameData());
    const skills = record(gameData.skills);
    const ctype = this.character().ctype;

    return Object.entries(skills)
      .map(([key, rawSkill]) => {
        const skill = record(rawSkill);
        const classes = Array.isArray(skill.class)
          ? skill.class.filter(
              (className): className is string =>
                typeof className === "string",
            )
          : [];

        return {
          key,
          name: stringOrNull(skill.name),
          classes,
          level: numberOrNull(skill.level),
          mp: numberOrNull(skill.mp),
          cooldown: numberOrNull(skill.cooldown),
          range: numberOrNull(skill.range),
          hostile: skill.hostile === true,
          party: skill.party === true,
          passive: skill.passive === true,
        };
      })
      .filter(
        (skill) =>
          !characterOnly ||
          skill.classes.length === 0 ||
          (!!ctype && skill.classes.includes(ctype)),
      )
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  cooldowns(): CooldownSnapshot[] {
    const now = this.source.now();
    return Object.entries(record(this.source.nextSkill()))
      .map(([skill, value]) => {
        const readyAt = dateMsOrNull(value);
        if (readyAt === null) return null;

        const remainingMs = Math.max(0, readyAt - now);
        return {
          skill,
          readyAt,
          remainingMs,
          ready: remainingMs === 0,
        };
      })
      .filter(
        (cooldown): cooldown is CooldownSnapshot => cooldown !== null,
      )
      .sort((a, b) => a.skill.localeCompare(b.skill));
  }

  map(): MapSnapshot {
    const current = this.character();
    return {
      name: current.map,
      x: current.x,
      y: current.y,
    };
  }

  zones(mapName = this.character().map): ZoneSnapshot[] {
    if (!mapName) return [];

    const gameData = record(this.source.gameData());
    const mapDefinition = record(record(gameData.maps)[mapName]);
    const zones = Array.isArray(mapDefinition.zones)
      ? mapDefinition.zones
      : [];

    return zones.map((rawZone) => {
      const zone = record(rawZone);
      const polygon = Array.isArray(zone.polygon)
        ? zone.polygon
            .filter(
              (point): point is unknown[] =>
                Array.isArray(point) && point.length >= 2,
            )
            .map((point) => [
              numberOrNull(point[0]) ?? 0,
              numberOrNull(point[1]) ?? 0,
            ] as [number, number])
        : [];

      return {
        map: mapName,
        type: stringOrNull(zone.type),
        drop: stringOrNull(zone.drop),
        polygon,
      };
    });
  }

  gameData(): Record<string, unknown> {
    return record(cloneJsonValue(this.source.gameData()));
  }

  itemGrade(item: Record<string, unknown>): number | null {
    if (!this.source.itemGrade) return null;
    try {
      const value = this.source.itemGrade(cloneJsonValue(item));
      const grade = numberOrNull(value);
      return grade !== null && Number.isInteger(grade) && grade >= 0
        ? grade
        : null;
    } catch {
      return null;
    }
  }
}

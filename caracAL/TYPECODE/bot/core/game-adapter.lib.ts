export interface CharacterSnapshot {
  name: string | null;
  ctype: string | null;
  map: string | null;
  x: number | null;
  y: number | null;
  hp: number | null;
  maxHp: number | null;
  mp: number | null;
  maxMp: number | null;
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

export interface MapSnapshot {
  name: string | null;
  x: number | null;
  y: number | null;
}

export interface GameAdapterSource {
  character(): unknown;
  entities(): unknown;
  party(): unknown;
  gameData(): unknown;
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

export function createRuntimeGameAdapterSource(): GameAdapterSource {
  return {
    character: () => runtimeValue("character"),
    entities: () => runtimeValue("entities"),
    party: () => runtimeValue("party"),
    gameData: () => runtimeValue("G"),
  };
}

export class GameAdapter {
  constructor(
    private readonly source: GameAdapterSource = createRuntimeGameAdapterSource(),
  ) {}

  character(): CharacterSnapshot {
    const current = record(this.source.character());
    return {
      name: stringOrNull(current.name),
      ctype: stringOrNull(current.ctype),
      map: stringOrNull(current.map),
      x: numberOrNull(current.x),
      y: numberOrNull(current.y),
      hp: numberOrNull(current.hp),
      maxHp: numberOrNull(current.max_hp),
      mp: numberOrNull(current.mp),
      maxMp: numberOrNull(current.max_mp),
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
      result[slot] =
        item && typeof item === "object"
          ? ((cloneJsonValue(item) as Record<string, unknown>) || null)
          : null;
    }

    return result;
  }

  map(): MapSnapshot {
    const current = this.character();
    return {
      name: current.map,
      x: current.x,
      y: current.y,
    };
  }

  gameData(): Record<string, unknown> {
    return record(cloneJsonValue(this.source.gameData()));
  }
}

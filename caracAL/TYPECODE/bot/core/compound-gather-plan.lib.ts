import type { InventorySlotSnapshot } from "./game-adapter.lib";

export interface CompoundGatherCandidate {
  source: "MERCHANT_INVENTORY" | "MONSTER_DROP";
  itemName: string;
  itemLevel: number;
  itemSlots: number[];
  monsterType: string | null;
  itemGrade: number;
  scrollName: string;
  scrollSlots: number[];
  scrollQuantity: number;
  dropChance: number | null;
  monsterHp: number | null;
  score: number;
}

export interface CompoundGatherPlan {
  outcome: "PASS" | "FAIL";
  reason:
    | "COMPOUND_GATHER_TARGET_SELECTED"
    | "COMPOUND_GATHER_TARGET_NOT_FOUND";
  selected: CompoundGatherCandidate | null;
  candidates: CompoundGatherCandidate[];
  observerPosition: {
    map: string;
    x: number;
    y: number;
  } | null;
}

interface CompoundGatherGame {
  gameData(): Record<string, unknown>;
  itemGrade(item: Record<string, unknown>): number | null;
  character?(): {
    map?: unknown;
    x?: unknown;
    y?: unknown;
  };
  inventory?(): InventorySlotSnapshot[];
}

interface DropReference {
  itemName: string;
  chance: number | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) &&
    Number.isInteger(number) &&
    number >= 0
    ? number
    : null;
}

function probability(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

function mergeChance(
  parent: number | null,
  child: number | null,
): number | null {
  if (parent === null) return child;
  if (child === null) return parent;
  return parent * child;
}

function openDropReferences(
  tableName: string,
  itemDefinitions: Record<string, unknown>,
  dropTables: Record<string, unknown>,
  inheritedChance: number | null,
  visited: Set<string>,
): DropReference[] {
  const visitKey = `open:${tableName}`;
  if (visited.has(visitKey)) return [];

  const table = dropTables[tableName];
  if (!Array.isArray(table)) return [];

  const weighted = table.filter(
    (entry): entry is unknown[] =>
      Array.isArray(entry) &&
      entry.length >= 2 &&
      typeof entry[0] === "number" &&
      entry[0] >= 0 &&
      typeof entry[1] === "string",
  );
  const total = weighted.reduce((sum, entry) => sum + Number(entry[0]), 0);
  if (!(total > 0)) return [];

  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);

  return weighted.flatMap((entry) => {
    const chance = mergeChance(
      inheritedChance,
      Number(entry[0]) / total,
    );
    if (entry[1] === "open" && typeof entry[2] === "string") {
      return openDropReferences(
        entry[2],
        itemDefinitions,
        dropTables,
        chance,
        nextVisited,
      );
    }
    return dropReferences(
      entry[1],
      itemDefinitions,
      dropTables,
      chance,
      nextVisited,
    );
  });
}

function dropReferences(
  value: unknown,
  itemDefinitions: Record<string, unknown>,
  dropTables: Record<string, unknown>,
  inheritedChance: number | null = null,
  visited: Set<string> = new Set(),
): DropReference[] {
  if (typeof value === "string") {
    if (Object.prototype.hasOwnProperty.call(itemDefinitions, value)) {
      return [{ itemName: value, chance: inheritedChance }];
    }
    if (
      Object.prototype.hasOwnProperty.call(dropTables, value) &&
      !visited.has(value)
    ) {
      const nextVisited = new Set(visited);
      nextVisited.add(value);
      return dropReferences(
        dropTables[value],
        itemDefinitions,
        dropTables,
        inheritedChance,
        nextVisited,
      );
    }
    return [];
  }

  if (Array.isArray(value)) {
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "string"
    ) {
      const chance = mergeChance(inheritedChance, probability(value[0]));
      if (value[1] === "open" && typeof value[2] === "string") {
        return openDropReferences(
          value[2],
          itemDefinitions,
          dropTables,
          chance,
          visited,
        );
      }
      return dropReferences(
        value[1],
        itemDefinitions,
        dropTables,
        chance,
        visited,
      );
    }
    return value.flatMap((entry) =>
      dropReferences(
        entry,
        itemDefinitions,
        dropTables,
        inheritedChance,
        visited,
      ),
    );
  }

  const source = record(value);
  if (!Object.keys(source).length) return [];

  const chance = mergeChance(
    inheritedChance,
    probability(
      source.chance ??
        source.probability ??
        source.rate ??
        source.p,
    ),
  );
  const directName =
    text(source.name) || text(source.item) || text(source.id);
  const result = directName
    ? dropReferences(
        directName,
        itemDefinitions,
        dropTables,
        chance,
        visited,
      )
    : [];

  for (const key of ["drop", "drops", "items", "loot"]) {
    if (source[key] !== undefined) {
      result.push(
        ...dropReferences(
          source[key],
          itemDefinitions,
          dropTables,
          chance,
          visited,
        ),
      );
    }
  }

  for (const [key, raw] of Object.entries(source)) {
    if (
      ["chance", "probability", "rate", "p", "name", "item", "id", "drop", "drops", "items", "loot"].includes(
        key,
      )
    ) {
      continue;
    }
    if (
      !Object.prototype.hasOwnProperty.call(itemDefinitions, key) &&
      !Object.prototype.hasOwnProperty.call(dropTables, key)
    ) {
      continue;
    }
    result.push(
      ...dropReferences(
        key,
        itemDefinitions,
        dropTables,
        mergeChance(chance, probability(raw)),
        visited,
      ),
    );
  }
  return result;
}

function bestDropChance(refs: DropReference[], itemName: string): number | null {
  const chances = refs
    .filter((entry) => entry.itemName === itemName)
    .map((entry) => entry.chance)
    .filter((entry): entry is number => entry !== null);
  return chances.length ? Math.max(...chances) : null;
}

function spawnTypes(value: unknown): string[] {
  const spawn = record(value);
  const direct = spawn.type;
  if (typeof direct === "string" && direct.trim()) {
    return [direct.trim()];
  }
  if (Array.isArray(direct)) {
    return direct.filter(
      (entry): entry is string =>
        typeof entry === "string" && !!entry.trim(),
    );
  }

  for (const key of ["types", "monsters"]) {
    if (!Array.isArray(spawn[key])) continue;
    const result = (spawn[key] as unknown[]).filter(
      (entry): entry is string =>
        typeof entry === "string" && !!entry.trim(),
    );
    if (result.length) return result;
  }
  return [];
}

function regularSpawnMonsterTypes(
  maps: Record<string, unknown>,
): Set<string> {
  const result = new Set<string>();
  for (const rawMap of Object.values(maps)) {
    const map = record(rawMap);
    const spawns = Array.isArray(map.monsters) ? map.monsters : [];
    for (const spawn of spawns) {
      for (const monsterType of spawnTypes(spawn)) {
        result.add(monsterType);
      }
    }
  }
  return result;
}

function observerPosition(
  game: CompoundGatherGame,
): CompoundGatherPlan["observerPosition"] {
  const character = game.character ? game.character() : {};
  const map = text(character.map);
  const x = finite(character.x);
  const y = finite(character.y);
  return map && x !== null && y !== null ? { map, x, y } : null;
}

function inventoryItemQuantity(item: Record<string, unknown>): number {
  const quantity = nonNegativeInteger(item.q);
  return quantity !== null && quantity > 0 ? quantity : 1;
}

function matchingInventoryEvidence(
  inventory: InventorySlotSnapshot[],
  itemName: string,
): { slots: number[]; quantity: number } {
  const matching = inventory
    .filter((entry) => text(entry.item?.name) === itemName)
    .sort((left, right) => left.slot - right.slot);
  return {
    slots: matching.map((entry) => entry.slot),
    quantity: matching.reduce(
      (sum, entry) =>
        sum + (entry.item ? inventoryItemQuantity(record(entry.item)) : 0),
      0,
    ),
  };
}

function inventoryTripleCandidates(
  game: CompoundGatherGame,
  itemDefinitions: Record<string, unknown>,
  inventory: InventorySlotSnapshot[],
): CompoundGatherCandidate[] {
  const groups = new Map<
    string,
    {
      itemName: string;
      itemLevel: number;
      entries: Array<{ slot: number; item: Record<string, unknown> }>;
    }
  >();

  for (const entry of inventory) {
    if (!entry.item) continue;
    const item = record(entry.item);
    const itemName = text(item.name);
    if (!itemName) continue;

    const definition = record(itemDefinitions[itemName]);
    if (!Object.prototype.hasOwnProperty.call(definition, "compound")) {
      continue;
    }

    const itemLevel = nonNegativeInteger(item.level) ?? 0;
    const key = JSON.stringify([itemName, itemLevel]);
    const group = groups.get(key) || {
      itemName,
      itemLevel,
      entries: [],
    };
    group.entries.push({ slot: entry.slot, item });
    groups.set(key, group);
  }

  const result: CompoundGatherCandidate[] = [];
  for (const group of groups.values()) {
    const entries = group.entries
      .slice()
      .sort((left, right) => left.slot - right.slot);
    if (entries.length < 3) continue;

    const selected = entries.slice(0, 3);
    const grades = selected.map((entry) => game.itemGrade(entry.item));
    if (
      grades.some(
        (grade) =>
          grade === null ||
          !Number.isInteger(grade) ||
          Number(grade) < 0,
      ) ||
      !grades.every((grade) => grade === grades[0])
    ) {
      continue;
    }

    const itemGrade = grades[0] as number;
    const scrollName = `cscroll${itemGrade}`;
    const scrollEvidence = matchingInventoryEvidence(inventory, scrollName);
    result.push({
      source: "MERCHANT_INVENTORY",
      itemName: group.itemName,
      itemLevel: group.itemLevel,
      itemSlots: selected.map((entry) => entry.slot),
      monsterType: null,
      itemGrade,
      scrollName,
      scrollSlots: scrollEvidence.slots,
      scrollQuantity: scrollEvidence.quantity,
      dropChance: null,
      monsterHp: null,
      score: 0,
    });
  }

  return result.sort(
    (left, right) =>
      (left.itemSlots[0] ?? Number.MAX_SAFE_INTEGER) -
        (right.itemSlots[0] ?? Number.MAX_SAFE_INTEGER) ||
      left.itemName.localeCompare(right.itemName) ||
      left.itemLevel - right.itemLevel,
  );
}

function compoundableItemNames(
  itemDefinitions: Record<string, unknown>,
): string[] {
  return Object.entries(itemDefinitions)
    .filter(([, raw]) =>
      Object.prototype.hasOwnProperty.call(record(raw), "compound"),
    )
    .map(([name]) => name)
    .sort();
}

export function planCompoundGatherTarget(
  game: CompoundGatherGame,
): CompoundGatherPlan {
  const gameData = record(game.gameData());
  const itemDefinitions = record(gameData.items);
  const monsters = record(gameData.monsters);
  const dropTables = record(gameData.drops);
  const monsterDropTables = record(dropTables.monsters);
  const compoundable = new Set(compoundableItemNames(itemDefinitions));
  const regularSpawns = regularSpawnMonsterTypes(record(gameData.maps));
  const restrictToRegularSpawns = regularSpawns.size > 0;
  const position = observerPosition(game);
  const inventory = game.inventory ? game.inventory() : [];
  const candidates: CompoundGatherCandidate[] = inventoryTripleCandidates(
    game,
    itemDefinitions,
    inventory,
  );

  for (const [monsterType, rawMonster] of Object.entries(monsters)) {
    if (restrictToRegularSpawns && !regularSpawns.has(monsterType)) continue;
    const monster = record(rawMonster);
    const refs = dropReferences(
      monsterDropTables[monsterType] ??
        monster.drop ??
        monster.drops ??
        monster.loot,
      itemDefinitions,
      dropTables,
    );
    if (!refs.length) continue;

    const monsterHp = finite(monster.hp);
    for (const itemName of new Set(refs.map((entry) => entry.itemName))) {
      if (!compoundable.has(itemName)) continue;

      const itemGrade = game.itemGrade({ name: itemName, level: 0 });
      if (
        itemGrade === null ||
        !Number.isInteger(itemGrade) ||
        itemGrade < 0
      ) {
        continue;
      }

      const dropChance = bestDropChance(refs, itemName);
      const chanceWeight =
        dropChance !== null && dropChance > 0 ? dropChance : 0.000001;
      const hpWeight =
        monsterHp !== null && monsterHp > 0 ? monsterHp : 1000000;
      const scrollName = `cscroll${itemGrade}`;
      const scrollEvidence = matchingInventoryEvidence(inventory, scrollName);
      candidates.push({
        source: "MONSTER_DROP",
        itemName,
        itemLevel: 0,
        itemSlots: [],
        monsterType,
        itemGrade,
        scrollName,
        scrollSlots: scrollEvidence.slots,
        scrollQuantity: scrollEvidence.quantity,
        dropChance,
        monsterHp,
        score: chanceWeight / Math.max(1, hpWeight),
      });
    }
  }

  candidates.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "MERCHANT_INVENTORY" ? -1 : 1;
    }
    if (left.source === "MERCHANT_INVENTORY") {
      return (
        (left.itemSlots[0] ?? Number.MAX_SAFE_INTEGER) -
          (right.itemSlots[0] ?? Number.MAX_SAFE_INTEGER) ||
        left.itemName.localeCompare(right.itemName) ||
        left.itemLevel - right.itemLevel
      );
    }
    return (
      right.score - left.score ||
      (right.dropChance ?? -1) - (left.dropChance ?? -1) ||
      (left.monsterHp ?? Number.MAX_SAFE_INTEGER) -
        (right.monsterHp ?? Number.MAX_SAFE_INTEGER) ||
      left.itemName.localeCompare(right.itemName) ||
      (left.monsterType || "").localeCompare(right.monsterType || "")
    );
  });

  return candidates.length
    ? {
        outcome: "PASS",
        reason: "COMPOUND_GATHER_TARGET_SELECTED",
        selected: { ...candidates[0] },
        candidates: candidates.map((entry) => ({ ...entry })),
        observerPosition: position,
      }
    : {
        outcome: "FAIL",
        reason: "COMPOUND_GATHER_TARGET_NOT_FOUND",
        selected: null,
        candidates: [],
        observerPosition: position,
      };
}

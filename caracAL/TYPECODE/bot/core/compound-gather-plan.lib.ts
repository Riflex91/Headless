export interface CompoundGatherCandidate {
  itemName: string;
  monsterType: string;
  itemGrade: number;
  scrollName: string;
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
}

interface CompoundGatherGame {
  gameData(): Record<string, unknown>;
  itemGrade(item: Record<string, unknown>): number | null;
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
      const direct = dropReferences(
        value[1],
        itemDefinitions,
        dropTables,
        chance,
        visited,
      );
      const nested = value
        .slice(2)
        .flatMap((entry) =>
          dropReferences(
            entry,
            itemDefinitions,
            dropTables,
            chance,
            visited,
          ),
        );
      return [...direct, ...nested];
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
  const compoundable = new Set(compoundableItemNames(itemDefinitions));
  const candidates: CompoundGatherCandidate[] = [];

  for (const [monsterType, rawMonster] of Object.entries(monsters)) {
    const monster = record(rawMonster);
    const refs = dropReferences(
      monster.drop ?? monster.drops ?? monster.loot,
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
      candidates.push({
        itemName,
        monsterType,
        itemGrade,
        scrollName: `cscroll${itemGrade}`,
        dropChance,
        monsterHp,
        score: chanceWeight / Math.max(1, hpWeight),
      });
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      (right.dropChance ?? -1) - (left.dropChance ?? -1) ||
      (left.monsterHp ?? Number.MAX_SAFE_INTEGER) -
        (right.monsterHp ?? Number.MAX_SAFE_INTEGER) ||
      left.itemName.localeCompare(right.itemName) ||
      left.monsterType.localeCompare(right.monsterType),
  );

  return candidates.length
    ? {
        outcome: "PASS",
        reason: "COMPOUND_GATHER_TARGET_SELECTED",
        selected: { ...candidates[0] },
        candidates: candidates.map((entry) => ({ ...entry })),
      }
    : {
        outcome: "FAIL",
        reason: "COMPOUND_GATHER_TARGET_NOT_FOUND",
        selected: null,
        candidates: [],
      };
}

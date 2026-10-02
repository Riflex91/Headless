"use strict";

const MAP_SCENE_MAX_PLACEMENTS = 50000;
const NEARBY_ENTITY_RADIUS = 1400;
const NEARBY_ENTITY_LIMIT = 300;

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function publicTileDefinition(definition, gameData) {
  if (!Array.isArray(definition)) return null;
  const tileset = gameData?.tilesets?.[definition[0]];
  if (!tileset?.file) return null;

  const rawWidth = definition[3];
  const width = Array.isArray(rawWidth)
    ? finiteNumber(rawWidth[0])
    : finiteNumber(rawWidth);
  const height = Array.isArray(rawWidth)
    ? finiteNumber(rawWidth[1])
    : finiteNumber(definition[4]) ?? width;

  if (!width || !height) return null;

  return {
    tileset: definition[0],
    file: tileset.file,
    source_x: finiteNumber(definition[1]) ?? 0,
    source_y: finiteNumber(definition[2]) ?? 0,
    width,
    height,
  };
}

function publicMapPlacement(placement) {
  if (!Array.isArray(placement) || !Number.isInteger(placement[0])) return null;
  const x = finiteNumber(placement[1]);
  const y = finiteNumber(placement[2]);
  if (x === null || y === null) return null;

  const result = [placement[0], x, y];
  const x2 = finiteNumber(placement[3]);
  const y2 = finiteNumber(placement[4]);
  if (x2 !== null && y2 !== null) result.push(x2, y2);
  return result;
}

function publicMapNpcs(mapDefinition, gameData) {
  const result = [];

  for (const npc of mapDefinition?.npcs || []) {
    const id = typeof npc?.id === "string" ? npc.id : null;
    const name =
      (typeof npc?.name === "string" && npc.name) ||
      gameData?.npcs?.[id]?.name ||
      id ||
      "NPC";
    const rawPositions = Array.isArray(npc?.positions)
      ? npc.positions
      : Array.isArray(npc?.position)
      ? [npc.position]
      : [];

    for (const position of rawPositions) {
      if (!Array.isArray(position)) continue;
      const x = finiteNumber(position[0]);
      const y = finiteNumber(position[1]);
      if (x === null || y === null) continue;
      result.push({ id, name, x, y });
    }
  }

  return result;
}

function publicMapScene(gameContext) {
  const character = gameContext?.character;
  const mapName = character?.map || gameContext?.current_map || null;
  const geometry =
    gameContext?.GEO || gameContext?.G?.geometry?.[mapName] || null;
  const mapDefinition = gameContext?.G?.maps?.[mapName] || null;
  if (!mapName || !geometry || !Array.isArray(geometry.tiles)) return null;

  const normalizePlacements = (placements) =>
    (placements || [])
      .slice(0, MAP_SCENE_MAX_PLACEMENTS)
      .map(publicMapPlacement)
      .filter(Boolean);

  return {
    map: mapName,
    name: mapDefinition?.name || mapName,
    bounds: {
      min_x: finiteNumber(geometry.min_x),
      min_y: finiteNumber(geometry.min_y),
      max_x: finiteNumber(geometry.max_x),
      max_y: finiteNumber(geometry.max_y),
    },
    default_tile: Number.isInteger(geometry.default) ? geometry.default : null,
    tiles: geometry.tiles.map((definition) =>
      publicTileDefinition(definition, gameContext.G),
    ),
    placements: normalizePlacements(geometry.placements),
    animations: normalizePlacements(geometry.animations),
    groups: (geometry.groups || [])
      .slice(0, 5000)
      .map((group) => normalizePlacements(Array.isArray(group) ? group : []))
      .filter((group) => group.length > 0),
    npcs: publicMapNpcs(mapDefinition, gameContext.G),
    truncated:
      (geometry.placements || []).length > MAP_SCENE_MAX_PLACEMENTS ||
      (geometry.animations || []).length > MAP_SCENE_MAX_PLACEMENTS,
  };
}

function publicNearbyEntities(gameContext, radius = NEARBY_ENTITY_RADIUS) {
  const character = gameContext?.character;
  const characterX = finiteNumber(character?.real_x ?? character?.x);
  const characterY = finiteNumber(character?.real_y ?? character?.y);
  if (characterX === null || characterY === null) return [];

  return Object.entries(gameContext?.entities || {})
    .map(([id, entity]) => {
      if (!entity || entity.dead) return null;
      const kind = entity.mtype ? "monster" : entity.npc ? "npc" : null;
      if (!kind) return null;

      const x = finiteNumber(entity.real_x ?? entity.x);
      const y = finiteNumber(entity.real_y ?? entity.y);
      if (x === null || y === null) return null;

      const distance = Math.hypot(x - characterX, y - characterY);
      if (distance > radius) return null;

      const npcId =
        typeof entity.npc === "string"
          ? entity.npc
          : typeof entity.id === "string" && kind === "npc"
          ? entity.id
          : null;
      const name =
        entity.name ||
        (entity.mtype && gameContext?.G?.monsters?.[entity.mtype]?.name) ||
        (npcId && gameContext?.G?.npcs?.[npcId]?.name) ||
        entity.mtype ||
        npcId ||
        id;

      return {
        id,
        kind,
        name,
        mtype: entity.mtype || null,
        npc: npcId,
        x,
        y,
        hp: finiteNumber(entity.hp),
        max_hp: finiteNumber(entity.max_hp),
        target: entity.target || null,
        distance: Math.round(distance),
        engaged: entity.target === character.name,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, NEARBY_ENTITY_LIMIT);
}

module.exports = {
  MAP_SCENE_MAX_PLACEMENTS,
  NEARBY_ENTITY_LIMIT,
  NEARBY_ENTITY_RADIUS,
  publicMapNpcs,
  publicMapScene,
  publicNearbyEntities,
  publicTileDefinition,
};

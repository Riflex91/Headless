"use strict";

(function initMovementMap(globalScope) {
  const SVG_NS = "http://www.w3.org/2000/svg";

  function finitePoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
  }

  function availableMaps(characters) {
    return [
      ...new Set(
        (characters || [])
          .map((character) => character?.game?.map)
          .filter(Boolean),
      ),
    ].sort();
  }

  function filterTrail(character, mapName, since) {
    return (character?.movement_trail || []).filter(
      (point) =>
        finitePoint(point) &&
        point.map === mapName &&
        (!Number.isFinite(since) || point.timestamp >= since),
    );
  }

  function samePoint(left, right) {
    return (
      finitePoint(left) &&
      finitePoint(right) &&
      Math.hypot(left.x - right.x, left.y - right.y) < 0.01
    );
  }

  function plannedPath(character, mapName) {
    const game = character?.game;
    if (!game) return [];

    const runtimePlan = Array.isArray(game.runtime_planned_path)
      ? game.runtime_planned_path
      : [];
    const source =
      runtimePlan.length > 0 ? runtimePlan : game.planned_path || [];
    const points = source
      .filter(
        (point) => finitePoint(point) && (!point.map || point.map === mapName),
      )
      .map((point) => ({
        ...point,
        map: point.map || mapName,
      }));

    if (game.map === mapName && finitePoint(game)) {
      const current = {
        map: mapName,
        x: game.x,
        y: game.y,
      };
      if (!samePoint(current, points[0])) {
        points.unshift(current);
      }
    }

    const destination =
      game.runtime_planned_destination || game.planned_destination;
    if (
      destination &&
      (!destination.map || destination.map === mapName) &&
      finitePoint(destination)
    ) {
      const normalized = {
        ...destination,
        map: destination.map || mapName,
      };
      if (!samePoint(points[points.length - 1], normalized)) {
        points.push(normalized);
      }
    }

    return points;
  }

  function characterGeometry(character, mapName, since) {
    const game = character?.game;
    const current =
      game?.map === mapName && finitePoint(game)
        ? { x: game.x, y: game.y }
        : null;
    const trail = filterTrail(character, mapName, since);
    const plan = plannedPath(character, mapName);
    const target =
      current && finitePoint(game?.target)
        ? { x: game.target.x, y: game.target.y }
        : null;
    const safePoint =
      finitePoint(game?.safe_point) &&
      (!game.safe_point.map || game.safe_point.map === mapName)
        ? { x: game.safe_point.x, y: game.safe_point.y }
        : null;

    return {
      character,
      current,
      trail,
      plan,
      target,
      safePoint,
      heading: Number.isFinite(game?.heading) ? game.heading : null,
    };
  }

  function nearbyEntities(characters, mapName) {
    const entities = new Map();

    for (const character of characters || []) {
      if (character?.game?.map !== mapName) continue;
      for (const entity of character.game.nearby_entities || []) {
        if (!finitePoint(entity)) continue;
        if (!["monster", "npc"].includes(entity.kind)) continue;
        const key = [
          entity.kind,
          entity.id || entity.mtype || entity.npc || entity.name,
          Math.round(entity.x),
          Math.round(entity.y),
        ].join("|");
        const previous = entities.get(key);
        if (!previous || (entity.distance ?? Infinity) < (previous.distance ?? Infinity)) {
          entities.set(key, entity);
        }
      }
    }

    return [...entities.values()].sort(
      (left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity),
    );
  }

  function sceneNpcs(mapScene) {
    return (mapScene?.npcs || [])
      .filter(finitePoint)
      .map((npc) => ({
        ...npc,
        kind: "npc",
      }));
  }

  function pointInBounds(point, bounds) {
    return (
      finitePoint(point) &&
      !!bounds &&
      point.x >= bounds.minX &&
      point.x <= bounds.minX + bounds.width &&
      point.y >= bounds.minY &&
      point.y <= bounds.minY + bounds.height
    );
  }

  function computeBounds(geometries) {
    const points = [];

    for (const geometry of geometries || []) {
      if (geometry.current) points.push(geometry.current);
      if (geometry.target) points.push(geometry.target);
      if (geometry.safePoint) points.push(geometry.safePoint);
      points.push(...geometry.trail, ...geometry.plan);
    }

    if (points.length === 0) {
      return null;
    }

    let minX = Math.min(...points.map((point) => point.x));
    let maxX = Math.max(...points.map((point) => point.x));
    let minY = Math.min(...points.map((point) => point.y));
    let maxY = Math.max(...points.map((point) => point.y));

    const minSpan = 500;
    if (maxX - minX < minSpan) {
      const center = (minX + maxX) / 2;
      minX = center - minSpan / 2;
      maxX = center + minSpan / 2;
    }
    if (maxY - minY < minSpan) {
      const center = (minY + maxY) / 2;
      minY = center - minSpan / 2;
      maxY = center + minSpan / 2;
    }

    const paddingX = Math.max(80, (maxX - minX) * 0.12);
    const paddingY = Math.max(80, (maxY - minY) * 0.12);

    return {
      minX: minX - paddingX,
      minY: minY - paddingY,
      width: maxX - minX + paddingX * 2,
      height: maxY - minY + paddingY * 2,
    };
  }

  function createSvgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  }

  function appendPolyline(svg, points, className) {
    if (points.length < 2) return;
    const polyline = createSvgElement("polyline", {
      class: className,
      points: points.map((point) => `${point.x},${point.y}`).join(" "),
    });
    svg.append(polyline);
  }

  function appendFacing(svg, current, heading, className, markerLength) {
    if (!current || !Number.isFinite(heading)) return;

    const radians = (heading * Math.PI) / 180;
    const tip = {
      x: current.x + Math.cos(radians) * markerLength,
      y: current.y + Math.sin(radians) * markerLength,
    };
    const side = markerLength * 0.28;
    const back = markerLength * 0.34;
    const left = {
      x:
        tip.x -
        Math.cos(radians) * back +
        Math.cos(radians + Math.PI / 2) * side,
      y:
        tip.y -
        Math.sin(radians) * back +
        Math.sin(radians + Math.PI / 2) * side,
    };
    const right = {
      x:
        tip.x -
        Math.cos(radians) * back +
        Math.cos(radians - Math.PI / 2) * side,
      y:
        tip.y -
        Math.sin(radians) * back +
        Math.sin(radians - Math.PI / 2) * side,
    };

    svg.append(
      createSvgElement("line", {
        class: `${className} facing-line`,
        x1: current.x,
        y1: current.y,
        x2: tip.x,
        y2: tip.y,
      }),
    );
    svg.append(
      createSvgElement("polygon", {
        class: `${className} facing-arrow`,
        points: `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`,
      }),
    );
  }

  function appendEntityMarker(svg, entity, markerLength) {
    const marker = createSvgElement("g", {
      class:
        entity.kind === "monster"
          ? `map-entity-marker monster-marker${entity.engaged ? " engaged" : ""}`
          : "map-entity-marker npc-marker",
    });

    if (entity.kind === "monster") {
      marker.append(
        createSvgElement("circle", {
          cx: entity.x,
          cy: entity.y,
          r: markerLength * 0.15,
        }),
      );
    } else {
      const radius = markerLength * 0.17;
      marker.append(
        createSvgElement("polygon", {
          points: [
            `${entity.x},${entity.y - radius}`,
            `${entity.x + radius},${entity.y}`,
            `${entity.x},${entity.y + radius}`,
            `${entity.x - radius},${entity.y}`,
          ].join(" "),
        }),
      );
    }

    const label = createSvgElement("text", {
      x: entity.x + markerLength * 0.24,
      y: entity.y - markerLength * 0.2,
    });
    label.textContent =
      entity.name || entity.mtype || entity.npc || entity.id || entity.kind;
    marker.append(label);

    const title = createSvgElement("title");
    const health =
      Number.isFinite(entity.hp) && Number.isFinite(entity.max_hp)
        ? ` · HP ${entity.hp}/${entity.max_hp}`
        : "";
    title.textContent =
      `${label.textContent}${health}` +
      (Number.isFinite(entity.distance) ? ` · ${entity.distance}px` : "");
    marker.append(title);

    svg.append(marker);
  }

  function appendEntityLegend(legend, monsters, npcs) {
    const row = document.createElement("div");
    row.className = "movement-entity-summary";

    const monsterCount = document.createElement("span");
    monsterCount.className = "monster-summary";
    monsterCount.textContent = `Monster: ${monsters.length}`;

    const npcCount = document.createElement("span");
    npcCount.className = "npc-summary";
    npcCount.textContent = `NPCs: ${npcs.length}`;

    row.append(monsterCount, npcCount);
    legend.append(row);
  }

  function renderMovementMap({
    svg,
    backgroundCanvas,
    legend,
    emptyState,
    characters,
    mapName,
    trailMs,
    showTrail,
    showPlan,
    showFacing,
    showTarget,
    showMonsters,
    showNpcs,
    mapScene,
    now = Date.now(),
  }) {
    if (!svg || !legend || !emptyState) return;

    const since = now - trailMs;
    const geometries = (characters || [])
      .map((character) => characterGeometry(character, mapName, since))
      .filter(
        (geometry) =>
          geometry.current ||
          geometry.trail.length > 0 ||
          geometry.plan.length > 0,
      );
    const bounds = computeBounds(geometries);

    svg.replaceChildren();
    legend.replaceChildren();

    if (!bounds) {
      emptyState.hidden = false;
      if (backgroundCanvas) {
        const context = backgroundCanvas.getContext?.("2d");
        context?.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
      }
      return;
    }

    emptyState.hidden = true;
    svg.setAttribute(
      "viewBox",
      `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`,
    );

    const backgroundApi = globalScope?.HeadlessOriginalMapBackground;
    if (backgroundCanvas && backgroundApi?.renderOriginalMapBackground) {
      void backgroundApi.renderOriginalMapBackground({
        canvas: backgroundCanvas,
        scene: mapScene,
        bounds,
      });
    }

    const gridSize = 100;
    const gridGroup = createSvgElement("g", { class: "map-grid" });
    const startX = Math.floor(bounds.minX / gridSize) * gridSize;
    const endX = bounds.minX + bounds.width;
    const startY = Math.floor(bounds.minY / gridSize) * gridSize;
    const endY = bounds.minY + bounds.height;

    for (let x = startX; x <= endX; x += gridSize) {
      gridGroup.append(
        createSvgElement("line", {
          x1: x,
          y1: bounds.minY,
          x2: x,
          y2: endY,
        }),
      );
    }
    for (let y = startY; y <= endY; y += gridSize) {
      gridGroup.append(
        createSvgElement("line", {
          x1: bounds.minX,
          y1: y,
          x2: endX,
          y2: y,
        }),
      );
    }
    svg.append(gridGroup);

    const markerLength = Math.max(
      28,
      Math.min(bounds.width, bounds.height) * 0.05,
    );

    const liveEntities = nearbyEntities(characters, mapName).filter((entity) =>
      pointInBounds(entity, bounds),
    );
    const monsters = liveEntities.filter((entity) => entity.kind === "monster");
    const npcMap = new Map();
    for (const npc of sceneNpcs(mapScene).concat(
      liveEntities.filter((entity) => entity.kind === "npc"),
    )) {
      if (!pointInBounds(npc, bounds)) continue;
      const key = [
        npc.id || npc.npc || npc.name,
        Math.round(npc.x),
        Math.round(npc.y),
      ].join("|");
      npcMap.set(key, npc);
    }
    const npcs = [...npcMap.values()];

    if (showMonsters) {
      for (const monster of monsters) {
        appendEntityMarker(svg, monster, markerLength);
      }
    }
    if (showNpcs) {
      for (const npc of npcs) {
        appendEntityMarker(svg, npc, markerLength);
      }
    }

    geometries.forEach((geometry, index) => {
      const character = geometry.character;
      const className = `character-color-${index % 8}`;

      if (showTrail) {
        appendPolyline(svg, geometry.trail, `${className} actual-trail`);
      }
      if (showPlan) {
        appendPolyline(svg, geometry.plan, `${className} planned-path`);
        for (const waypoint of geometry.plan.slice(1)) {
          svg.append(
            createSvgElement("circle", {
              class: `${className} planned-waypoint`,
              cx: waypoint.x,
              cy: waypoint.y,
              r: markerLength * 0.11,
            }),
          );
        }
      }
      if (showTarget && geometry.current && geometry.target) {
        appendPolyline(
          svg,
          [geometry.current, geometry.target],
          `${className} target-line`,
        );
      }
      if (showFacing) {
        appendFacing(
          svg,
          geometry.current,
          geometry.heading,
          className,
          markerLength,
        );
      }

      if (geometry.safePoint) {
        svg.append(
          createSvgElement("circle", {
            class: `${className} safe-point-marker`,
            cx: geometry.safePoint.x,
            cy: geometry.safePoint.y,
            r: markerLength * 0.18,
          }),
        );
      }

      if (geometry.current) {
        const marker = createSvgElement("g", {
          class: `character-marker ${className}`,
        });
        marker.append(
          createSvgElement("circle", {
            cx: geometry.current.x,
            cy: geometry.current.y,
            r: markerLength * 0.22,
          }),
        );
        const label = createSvgElement("text", {
          x: geometry.current.x + markerLength * 0.32,
          y: geometry.current.y - markerLength * 0.25,
        });
        label.textContent = character.name;
        marker.append(label);
        svg.append(marker);
      }

      const row = document.createElement("div");
      const game = character.game || {};
      row.className = `movement-legend-row${
        game.movement_stuck?.stuck ? " movement-stuck" : ""
      }`;
      const dot = document.createElement("span");
      dot.className = `movement-legend-dot ${className}`;
      const text = document.createElement("span");
      const mode = game.movement_mode || game.movement_state || "IDLE";
      const owner = game.movement_owner ? ` · ${game.movement_owner}` : "";
      const reason = game.movement_reason ? ` · ${game.movement_reason}` : "";
      text.textContent = `${character.name} · ${mode}${owner} · ${Math.round(
        game.x ?? 0,
      )}, ${Math.round(game.y ?? 0)}${reason}`;
      row.append(dot, text);
      legend.append(row);
    });

    appendEntityLegend(
      legend,
      showMonsters ? monsters : [],
      showNpcs ? npcs : [],
    );
  }

  const api = {
    availableMaps,
    characterGeometry,
    computeBounds,
    filterTrail,
    finitePoint,
    nearbyEntities,
    plannedPath,
    pointInBounds,
    renderMovementMap,
    sceneNpcs,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.HeadlessMovementMap = api;
  }
})(typeof window !== "undefined" ? window : globalThis);

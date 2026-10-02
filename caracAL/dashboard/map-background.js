"use strict";

(function initOriginalMapBackground(globalScope) {
  const imagePromises = new Map();
  const tileCanvases = new Map();

  function assetUrl(file) {
    return (
      "/headless/api/assets/adventure-land?path=" +
      encodeURIComponent(file || "")
    );
  }

  function collectSceneAssetFiles(scene) {
    return [
      ...new Set(
        (scene?.tiles || [])
          .map((tile) => tile?.file)
          .filter((file) => typeof file === "string" && file),
      ),
    ].sort();
  }

  function placementBounds(scene, placement) {
    if (!Array.isArray(placement)) return null;
    const tile = scene?.tiles?.[placement[0]];
    if (!tile) return null;
    return {
      minX: placement[1],
      minY: placement[2],
      maxX: Number.isFinite(placement[3])
        ? placement[3] + tile.width
        : placement[1] + tile.width,
      maxY: Number.isFinite(placement[4])
        ? placement[4] + tile.height
        : placement[2] + tile.height,
    };
  }

  function placementIntersectsBounds(scene, placement, bounds) {
    const area = placementBounds(scene, placement);
    if (!area || !bounds) return false;
    return !(
      area.maxX < bounds.minX ||
      area.minX > bounds.minX + bounds.width ||
      area.maxY < bounds.minY ||
      area.minY > bounds.minY + bounds.height
    );
  }

  function scenePlacements(scene, bounds) {
    const result = [];
    const append = (list) => {
      for (const placement of list || []) {
        if (placementIntersectsBounds(scene, placement, bounds)) {
          result.push(placement);
        }
      }
    };
    append(scene?.placements);
    append(scene?.animations);
    for (const group of scene?.groups || []) append(group);
    return result;
  }

  function imageFor(file) {
    if (!imagePromises.has(file)) {
      imagePromises.set(
        file,
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = assetUrl(file);
        }),
      );
    }
    return imagePromises.get(file);
  }

  function tileCanvas(tile, image) {
    const key = [
      tile.file,
      tile.source_x,
      tile.source_y,
      tile.width,
      tile.height,
    ].join("|");
    if (tileCanvases.has(key)) return tileCanvases.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = tile.width;
    canvas.height = tile.height;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(
      image,
      tile.source_x,
      tile.source_y,
      tile.width,
      tile.height,
      0,
      0,
      tile.width,
      tile.height,
    );
    tileCanvases.set(key, canvas);
    return canvas;
  }

  function drawPlacement(context, scene, placement, images) {
    const tile = scene.tiles?.[placement[0]];
    const image = tile && images.get(tile.file);
    if (!tile || !image) return;

    const texture = tileCanvas(tile, image);
    if (!Number.isFinite(placement[3]) || !Number.isFinite(placement[4])) {
      context.drawImage(texture, placement[1], placement[2]);
      return;
    }

    context.save();
    context.translate(placement[1], placement[2]);
    context.fillStyle = context.createPattern(texture, "repeat");
    context.fillRect(
      0,
      0,
      placement[3] - placement[1] + tile.width,
      placement[4] - placement[2] + tile.height,
    );
    context.restore();
  }

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? Math.max(1, window.devicePixelRatio)
        : 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height };
  }

  async function renderOriginalMapBackground({ canvas, scene, bounds }) {
    if (!canvas || !bounds) return false;

    const context = canvas.getContext("2d");
    const size = resizeCanvas(canvas);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#080b0d";
    context.fillRect(0, 0, size.width, size.height);
    if (!scene?.tiles?.length) return false;

    const images = new Map();
    await Promise.all(
      collectSceneAssetFiles(scene).map(async (file) => {
        try {
          images.set(file, await imageFor(file));
        } catch (_error) {
          images.set(file, null);
        }
      }),
    );

    const scale = Math.min(
      size.width / bounds.width,
      size.height / bounds.height,
    );
    const offsetX = (size.width - bounds.width * scale) / 2;
    const offsetY = (size.height - bounds.height * scale) / 2;

    context.save();
    context.imageSmoothingEnabled = false;
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);
    context.translate(-bounds.minX, -bounds.minY);

    const defaultTile = Number.isInteger(scene.default_tile)
      ? scene.tiles[scene.default_tile]
      : null;
    const defaultImage = defaultTile && images.get(defaultTile.file);
    if (defaultTile && defaultImage) {
      const texture = tileCanvas(defaultTile, defaultImage);
      context.save();
      context.translate(bounds.minX, bounds.minY);
      context.fillStyle = context.createPattern(texture, "repeat");
      context.fillRect(0, 0, bounds.width, bounds.height);
      context.restore();
    }

    for (const placement of scenePlacements(scene, bounds)) {
      drawPlacement(context, scene, placement, images);
    }

    context.restore();
    return true;
  }

  const api = {
    assetUrl,
    collectSceneAssetFiles,
    imageFor,
    placementBounds,
    placementIntersectsBounds,
    renderOriginalMapBackground,
    scenePlacements,
    tileCanvas,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.HeadlessOriginalMapBackground = api;
})(typeof window !== "undefined" ? window : globalThis);

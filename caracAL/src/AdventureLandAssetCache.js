"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const AL_BASE_URL = "https://adventure.land";
function validateAdventureLandAssetPath(assetPath) {
  const value = String(assetPath || "").trim();
  let parsed;

  try {
    parsed = new URL(value, AL_BASE_URL);
  } catch (_error) {
    parsed = null;
  }

  const allowedPrefixes = [
    "/images/tiles/items/",
    "/images/tiles/map/",
    "/images/tiles/monsters/",
  ];
  const valid =
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("..") &&
    parsed?.origin === AL_BASE_URL &&
    allowedPrefixes.some((prefix) => parsed.pathname.startsWith(prefix)) &&
    /\.(?:png|webp)$/i.test(parsed.pathname);

  if (!valid) {
    const error = new Error("Unsupported Adventure Land asset path");
    error.code = "INVALID_ASSET_PATH";
    error.statusCode = 400;
    throw error;
  }

  return `${parsed.pathname}${parsed.search}`;
}

function assetCacheFilename(assetPath) {
  const safePath = validateAdventureLandAssetPath(assetPath);
  const parsed = new URL(safePath, AL_BASE_URL);
  const extension = path.extname(parsed.pathname).toLowerCase() || ".bin";
  const baseName =
    path
      .basename(parsed.pathname, extension)
      .replace(/[^A-Za-z0-9._-]/g, "_") || "asset";
  const digest = crypto
    .createHash("sha256")
    .update(safePath)
    .digest("hex")
    .slice(0, 16);
  return `${baseName}-${digest}${extension}`;
}

function contentTypeForAsset(assetPath) {
  const pathname = new URL(
    validateAdventureLandAssetPath(assetPath),
    AL_BASE_URL,
  ).pathname.toLowerCase();
  if (pathname.endsWith(".webp")) return "image/webp";
  return "image/png";
}

class AdventureLandAssetCache {
  constructor({ cacheDir, fetchImpl, baseUrl = AL_BASE_URL } = {}) {
    if (!cacheDir) {
      throw new Error("AdventureLandAssetCache requires cacheDir");
    }
    this.cacheDir = cacheDir;
    this.baseUrl = baseUrl;
    this.fetchImpl =
      fetchImpl ||
      ((...args) =>
        import("node-fetch").then(({ default: fetch }) => fetch(...args)));
    this.inflight = new Map();
  }

  async ensure(assetPath) {
    const safePath = validateAdventureLandAssetPath(assetPath);
    const filename = assetCacheFilename(safePath);
    const localPath = path.join(this.cacheDir, filename);

    try {
      await fs.access(localPath);
      return {
        path: localPath,
        contentType: contentTypeForAsset(safePath),
        cacheHit: true,
      };
    } catch (_error) {
      // Cache miss.
    }

    if (!this.inflight.has(safePath)) {
      this.inflight.set(
        safePath,
        this.download(safePath, localPath).finally(() => {
          this.inflight.delete(safePath);
        }),
      );
    }

    await this.inflight.get(safePath);
    return {
      path: localPath,
      contentType: contentTypeForAsset(safePath),
      cacheHit: false,
    };
  }

  async download(assetPath, localPath) {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const response = await this.fetchImpl(new URL(assetPath, this.baseUrl));

    if (!response.ok) {
      throw new Error(
        `failed to download Adventure Land asset: ${response.status} ${response.statusText}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempPath = `${localPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, localPath);
  }
}

module.exports = {
  AL_BASE_URL,
  AdventureLandAssetCache,
  assetCacheFilename,
  contentTypeForAsset,
  validateAdventureLandAssetPath,
};

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AdventureLandAssetCache,
  assetCacheFilename,
  contentTypeForAsset,
  validateAdventureLandAssetPath,
} = require("../src/AdventureLandAssetCache");

test("Adventure Land asset validation accepts item sprites only", () => {
  assert.equal(
    validateAdventureLandAssetPath("/images/tiles/items/pack_20vt8.png"),
    "/images/tiles/items/pack_20vt8.png",
  );
  assert.equal(
    validateAdventureLandAssetPath("/images/tiles/items/custom.png?v=12"),
    "/images/tiles/items/custom.png?v=12",
  );

  for (const invalid of [
    "https://evil.example/items.png",
    "//evil.example/items.png",
    "/images/tiles/map/custom.png",
    "/images/tiles/items/../../secrets.png",
    "../images/tiles/items/pack.png",
    "/images/tiles/items/not-an-image.js",
  ]) {
    assert.throws(
      () => validateAdventureLandAssetPath(invalid),
      (error) =>
        error.code === "INVALID_ASSET_PATH" && error.statusCode === 400,
    );
  }
});

test("asset cache filenames are deterministic and version-aware", () => {
  const first = assetCacheFilename("/images/tiles/items/custom.png?v=1");
  const same = assetCacheFilename("/images/tiles/items/custom.png?v=1");
  const second = assetCacheFilename("/images/tiles/items/custom.png?v=2");

  assert.equal(first, same);
  assert.notEqual(first, second);
  assert.match(first, /^custom-[a-f0-9]{16}\.png$/);
});

test("asset content type follows the validated file extension", () => {
  assert.equal(
    contentTypeForAsset("/images/tiles/items/pack.png"),
    "image/png",
  );
  assert.equal(
    contentTypeForAsset("/images/tiles/items/pack.webp?v=3"),
    "image/webp",
  );
});

test("asset cache downloads once and serves the local copy afterwards", async () => {
  const cacheDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "caracal-asset-cache-"),
  );
  let fetchCount = 0;

  const cache = new AdventureLandAssetCache({
    cacheDir,
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => Buffer.from("fake-png"),
      };
    },
  });

  try {
    const first = await cache.ensure("/images/tiles/items/pack_20vt8.png");
    const second = await cache.ensure("/images/tiles/items/pack_20vt8.png");

    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(fetchCount, 1);
    assert.equal(await fs.readFile(first.path, "utf8"), "fake-png");
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});

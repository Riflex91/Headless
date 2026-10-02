"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  FileRevisionCache,
  createConfigRevision,
  resolveCharacterScriptPath,
  revisionStatus,
  stableStringify,
} = require("../src/RuntimeRevision");

test("config revision is stable and excludes secret values", () => {
  const first = createConfigRevision({
    session: "user-secret-one",
    web_app: { port: 924 },
    characters: {
      My_Ranger1: { enabled: true, typescript: "bot/main.js" },
    },
  });
  const second = createConfigRevision({
    session: "user-secret-two",
    characters: {
      My_Ranger1: { typescript: "bot/main.js", enabled: true },
    },
    web_app: { port: 924 },
  });
  const changed = createConfigRevision({
    session: "user-secret-two",
    web_app: { port: 925 },
    characters: {
      My_Ranger1: { enabled: true, typescript: "bot/main.js" },
    },
  });

  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.match(first, /^cfg-[a-f0-9]{12}$/);
});

test("stable stringify ignores object key order", () => {
  assert.equal(
    stableStringify({ b: 2, a: { d: 4, c: 3 } }),
    stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("file revision cache changes only when bundle content changes", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "caracal-revision-"));
  const filePath = path.join(root, "main.js");
  const cache = new FileRevisionCache();

  try {
    await fsp.writeFile(filePath, "first", "utf8");
    const first = cache.revision(filePath);
    const repeated = cache.revision(filePath);

    assert.equal(first, repeated);
    assert.match(first, /^sha256-[a-f0-9]{12}$/);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await fsp.writeFile(filePath, "second-version", "utf8");
    const second = cache.revision(filePath);

    assert.notEqual(first, second);
    assert.equal(cache.revision(path.join(root, "missing.js")), null);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("character script path follows actual TYPECODE or CODE mode", () => {
  const root = path.join("D:", "caracAL");

  assert.equal(
    resolveCharacterScriptPath(
      root,
      { typescript: "bot/main.js", script: "legacy.js" },
      true,
    ),
    path.join(root, "TYPECODE.out", "bot/main.js"),
  );

  assert.equal(
    resolveCharacterScriptPath(root, { script: "legacy.js" }, false),
    path.join(root, "CODE", "legacy.js"),
  );
});

test("revision status distinguishes healthy stale and unknown", () => {
  assert.equal(
    revisionStatus({
      runningCodeRevision: "code-a",
      installedCodeRevision: "code-a",
      runningConfigRevision: "cfg-a",
      installedConfigRevision: "cfg-a",
    }),
    "HEALTHY",
  );

  assert.equal(
    revisionStatus({
      runningCodeRevision: "code-a",
      installedCodeRevision: "code-b",
      runningConfigRevision: "cfg-a",
      installedConfigRevision: "cfg-a",
    }),
    "STALE",
  );

  assert.equal(
    revisionStatus({
      runningCodeRevision: null,
      installedCodeRevision: "code-a",
      runningConfigRevision: "cfg-a",
      installedConfigRevision: "cfg-a",
    }),
    "UNKNOWN",
  );
});

test("FileRevisionCache accepts the real fs implementation contract", () => {
  const cache = new FileRevisionCache({ fsImpl: fs });
  assert.equal(typeof cache.revision, "function");
});

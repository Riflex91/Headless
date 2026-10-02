"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  get_game_files,
  get_game_files_after_html_vars,
  get_game_files_before_html_vars,
  get_required_files,
  get_runner_files,
  missing_version_files,
} = require("../game_files");

test("game runtime dependencies follow the current Adventure Land load order", () => {
  const before = get_game_files_before_html_vars();
  const after = get_game_files_after_html_vars();
  const files = get_game_files();

  assert.ok(before.indexOf("/js/phrases.js") < before.indexOf("/js/game.js"));
  assert.ok(
    before.indexOf("/js/common_functions.js") <
      before.indexOf("/js/old_common_functions.js"),
  );
  assert.ok(
    before.indexOf("/js/old_common_functions.js") <
      before.indexOf("/js/functions.js"),
  );
  assert.ok(
    before.indexOf("/js/functions.js") <
      before.indexOf("/js/generated_zones.js"),
  );
  assert.ok(
    before.indexOf("/js/generated_zones.js") < before.indexOf("/js/game.js"),
  );
  assert.ok(
    before.indexOf("/js/entity_animations.js") < before.indexOf("/js/game.js"),
  );
  assert.deepEqual(after, [
    "/js/pixel_fonts.js",
    "/js/npc_obstruction_hint.js",
  ]);
  assert.deepEqual(files, before.concat(after));
});

test("character thread loads html vars between official pre/post scripts", () => {
  const source = require("node:fs").readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  const before = source.indexOf(
    "await ev_files(game_sources_before_html_vars, game_context);",
  );
  const htmlVars = source.indexOf(
    'await ev_files(["./html_vars.js"], game_context);',
  );
  const after = source.indexOf(
    "await ev_files(game_sources_after_html_vars, game_context);",
  );

  assert.ok(before >= 0);
  assert.ok(before < htmlVars);
  assert.ok(htmlVars < after);
});

test("runner loads legacy common helpers before runner functions", () => {
  const files = get_runner_files();

  assert.deepEqual(files.slice(0, 3), [
    "/js/common_functions.js",
    "/js/old_common_functions.js",
    "/js/runner_functions.js",
  ]);
});

test("required version files are unique across game and runner sources", () => {
  const files = get_required_files();
  assert.equal(files.length, new Set(files).size);
  assert.ok(files.includes("/js/phrases.js"));
  assert.ok(files.includes("/js/old_common_functions.js"));
  assert.ok(files.includes("/js/generated_zones.js"));
  assert.ok(files.includes("/js/entity_animations.js"));
  assert.ok(files.includes("/js/progression/runtime.js"));
  assert.ok(files.includes("/js/tavern_poker.js"));
  assert.ok(files.includes("/js/npc_obstruction_hint.js"));
});

test("cached versions report newly required runtime files as missing", async () => {
  const previousCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "caracal-game-files-"));
  const version = 17397;

  try {
    process.chdir(root);
    await fs.mkdir(path.join("game_files", String(version)), {
      recursive: true,
    });

    for (const resource of get_required_files()) {
      if (
        resource === "/js/generated_zones.js" ||
        resource === "/js/entity_animations.js" ||
        resource === "/js/pixel_fonts.js" ||
        resource === "/js/npc_obstruction_hint.js"
      ) {
        continue;
      }

      await fs.writeFile(
        path.join("game_files", String(version), path.posix.basename(resource)),
        "",
      );
    }

    assert.deepEqual(await missing_version_files(version), [
      "/js/generated_zones.js",
      "/js/entity_animations.js",
      "/js/pixel_fonts.js",
      "/js/npc_obstruction_hint.js",
    ]);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
});

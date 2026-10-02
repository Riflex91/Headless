const base_url = "https://adventure.land";
const fs = require("fs").promises;
const { createWriteStream } = require("fs");
const { pipeline } = require("stream");
const { promisify } = require("util");
const streamPipeline = promisify(pipeline);
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const path = require("path");
const { console } = require("./src/LogUtils");

function get_runner_files() {
  return [
    "/js/common_functions.js",
    "/js/old_common_functions.js",
    "/js/runner_functions.js",
    "/js/runner_compat.js",
  ];
}

function get_game_files_before_html_vars() {
  return [
    "/js/phrases.js",
    "/js/pixi/fake/pixi.min.js",
    "/js/libraries/combined.js",
    "/js/codemirror/fake/codemirror.js",

    "/js/common_functions.js",
    "/js/old_common_functions.js",
    "/js/functions.js",
    "/js/generated_zones.js",
    "/js/entity_animations.js",
    "/js/game.js",
    "/js/html.js",
    "/js/progression/sources.js",
    "/js/progression/stats.js",
    "/js/progression/engine.js",
    "/js/progression/runtime.js",
    "/js/progression/ui.js",
    "/js/merrit_stand_notice.js",
    "/js/tavern_wheel.js",
    "/js/tavern_slots.js",
    "/js/tavern_poker.js",
    "/js/payments.js",
    "/js/keyboard.js",
    "/data.js",
  ];
}

function get_game_files_after_html_vars() {
  return ["/js/pixel_fonts.js", "/js/npc_obstruction_hint.js"];
}

function get_game_files() {
  return get_game_files_before_html_vars().concat(
    get_game_files_after_html_vars(),
  );
}

function get_required_files() {
  return get_game_files()
    .concat(get_runner_files())
    .filter(function (item, pos, self) {
      return self.indexOf(item) == pos;
    });
}

async function cull_versions(exclusions) {
  const all_versions = await available_versions();
  const target_culls = all_versions.filter(
    (x, i) => i >= 2 && !exclusions.includes(x),
  );
  for (let cull of target_culls) {
    try {
      console.log("culling version " + cull);
      await fs.rmdir("./game_files/" + cull, { recursive: true });
    } catch (e) {
      console.warn("failed to cull version " + cull, e);
    }
  }
}

async function available_versions() {
  try {
    return (await fs.readdir("./game_files", { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .filter((x) => x.match(/^\d+$/))
      .map((x) => parseInt(x))
      .sort()
      .reverse();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function download_file(url, file_p) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`failed to download ${url}: ${response.statusText}`);
  }

  return await streamPipeline(response.body, createWriteStream(file_p));
}

async function get_latest_version() {
  const raw = await fetch(base_url);
  if (!raw.ok) {
    throw new Error(`failed to check version: ${raw.statusText}`);
  }
  const html = await raw.text();
  const match = /game\.js\?v=([0-9]+)"/.exec(html);
  if (!match) {
    throw new Error("malformed version response");
  }
  return parseInt(match[1]);
}

function locate_game_file(resource, version) {
  return `./game_files/${version}/${path.posix.basename(resource)}`;
}

async function missing_version_files(version) {
  const missing = [];

  for (const resource of get_required_files()) {
    try {
      await fs.access(locate_game_file(resource, version));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(resource);
    }
  }

  return missing;
}

async function download_version_files(version, resources) {
  const fpath = "./game_files/" + version;
  await fs.mkdir(fpath, { recursive: true });

  await Promise.all(
    resources.map((resource) =>
      download_file(base_url + resource, locate_game_file(resource, version)),
    ),
  );
}

async function ensure_latest() {
  const version = await get_latest_version();
  const existing = (await available_versions()).includes(version);

  if (existing) {
    const missing = await missing_version_files(version);
    if (!missing.length) {
      console.log(`version ${version} is already downloaded`);
      return version;
    }

    console.log(
      `repairing version ${version}: downloading ${missing.length} missing files`,
    );
    await download_version_files(version, missing);
    return version;
  }

  console.log(`downloading version ${version}`);
  const fpath = "./game_files/" + version;
  try {
    await download_version_files(version, get_required_files());
  } catch (error) {
    await fs.rm(fpath, { recursive: true, force: true });
    throw error;
  }

  return version;
}

exports.cull_versions = cull_versions;
exports.available_versions = available_versions;
exports.ensure_latest = ensure_latest;
exports.locate_game_file = locate_game_file;
exports.get_runner_files = get_runner_files;
exports.get_game_files = get_game_files;
exports.get_game_files_before_html_vars = get_game_files_before_html_vars;
exports.get_game_files_after_html_vars = get_game_files_after_html_vars;
exports.get_required_files = get_required_files;
exports.missing_version_files = missing_version_files;

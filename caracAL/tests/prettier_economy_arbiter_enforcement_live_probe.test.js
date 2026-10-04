"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

function compactDelta(source, formatted) {
  let prefix = 0;
  const maxPrefix = Math.min(source.length, formatted.length);
  while (prefix < maxPrefix && source[prefix] === formatted[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(
    source.length - prefix,
    formatted.length - prefix,
  );
  while (
    suffix < maxSuffix &&
    source[source.length - 1 - suffix] ===
      formatted[formatted.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const replacement = formatted.slice(
    prefix,
    suffix > 0 ? formatted.length - suffix : formatted.length,
  );
  return {
    prefix,
    suffix,
    replacement: Buffer.from(replacement).toString("base64"),
  };
}

test("print compact Prettier deltas for Economy Arbiter enforcement live files", async () => {
  for (const relative of [
    "../standalones/CharacterCoordinator.js",
    "economy_arbiter_enforcement_live_launcher.test.js",
  ]) {
    const file = path.join(__dirname, relative);
    const source = fs.readFileSync(file, "utf8");
    const formatted = await prettier.format(source, { filepath: file });
    console.log(
      `PRETTIER_DELTA ${path.basename(file)} ${JSON.stringify(
        compactDelta(source, formatted),
      )}`,
    );
  }
});

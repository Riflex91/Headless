"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

test("print compact Prettier delta for coupled Prebuff coordinator", async () => {
  const file = path.join(
    __dirname,
    "..",
    "standalones",
    "CharacterCoordinator.js",
  );
  const source = fs.readFileSync(file, "utf8");
  const formatted = await prettier.format(source, { filepath: file });
  let prefix = 0;
  while (
    prefix < source.length &&
    prefix < formatted.length &&
    source[prefix] === formatted[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < source.length - prefix &&
    suffix < formatted.length - prefix &&
    source[source.length - 1 - suffix] ===
      formatted[formatted.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const replacement = formatted.slice(prefix, formatted.length - suffix);
  console.log(
    "PRETTIER_DELTA CharacterCoordinator.js " +
      JSON.stringify({
        prefix,
        suffix,
        replacement: Buffer.from(replacement).toString("base64"),
      }),
  );
});

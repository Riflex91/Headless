"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints canonical coordinator chunk 37 in small pieces", async () => {
  const prettier = require("prettier");
  const target = path.join(
    __dirname,
    "..",
    "standalones",
    "CharacterCoordinator.js",
  );
  const source = fs.readFileSync(target, "utf8");
  const formatted = await prettier.format(source, { filepath: target });
  const encoded = Buffer.from(formatted, "utf8").toString("base64");
  const chunk = encoded.slice(37 * 3000, 38 * 3000);
  const size = 400;
  const total = Math.ceil(chunk.length / size);
  for (let index = 0; index < total; index += 1) {
    console.log(
      "PRETTIER_COORD_37:" +
        index +
        ":" +
        total +
        ":" +
        chunk.slice(index * size, (index + 1) * size),
    );
  }
});

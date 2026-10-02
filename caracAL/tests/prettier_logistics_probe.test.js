"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints missing Phase 11 coordinator prettier chunk", async () => {
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
  const chunk = encoded.slice(798 * 200, 799 * 200);
  const size = 100;
  const total = Math.ceil(chunk.length / size);

  for (let index = 0; index < total; index += 1) {
    console.log(
      "PRETTIER_P11_COORD798:" +
        index +
        ":" +
        total +
        ":" +
        chunk.slice(index * size, (index + 1) * size),
    );
  }
});

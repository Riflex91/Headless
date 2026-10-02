"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints canonical coordinator formatting in chunks", async () => {
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
  const size = 3000;
  const total = Math.ceil(encoded.length / size);
  for (let index = 0; index < total; index += 1) {
    console.log(
      "PRETTIER_COORD_CHUNK:" +
        index +
        ":" +
        total +
        ":" +
        encoded.slice(index * size, (index + 1) * size),
    );
  }
});

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints missing coordinator formatting chunks safely", async () => {
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
  const chunkSize = 200;
  const pieceSize = 50;

  for (const chunkIndex of [441, 714, 987]) {
    const chunk = encoded.slice(
      chunkIndex * chunkSize,
      (chunkIndex + 1) * chunkSize,
    );
    const total = Math.ceil(chunk.length / pieceSize);
    for (let index = 0; index < total; index += 1) {
      console.log(
        "PRETTIER_P11_EXEC_FIX:" +
          chunkIndex +
          ":" +
          index +
          ":" +
          total +
          ":" +
          chunk.slice(index * pieceSize, (index + 1) * pieceSize),
      );
    }
  }
});

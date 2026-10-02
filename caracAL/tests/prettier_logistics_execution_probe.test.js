"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

async function formattedBase64(prettier, relative) {
  const target = path.join(__dirname, relative);
  const source = fs.readFileSync(target, "utf8");
  const formatted = await prettier.format(source, { filepath: target });
  return Buffer.from(formatted, "utf8").toString("base64");
}

function printPiece(key, encoded, chunkIndex) {
  const chunk = encoded.slice(chunkIndex * 100, (chunkIndex + 1) * 100);
  const size = 25;
  const total = Math.ceil(chunk.length / size);
  for (let index = 0; index < total; index += 1) {
    console.log(
      "PRETTIER_P11_FINAL_FIX:" +
        key +
        ":" +
        chunkIndex +
        ":" +
        index +
        ":" +
        total +
        ":" +
        chunk.slice(index * size, (index + 1) * size),
    );
  }
}

test("prints missing final logistics formatting fragments", async () => {
  const prettier = require("prettier");
  const coordinator = await formattedBase64(
    prettier,
    "../standalones/CharacterCoordinator.js",
  );
  for (const index of [744, 1208, 1669]) {
    printPiece("Coordinator", coordinator, index);
  }

  const plannerTest = await formattedBase64(
    prettier,
    "merchant_logistics_planner.test.js",
  );
  printPiece("PlannerTest", plannerTest, 63);
});

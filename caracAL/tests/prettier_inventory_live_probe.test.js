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

function printChunks(key, encoded, size) {
  const total = Math.ceil(encoded.length / size);
  for (let index = 0; index < total; index += 1) {
    console.log(
      "PRETTIER_INV2:" +
        key +
        ":" +
        index +
        ":" +
        total +
        ":" +
        encoded.slice(index * size, (index + 1) * size),
    );
  }
}

test("prints remaining canonical inventory live formatting safely", async () => {
  const prettier = require("prettier");

  printChunks(
    "SourceInventoryLiveTest",
    await formattedBase64(prettier, "../src/InventoryLiveTest.js"),
    200,
  );
  printChunks(
    "TestInventoryLiveTest",
    await formattedBase64(prettier, "inventory_live_test.test.js"),
    200,
  );

  const coordinator = await formattedBase64(
    prettier,
    "../standalones/CharacterCoordinator.js",
  );
  for (const chunkIndex of [236, 403]) {
    const chunk = coordinator.slice(chunkIndex * 400, (chunkIndex + 1) * 400);
    printChunks("Coordinator" + chunkIndex, chunk, 100);
  }
});

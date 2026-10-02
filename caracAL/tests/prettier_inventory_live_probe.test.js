"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints canonical inventory live formatting in safe chunks", async () => {
  const prettier = require("prettier");
  const targets = [
    ["InventoryLiveTest", "../src/InventoryLiveTest.js"],
    ["CharacterCoordinator", "../standalones/CharacterCoordinator.js"],
    ["InventoryLiveSupervisorTest", "inventory_live_supervisor.test.js"],
    ["InventoryLiveTest", "inventory_live_test.test.js"],
  ];
  const size = 400;

  for (const [key, relative] of targets) {
    const target = path.join(__dirname, relative);
    const source = fs.readFileSync(target, "utf8");
    const formatted = await prettier.format(source, { filepath: target });
    const encoded = Buffer.from(formatted, "utf8").toString("base64");
    const total = Math.ceil(encoded.length / size);

    for (let index = 0; index < total; index += 1) {
      console.log(
        "PRETTIER_INV:" +
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
});

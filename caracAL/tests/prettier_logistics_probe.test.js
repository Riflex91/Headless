"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints canonical Phase 11 formatting in safe chunks", async () => {
  const prettier = require("prettier");
  const targets = [
    ["Planner", "../src/MerchantLogisticsPlanner.js"],
    ["Coordinator", "../standalones/CharacterCoordinator.js"],
    ["PlannerTest", "merchant_logistics_planner.test.js"],
    ["SupervisorTest", "merchant_logistics_supervisor.test.js"],
  ];
  const size = 200;

  for (const [key, relative] of targets) {
    const target = path.join(__dirname, relative);
    const source = fs.readFileSync(target, "utf8");
    const formatted = await prettier.format(source, { filepath: target });
    const encoded = Buffer.from(formatted, "utf8").toString("base64");
    const total = Math.ceil(encoded.length / size);

    for (let index = 0; index < total; index += 1) {
      console.log(
        "PRETTIER_P11:" +
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

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

async function encoded(prettier, relative) {
  const target = path.join(__dirname, relative);
  const source = fs.readFileSync(target, "utf8");
  const formatted = await prettier.format(source, { filepath: target });
  return Buffer.from(formatted, "utf8").toString("base64");
}

function emit(key, chunk) {
  const size = 25;
  const total = Math.ceil(chunk.length / size);
  for (let index = 0; index < total; index += 1) {
    console.log(
      "PRETTIER_P11_EXEC_FIX2:" +
        key +
        ":" +
        index +
        ":" +
        total +
        ":" +
        chunk.slice(index * size, (index + 1) * size),
    );
  }
}

test("recovers missing Phase 11 execution formatting chunks", async () => {
  const prettier = require("prettier");
  const coordinator = await encoded(
    prettier,
    "../standalones/CharacterCoordinator.js",
  );
  const plannerTest = await encoded(
    prettier,
    "merchant_logistics_planner.test.js",
  );

  emit("Coordinator859", coordinator.slice(859 * 100, 860 * 100));
  emit("PlannerTest42", plannerTest.slice(42 * 100, 43 * 100));
});

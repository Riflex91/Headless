"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("prints canonical logistics executor test formatting", async () => {
  const prettier = require("prettier");
  const target = path.join(__dirname, "logistics_claim_executor.test.js");
  const source = fs.readFileSync(target, "utf8");
  const formatted = await prettier.format(source, { filepath: target });
  const encoded = Buffer.from(formatted, "utf8").toString("base64");
  const size = 100;
  const total = Math.ceil(encoded.length / size);

  for (let index = 0; index < total; index += 1) {
    console.log(
      "PRETTIER_EXECUTOR_TEST:" +
        index +
        ":" +
        total +
        ":" +
        encoded.slice(index * size, (index + 1) * size),
    );
  }
});

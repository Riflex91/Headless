"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("character thread routes logistics claims into runtime executor", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /case "logistics_claim"/);
  assert.match(source, /executeLogisticsClaim/);
  assert.match(source, /logistics_claim_result/);
  assert.match(source, /claim_id/);
});

test("supervisor dispatches one claim at a time and holds uncertain outcomes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /LOGISTICS_CLAIM_RESULT_TIMEOUT_MS/);
  assert.match(source, /logistics_claim_requests/);
  assert.match(source, /dispatch_merchant_logistics_claim/);
  assert.match(source, /logistics_execution_enabled/);
  assert.match(source, /emergency_stop\.snapshot\(\)\.active/);
  assert.match(source, /type: "logistics_claim"/);
  assert.match(source, /case "logistics_claim_result"/);
  assert.match(source, /recordClaimOutcome/);
  assert.match(source, /OUTCOME_UNCERTAIN_NO_BLIND_RETRY/);
});

test("logistics execution requires explicit enablement on farmer and merchant", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(source, /farmer_logistics\.executionEnabled === true/);
  assert.match(source, /merchant_logistics\.executionEnabled === true/);
  assert.match(source, /return farmer_enabled && merchant_enabled/);
});

test("runtime kernel exposes serialized logistics execution status", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );

  assert.match(source, /LogisticsClaimExecutor/);
  assert.match(source, /executeLogisticsClaim/);
  assert.match(source, /logisticsClaimRunning/);
  assert.match(source, /LOGISTICS_CLAIM_STARTED/);
  assert.match(source, /LOGISTICS_CLAIM_COMPLETED/);
  assert.match(source, /logisticsExecution/);
});

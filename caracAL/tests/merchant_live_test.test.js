"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadRunner() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "merchant-live-test.lib.ts",
    ),
  ).MerchantLiveTestRunner;
}

function readyStatus() {
  return {
    timestamp: 1000,
    enabled: true,
    state: "READY",
    reason: "MERCHANT_AUTONOMY_READY",
    character: { name: "My_Merchant", ctype: "merchant", map: "main" },
    featureOrder: [
      "MERRIT",
      "FISHING",
      "MINING",
      "WISHLIST",
      "GIVEAWAYS",
      "PONTY",
      "MERCHANT_SKILLS",
    ],
    merrit: {
      npcPresent: true,
      mainMapPresent: true,
      standItems: ["stand0"],
      activeListings: 0,
    },
    gathering: {
      fishing: {
        skillPresent: true,
        toolPresent: false,
        zones: [{ map: "main", type: "fishing", drop: "f1", points: 4 }],
      },
      mining: {
        skillPresent: true,
        toolPresent: false,
        zones: [{ map: "tunnel", type: "mining", drop: "m2", points: 4 }],
      },
    },
    wishlist: { boundarySupported: true, activeSlots: [] },
    giveaways: { joinOnly: true, visibleCount: 0, visible: [] },
    ponty: { boundarySupported: true, npcPresent: true },
    merchantSkills: { available: ["fishing", "mcourage", "mining"] },
    mutationPolicy: {
      executionEnabled: false,
      valueMutationForced: false,
      giveawayCreationSupported: false,
    },
  };
}

test("merchant live test confirms Phase 12 core without forcing mutations", () => {
  const MerchantLiveTestRunner = loadRunner();
  const calls = [];
  let now = 1000;
  const runner = new MerchantLiveTestRunner({
    merchantAutonomy: {
      setConfigOverride(config) {
        calls.push(["set", config.merchantAutonomy.enabled]);
      },
      clearConfigOverride() {
        calls.push(["clear"]);
      },
      tick() {
        return readyStatus();
      },
    },
    now: () => {
      now += 5;
      return now;
    },
  });

  const result = runner.run({ requestId: "merchant-1" });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MERCHANT_LIVE_RUNTIME_CONFIRMED");
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.valueMutationForced, false);
  assert.equal(result.scope.pontyPurchaseForced, false);
  assert.equal(result.scope.giveawayJoinForced, false);
  assert.equal(result.cleanup.autonomyOverrideCleared, true);
  assert.deepEqual(calls, [["set", true], ["clear"]]);
});

test("merchant live test fails if current G lacks required Phase 12 evidence", () => {
  const MerchantLiveTestRunner = loadRunner();
  const status = readyStatus();
  status.merrit.npcPresent = false;
  status.gathering.mining.zones = [];
  const runner = new MerchantLiveTestRunner({
    merchantAutonomy: {
      setConfigOverride() {},
      clearConfigOverride() {},
      tick() {
        return status;
      },
    },
  });

  const result = runner.run();
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "MERCHANT_LIVE_EVIDENCE_INCOMPLETE");
  assert.equal(result.evidence.merritDataVisible, false);
  assert.equal(result.evidence.miningDataVisible, false);
});

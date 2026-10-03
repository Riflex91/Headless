"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

test("gathering skill preserves found=false as confirmed evidence", async () => {
  const state = {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      in: "main",
      x: -1572,
      y: 552,
      hp: 1000,
      max_hp: 1000,
      mp: 500,
      max_mp: 500,
      level: 30,
      gold: 10000,
      target: null,
      rip: false,
      moving: false,
      items: [null],
      slots: { mainhand: { name: "rod" } },
    },
    G: {
      items: { rod: { type: "tool", wtype: "rod" } },
      skills: {
        fishing: {
          class: ["merchant"],
          level: 16,
          mp: 120,
          wtype: ["rod"],
        },
      },
      craft: {},
      maps: {},
      npcs: {},
    },
  };

  const { GameAdapter } = core("game-adapter.lib.ts");
  const game = new GameAdapter({
    character: () => state.character,
    entities: () => ({}),
    party: () => ({}),
    gameData: () => state.G,
    nextSkill: () => ({}),
    bankPacks: () => ({}),
    now: () => 1000,
  });

  const { ActionLedger } = core("action-ledger.lib.ts");
  const ledger = new ActionLedger({
    nextActionId: () => "G-1",
    nextCorrelationId: () => "GC-1",
  });

  const driver = {
    move() {},
    smartMove() {},
    cancelMovement() {},
    resolveEntity() {
      return null;
    },
    canAttack() {
      return false;
    },
    attack() {},
    canUseSkill(skill) {
      return skill === "fishing";
    },
    async useSkill() {
      return {
        success: true,
        response: "fishing_none",
        place: "fishing",
        found: false,
      };
    },
    loot() {},
    buy() {},
    sell() {},
    sendItem() {},
    sendGold() {},
    bankStore() {},
    bankRetrieve() {},
    bankDeposit() {},
    bankWithdraw() {},
    equip() {},
    unequip() {},
    upgrade() {},
    compound() {},
    exchange() {},
    craft() {},
    openStand() {},
    closeStand() {},
    tradeList() {},
    tradeUnlist() {},
    requestMerritStatus() {},
    wishlist() {},
    pontyBuy() {},
    partyInvite() {},
    partyRequest() {},
    partyAcceptInvite() {},
    partyAcceptRequest() {},
    partyLeave() {},
    respawn() {},
  };

  const { ActionBoundary } = core("action-boundary.lib.ts");
  const actions = new ActionBoundary(ledger, game, driver);
  const result = await actions.useSkill({
    skill: "fishing",
    module: "MerchantFishingController",
    why: "FISHING_EXECUTE_SKILL",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.evidence.result.found, false);
  assert.equal(result.evidence.result.response, "fishing_none");
});

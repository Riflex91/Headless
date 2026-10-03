"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadController() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "bank-travel-controller.lib.ts",
    ),
  );
}

function setup({
  enabled = true,
  bankAvailable = false,
  movementOwner = null,
  actionStatus = "CONFIRMED",
} = {}) {
  const { BankTravelController } = loadController();
  const state = {
    character: {
      name: "My_Merchant",
      ctype: "merchant",
      map: "main",
      x: 948,
      y: -144,
      hp: 3079,
      maxHp: 3079,
      mp: 1915,
      maxMp: 1915,
      level: 58,
      xp: 0,
      attack: 0,
      frequency: 0,
      armor: 0,
      resistance: 0,
      range: 0,
      gold: 100000,
      target: null,
      rip: false,
      moving: false,
    },
    bank: {
      available: bankAvailable,
      gold: bankAvailable ? 50000 : null,
      packs: bankAvailable
        ? [{ name: "items0", items: [{ slot: 0, item: null }] }]
        : [],
      access: [
        {
          name: "items1",
          map: "bank_b",
          goldPrice: 500000,
          shellPrice: 10,
        },
        {
          name: "items0",
          map: "bank",
          goldPrice: 0,
          shellPrice: 0,
        },
      ],
    },
  };
  const calls = [];
  const movementState = {
    owner: movementOwner,
    mode: movementOwner ? "SMART" : "IDLE",
    path: null,
    safePoint: null,
    stuck: {
      active: false,
      since: null,
      lastProgressAt: null,
      lastDistance: null,
    },
    active: movementOwner
      ? {
          id: 1,
          type: "SMART",
          owner: movementOwner,
          module: movementOwner,
          reason: "OTHER",
          startedAt: 1,
          actionId: "move-0",
          target: null,
        }
      : null,
  };

  const movement = {
    status() {
      return {
        ...movementState,
        active: movementState.active ? { ...movementState.active } : null,
      };
    },
    async smart(request) {
      calls.push(request);
      if (actionStatus === "CONFIRMED") {
        state.character.map = request.destination;
        state.bank.available = true;
        state.bank.gold = 50000;
        state.bank.packs = [
          { name: "items0", items: [{ slot: 0, item: null }] },
        ];
      }
      return {
        id: "move-1",
        status: actionStatus,
      };
    },
  };

  const events = [];
  const controller = new BankTravelController(
    {
      character: () => ({ ...state.character }),
      bank: () => ({
        ...state.bank,
        packs: state.bank.packs.map((pack) => ({
          ...pack,
          items: pack.items.map((item) => ({ ...item })),
        })),
        access: state.bank.access.map((access) => ({ ...access })),
      }),
    },
    movement,
    {
      config: () => ({ bank: { enabled } }),
      now: () => 1234,
      onEvent: (event) => events.push(event),
    },
  );

  return { controller, state, calls, events };
}

test("bank travel stays disabled without explicit config", async () => {
  const { controller, calls } = setup({ enabled: false });
  const status = await controller.tick();

  assert.equal(status.state, "DISABLED");
  assert.equal(status.reason, "BANK_TRAVEL_DISABLED");
  assert.equal(calls.length, 0);
});

test("bank travel prefers primary bank access and confirms visible bank state", async () => {
  const { controller, calls } = setup();
  const status = await controller.tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].destination, "bank");
  assert.equal(calls[0].owner, "BankTravelController");
  assert.equal(status.state, "READY");
  assert.equal(status.reason, "BANK_AVAILABLE");
  assert.equal(status.roadmapStage, "Bank bereit");
  assert.equal(status.bank.available, true);
  assert.equal(status.target.map, "bank");
  assert.equal(status.target.pack, "items0");
  assert.equal(status.lastAction.status, "CONFIRMED");
});

test("bank travel is immediately ready when bank state is already visible", async () => {
  const { controller, calls } = setup({ bankAvailable: true });
  const status = await controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.bank.available, true);
  assert.equal(calls.length, 0);
});

test("bank travel respects movement ownership", async () => {
  const { controller, calls } = setup({ movementOwner: "CombatController" });
  const status = await controller.tick();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "BANK_TRAVEL_MOVEMENT_OWNED");
  assert.equal(calls.length, 0);
});

test("bank travel holds UNKNOWN outcome and never blindly retries", async () => {
  const { controller, calls } = setup({ actionStatus: "UNKNOWN" });

  let status = await controller.tick();
  assert.equal(status.state, "UNKNOWN");
  assert.equal(status.reason, "BANK_TRAVEL_OUTCOME_UNKNOWN");
  assert.equal(calls.length, 1);

  status = await controller.tick();
  assert.equal(status.state, "UNKNOWN");
  assert.equal(calls.length, 1);
});

test("bank access selection prefers primary bank over paid secondary packs", () => {
  const { selectBankAccess } = loadController();
  const selected = selectBankAccess({
    available: false,
    gold: null,
    packs: [],
    access: [
      {
        name: "items1",
        map: "bank_b",
        goldPrice: 0,
        shellPrice: 0,
      },
      {
        name: "items0",
        map: "bank",
        goldPrice: 100000,
        shellPrice: 1,
      },
    ],
  });

  assert.equal(selected.map, "bank");
  assert.equal(selected.name, "items0");
});

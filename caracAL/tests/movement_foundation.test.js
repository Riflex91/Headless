"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", fileName),
  );
}

function characterSnapshot(overrides = {}) {
  return {
    name: "My_Merchant",
    ctype: "merchant",
    map: "main",
    x: 0,
    y: 0,
    hp: 900,
    maxHp: 900,
    mp: 500,
    maxMp: 500,
    gold: 10000,
    target: null,
    rip: false,
    moving: false,
    ...overrides,
  };
}

function makeLedger(options = {}) {
  const { ActionLedger } = coreModule("action-ledger.lib.ts");
  let actionId = 0;
  return new ActionLedger({
    nextActionId: () => `A-${++actionId}`,
    nextCorrelationId: () => `C-${actionId}`,
    ...options,
  });
}

function makeBoundary(options = {}) {
  const { ActionBoundary } = coreModule("action-boundary.lib.ts");
  const state = {
    character: characterSnapshot(options.character),
  };
  const game = {
    character: () => ({ ...state.character }),
    entity: () => null,
    inventory: () => [],
    equipment: () => ({}),
    tradeSlots: () => ({}),
    party: () => ({}),
    bank: () => ({ available: false, gold: null, packs: [], access: [] }),
    skills: () => [],
    map: () => ({
      name: state.character.map,
      x: state.character.x,
      y: state.character.y,
    }),
    gameData: () => ({}),
  };
  const driver = {
    move() {},
    async smartMove() {
      return { success: true };
    },
    async cancelMovement() {
      return { success: true };
    },
    resolveEntity() {
      return null;
    },
    canAttack() {
      return false;
    },
    async attack() {},
    canUseSkill() {
      return false;
    },
    async useSkill() {},
    async loot() {},
    async buy() {},
    async sell() {},
    async sendItem() {},
    async sendGold() {},
    async bankStore() {},
    async bankRetrieve() {},
    bankDeposit() {},
    bankWithdraw() {},
    async equip() {},
    unequip() {},
    async upgrade() {},
    async compound() {},
    async exchange() {},
    async craft() {},
    wishlist() {},
    pontyBuy() {},
    partyInvite() {},
    partyRequest() {},
    partyAcceptInvite() {},
    partyAcceptRequest() {},
    async partyLeave() {},
    respawn() {},
    ...(options.driver || {}),
  };
  const ledger = options.ledger || makeLedger();

  return {
    boundary: new ActionBoundary(ledger, game, driver),
    ledger,
    state,
  };
}

function actionRecord(id, status) {
  return {
    id,
    module: "Movement",
    action: "TEST",
    why: "TEST",
    correlationId: `C-${id}`,
    createdAt: 1,
    status,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("movement cancel is allowed during emergency stop while normal move remains blocked", async () => {
  let cancelCalls = 0;
  const ledger = makeLedger({
    isEmergencyStopActive: () => true,
  });
  const { boundary } = makeBoundary({
    ledger,
    driver: {
      async cancelMovement() {
        cancelCalls += 1;
        return { success: true };
      },
    },
  });

  const move = boundary.move({
    x: 10,
    y: 20,
    module: "Movement",
    why: "DIRECT_MOVE",
  });
  assert.equal(move.status, "BLOCKED");

  const cancel = await boundary.cancelMovement({
    module: "Movement",
    why: "EMERGENCY_CANCEL",
  });
  assert.equal(cancel.status, "CONFIRMED");
  assert.equal(cancelCalls, 1);
  assert.equal(cancel.allowDuringEmergencyStop, true);
});

test("smart move validates destinations before dispatch", async () => {
  let calls = 0;
  const { boundary } = makeBoundary({
    driver: {
      async smartMove() {
        calls += 1;
        return { success: true };
      },
    },
  });

  for (const destination of ["", { x: NaN, y: 10 }, { to: "" }]) {
    const result = await boundary.smartMove({
      destination,
      module: "Movement",
      why: "SMART_MOVE",
    });
    assert.equal(result.status, "BLOCKED");
  }

  assert.equal(calls, 0);
});

test("smart move confirms arrival and rejects known path failure", async () => {
  const confirmed = makeBoundary({
    driver: {
      async smartMove() {
        return { success: true };
      },
    },
  }).boundary;
  const confirmedResult = await confirmed.smartMove({
    destination: { map: "main", x: 100, y: 200 },
    module: "Movement",
    why: "SMART_MOVE",
  });
  assert.equal(confirmedResult.status, "CONFIRMED");

  const rejected = makeBoundary({
    driver: {
      async smartMove() {
        return { success: false, reason: "invalid" };
      },
    },
  }).boundary;
  const rejectedResult = await rejected.smartMove({
    destination: "winterland",
    module: "Movement",
    why: "SMART_MOVE",
  });
  assert.equal(rejectedResult.status, "REJECTED");
  assert.equal(rejectedResult.evidence.reason, "invalid");
});

test("smart move rejected promise with interrupted reason is REJECTED not UNKNOWN", async () => {
  const { boundary } = makeBoundary({
    driver: {
      async smartMove() {
        throw { reason: "interrupted" };
      },
    },
  });

  const result = await boundary.smartMove({
    destination: "main",
    module: "Movement",
    why: "SMART_MOVE",
  });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.evidence.reason, "interrupted");
});

test("smart move transport exception is UNKNOWN and cannot blind retry", async () => {
  const setup = makeBoundary({
    driver: {
      async smartMove() {
        throw new Error("socket lost");
      },
    },
  });

  const result = await setup.boundary.smartMove({
    destination: "main",
    module: "Movement",
    why: "SMART_MOVE",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(setup.ledger.canRetry(result.id), false);
});

test("movement controller gives direct movement an exclusive owner", () => {
  const { MovementController, MovementOwnershipError } = coreModule(
    "movement-controller.lib.ts",
  );
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions, { now: () => 100 });

  const result = movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "CHASE_TARGET",
    x: 10,
    y: 20,
  });
  assert.equal(result.status, "DISPATCHED");
  assert.equal(movement.status().owner, "Farm");
  assert.equal(movement.status().mode, "DIRECT");
  assert.equal(movement.release("Farm"), false);

  assert.throws(
    () =>
      movement.direct({
        owner: "Merchant",
        module: "Merchant",
        why: "GO_BANK",
        x: 30,
        y: 40,
      }),
    MovementOwnershipError,
  );
});

test("confirmed cancel releases direct movement ownership", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions);

  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "CHASE_TARGET",
    x: 10,
    y: 20,
  });
  const cancelled = await movement.cancel({
    owner: "Farm",
    module: "Farm",
    why: "TARGET_GONE",
  });

  assert.equal(cancelled.status, "CONFIRMED");
  assert.deepEqual(movement.status(), {
    owner: null,
    mode: "IDLE",
    active: null,
  });
});

test("smart movement keeps ownership until settlement then releases it", async () => {
  const { MovementController, MovementOwnershipError } = coreModule(
    "movement-controller.lib.ts",
  );
  const pending = deferred();
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    smartMove() {
      return pending.promise;
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions);

  const smartPromise = movement.smart({
    owner: "Travel",
    module: "Travel",
    why: "GO_TOWN",
    destination: "main",
  });

  assert.equal(movement.status().owner, "Travel");
  assert.equal(movement.status().mode, "SMART");
  assert.throws(
    () =>
      movement.direct({
        owner: "Farm",
        module: "Farm",
        why: "CHASE",
        x: 1,
        y: 2,
      }),
    MovementOwnershipError,
  );

  pending.resolve(actionRecord("S-1", "CONFIRMED"));
  const result = await smartPromise;
  assert.equal(result.status, "CONFIRMED");
  assert.equal(movement.status().owner, null);
  assert.equal(movement.status().mode, "IDLE");
});

test("UNKNOWN smart movement conservatively retains ownership", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    async smartMove() {
      return actionRecord("S-1", "UNKNOWN");
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions);

  const result = await movement.smart({
    owner: "Travel",
    module: "Travel",
    why: "GO_TOWN",
    destination: "main",
  });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(movement.status().owner, "Travel");
  assert.equal(movement.status().mode, "UNKNOWN");
});

test("forced cancel can preempt a different movement owner", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const events = [];
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions, {
    onEvent: (event) => events.push(event),
  });

  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "CHASE",
    x: 1,
    y: 2,
  });
  const result = await movement.cancel({
    owner: "Safety",
    module: "Safety",
    why: "EMERGENCY_CANCEL",
    force: true,
  });

  assert.equal(result.status, "CONFIRMED");
  assert.equal(movement.status().owner, null);
  assert.equal(
    events.some(
      (event) =>
        event.type === "MOVEMENT_OWNER_PREEMPTED" &&
        event.previousOwner === "Farm",
    ),
    true,
  );
});

test("UNKNOWN cancel retains safety ownership instead of allowing a race", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-1", "UNKNOWN");
    },
  };
  const movement = new MovementController(actions);

  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "CHASE",
    x: 1,
    y: 2,
  });
  await movement.cancel({
    owner: "Farm",
    module: "Farm",
    why: "CANCEL",
  });

  assert.equal(movement.status().owner, "Farm");
  assert.equal(movement.status().mode, "UNKNOWN");
});

test("movement controller status is exposed without mutable internal target references", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions);
  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "MOVE",
    x: 10,
    y: 20,
  });

  const status = movement.status();
  status.active.target.x = 999;

  assert.equal(movement.status().active.target.x, 10);
});


test("direct move settles only after observed arrival and stop", () => {
  const setup = makeBoundary({
    character: {
      x: 0,
      y: 0,
      moving: true,
    },
  });

  const move = setup.boundary.move({
    x: 100,
    y: 200,
    module: "Movement",
    why: "DIRECT_MOVE",
  });
  assert.equal(move.status, "DISPATCHED");

  const inFlight = setup.boundary.settleMove(move.id, 5);
  assert.equal(inFlight.status, "DISPATCHED");

  setup.state.character.x = 98;
  setup.state.character.y = 202;
  setup.state.character.moving = false;

  const settled = setup.boundary.settleMove(move.id, 5);
  assert.equal(settled.status, "CONFIRMED");
  assert.equal(settled.evidence.distance <= 5, true);
  assert.equal(settled.evidence.tolerance, 5);
});

test("movement controller observe retains ownership in flight and releases it on settlement", () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  let settlement = actionRecord("D-1", "DISPATCHED");
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    settleMove() {
      return settlement;
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions);

  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "CHASE_TARGET",
    x: 10,
    y: 20,
  });

  const inFlight = movement.observe();
  assert.equal(inFlight.status, "DISPATCHED");
  assert.equal(movement.status().owner, "Farm");
  assert.equal(movement.status().mode, "DIRECT");

  settlement = actionRecord("D-1", "CONFIRMED");
  const arrived = movement.observe();
  assert.equal(arrived.status, "CONFIRMED");
  assert.deepEqual(movement.status(), {
    owner: null,
    mode: "IDLE",
    active: null,
  });
});

test("movement controller observe ignores non-direct commands", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const pending = deferred();
  let settlementCalls = 0;
  const actions = {
    move() {
      return actionRecord("D-1", "DISPATCHED");
    },
    cancelDirectMove() {
      return actionRecord("D-1", "REJECTED");
    },
    settleMove() {
      settlementCalls += 1;
      return actionRecord("D-1", "CONFIRMED");
    },
    smartMove() {
      return pending.promise;
    },
    async cancelMovement() {
      return actionRecord("C-1", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions);

  const smartPromise = movement.smart({
    owner: "Travel",
    module: "Travel",
    why: "GO_TOWN",
    destination: "main",
  });
  assert.equal(movement.observe(), null);
  assert.equal(settlementCalls, 0);

  pending.resolve(actionRecord("S-1", "CONFIRMED"));
  await smartPromise;
});


test("confirmed movement cancel rejects the superseded direct move", async () => {
  const { MovementController } = coreModule("movement-controller.lib.ts");
  const cancelledDirect = [];
  const actions = {
    move() {
      return actionRecord("D-9", "DISPATCHED");
    },
    cancelDirectMove(actionId, reason) {
      cancelledDirect.push([actionId, reason]);
      return actionRecord(actionId, "REJECTED");
    },
    settleMove() {
      return actionRecord("D-9", "DISPATCHED");
    },
    async smartMove() {
      return actionRecord("S-1", "CONFIRMED");
    },
    async cancelMovement() {
      return actionRecord("C-9", "CONFIRMED");
    },
  };
  const movement = new MovementController(actions);

  movement.direct({
    owner: "Farm",
    module: "Farm",
    why: "CHASE_TARGET",
    x: 10,
    y: 20,
  });
  const result = await movement.cancel({
    owner: "Farm",
    module: "Farm",
    why: "TARGET_GONE",
  });

  assert.equal(result.status, "CONFIRMED");
  assert.deepEqual(cancelledDirect, [["D-9", "MOVE_CANCELLED"]]);
  assert.equal(movement.status().owner, null);
});

test("ActionBoundary cancelDirectMove closes a dispatched move as REJECTED", () => {
  const setup = makeBoundary();

  const move = setup.boundary.move({
    x: 100,
    y: 200,
    module: "Movement",
    why: "DIRECT_MOVE",
  });
  assert.equal(move.status, "DISPATCHED");

  const cancelled = setup.boundary.cancelDirectMove(move.id);
  assert.equal(cancelled.status, "REJECTED");
  assert.equal(cancelled.evidence.cancelled, true);
  assert.equal(setup.ledger.canRetry(cancelled.id), true);
});

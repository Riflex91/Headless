"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");
const {
  combineMovementLiveTestResult,
  evidenceComplete,
  movementLiveTestDiagnostics,
  movementLiveTestEvidence,
} = require("../src/MovementLiveTest");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", fileName),
  );
}

function actionRecord(id, status) {
  return {
    id,
    module: "MovementLiveTest",
    action: "MOVE",
    why: "TEST",
    correlationId: `C-${id}`,
    createdAt: 1,
    status,
  };
}

function idleStatus(safePoint = null) {
  return {
    owner: null,
    mode: "IDLE",
    path: null,
    safePoint,
    stuck: {
      commandKey: null,
      stuck: false,
      stuckSince: null,
      lastProgressAt: null,
      lastPosition: null,
    },
    active: null,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function successfulHarness({ rejectFirstRoute = false } = {}) {
  let now = 0;
  let polls = 0;
  let pathCalls = 0;
  let cancelCalls = 0;
  let safePoint = null;
  const character = {
    name: "My_Ranger1",
    ctype: "ranger",
    map: "main",
    x: 100,
    y: 200,
    hp: 100,
    maxHp: 100,
    mp: 100,
    maxMp: 100,
    gold: 0,
    target: null,
    rip: false,
    moving: false,
  };
  let status = idleStatus();

  const movement = {
    status() {
      const snapshot = clone(status);
      snapshot.safePoint = safePoint ? { ...safePoint } : null;
      return snapshot;
    },
    captureSafePoint(tolerance, source) {
      safePoint = {
        map: character.map,
        x: character.x,
        y: character.y,
        tolerance,
        source,
        capturedAt: now,
      };
      return { ...safePoint };
    },
    clearSafePoint() {
      const previous = safePoint ? { ...safePoint } : null;
      safePoint = null;
      return previous;
    },
    path(request) {
      pathCalls += 1;
      if (rejectFirstRoute && pathCalls === 1) {
        status = idleStatus(safePoint);
        return actionRecord("P-1", "REJECTED");
      }

      polls = 0;
      status = {
        owner: request.owner,
        mode: "PATH",
        path: {
          id: pathCalls,
          owner: request.owner,
          index: 0,
          total: request.waypoints.length,
          remaining: request.waypoints.map((point) => ({ ...point })),
        },
        safePoint,
        stuck: {
          commandKey: `${request.owner}:1`,
          stuck: false,
          stuckSince: null,
          lastProgressAt: now,
          lastPosition: {
            map: character.map,
            x: character.x,
            y: character.y,
            moving: true,
          },
        },
        active: { id: 1, type: "DIRECT", owner: request.owner },
      };
      movement.currentWaypoints = request.waypoints.map((point) => ({
        ...point,
      }));
      return actionRecord(`P-${pathCalls}`, "DISPATCHED");
    },
    async returnToSafePoint() {
      character.x = safePoint.x;
      character.y = safePoint.y;
      character.map = safePoint.map;
      status = idleStatus(safePoint);
      return actionRecord("R-1", "CONFIRMED");
    },
    async cancel() {
      cancelCalls += 1;
      status = idleStatus(safePoint);
      return actionRecord("C-1", "CONFIRMED");
    },
  };

  async function sleep(ms) {
    now += ms;
    if (!status.path) return;
    polls += 1;

    if (polls === 1) {
      status.path.index = 1;
      character.x = movement.currentWaypoints[0].x;
      character.y = movement.currentWaypoints[0].y;
    } else if (polls === 2) {
      const destination =
        movement.currentWaypoints[movement.currentWaypoints.length - 1];
      character.x = destination.x;
      character.y = destination.y;
      character.map = destination.map;
      status = idleStatus(safePoint);
    }
  }

  return {
    character,
    movement,
    now: () => now,
    sleep,
    pathCalls: () => pathCalls,
    cancelCalls: () => cancelCalls,
  };
}

test("coordinator temporarily swaps to the bot runtime for movement live E2E", () => {
  const coordinator = fs.readFileSync(
    path.join(__dirname, "..", "standalones", "CharacterCoordinator.js"),
    "utf8",
  );

  assert.match(coordinator, /MOVEMENT_LIVE_TEST_RUNTIME_OVERRIDE_APPLIED/);
  assert.match(coordinator, /movement_live_test_typescript_override/);
  assert.match(coordinator, /MOVEMENT_LIVE_TEST_TYPESCRIPT_FILE/);
  assert.match(coordinator, /restore_movement_live_test_execution_source/);
  assert.match(coordinator, /MOVEMENT_LIVE_TEST_RUNTIME_OVERRIDE_CLEARED/);
});

test("movement live runner autonomously paths and returns to captured safe point", async () => {
  const { MovementLiveTestRunner } = coreModule("movement-live-test.lib.ts");
  const harness = successfulHarness();
  const runner = new MovementLiveTestRunner({
    movement: harness.movement,
    character: () => ({ ...harness.character }),
    now: harness.now,
    sleep: harness.sleep,
  });

  const result = await runner.run({
    requestId: "LIVE-1",
    waypointOffset: 18,
    pollIntervalMs: 100,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "MOVEMENT_LIVE_E2E_CONFIRMED");
  assert.equal(result.path.attempt, 1);
  assert.equal(result.path.waypoints.length, 2);
  assert.equal(result.path.completed, true);
  assert.equal(result.returned.actionStatus, "CONFIRMED");
  assert.equal(result.returned.distanceToSafePoint, 0);
  assert.equal(result.evidence.safePointCaptured, true);
  assert.equal(result.evidence.pathOwnerObserved, true);
  assert.equal(result.evidence.pathModeObserved, true);
  assert.equal(result.evidence.waypointProgressObserved, true);
  assert.equal(result.evidence.stuckTelemetryAvailable, true);
  assert.equal(result.evidence.finalIdle, true);
  assert.equal(result.cleanup.safePointCleared, true);
  assert.equal(harness.cancelCalls(), 0);
});

test("movement live runner retries a known rejected local route autonomously", async () => {
  const { MovementLiveTestRunner } = coreModule("movement-live-test.lib.ts");
  const harness = successfulHarness({ rejectFirstRoute: true });
  const runner = new MovementLiveTestRunner({
    movement: harness.movement,
    character: () => ({ ...harness.character }),
    now: harness.now,
    sleep: harness.sleep,
  });

  const result = await runner.run({ requestId: "LIVE-2" });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.path.attempt, 2);
  assert.equal(harness.pathCalls(), 2);
});

test("movement live runner never blind-retries UNKNOWN movement", async () => {
  const { MovementLiveTestRunner } = coreModule("movement-live-test.lib.ts");
  let pathCalls = 0;
  let cancelCalls = 0;
  let safePoint = null;
  let status = idleStatus();
  const character = {
    name: "My_Ranger1",
    ctype: "ranger",
    map: "main",
    x: 10,
    y: 20,
    hp: 100,
    maxHp: 100,
    mp: 100,
    maxMp: 100,
    gold: 0,
    target: null,
    rip: false,
    moving: false,
  };
  const movement = {
    status: () => clone(status),
    captureSafePoint(tolerance, source) {
      safePoint = {
        map: "main",
        x: 10,
        y: 20,
        tolerance,
        source,
        capturedAt: 0,
      };
      status.safePoint = safePoint;
      return { ...safePoint };
    },
    clearSafePoint() {
      const previous = safePoint;
      safePoint = null;
      return previous;
    },
    path(request) {
      pathCalls += 1;
      status = {
        ...idleStatus(safePoint),
        owner: request.owner,
        mode: "UNKNOWN",
        active: { id: 1, type: "DIRECT", owner: request.owner },
      };
      return actionRecord("P-UNKNOWN", "UNKNOWN");
    },
    async returnToSafePoint() {
      throw new Error("return must not run after UNKNOWN path");
    },
    async cancel() {
      cancelCalls += 1;
      status = idleStatus(safePoint);
      return actionRecord("C-1", "CONFIRMED");
    },
  };

  const runner = new MovementLiveTestRunner({
    movement,
    character: () => ({ ...character }),
    now: () => 0,
    sleep: async () => {},
  });
  const result = await runner.run({ requestId: "LIVE-UNKNOWN" });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "PATH_DISPATCH_UNKNOWN");
  assert.equal(pathCalls, 1);
  assert.equal(cancelCalls, 1);
});

test("supervisor evidence validates runtime IPC dashboard and trail chain", () => {
  const events = [
    "MOVEMENT_SAFE_POINT_SET",
    "MOVEMENT_PATH_STARTED",
    "MOVEMENT_WAYPOINT_SETTLED",
    "MOVEMENT_WAYPOINT_SETTLED",
    "MOVEMENT_PATH_COMPLETED",
    "MOVEMENT_RETURN_STARTED",
    "MOVEMENT_LIVE_TEST_COMPLETED",
  ].map((type, index) => ({
    source: "bot_runtime",
    module: type.startsWith("MOVEMENT_LIVE_TEST")
      ? "MovementLiveTest"
      : "MovementController",
    type,
    timestamp: index + 1,
  }));
  const charBlock = {
    live_state: {
      movement_mode: "IDLE",
      movement_owner: null,
      movement_command: null,
      movement_stuck: { stuck: false },
    },
    movement_trail: [
      { timestamp: 1, map: "main", x: 1, y: 2 },
      { timestamp: 2, map: "main", x: 3, y: 4 },
    ],
  };

  const evidence = movementLiveTestEvidence(events, charBlock);

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(evidence.waypointSettlements, 2);
  assert.equal(evidence.trailVisible, true);
  assert.equal(
    combineMovementLiveTestResult(
      { outcome: "PASS", reason: "MOVEMENT_LIVE_E2E_CONFIRMED" },
      evidence,
    ).outcome,
    "PASS",
  );
});

test("missing supervisor telemetry downgrades a runtime PASS to FAIL", () => {
  const evidence = movementLiveTestEvidence([], {
    live_state: null,
    movement_trail: [],
  });
  const combined = combineMovementLiveTestResult(
    { outcome: "PASS", reason: "MOVEMENT_LIVE_E2E_CONFIRMED" },
    evidence,
  );

  assert.equal(evidenceComplete(evidence), false);
  assert.equal(combined.outcome, "FAIL");
  assert.equal(combined.reason, "SUPERVISOR_MOVEMENT_EVIDENCE_INCOMPLETE");
});

test("supervisor evidence does not fail a fast movement only because trail sampling is sparse", () => {
  const evidence = {
    safePointSet: true,
    pathStarted: true,
    waypointSettlements: 2,
    pathCompleted: true,
    returnStarted: true,
    movementTestCompleted: true,
    movementProjectionVisible: true,
    finalIdle: true,
    trailPoints: 1,
    trailVisible: false,
  };

  assert.equal(evidenceComplete(evidence), true);
  assert.equal(
    combineMovementLiveTestResult(
      { outcome: "PASS", reason: "MOVEMENT_LIVE_E2E_CONFIRMED" },
      evidence,
    ).outcome,
    "PASS",
  );
});

test("movement live diagnostics include roadmap-required test fields", () => {
  const diagnostics = movementLiveTestDiagnostics(
    {
      requestId: "LIVE-DIAG",
      character: "My_Ranger1",
      outcome: "FAIL",
      reason: "RETURN_POSITION_NOT_CONFIRMED",
      durationMs: 1234,
      start: { map: "main", x: 10, y: 20 },
      path: {
        attempt: 2,
        waypoints: [
          { map: "main", x: 30, y: 20 },
          { map: "main", x: 30, y: 40 },
        ],
        firstActionStatus: "DISPATCHED",
        completed: true,
      },
      returned: {
        actionStatus: "CONFIRMED",
        confirmed: false,
      },
      evidence: {
        safePointCaptured: true,
        finalIdle: true,
      },
      cleanup: {
        cancelStatus: null,
        safePointCleared: true,
      },
    },
    {
      character: "My_Ranger1",
      originalDesiredState: "PAUSED",
      startState: {
        lifecycle_state: "PAUSED",
        desired_runtime_state: "PAUSED",
        map: "main",
        x: 10,
        y: 20,
      },
      evidence: {
        waypointSettlements: 2,
        finalIdle: true,
        movementProjectionVisible: true,
        trailPoints: 1,
      },
      incidentId: "incident-1",
    },
  );

  assert.equal(diagnostics.test_id, "LIVE-DIAG");
  assert.equal(diagnostics.character, "My_Ranger1");
  assert.equal(diagnostics.start_state.lifecycle_state, "PAUSED");
  assert.equal(diagnostics.preparation.safe_point_captured, true);
  assert.equal(diagnostics.navigation.path_completed, true);
  assert.equal(diagnostics.actions.return_action_status, "CONFIRMED");
  assert.equal(diagnostics.expected.return_confirmed, true);
  assert.equal(diagnostics.observed.return_confirmed, false);
  assert.equal(diagnostics.result, "FAIL");
  assert.equal(diagnostics.duration_ms, 1234);
  assert.equal(diagnostics.incident_id, "incident-1");
});

test("movement live evidence can scope trail samples to the test start", () => {
  const evidence = movementLiveTestEvidence(
    [
      {
        source: "bot_runtime",
        type: "MOVEMENT_SAFE_POINT_SET",
      },
    ],
    {
      live_state: {
        movement_mode: "IDLE",
        movement_owner: null,
        movement_command: null,
        movement_stuck: { stuck: false },
      },
      movement_trail: [
        { timestamp: 100, map: "main", x: 1, y: 1 },
        { timestamp: 1000, map: "main", x: 2, y: 2 },
      ],
    },
    { startedAt: 500 },
  );

  assert.equal(evidence.trailPoints, 1);
  assert.equal(evidence.trailVisible, false);
});

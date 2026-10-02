import type { ActionRecord } from "./action-ledger.lib";
import type { CharacterSnapshot } from "./game-adapter.lib";
import type {
  MovementController,
  MovementControllerStatus,
} from "./movement-controller.lib";

export type MovementLiveTestOutcome =
  | "PASS"
  | "FAIL"
  | "UNKNOWN"
  | "TIMEOUT";

export interface MovementLiveTestOptions {
  requestId?: string;
  owner?: string;
  waypointOffset?: number;
  routeTimeoutMs?: number;
  returnTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface MovementLiveTestResult {
  requestId: string;
  outcome: MovementLiveTestOutcome;
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  start: {
    map: string;
    x: number;
    y: number;
  } | null;
  path: {
    attempt: number | null;
    waypoints: Array<{ map: string; x: number; y: number }>;
    firstActionStatus: string | null;
    completed: boolean;
  };
  returned: {
    actionStatus: string | null;
    distanceToSafePoint: number | null;
    confirmed: boolean;
  };
  evidence: {
    safePointCaptured: boolean;
    pathOwnerObserved: boolean;
    pathModeObserved: boolean;
    waypointProgressObserved: boolean;
    stuckTelemetryAvailable: boolean;
    finalIdle: boolean;
  };
  cleanup: {
    cancelStatus: string | null;
    safePointCleared: boolean;
  };
}

export interface MovementLiveTestDependencies {
  movement: Pick<
    MovementController,
    | "status"
    | "captureSafePoint"
    | "clearSafePoint"
    | "path"
    | "returnToSafePoint"
    | "cancel"
  >;
  character: () => CharacterSnapshot;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface RouteObservation {
  outcome: "COMPLETED" | "FAILED" | "UNKNOWN" | "TIMEOUT";
  ownerObserved: boolean;
  pathModeObserved: boolean;
  waypointProgressObserved: boolean;
}

function finitePosition(
  character: CharacterSnapshot,
): character is CharacterSnapshot & { map: string; x: number; y: number } {
  return (
    typeof character.map === "string" &&
    character.map.length > 0 &&
    Number.isFinite(character.x) &&
    Number.isFinite(character.y)
  );
}

function actionStatus(record: ActionRecord | null | undefined): string | null {
  return record?.status || null;
}

function completedMovement(status: MovementControllerStatus): boolean {
  return (
    status.owner === null &&
    status.active === null &&
    status.path === null &&
    status.mode === "IDLE"
  );
}

function distance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function routeCandidates(
  map: string,
  x: number,
  y: number,
  offset: number,
): Array<Array<{ map: string; x: number; y: number }>> {
  return [
    [
      { map, x: x + offset, y },
      { map, x: x + offset, y: y + offset },
    ],
    [
      { map, x: x - offset, y },
      { map, x: x - offset, y: y + offset },
    ],
    [
      { map, x, y: y + offset },
      { map, x: x + offset, y: y + offset },
    ],
    [
      { map, x, y: y - offset },
      { map, x: x + offset, y: y - offset },
    ],
  ];
}

export class MovementLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly dependencies: MovementLiveTestDependencies) {
    this.now = dependencies.now || (() => Date.now());
    this.sleep =
      dependencies.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(options: MovementLiveTestOptions = {}): Promise<MovementLiveTestResult> {
    const startedAt = this.now();
    const requestId =
      options.requestId || `movement-live-${startedAt}`;
    const owner = options.owner?.trim() || "MovementLiveTest";
    const waypointOffset = Math.max(
      8,
      Number.isFinite(options.waypointOffset)
        ? Number(options.waypointOffset)
        : 18,
    );
    const routeTimeoutMs = Math.max(
      5000,
      Number.isFinite(options.routeTimeoutMs)
        ? Number(options.routeTimeoutMs)
        : 15000,
    );
    const returnTimeoutMs = Math.max(
      5000,
      Number.isFinite(options.returnTimeoutMs)
        ? Number(options.returnTimeoutMs)
        : 30000,
    );
    const pollIntervalMs = Math.max(
      50,
      Number.isFinite(options.pollIntervalMs)
        ? Number(options.pollIntervalMs)
        : 100,
    );

    const result: MovementLiveTestResult = {
      requestId,
      outcome: "FAIL",
      reason: "NOT_RUN",
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      character: null,
      start: null,
      path: {
        attempt: null,
        waypoints: [],
        firstActionStatus: null,
        completed: false,
      },
      returned: {
        actionStatus: null,
        distanceToSafePoint: null,
        confirmed: false,
      },
      evidence: {
        safePointCaptured: false,
        pathOwnerObserved: false,
        pathModeObserved: false,
        waypointProgressObserved: false,
        stuckTelemetryAvailable: false,
        finalIdle: false,
      },
      cleanup: {
        cancelStatus: null,
        safePointCleared: false,
      },
    };

    try {
      const startCharacter = this.dependencies.character();
      result.character = startCharacter.name;
      if (!finitePosition(startCharacter)) {
        result.reason = "START_POSITION_UNKNOWN";
        return this.finish(result);
      }
      if (startCharacter.rip) {
        result.reason = "CHARACTER_DEAD";
        return this.finish(result);
      }

      result.start = {
        map: startCharacter.map,
        x: startCharacter.x,
        y: startCharacter.y,
      };

      this.dependencies.movement.captureSafePoint(8, "MOVEMENT_LIVE_E2E");
      result.evidence.safePointCaptured = true;
      result.evidence.stuckTelemetryAvailable =
        typeof this.dependencies.movement.status().stuck?.stuck === "boolean";

      const candidates = routeCandidates(
        startCharacter.map,
        startCharacter.x,
        startCharacter.y,
        waypointOffset,
      );

      let pathCompleted = false;
      for (let index = 0; index < candidates.length; index += 1) {
        const waypoints = candidates[index];
        result.path.attempt = index + 1;
        result.path.waypoints = waypoints.map((point) => ({ ...point }));

        let first: ActionRecord;
        try {
          first = this.dependencies.movement.path({
            owner,
            module: "MovementLiveTest",
            why: `MOVEMENT_LIVE_E2E_PATH_${index + 1}`,
            correlationId: requestId,
            waypoints,
          });
        } catch (_error) {
          continue;
        }
        result.path.firstActionStatus = actionStatus(first);

        if (first.status === "UNKNOWN") {
          result.outcome = "UNKNOWN";
          result.reason = "PATH_DISPATCH_UNKNOWN";
          return this.finish(result);
        }
        if (first.status === "BLOCKED" || first.status === "REJECTED") {
          continue;
        }

        const observation = await this.observeRoute(
          owner,
          routeTimeoutMs,
          pollIntervalMs,
        );
        result.evidence.pathOwnerObserved ||= observation.ownerObserved;
        result.evidence.pathModeObserved ||= observation.pathModeObserved;
        result.evidence.waypointProgressObserved ||=
          observation.waypointProgressObserved;

        if (observation.outcome === "UNKNOWN") {
          result.outcome = "UNKNOWN";
          result.reason = "PATH_OUTCOME_UNKNOWN";
          return this.finish(result);
        }

        if (observation.outcome === "COMPLETED") {
          const end = this.dependencies.character();
          const destination = waypoints[waypoints.length - 1];
          if (
            finitePosition(end) &&
            end.map === destination.map &&
            distance(end, destination) <= 12
          ) {
            pathCompleted = true;
            result.path.completed = true;
            break;
          }
        }

        const cleanup = await this.cancelActive(
          owner,
          `MOVEMENT_LIVE_E2E_ROUTE_${index + 1}_RECOVERY`,
          requestId,
        );
        if (cleanup === "UNKNOWN") {
          result.outcome = "UNKNOWN";
          result.reason = "PATH_CANCEL_UNKNOWN";
          return this.finish(result);
        }
      }

      if (!pathCompleted) {
        result.outcome = "FAIL";
        result.reason = "NO_AUTONOMOUS_ROUTE_COMPLETED";
        return this.finish(result);
      }

      const returnPromise = this.dependencies.movement.returnToSafePoint({
        owner,
        module: "MovementLiveTest",
        why: "MOVEMENT_LIVE_E2E_RETURN",
        correlationId: requestId,
      });
      const returned = await this.withTimeout(
        returnPromise,
        returnTimeoutMs,
      );
      if (!returned) {
        result.outcome = "TIMEOUT";
        result.reason = "RETURN_TIMEOUT";
        return this.finish(result);
      }

      result.returned.actionStatus = actionStatus(returned);
      if (returned.status === "UNKNOWN") {
        result.outcome = "UNKNOWN";
        result.reason = "RETURN_UNKNOWN";
        return this.finish(result);
      }
      if (returned.status !== "CONFIRMED") {
        result.outcome = "FAIL";
        result.reason = `RETURN_${returned.status || "UNSET"}`;
        return this.finish(result);
      }

      const finalCharacter = this.dependencies.character();
      if (!finitePosition(finalCharacter) || !result.start) {
        result.outcome = "FAIL";
        result.reason = "FINAL_POSITION_UNKNOWN";
        return this.finish(result);
      }

      result.returned.distanceToSafePoint =
        finalCharacter.map === result.start.map
          ? distance(finalCharacter, result.start)
          : null;
      result.returned.confirmed =
        finalCharacter.map === result.start.map &&
        result.returned.distanceToSafePoint !== null &&
        result.returned.distanceToSafePoint <= 12;

      const finalStatus = this.dependencies.movement.status();
      result.evidence.finalIdle = completedMovement(finalStatus);

      if (!result.returned.confirmed) {
        result.outcome = "FAIL";
        result.reason = "RETURN_POSITION_NOT_CONFIRMED";
      } else if (!result.evidence.finalIdle) {
        result.outcome = "FAIL";
        result.reason = "MOVEMENT_NOT_IDLE_AFTER_RETURN";
      } else if (
        !result.evidence.pathOwnerObserved ||
        !result.evidence.pathModeObserved ||
        !result.evidence.waypointProgressObserved ||
        !result.evidence.stuckTelemetryAvailable
      ) {
        result.outcome = "FAIL";
        result.reason = "MOVEMENT_TELEMETRY_INCOMPLETE";
      } else {
        result.outcome = "PASS";
        result.reason = "MOVEMENT_LIVE_E2E_CONFIRMED";
      }

      return this.finish(result);
    } catch (error) {
      result.outcome = "FAIL";
      result.reason =
        error instanceof Error
          ? `UNEXPECTED:${error.message}`
          : `UNEXPECTED:${String(error)}`;
      return this.finish(result);
    } finally {
      const status = this.dependencies.movement.status();
      if (status.active || status.owner) {
        try {
          const cancelled = await this.dependencies.movement.cancel({
            owner,
            module: "MovementLiveTest",
            why: "MOVEMENT_LIVE_E2E_CLEANUP",
            correlationId: requestId,
            force: true,
          });
          result.cleanup.cancelStatus = actionStatus(cancelled);
        } catch (_error) {
          result.cleanup.cancelStatus = "FAILED";
        }
      }
      result.cleanup.safePointCleared =
        this.dependencies.movement.clearSafePoint() !== null;
      this.finish(result);
    }
  }

  private async observeRoute(
    owner: string,
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<RouteObservation> {
    const startedAt = this.now();
    let ownerObserved = false;
    let pathModeObserved = false;
    let waypointProgressObserved = false;
    let initialIndex: number | null = null;

    while (this.now() - startedAt < timeoutMs) {
      const status = this.dependencies.movement.status();
      ownerObserved ||= status.owner === owner;
      pathModeObserved ||= status.mode === "PATH" || status.mode === "STUCK";
      if (status.path) {
        if (initialIndex === null) initialIndex = status.path.index;
        if (status.path.index > initialIndex) waypointProgressObserved = true;
      }

      if (status.mode === "UNKNOWN") {
        return {
          outcome: "UNKNOWN",
          ownerObserved,
          pathModeObserved,
          waypointProgressObserved,
        };
      }
      if (status.mode === "STUCK") {
        return {
          outcome: "FAILED",
          ownerObserved,
          pathModeObserved,
          waypointProgressObserved,
        };
      }
      if (completedMovement(status)) {
        return {
          outcome: "COMPLETED",
          ownerObserved,
          pathModeObserved,
          waypointProgressObserved: true,
        };
      }

      await this.sleep(pollIntervalMs);
    }

    return {
      outcome: "TIMEOUT",
      ownerObserved,
      pathModeObserved,
      waypointProgressObserved,
    };
  }

  private async cancelActive(
    owner: string,
    why: string,
    correlationId: string,
  ): Promise<string | null> {
    const status = this.dependencies.movement.status();
    if (!status.active && !status.owner) return null;

    const record = await this.dependencies.movement.cancel({
      owner,
      module: "MovementLiveTest",
      why,
      correlationId,
      force: true,
    });
    return actionStatus(record);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private finish(result: MovementLiveTestResult): MovementLiveTestResult {
    result.completedAt = this.now();
    result.durationMs = Math.max(0, result.completedAt - result.startedAt);
    return result;
  }
}

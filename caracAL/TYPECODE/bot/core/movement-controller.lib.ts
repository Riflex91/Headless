import type { ActionRecord } from "./action-ledger.lib";
import type {
  BoundaryRequest,
  MoveRequest,
  SmartMoveDestination,
  SmartMoveRequest,
} from "./action-boundary.lib";
import {
  MovementPathPlanner,
  MovementPathStatus,
  MovementWaypoint,
} from "./movement-path.lib";
import {
  MovementPositionSnapshot,
  MovementSafePoint,
  MovementSafePointStore,
  MovementStuckDetector,
  MovementStuckStatus,
} from "./movement-safety.lib";

export type MovementMode =
  | "IDLE"
  | "DIRECT"
  | "SMART"
  | "PATH"
  | "RETURN"
  | "STUCK"
  | "CANCELLING"
  | "UNKNOWN";

export type MovementCommandType = "DIRECT" | "SMART" | "CANCEL";

export interface MovementControllerEvent {
  type:
    | "MOVEMENT_OWNER_ACQUIRED"
    | "MOVEMENT_OWNER_RELEASED"
    | "MOVEMENT_OWNER_PREEMPTED"
    | "MOVEMENT_COMMAND_STARTED"
    | "MOVEMENT_COMMAND_SETTLED"
    | "MOVEMENT_COMMAND_UNKNOWN"
    | "MOVEMENT_PATH_STARTED"
    | "MOVEMENT_WAYPOINT_STARTED"
    | "MOVEMENT_WAYPOINT_SETTLED"
    | "MOVEMENT_PATH_COMPLETED"
    | "MOVEMENT_PATH_FAILED"
    | "MOVEMENT_PATH_CANCELLED"
    | "MOVEMENT_SAFE_POINT_SET"
    | "MOVEMENT_SAFE_POINT_CLEARED"
    | "MOVEMENT_RETURN_STARTED"
    | "MOVEMENT_STUCK"
    | "MOVEMENT_PROGRESS_RESUMED";
  timestamp: number;
  owner: string | null;
  previousOwner?: string | null;
  commandType?: MovementCommandType;
  commandId?: number;
  actionId?: string;
  status?: string | null;
  reason?: string;
  pathId?: number;
  waypointIndex?: number;
  waypointCount?: number;
  safePoint?: MovementSafePoint | null;
  stuckSince?: number | null;
}

export interface MovementControllerOptions {
  now?: () => number;
  onEvent?: (event: MovementControllerEvent) => void;
  directSettlementTolerance?: number;
  antiPingPongDistance?: number;
  position?: () => MovementPositionSnapshot;
  stuckTimeoutMs?: number;
  stuckProgressDistance?: number;
}

export interface MovementRequestBase {
  owner: string;
  module: string;
  why: string;
  correlationId?: string;
}

export interface DirectMovementRequest extends MovementRequestBase {
  x: number;
  y: number;
}

export interface SmartMovementRequest extends MovementRequestBase {
  destination: SmartMoveDestination;
}

export interface CancelMovementRequest extends MovementRequestBase {
  force?: boolean;
}

export interface PathMovementRequest extends MovementRequestBase {
  waypoints: MovementWaypoint[];
  allowBacktrack?: boolean;
}

export interface ReturnMovementRequest extends MovementRequestBase {}

export interface MovementActionBoundary {
  directMove(request: MoveRequest): ActionRecord;
  cancelDirectMove(actionId: string, reason?: string): ActionRecord;
  settleMove(actionId: string, tolerance?: number): ActionRecord;
  smartMove(request: SmartMoveRequest): Promise<ActionRecord>;
  cancelMovement(request: BoundaryRequest): Promise<ActionRecord>;
}

interface ActiveMovementCommand {
  id: number;
  type: MovementCommandType;
  owner: string;
  startedAt: number;
  actionId: string | null;
  target: Record<string, unknown> | null;
}

interface MovementPathContext {
  pathId: number;
  module: string;
  why: string;
  correlationId?: string;
}

export interface MovementControllerStatus {
  owner: string | null;
  mode: MovementMode;
  path: MovementPathStatus | null;
  safePoint: MovementSafePoint | null;
  stuck: MovementStuckStatus;
  active: {
    id: number;
    type: MovementCommandType;
    owner: string;
    startedAt: number;
    actionId: string | null;
    target: Record<string, unknown> | null;
  } | null;
}

export class MovementOwnershipError extends Error {
  readonly code = "MOVEMENT_OWNED_BY_OTHER";

  constructor(
    readonly requestedOwner: string,
    readonly currentOwner: string,
  ) {
    super(
      `movement owned by ${currentOwner}; ${requestedOwner} cannot issue movement`,
    );
    this.name = "MovementOwnershipError";
  }
}

function requiredOwner(owner: string): string {
  const normalized = owner?.trim();
  if (!normalized) {
    throw new Error("movement request requires owner");
  }
  return normalized;
}

function targetForDirect(
  request: DirectMovementRequest,
): Record<string, unknown> {
  return {
    x: request.x,
    y: request.y,
  };
}

function targetForSmart(
  request: SmartMovementRequest,
): Record<string, unknown> {
  return {
    destination: request.destination,
  };
}

export class MovementController {
  private readonly now: () => number;
  private readonly onEvent?: (event: MovementControllerEvent) => void;
  private readonly directSettlementTolerance: number;
  private readonly paths: MovementPathPlanner;
  private readonly safePoints: MovementSafePointStore;
  private readonly stuckDetector: MovementStuckDetector;
  private readonly position?: () => MovementPositionSnapshot;
  private owner: string | null = null;
  private mode: MovementMode = "IDLE";
  private active: ActiveMovementCommand | null = null;
  private pathContext: MovementPathContext | null = null;
  private stuckPreviousMode: MovementMode | null = null;
  private commandSequence = 0;

  constructor(
    private readonly actions: MovementActionBoundary,
    options: MovementControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.onEvent = options.onEvent;
    this.directSettlementTolerance =
      Number.isFinite(options.directSettlementTolerance) &&
      (options.directSettlementTolerance || 0) > 0
        ? Number(options.directSettlementTolerance)
        : 5;
    this.paths = new MovementPathPlanner({
      now: this.now,
      antiPingPongDistance: options.antiPingPongDistance,
    });
    this.safePoints = new MovementSafePointStore(this.now);
    this.stuckDetector = new MovementStuckDetector({
      now: this.now,
      timeoutMs: options.stuckTimeoutMs,
      minProgressDistance: options.stuckProgressDistance,
    });
    this.position = options.position;
  }

  status(): MovementControllerStatus {
    return {
      owner: this.owner,
      mode: this.mode,
      path: this.paths.status(),
      safePoint: this.safePoints.get(),
      stuck: this.stuckDetector.status(),
      active: this.active
        ? {
            ...this.active,
            target: this.active.target
              ? { ...this.active.target }
              : null,
          }
        : null,
    };
  }

  acquire(owner: string): boolean {
    const requested = requiredOwner(owner);
    if (this.owner === requested) return true;
    if (this.owner !== null) return false;

    this.owner = requested;
    this.emit({
      type: "MOVEMENT_OWNER_ACQUIRED",
      owner: requested,
    });
    return true;
  }

  release(owner: string, reason = "MOVEMENT_OWNER_RELEASED"): boolean {
    const requested = requiredOwner(owner);
    if (this.owner !== requested || this.active !== null) return false;

    this.owner = null;
    this.stuckPreviousMode = null;
    this.stuckDetector.clear();
    this.mode = "IDLE";
    this.emit({
      type: "MOVEMENT_OWNER_RELEASED",
      owner: null,
      previousOwner: requested,
      reason,
    });
    return true;
  }

  setSafePoint(
    point: { map: string; x: number; y: number; tolerance?: number },
    source = "MANUAL",
  ): MovementSafePoint {
    const safePoint = this.safePoints.set(point, source);
    this.emit({
      type: "MOVEMENT_SAFE_POINT_SET",
      owner: this.owner,
      safePoint,
    });
    return safePoint;
  }

  captureSafePoint(
    tolerance?: number,
    source = "CURRENT_POSITION",
  ): MovementSafePoint {
    const position = this.readPosition();
    if (!position) {
      throw new Error("movement position source unavailable");
    }

    const safePoint = this.safePoints.capture(
      position,
      tolerance,
      source,
    );
    this.emit({
      type: "MOVEMENT_SAFE_POINT_SET",
      owner: this.owner,
      safePoint,
    });
    return safePoint;
  }

  clearSafePoint(): MovementSafePoint | null {
    const safePoint = this.safePoints.clear();
    if (safePoint) {
      this.emit({
        type: "MOVEMENT_SAFE_POINT_CLEARED",
        owner: this.owner,
        safePoint,
      });
    }
    return safePoint;
  }

  async returnToSafePoint(
    request: ReturnMovementRequest,
  ): Promise<ActionRecord> {
    const safePoint = this.safePoints.get();
    if (!safePoint) {
      throw new Error("movement safe point is not configured");
    }

    const owner = requiredOwner(request.owner);
    const promise = this.smart({
      owner,
      module: request.module,
      why: request.why,
      correlationId: request.correlationId,
      destination: {
        map: safePoint.map,
        x: safePoint.x,
        y: safePoint.y,
      },
    });

    if (this.owner === owner && this.active?.type === "SMART") {
      this.mode = "RETURN";
      this.emit({
        type: "MOVEMENT_RETURN_STARTED",
        owner,
        commandId: this.active.id,
        actionId: this.active.actionId || undefined,
        safePoint,
      });
    }

    return promise;
  }

  direct(request: DirectMovementRequest): ActionRecord {
    const owner = this.requireOwner(request.owner);
    const command = this.startCommand(
      "DIRECT",
      owner,
      targetForDirect(request),
    );

    const record = this.actions.directMove({
      x: request.x,
      y: request.y,
      module: request.module,
      why: request.why,
      correlationId: request.correlationId,
    });

    if (this.isCurrent(command.id)) {
      this.active!.actionId = record.id;
      if (
        record.status === "CONFIRMED" ||
        record.status === "BLOCKED" ||
        record.status === "REJECTED"
      ) {
        this.settleCurrent(record, true);
      } else if (record.status === "UNKNOWN") {
        this.mode = "UNKNOWN";
        this.emitUnknown(record);
      }
    }

    return record;
  }

  path(request: PathMovementRequest): ActionRecord {
    if (this.active) {
      throw new Error(
        `movement command already active: ${this.active.type}#${this.active.id}`,
      );
    }

    const previousOwner = this.owner;
    const owner = this.requireOwner(request.owner);

    let pathStatus: MovementPathStatus;
    try {
      pathStatus = this.paths.start({
        owner,
        waypoints: request.waypoints,
        allowBacktrack: request.allowBacktrack,
      });
    } catch (error) {
      if (previousOwner === null && this.owner === owner) {
        this.release(owner, "MOVEMENT_PATH_REJECTED");
      }
      throw error;
    }

    this.pathContext = {
      pathId: pathStatus.id,
      module: request.module,
      why: request.why,
      correlationId: request.correlationId,
    };
    this.mode = "PATH";
    this.emit({
      type: "MOVEMENT_PATH_STARTED",
      owner,
      pathId: pathStatus.id,
      waypointIndex: 0,
      waypointCount: pathStatus.total,
    });

    return this.dispatchPathWaypoint();
  }

  async smart(request: SmartMovementRequest): Promise<ActionRecord> {
    const owner = this.requireOwner(request.owner);
    const command = this.startCommand(
      "SMART",
      owner,
      targetForSmart(request),
    );

    const promise = this.actions.smartMove({
      destination: request.destination,
      module: request.module,
      why: request.why,
      correlationId: request.correlationId,
    });

    const record = await promise;
    if (!this.isCurrent(command.id)) return record;

    this.active!.actionId = record.id;
    if (
      record.status === "CONFIRMED" ||
      record.status === "REJECTED" ||
      record.status === "BLOCKED"
    ) {
      this.settleCurrent(record, true);
    } else if (record.status === "UNKNOWN") {
      this.mode = "UNKNOWN";
      this.emitUnknown(record);
    }

    return record;
  }

  observe(): ActionRecord | null {
    const command = this.active;
    if (!command) return null;

    if (command.type !== "DIRECT" || !command.actionId) {
      this.observeStuck(command);
      return null;
    }

    const pathBeforeSettlement = this.paths.status();
    const settlementTolerance =
      pathBeforeSettlement?.current?.tolerance ??
      this.directSettlementTolerance;
    const record = this.actions.settleMove(
      command.actionId,
      settlementTolerance,
    );
    if (!this.isCurrent(command.id)) return record;

    const pathStatus = this.paths.status();
    const isPathWaypoint =
      pathStatus !== null &&
      pathStatus.owner === command.owner &&
      this.pathContext?.pathId === pathStatus.id;

    if (record.status === "CONFIRMED" && isPathWaypoint) {
      this.settleCurrent(record, false);
      const progress = this.paths.settleCurrent();
      this.emit({
        type: "MOVEMENT_WAYPOINT_SETTLED",
        owner: command.owner,
        pathId: progress.pathId,
        waypointIndex: progress.waypointIndex,
        waypointCount: progress.waypointCount,
        actionId: record.id,
        status: record.status,
      });

      if (progress.completed) {
        const completedPathId = progress.pathId;
        const owner = command.owner;
        this.pathContext = null;
        this.mode = "IDLE";
        this.release(owner, "MOVEMENT_PATH_COMPLETED");
        this.emit({
          type: "MOVEMENT_PATH_COMPLETED",
          owner: null,
          previousOwner: owner,
          pathId: completedPathId,
          waypointIndex: progress.waypointCount,
          waypointCount: progress.waypointCount,
          actionId: record.id,
          status: record.status,
        });
      } else {
        this.mode = "PATH";
        this.dispatchPathWaypoint();
      }
    } else if (
      (record.status === "REJECTED" ||
        record.status === "BLOCKED") &&
      isPathWaypoint
    ) {
      this.settleCurrent(record, false);
      this.failPath(
        record.status === "BLOCKED"
          ? "MOVEMENT_WAYPOINT_BLOCKED"
          : "MOVEMENT_WAYPOINT_REJECTED",
        record,
      );
    } else if (
      record.status === "CONFIRMED" ||
      record.status === "REJECTED" ||
      record.status === "BLOCKED"
    ) {
      this.settleCurrent(record, true);
    } else if (record.status === "UNKNOWN") {
      this.mode = "UNKNOWN";
      this.emitUnknown(record);
    }

    return record;
  }

  async cancel(request: CancelMovementRequest): Promise<ActionRecord> {
    const requestedOwner = requiredOwner(request.owner);
    const previousOwner = this.owner;
    const previousMode = this.mode;
    const previousActive = this.active
      ? {
          ...this.active,
          target: this.active.target
            ? { ...this.active.target }
            : null,
        }
      : null;

    if (
      this.owner !== null &&
      this.owner !== requestedOwner &&
      !request.force
    ) {
      throw new MovementOwnershipError(requestedOwner, this.owner);
    }

    if (this.owner !== requestedOwner) {
      this.emit({
        type: "MOVEMENT_OWNER_PREEMPTED",
        owner: requestedOwner,
        previousOwner: this.owner,
        reason: request.force ? "FORCED_CANCEL" : "CANCEL_UNOWNED",
      });
      this.owner = requestedOwner;
    }

    const command = this.startCommand("CANCEL", requestedOwner, null, true);
    const record = await this.actions.cancelMovement({
      module: request.module,
      why: request.why,
      correlationId: request.correlationId,
    });

    if (!this.isCurrent(command.id)) return record;
    this.active!.actionId = record.id;

    if (record.status === "CONFIRMED") {
      if (
        previousActive?.type === "DIRECT" &&
        previousActive.actionId
      ) {
        this.actions.cancelDirectMove(
          previousActive.actionId,
          "MOVE_CANCELLED",
        );
      }

      const cancelledPath = this.paths.cancel();
      this.pathContext = null;
      this.settleCurrent(record, true);
      if (cancelledPath) {
        this.emit({
          type: "MOVEMENT_PATH_CANCELLED",
          owner: null,
          previousOwner: cancelledPath.owner,
          pathId: cancelledPath.id,
          waypointIndex: cancelledPath.index,
          waypointCount: cancelledPath.total,
          actionId: record.id,
          status: record.status,
          reason: request.why,
        });
      }
      return record;
    }

    if (record.status === "UNKNOWN") {
      this.mode = "UNKNOWN";
      this.emitUnknown(record);
      return record;
    }

    this.active = previousActive;
    this.mode = previousActive ? previousMode : "IDLE";
    this.owner = previousOwner;
    this.stuckPreviousMode = null;
    if (previousActive) {
      this.stuckDetector.reset(
        this.commandKey(previousActive),
        this.readPosition(),
      );
    } else {
      this.stuckDetector.clear();
    }
    this.emit({
      type: "MOVEMENT_COMMAND_SETTLED",
      owner: this.owner,
      commandType: "CANCEL",
      commandId: command.id,
      actionId: record.id,
      status: record.status,
      reason: "CANCEL_NOT_CONFIRMED",
    });
    return record;
  }

  private dispatchPathWaypoint(): ActionRecord {
    const path = this.paths.status();
    const context = this.pathContext;
    const waypoint = this.paths.current();
    if (!path || !context || !waypoint || context.pathId !== path.id) {
      throw new Error("movement path state is not dispatchable");
    }

    this.emit({
      type: "MOVEMENT_WAYPOINT_STARTED",
      owner: path.owner,
      pathId: path.id,
      waypointIndex: path.index,
      waypointCount: path.total,
    });

    const record = this.direct({
      owner: path.owner,
      module: context.module,
      why: `${context.why}:WAYPOINT_${path.index + 1}`,
      correlationId: context.correlationId,
      x: waypoint.x,
      y: waypoint.y,
    });

    if (
      record.status === "DISPATCHED" &&
      this.paths.status()?.id === path.id
    ) {
      this.mode = "PATH";
    }

    if (
      record.status === "BLOCKED" ||
      record.status === "REJECTED"
    ) {
      this.failPath(
        record.status === "BLOCKED"
          ? "MOVEMENT_WAYPOINT_BLOCKED"
          : "MOVEMENT_WAYPOINT_REJECTED",
        record,
      );
    }
    return record;
  }

  private failPath(reason: string, record: ActionRecord): void {
    const path = this.paths.cancel();
    this.pathContext = null;
    if (!path) return;

    const owner = path.owner;
    if (this.active) {
      this.active = null;
    }
    this.mode = "IDLE";
    if (this.owner === owner) {
      this.release(owner, "MOVEMENT_PATH_FAILED");
    }
    this.emit({
      type: "MOVEMENT_PATH_FAILED",
      owner: this.owner,
      previousOwner: owner,
      pathId: path.id,
      waypointIndex: path.index,
      waypointCount: path.total,
      actionId: record.id,
      status: record.status,
      reason,
    });
  }

  private observeStuck(command: ActiveMovementCommand): void {
    const position = this.readPosition();
    if (!position) return;

    const observation = this.stuckDetector.observe(
      this.commandKey(command),
      position,
    );

    if (observation.transition === "STUCK") {
      if (this.mode !== "STUCK") {
        this.stuckPreviousMode = this.mode;
      }
      this.mode = "STUCK";
      this.emit({
        type: "MOVEMENT_STUCK",
        owner: this.owner,
        commandType: command.type,
        commandId: command.id,
        actionId: command.actionId || undefined,
        stuckSince: observation.status.stuckSince,
      });
    } else if (observation.transition === "RESUMED") {
      const restoredMode = this.stuckPreviousMode;
      this.stuckPreviousMode = null;
      this.mode =
        restoredMode && restoredMode !== "STUCK"
          ? restoredMode
          : command.type === "SMART"
            ? "SMART"
            : this.paths.status()
              ? "PATH"
              : "DIRECT";
      this.emit({
        type: "MOVEMENT_PROGRESS_RESUMED",
        owner: this.owner,
        commandType: command.type,
        commandId: command.id,
        actionId: command.actionId || undefined,
      });
    }
  }

  private readPosition(): MovementPositionSnapshot | null {
    if (!this.position) return null;

    try {
      return this.position();
    } catch (_error) {
      return null;
    }
  }

  private commandKey(command: ActiveMovementCommand): string {
    return `${command.owner}:${command.id}`;
  }

  private requireOwner(owner: string): string {
    const requested = requiredOwner(owner);
    if (this.owner === null) {
      this.owner = requested;
      this.emit({
        type: "MOVEMENT_OWNER_ACQUIRED",
        owner: requested,
      });
      return requested;
    }
    if (this.owner !== requested) {
      throw new MovementOwnershipError(requested, this.owner);
    }
    return requested;
  }

  private startCommand(
    type: MovementCommandType,
    owner: string,
    target: Record<string, unknown> | null,
    replaceActive = false,
  ): ActiveMovementCommand {
    if (this.active && !replaceActive) {
      throw new Error(
        `movement command already active: ${this.active.type}#${this.active.id}`,
      );
    }

    this.commandSequence += 1;
    const command: ActiveMovementCommand = {
      id: this.commandSequence,
      type,
      owner,
      startedAt: this.now(),
      actionId: null,
      target: target ? { ...target } : null,
    };
    this.active = command;
    this.stuckPreviousMode = null;
    this.stuckDetector.reset(this.commandKey(command), this.readPosition());
    this.mode =
      type === "DIRECT"
        ? "DIRECT"
        : type === "SMART"
          ? "SMART"
          : "CANCELLING";
    this.emit({
      type: "MOVEMENT_COMMAND_STARTED",
      owner,
      commandType: type,
      commandId: command.id,
    });
    return command;
  }

  private isCurrent(commandId: number): boolean {
    return this.active?.id === commandId;
  }

  private settleCurrent(
    record: ActionRecord,
    releaseOwnership: boolean,
  ): void {
    const command = this.active;
    if (!command) return;

    const owner = this.owner;
    this.active = null;
    this.stuckPreviousMode = null;
    this.stuckDetector.clear();
    this.mode = "IDLE";
    if (releaseOwnership) this.owner = null;

    this.emit({
      type: "MOVEMENT_COMMAND_SETTLED",
      owner: this.owner,
      previousOwner: releaseOwnership ? owner : undefined,
      commandType: command.type,
      commandId: command.id,
      actionId: record.id,
      status: record.status,
    });
    if (releaseOwnership && owner) {
      this.emit({
        type: "MOVEMENT_OWNER_RELEASED",
        owner: null,
        previousOwner: owner,
        reason: "MOVEMENT_COMMAND_SETTLED",
      });
    }
  }

  private emitUnknown(record: ActionRecord): void {
    const command = this.active;
    this.emit({
      type: "MOVEMENT_COMMAND_UNKNOWN",
      owner: this.owner,
      commandType: command?.type,
      commandId: command?.id,
      actionId: record.id,
      status: record.status,
      reason: "MOVEMENT_OUTCOME_UNKNOWN",
    });
  }

  private emit(
    event: Omit<MovementControllerEvent, "timestamp">,
  ): void {
    this.onEvent?.({
      ...event,
      timestamp: this.now(),
    });
  }
}

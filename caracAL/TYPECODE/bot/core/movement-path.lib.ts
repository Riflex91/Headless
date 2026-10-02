export interface MovementWaypoint {
  x: number;
  y: number;
  map?: string;
  tolerance?: number;
}

export interface MovementPathStatus {
  id: number;
  owner: string;
  startedAt: number;
  index: number;
  total: number;
  allowBacktrack: boolean;
  current: MovementWaypoint | null;
  destination: MovementWaypoint;
  waypoints: MovementWaypoint[];
  remaining: MovementWaypoint[];
}

export interface MovementPathStart {
  owner: string;
  waypoints: MovementWaypoint[];
  allowBacktrack?: boolean;
}

export interface MovementPathProgress {
  completed: boolean;
  settled: MovementWaypoint;
  next: MovementWaypoint | null;
  pathId: number;
  waypointIndex: number;
  waypointCount: number;
}

export interface MovementPathPlannerOptions {
  now?: () => number;
  antiPingPongDistance?: number;
}

interface ActiveMovementPath {
  id: number;
  owner: string;
  startedAt: number;
  index: number;
  allowBacktrack: boolean;
  waypoints: MovementWaypoint[];
}

export class MovementPathError extends Error {
  constructor(
    readonly code:
      | "MOVEMENT_PATH_EMPTY"
      | "MOVEMENT_WAYPOINT_INVALID"
      | "MOVEMENT_PATH_PINGPONG",
    message: string,
  ) {
    super(message);
    this.name = "MovementPathError";
  }
}

function cloneWaypoint(waypoint: MovementWaypoint): MovementWaypoint {
  return {
    x: waypoint.x,
    y: waypoint.y,
    ...(waypoint.map !== undefined && { map: waypoint.map }),
    ...(waypoint.tolerance !== undefined && {
      tolerance: waypoint.tolerance,
    }),
  };
}

function validWaypoint(waypoint: MovementWaypoint): boolean {
  return (
    !!waypoint &&
    Number.isFinite(waypoint.x) &&
    Number.isFinite(waypoint.y) &&
    (waypoint.map === undefined ||
      (typeof waypoint.map === "string" &&
        waypoint.map.trim().length > 0)) &&
    (waypoint.tolerance === undefined ||
      (Number.isFinite(waypoint.tolerance) && waypoint.tolerance > 0))
  );
}

function sameWaypoint(
  left: MovementWaypoint,
  right: MovementWaypoint,
  distance: number,
): boolean {
  if (
    left.map !== undefined &&
    right.map !== undefined &&
    left.map !== right.map
  ) {
    return false;
  }

  return Math.hypot(left.x - right.x, left.y - right.y) <= distance;
}

export class MovementPathPlanner {
  private readonly now: () => number;
  private readonly antiPingPongDistance: number;
  private active: ActiveMovementPath | null = null;
  private pathSequence = 0;
  private recentSettled: MovementWaypoint[] = [];

  constructor(options: MovementPathPlannerOptions = {}) {
    this.now = options.now || (() => Date.now());
    this.antiPingPongDistance =
      Number.isFinite(options.antiPingPongDistance) &&
      (options.antiPingPongDistance || 0) > 0
        ? Number(options.antiPingPongDistance)
        : 5;
  }

  start(request: MovementPathStart): MovementPathStatus {
    const owner = request.owner?.trim();
    if (!owner) {
      throw new MovementPathError(
        "MOVEMENT_WAYPOINT_INVALID",
        "movement path requires owner",
      );
    }
    if (!Array.isArray(request.waypoints) || request.waypoints.length === 0) {
      throw new MovementPathError(
        "MOVEMENT_PATH_EMPTY",
        "movement path requires at least one waypoint",
      );
    }
    if (this.active) {
      throw new Error(`movement path already active: ${this.active.id}`);
    }

    const waypoints: MovementWaypoint[] = [];
    for (const candidate of request.waypoints) {
      if (!validWaypoint(candidate)) {
        throw new MovementPathError(
          "MOVEMENT_WAYPOINT_INVALID",
          "movement path contains invalid waypoint",
        );
      }

      const waypoint = cloneWaypoint(candidate);
      const previous = waypoints[waypoints.length - 1];
      if (
        previous &&
        sameWaypoint(previous, waypoint, this.antiPingPongDistance)
      ) {
        continue;
      }
      waypoints.push(waypoint);
    }

    if (waypoints.length === 0) {
      throw new MovementPathError(
        "MOVEMENT_PATH_EMPTY",
        "movement path has no distinct waypoints",
      );
    }

    const allowBacktrack = request.allowBacktrack === true;
    if (!allowBacktrack) {
      this.assertNoPingPong(waypoints);
      this.assertNoHistoryPingPong(waypoints[0]);
    }

    this.pathSequence += 1;
    this.active = {
      id: this.pathSequence,
      owner,
      startedAt: this.now(),
      index: 0,
      allowBacktrack,
      waypoints,
    };

    return this.status()!;
  }

  status(): MovementPathStatus | null {
    if (!this.active) return null;

    const waypoints = this.active.waypoints.map(cloneWaypoint);
    const current = waypoints[this.active.index] || null;
    return {
      id: this.active.id,
      owner: this.active.owner,
      startedAt: this.active.startedAt,
      index: this.active.index,
      total: waypoints.length,
      allowBacktrack: this.active.allowBacktrack,
      current,
      destination: cloneWaypoint(waypoints[waypoints.length - 1]),
      waypoints,
      remaining: waypoints.slice(this.active.index).map(cloneWaypoint),
    };
  }

  current(): MovementWaypoint | null {
    const waypoint = this.active?.waypoints[this.active.index];
    return waypoint ? cloneWaypoint(waypoint) : null;
  }

  settleCurrent(): MovementPathProgress {
    const path = this.active;
    if (!path) {
      throw new Error("no active movement path");
    }

    const settled = path.waypoints[path.index];
    if (!settled) {
      throw new Error(`movement path ${path.id} has no current waypoint`);
    }

    const waypointIndex = path.index;
    this.recentSettled.push(cloneWaypoint(settled));
    this.recentSettled = this.recentSettled.slice(-2);

    path.index += 1;
    const completed = path.index >= path.waypoints.length;
    const next = completed ? null : cloneWaypoint(path.waypoints[path.index]);
    const result: MovementPathProgress = {
      completed,
      settled: cloneWaypoint(settled),
      next,
      pathId: path.id,
      waypointIndex,
      waypointCount: path.waypoints.length,
    };

    if (completed) {
      this.active = null;
    }
    return result;
  }

  cancel(): MovementPathStatus | null {
    const status = this.status();
    this.active = null;
    return status;
  }

  private assertNoPingPong(waypoints: MovementWaypoint[]): void {
    for (let index = 2; index < waypoints.length; index += 1) {
      const previousPrevious = waypoints[index - 2];
      const previous = waypoints[index - 1];
      const current = waypoints[index];

      if (
        sameWaypoint(
          previousPrevious,
          current,
          this.antiPingPongDistance,
        ) &&
        !sameWaypoint(previous, current, this.antiPingPongDistance)
      ) {
        throw new MovementPathError(
          "MOVEMENT_PATH_PINGPONG",
          `movement path oscillates at waypoint ${index + 1}`,
        );
      }
    }
  }

  private assertNoHistoryPingPong(candidate: MovementWaypoint): void {
    if (this.recentSettled.length < 2) return;

    const earlier = this.recentSettled[this.recentSettled.length - 2];
    const latest = this.recentSettled[this.recentSettled.length - 1];
    if (
      sameWaypoint(earlier, candidate, this.antiPingPongDistance) &&
      !sameWaypoint(latest, candidate, this.antiPingPongDistance)
    ) {
      throw new MovementPathError(
        "MOVEMENT_PATH_PINGPONG",
        "movement path would immediately oscillate to the previous waypoint",
      );
    }
  }
}

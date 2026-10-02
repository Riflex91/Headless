export interface MovementPositionSnapshot {
  map: string | null;
  x: number | null;
  y: number | null;
  moving: boolean;
}

export interface MovementSafePoint {
  map: string;
  x: number;
  y: number;
  tolerance?: number;
  source: string;
  capturedAt: number;
}

export interface MovementStuckStatus {
  commandKey: string | null;
  stuck: boolean;
  stuckSince: number | null;
  lastProgressAt: number | null;
  lastPosition: MovementPositionSnapshot | null;
}

export interface MovementStuckObservation {
  status: MovementStuckStatus;
  transition: "STUCK" | "RESUMED" | null;
}

export interface MovementStuckDetectorOptions {
  now?: () => number;
  timeoutMs?: number;
  minProgressDistance?: number;
}

function clonePosition(
  position: MovementPositionSnapshot | null,
): MovementPositionSnapshot | null {
  return position ? { ...position } : null;
}

function validPosition(
  position: MovementPositionSnapshot | null | undefined,
): position is MovementPositionSnapshot & { x: number; y: number } {
  return (
    !!position &&
    typeof position.x === "number" &&
    Number.isFinite(position.x) &&
    typeof position.y === "number" &&
    Number.isFinite(position.y)
  );
}

function normalizedSafePoint(
  map: string,
  x: number,
  y: number,
  tolerance?: number,
): Pick<MovementSafePoint, "map" | "x" | "y" | "tolerance"> {
  const normalizedMap = map?.trim();
  if (!normalizedMap || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("invalid movement safe point");
  }
  if (
    tolerance !== undefined &&
    (!Number.isFinite(tolerance) || tolerance <= 0)
  ) {
    throw new Error("invalid movement safe point tolerance");
  }

  return {
    map: normalizedMap,
    x,
    y,
    ...(tolerance !== undefined && { tolerance }),
  };
}

export class MovementSafePointStore {
  private safePoint: MovementSafePoint | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  set(
    point: { map: string; x: number; y: number; tolerance?: number },
    source = "MANUAL",
  ): MovementSafePoint {
    const normalized = normalizedSafePoint(
      point.map,
      point.x,
      point.y,
      point.tolerance,
    );
    const normalizedSource = source?.trim() || "MANUAL";

    this.safePoint = {
      ...normalized,
      source: normalizedSource,
      capturedAt: this.now(),
    };
    return this.get()!;
  }

  capture(
    position: MovementPositionSnapshot,
    tolerance?: number,
    source = "CURRENT_POSITION",
  ): MovementSafePoint {
    if (
      typeof position.map !== "string" ||
      !position.map.trim() ||
      !validPosition(position)
    ) {
      throw new Error("cannot capture safe point from unknown position");
    }

    return this.set(
      {
        map: position.map,
        x: position.x,
        y: position.y,
        ...(tolerance !== undefined && { tolerance }),
      },
      source,
    );
  }

  get(): MovementSafePoint | null {
    return this.safePoint ? { ...this.safePoint } : null;
  }

  clear(): MovementSafePoint | null {
    const previous = this.get();
    this.safePoint = null;
    return previous;
  }
}

export class MovementStuckDetector {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly minProgressDistance: number;
  private commandKey: string | null = null;
  private stuckSince: number | null = null;
  private lastProgressAt: number | null = null;
  private lastPosition: MovementPositionSnapshot | null = null;

  constructor(options: MovementStuckDetectorOptions = {}) {
    this.now = options.now || (() => Date.now());
    this.timeoutMs =
      Number.isFinite(options.timeoutMs) && (options.timeoutMs || 0) >= 250
        ? Number(options.timeoutMs)
        : 5000;
    this.minProgressDistance =
      Number.isFinite(options.minProgressDistance) &&
      (options.minProgressDistance || 0) > 0
        ? Number(options.minProgressDistance)
        : 5;
  }

  reset(
    commandKey: string,
    position?: MovementPositionSnapshot | null,
  ): MovementStuckStatus {
    const normalized = commandKey?.trim();
    if (!normalized) {
      throw new Error("stuck detector requires command key");
    }

    this.commandKey = normalized;
    this.stuckSince = null;
    this.lastProgressAt = this.now();
    this.lastPosition = validPosition(position || null)
      ? clonePosition(position || null)
      : null;
    return this.status();
  }

  observe(
    commandKey: string,
    position: MovementPositionSnapshot | null | undefined,
  ): MovementStuckObservation {
    const normalized = commandKey?.trim();
    if (!normalized) {
      throw new Error("stuck detector requires command key");
    }

    if (this.commandKey !== normalized) {
      this.reset(normalized, position || null);
      return { status: this.status(), transition: null };
    }

    if (!validPosition(position)) {
      return { status: this.status(), transition: null };
    }

    const now = this.now();
    let progressed = false;
    if (!validPosition(this.lastPosition)) {
      progressed = true;
    } else if (
      this.lastPosition.map !== position.map ||
      Math.hypot(
        position.x - this.lastPosition.x,
        position.y - this.lastPosition.y,
      ) >= this.minProgressDistance
    ) {
      progressed = true;
    }

    if (progressed) {
      const transition = this.stuckSince !== null ? "RESUMED" : null;
      this.lastPosition = clonePosition(position);
      this.lastProgressAt = now;
      this.stuckSince = null;
      return { status: this.status(), transition };
    }

    if (
      this.stuckSince === null &&
      this.lastProgressAt !== null &&
      now - this.lastProgressAt >= this.timeoutMs
    ) {
      this.stuckSince = now;
      return { status: this.status(), transition: "STUCK" };
    }

    return { status: this.status(), transition: null };
  }

  clear(): MovementStuckStatus {
    this.commandKey = null;
    this.stuckSince = null;
    this.lastProgressAt = null;
    this.lastPosition = null;
    return this.status();
  }

  status(): MovementStuckStatus {
    return {
      commandKey: this.commandKey,
      stuck: this.stuckSince !== null,
      stuckSince: this.stuckSince,
      lastProgressAt: this.lastProgressAt,
      lastPosition: clonePosition(this.lastPosition),
    };
  }
}

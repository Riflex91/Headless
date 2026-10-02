export type RuntimeState = "RUNNING" | "PAUSED" | "STOPPED";

export interface SchedulerJobContext {
  now: number;
  runtimeState: RuntimeState;
}

export interface SchedulerJob {
  id: string;
  intervalMs: number;
  priority?: number;
  runWhenPaused?: boolean;
  tick(context: SchedulerJobContext): void | Promise<void>;
}

export interface SchedulerEvent {
  type:
    | "JOB_REGISTERED"
    | "JOB_UNREGISTERED"
    | "JOB_STARTED"
    | "JOB_COMPLETED"
    | "JOB_FAILED"
    | "JOB_SKIPPED";
  jobId: string;
  timestamp: number;
  reason?: string;
  durationMs?: number;
  error?: string;
}

export interface SchedulerOptions {
  resolutionMs?: number;
  now?: () => number;
  getRuntimeState?: () => RuntimeState;
  onEvent?: (event: SchedulerEvent) => void;
}

interface ScheduledJobState {
  job: SchedulerJob;
  nextDueAt: number;
  running: boolean;
}

export class Scheduler {
  private readonly jobs = new Map<string, ScheduledJobState>();
  private readonly resolutionMs: number;
  private readonly now: () => number;
  private readonly getRuntimeState: () => RuntimeState;
  private readonly onEvent?: (event: SchedulerEvent) => void;
  private timer: number | undefined;
  private ticking = false;

  constructor(options: SchedulerOptions = {}) {
    this.resolutionMs = Math.max(25, options.resolutionMs || 100);
    this.now = options.now || (() => Date.now());
    this.getRuntimeState =
      options.getRuntimeState || (() => "RUNNING" as RuntimeState);
    this.onEvent = options.onEvent;
  }

  register(job: SchedulerJob): void {
    if (!job.id?.trim()) {
      throw new Error("scheduler job requires id");
    }
    if (!Number.isFinite(job.intervalMs) || job.intervalMs < 25) {
      throw new Error(`invalid scheduler interval for ${job.id}`);
    }
    if (this.jobs.has(job.id)) {
      throw new Error(`scheduler job already registered: ${job.id}`);
    }

    const now = this.now();
    this.jobs.set(job.id, {
      job,
      nextDueAt: now,
      running: false,
    });
    this.emit({
      type: "JOB_REGISTERED",
      jobId: job.id,
      timestamp: now,
    });
  }

  unregister(jobId: string): boolean {
    const removed = this.jobs.delete(jobId);
    if (removed) {
      this.emit({
        type: "JOB_UNREGISTERED",
        jobId,
        timestamp: this.now(),
      });
    }
    return removed;
  }

  has(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  list(): string[] {
    return [...this.jobs.keys()].sort();
  }

  start(): void {
    if (this.timer !== undefined) return;

    this.timer = setInterval(() => {
      void this.tickOnce();
    }, this.resolutionMs) as unknown as number;
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tickOnce(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const now = this.now();
      const runtimeState = this.getRuntimeState();
      const due = [...this.jobs.values()]
        .filter((state) => state.nextDueAt <= now)
        .sort(
          (a, b) =>
            (b.job.priority || 0) - (a.job.priority || 0) ||
            a.job.id.localeCompare(b.job.id),
        );

      for (const state of due) {
        await this.runJob(state, now, runtimeState);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async runJob(
    state: ScheduledJobState,
    now: number,
    runtimeState: RuntimeState,
  ): Promise<void> {
    const { job } = state;

    state.nextDueAt = now + job.intervalMs;

    if (state.running) {
      this.emit({
        type: "JOB_SKIPPED",
        jobId: job.id,
        timestamp: now,
        reason: "ALREADY_RUNNING",
      });
      return;
    }

    if (runtimeState === "STOPPED") {
      this.emit({
        type: "JOB_SKIPPED",
        jobId: job.id,
        timestamp: now,
        reason: "RUNTIME_STOPPED",
      });
      return;
    }

    if (runtimeState === "PAUSED" && !job.runWhenPaused) {
      this.emit({
        type: "JOB_SKIPPED",
        jobId: job.id,
        timestamp: now,
        reason: "RUNTIME_PAUSED",
      });
      return;
    }

    state.running = true;
    const startedAt = this.now();
    this.emit({
      type: "JOB_STARTED",
      jobId: job.id,
      timestamp: startedAt,
    });

    try {
      await job.tick({ now, runtimeState });
      this.emit({
        type: "JOB_COMPLETED",
        jobId: job.id,
        timestamp: this.now(),
        durationMs: Math.max(0, this.now() - startedAt),
      });
    } catch (error) {
      this.emit({
        type: "JOB_FAILED",
        jobId: job.id,
        timestamp: this.now(),
        durationMs: Math.max(0, this.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      state.running = false;
    }
  }

  private emit(event: SchedulerEvent): void {
    this.onEvent?.(event);
  }
}

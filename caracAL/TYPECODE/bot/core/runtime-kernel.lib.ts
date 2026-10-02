import { ActionBoundary } from "./action-boundary.lib";
import { ActionLedger } from "./action-ledger.lib";
import { EventBus, RuntimeEvent } from "./event-bus.lib";
import {
  ModuleRegistry,
  ModuleRegistryEvent,
} from "./module-registry.lib";
import {
  RuntimeState,
  Scheduler,
  SchedulerEvent,
} from "./scheduler.lib";
import { GameAdapter } from "./game-adapter.lib";
import {
  MovementController,
  MovementControllerEvent,
} from "./movement-controller.lib";
import {
  MovementLiveTestOptions,
  MovementLiveTestResult,
  MovementLiveTestRunner,
} from "./movement-live-test.lib";

const MOVEMENT_SETTLEMENT_JOB_ID = "movement-settlement";
const MOVEMENT_SETTLEMENT_INTERVAL_MS = 100;
const STATUS_JOB_ID = "runtime-status";
const STATUS_INTERVAL_MS = 5000;

interface RuntimeGlobal {
  __caracalBotRuntime?: BotRuntimeKernel;
}

function runtimeState(): RuntimeState {
  return parent.caracAL?.runtime_state || "RUNNING";
}

function runtimeIdentity(): Record<string, unknown> {
  const runtimeConfigRevision = (
    parent.caracAL as typeof parent.caracAL & {
      runtime_config_revision?: number;
    }
  )?.runtime_config_revision;

  return {
    character: character.name,
    ctype: character.ctype,
    map: character.map,
    codeRevision: parent.caracAL?.code_revision || null,
    configRevision: parent.caracAL?.config_revision || null,
    runtimeConfigRevision: runtimeConfigRevision ?? 0,
    sourceRevision: parent.caracAL?.source_revision || null,
  };
}

function forwardEvent(event: RuntimeEvent): void {
  const sent = parent.caracAL?.emit_event(event);
  if (sent === false) {
    console.warn("runtime event rejected by caracAL bridge", event.type);
  }
}

export class BotRuntimeKernel {
  readonly eventBus: EventBus;
  readonly scheduler: Scheduler;
  readonly modules: ModuleRegistry;
  readonly actionLedger: ActionLedger;
  readonly game: GameAdapter;
  readonly actions: ActionBoundary;
  readonly movement: MovementController;

  private started = false;
  private stopping = false;
  private movementLiveTestRunning = false;

  constructor() {
    this.eventBus = new EventBus({
      sink: forwardEvent,
    });

    this.scheduler = new Scheduler({
      getRuntimeState: runtimeState,
      onEvent: (event) => this.handleSchedulerEvent(event),
    });

    this.modules = new ModuleRegistry({
      onEvent: (event) => this.handleModuleEvent(event),
    });

    this.actionLedger = new ActionLedger({
      isEmergencyStopActive: () => !!parent.caracAL?.emergency_stop,
      emit: (event) => {
        this.eventBus.emit({
          module: event.module,
          type: event.type,
          why: event.why,
          actionId: event.actionId,
          correlationId: event.correlationId,
          ...(event.data && { data: event.data }),
        });
      },
    });

    this.game = new GameAdapter();
    this.actions = new ActionBoundary(this.actionLedger, this.game);
    this.movement = new MovementController(this.actions, {
      onEvent: (event) => this.handleMovementEvent(event),
      position: () => {
        const snapshot = this.game.character();
        return {
          map: snapshot.map,
          x: snapshot.x,
          y: snapshot.y,
          moving: snapshot.moving,
        };
      },
    });

    this.scheduler.register({
      id: MOVEMENT_SETTLEMENT_JOB_ID,
      intervalMs: MOVEMENT_SETTLEMENT_INTERVAL_MS,
      priority: 100,
      runWhenPaused: true,
      tick: () => {
        this.movement.observe();
      },
    });

    this.scheduler.register({
      id: STATUS_JOB_ID,
      intervalMs: STATUS_INTERVAL_MS,
      priority: -1000,
      runWhenPaused: true,
      tick: () => {
        this.eventBus.emit({
          module: "RuntimeKernel",
          type: "RUNTIME_STATUS",
          why: "PERIODIC_RUNTIME_HEALTH",
          data: {
            ...runtimeIdentity(),
            runtimeState: runtimeState(),
            emergencyStop: !!parent.caracAL?.emergency_stop,
            emergencyStopState:
              parent.caracAL?.emergency_stop_state || null,
            modules: this.modules.list(),
            schedulerJobs: this.scheduler.list(),
            gameAdapterReads: this.game.capabilities(),
            actionBoundaryMutations: this.actions.capabilities(),
            movement: this.movement.status(),
            recentActions: this.actionLedger.list(20),
          },
        });
      },
    });
  }

  async start(): Promise<void> {
    if (this.started || this.stopping) return;

    this.eventBus.emit({
      module: "RuntimeKernel",
      type: "RUNTIME_STARTING",
      why: "HEADLESS_BOOT",
      data: runtimeIdentity(),
    });

    try {
      await this.modules.startAll();
      this.scheduler.start();
      this.started = true;

      this.eventBus.emit({
        module: "RuntimeKernel",
        type: "RUNTIME_STARTED",
        why: "CORE_MODULES_READY",
        data: {
          ...runtimeIdentity(),
          runtimeState: runtimeState(),
        },
      });
    } catch (error) {
      this.scheduler.stop();
      this.eventBus.emit({
        module: "RuntimeKernel",
        type: "RUNTIME_START_FAILED",
        why: "CORE_START_FAILURE",
        data: {
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
        },
      });
      throw error;
    }
  }

  async stop(reason = "RUNTIME_STOP"): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    this.eventBus.emit({
      module: "RuntimeKernel",
      type: "RUNTIME_STOPPING",
      why: reason,
      data: runtimeIdentity(),
    });

    this.scheduler.stop();
    await this.modules.stopAll(reason);
    this.started = false;
    this.stopping = false;

    this.eventBus.emit({
      module: "RuntimeKernel",
      type: "RUNTIME_STOPPED",
      why: reason,
      data: runtimeIdentity(),
    });
  }

  status(): Record<string, unknown> {
    return {
      started: this.started,
      stopping: this.stopping,
      runtimeState: runtimeState(),
      emergencyStop: !!parent.caracAL?.emergency_stop,
      emergencyStopState: parent.caracAL?.emergency_stop_state || null,
      modules: this.modules.list(),
      schedulerJobs: this.scheduler.list(),
      movement: this.movement.status(),
      recentActions: this.actionLedger.list(20),
      ...runtimeIdentity(),
    };
  }

  async runMovementLiveTest(
    options: MovementLiveTestOptions = {},
  ): Promise<MovementLiveTestResult> {
    if (this.movementLiveTestRunning) {
      throw new Error("movement live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for movement live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for movement live test");
    }

    this.movementLiveTestRunning = true;
    const requestId =
      options.requestId || `movement-live-${Date.now()}`;
    this.eventBus.emit({
      module: "MovementLiveTest",
      type: "MOVEMENT_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_MOVEMENT_E2E",
      correlationId: requestId,
      data: {
        requestId,
        movement: this.movement.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new MovementLiveTestRunner({
        movement: this.movement,
        character: () => this.game.character(),
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "MovementLiveTest",
        type: "MOVEMENT_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          movement: this.movement.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "MovementLiveTest",
        type: "MOVEMENT_LIVE_TEST_FAILED",
        why: "MOVEMENT_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          movement: this.movement.status(),
        },
      });
      throw error;
    } finally {
      this.movementLiveTestRunning = false;
    }
  }

  private handleMovementEvent(event: MovementControllerEvent): void {
    this.eventBus.emit({
      module: "MovementController",
      type: event.type,
      ...(event.reason && { why: event.reason }),
      data: {
        owner: event.owner,
        ...(event.previousOwner !== undefined && {
          previousOwner: event.previousOwner,
        }),
        ...(event.commandType && { commandType: event.commandType }),
        ...(event.commandId !== undefined && {
          commandId: event.commandId,
        }),
        ...(event.actionId && { actionId: event.actionId }),
        ...(event.status !== undefined && { status: event.status }),
        ...(event.pathId !== undefined && { pathId: event.pathId }),
        ...(event.waypointIndex !== undefined && {
          waypointIndex: event.waypointIndex,
        }),
        ...(event.waypointCount !== undefined && {
          waypointCount: event.waypointCount,
        }),
        ...(event.safePoint !== undefined && {
          safePoint: event.safePoint,
        }),
        ...(event.stuckSince !== undefined && {
          stuckSince: event.stuckSince,
        }),
        movement: this.movement.status(),
      },
    });
  }

  private handleSchedulerEvent(event: SchedulerEvent): void {
    this.eventBus.emit({
      module: "Scheduler",
      type: event.type,
      ...(event.reason && { why: event.reason }),
      data: {
        jobId: event.jobId,
        ...(event.durationMs !== undefined && {
          durationMs: event.durationMs,
        }),
        ...(event.error && { error: event.error }),
        ...(event.stack && { stack: event.stack }),
      },
    });
  }

  private handleModuleEvent(event: ModuleRegistryEvent): void {
    this.eventBus.emit({
      module: "ModuleRegistry",
      type: event.type,
      ...(event.reason && { why: event.reason }),
      data: {
        moduleId: event.moduleId,
        ...(event.error && { error: event.error }),
        ...(event.stack && { stack: event.stack }),
      },
    });
  }
}

export function bootRuntime(): BotRuntimeKernel {
  const runtimeGlobal = globalThis as unknown as RuntimeGlobal;
  const previous = runtimeGlobal.__caracalBotRuntime;

  if (previous) {
    void previous.stop("SCRIPT_CONTEXT_REPLACED");
  }

  const runtime = new BotRuntimeKernel();
  runtimeGlobal.__caracalBotRuntime = runtime;

  void runtime.start().catch((error) => {
    console.error("Headless bot runtime failed to start", error);
  });

  return runtime;
}

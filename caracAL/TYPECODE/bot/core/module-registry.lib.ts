export type ModuleLifecycleState =
  | "REGISTERED"
  | "STARTING"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "ERROR";

export interface BotModule {
  id: string;
  dependsOn?: string[];
  start(): void | Promise<void>;
  stop(reason: string): void | Promise<void>;
  status?(): Record<string, unknown>;
}

export interface ModuleRegistryEvent {
  type:
    | "MODULE_REGISTERED"
    | "MODULE_STARTING"
    | "MODULE_STARTED"
    | "MODULE_STOPPING"
    | "MODULE_STOPPED"
    | "MODULE_FAILED";
  moduleId: string;
  timestamp: number;
  reason?: string;
  error?: string;
  stack?: string;
}

export interface ModuleRegistryOptions {
  now?: () => number;
  onEvent?: (event: ModuleRegistryEvent) => void;
}

interface RegisteredModule {
  module: BotModule;
  state: ModuleLifecycleState;
  error?: string;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, RegisteredModule>();
  private readonly now: () => number;
  private readonly onEvent?: (event: ModuleRegistryEvent) => void;
  private startedOrder: string[] = [];

  constructor(options: ModuleRegistryOptions = {}) {
    this.now = options.now || (() => Date.now());
    this.onEvent = options.onEvent;
  }

  register(module: BotModule): void {
    if (!module.id?.trim()) {
      throw new Error("bot module requires id");
    }
    if (this.modules.has(module.id)) {
      throw new Error(`bot module already registered: ${module.id}`);
    }

    this.modules.set(module.id, {
      module,
      state: "REGISTERED",
    });
    this.emit({
      type: "MODULE_REGISTERED",
      moduleId: module.id,
      timestamp: this.now(),
    });
  }

  has(moduleId: string): boolean {
    return this.modules.has(moduleId);
  }

  get(moduleId: string): BotModule | undefined {
    return this.modules.get(moduleId)?.module;
  }

  list(): Array<{
    id: string;
    state: ModuleLifecycleState;
    error?: string;
    status?: Record<string, unknown>;
  }> {
    return [...this.modules.entries()]
      .map(([id, entry]) => ({
        id,
        state: entry.state,
        ...(entry.error && { error: entry.error }),
        ...(entry.module.status && { status: entry.module.status() }),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async startAll(): Promise<void> {
    const order = this.resolveStartOrder();
    this.startedOrder = [];

    for (const moduleId of order) {
      const entry = this.requireEntry(moduleId);
      entry.state = "STARTING";
      entry.error = undefined;
      this.emit({
        type: "MODULE_STARTING",
        moduleId,
        timestamp: this.now(),
      });

      try {
        await entry.module.start();
        entry.state = "RUNNING";
        this.startedOrder.push(moduleId);
        this.emit({
          type: "MODULE_STARTED",
          moduleId,
          timestamp: this.now(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        entry.state = "ERROR";
        entry.error = message;
        this.emit({
          type: "MODULE_FAILED",
          moduleId,
          timestamp: this.now(),
          reason: "START_FAILED",
          error: message,
          ...(error instanceof Error && error.stack && { stack: error.stack }),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
        });
        await this.stopStarted("START_FAILURE_ROLLBACK");
        throw error;
      }
    }
  }

  async stopAll(reason = "RUNTIME_STOP"): Promise<void> {
    await this.stopStarted(reason);

    for (const entry of this.modules.values()) {
      if (entry.state === "REGISTERED") {
        entry.state = "STOPPED";
      }
    }
  }

  private async stopStarted(reason: string): Promise<void> {
    const order = [...this.startedOrder].reverse();
    this.startedOrder = [];

    for (const moduleId of order) {
      const entry = this.requireEntry(moduleId);
      if (entry.state !== "RUNNING" && entry.state !== "ERROR") continue;

      entry.state = "STOPPING";
      this.emit({
        type: "MODULE_STOPPING",
        moduleId,
        timestamp: this.now(),
        reason,
      });

      try {
        await entry.module.stop(reason);
        entry.state = "STOPPED";
        this.emit({
          type: "MODULE_STOPPED",
          moduleId,
          timestamp: this.now(),
          reason,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        entry.state = "ERROR";
        entry.error = message;
        this.emit({
          type: "MODULE_FAILED",
          moduleId,
          timestamp: this.now(),
          reason: "STOP_FAILED",
          error: message,
        });
      }
    }
  }

  private resolveStartOrder(): string[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (moduleId: string): void => {
      if (visited.has(moduleId)) return;
      if (visiting.has(moduleId)) {
        throw new Error(`bot module dependency cycle at ${moduleId}`);
      }

      const entry = this.requireEntry(moduleId);
      visiting.add(moduleId);

      for (const dependency of entry.module.dependsOn || []) {
        if (!this.modules.has(dependency)) {
          throw new Error(
            `bot module ${moduleId} requires missing module ${dependency}`,
          );
        }
        visit(dependency);
      }

      visiting.delete(moduleId);
      visited.add(moduleId);
      order.push(moduleId);
    };

    for (const moduleId of [...this.modules.keys()].sort()) {
      visit(moduleId);
    }

    return order;
  }

  private requireEntry(moduleId: string): RegisteredModule {
    const entry = this.modules.get(moduleId);
    if (!entry) {
      throw new Error(`unknown bot module: ${moduleId}`);
    }
    return entry;
  }

  private emit(event: ModuleRegistryEvent): void {
    this.onEvent?.(event);
  }
}

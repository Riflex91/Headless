export const RUNTIME_EVENT_VERSION = 1 as const;

export interface RuntimeEventInput {
  module: string;
  type: string;
  why?: string;
  correlationId?: string;
  actionId?: string;
  data?: Record<string, unknown>;
}

export interface RuntimeEvent extends RuntimeEventInput {
  version: typeof RUNTIME_EVENT_VERSION;
  id: string;
  timestamp: number;
}

export type RuntimeEventListener = (event: RuntimeEvent) => void;
export type RuntimeEventSink = (event: RuntimeEvent) => void;

export interface EventBusOptions {
  sink?: RuntimeEventSink;
  now?: () => number;
  nextId?: () => string;
}

export class EventBus {
  private readonly listeners = new Map<string, Set<RuntimeEventListener>>();
  private readonly sink?: RuntimeEventSink;
  private readonly now: () => number;
  private readonly nextId: () => string;
  private sequence = 0;

  constructor(options: EventBusOptions = {}) {
    this.sink = options.sink;
    this.now = options.now || (() => Date.now());
    this.nextId =
      options.nextId ||
      (() => {
        this.sequence += 1;
        return `E-${this.now()}-${this.sequence}`;
      });
  }

  emit(input: RuntimeEventInput): RuntimeEvent {
    if (!input.module?.trim()) {
      throw new Error("runtime event requires module");
    }
    if (!input.type?.trim()) {
      throw new Error("runtime event requires type");
    }

    const event: RuntimeEvent = {
      version: RUNTIME_EVENT_VERSION,
      id: this.nextId(),
      timestamp: this.now(),
      module: input.module,
      type: input.type,
      ...(input.why && { why: input.why }),
      ...(input.correlationId && { correlationId: input.correlationId }),
      ...(input.actionId && { actionId: input.actionId }),
      ...(input.data && { data: input.data }),
    };

    this.dispatch(event.type, event);
    this.dispatch("*", event);
    this.sink?.(event);
    return event;
  }

  on(type: string, listener: RuntimeEventListener): () => void {
    if (!type?.trim()) {
      throw new Error("event listener requires type");
    }

    const listeners = this.listeners.get(type) || new Set<RuntimeEventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  listenerCount(type?: string): number {
    if (type) return this.listeners.get(type)?.size || 0;

    let count = 0;
    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  clear(): void {
    this.listeners.clear();
  }

  private dispatch(type: string, event: RuntimeEvent): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;

    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        // Event listeners are observational and must never break runtime flow.
        console.error("EventBus listener failed", error);
      }
    }
  }
}

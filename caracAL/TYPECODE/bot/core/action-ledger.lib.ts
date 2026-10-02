export type ActionOutcome =
  | "DISPATCHED"
  | "CONFIRMED"
  | "REJECTED"
  | "UNKNOWN"
  | "BLOCKED";

export interface ActionIntent {
  module: string;
  action: string;
  why: string;
  correlationId?: string;
  expectedCost?: Record<string, unknown>;
  expectedEffect?: Record<string, unknown>;
  before?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ActionResolution {
  why: string;
  after?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  error?: string;
}

export interface ActionRecord extends ActionIntent {
  id: string;
  correlationId: string;
  createdAt: number;
  dispatchedAt?: number;
  completedAt?: number;
  durationMs?: number;
  status: ActionOutcome | null;
  after?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  error?: string;
}

export interface ActionLedgerEvent {
  module: string;
  type: string;
  why: string;
  actionId: string;
  correlationId: string;
  data?: Record<string, unknown>;
}

export interface ActionLedgerOptions {
  now?: () => number;
  nextActionId?: () => string;
  nextCorrelationId?: () => string;
  maxRecords?: number;
  isEmergencyStopActive?: () => boolean;
  emit?: (event: ActionLedgerEvent) => void;
}

export class ActionLedger {
  private readonly records = new Map<string, ActionRecord>();
  private readonly order: string[] = [];
  private readonly now: () => number;
  private readonly nextActionId: () => string;
  private readonly nextCorrelationId: () => string;
  private readonly maxRecords: number;
  private readonly isEmergencyStopActive: () => boolean;
  private readonly emit?: (event: ActionLedgerEvent) => void;
  private actionSequence = 0;
  private correlationSequence = 0;

  constructor(options: ActionLedgerOptions = {}) {
    this.now = options.now || (() => Date.now());
    this.nextActionId =
      options.nextActionId ||
      (() => {
        this.actionSequence += 1;
        return `A-${this.now()}-${this.actionSequence}`;
      });
    this.nextCorrelationId =
      options.nextCorrelationId ||
      (() => {
        this.correlationSequence += 1;
        return `C-${this.now()}-${this.correlationSequence}`;
      });
    this.maxRecords = Math.max(50, options.maxRecords || 1000);
    this.isEmergencyStopActive =
      options.isEmergencyStopActive || (() => false);
    this.emit = options.emit;
  }

  create(intent: ActionIntent): ActionRecord {
    if (!intent.module?.trim()) {
      throw new Error("action intent requires module");
    }
    if (!intent.action?.trim()) {
      throw new Error("action intent requires action");
    }
    if (!intent.why?.trim()) {
      throw new Error("action intent requires WHY");
    }

    const record: ActionRecord = {
      ...intent,
      id: this.nextActionId(),
      correlationId: intent.correlationId || this.nextCorrelationId(),
      createdAt: this.now(),
      status: null,
    };

    this.records.set(record.id, record);
    this.order.push(record.id);
    this.trim();

    this.emitRecord("ACTION_INTENT", record, intent.why);

    if (this.isEmergencyStopActive()) {
      return this.block(record.id, "EMERGENCY_STOP_ACTIVE");
    }

    return this.clone(record);
  }

  dispatch(
    actionId: string,
    evidence?: Record<string, unknown>,
  ): ActionRecord {
    const record = this.requireRecord(actionId);

    if (this.isEmergencyStopActive()) {
      return this.block(actionId, "EMERGENCY_STOP_ACTIVE");
    }

    if (record.status !== null) {
      throw new Error(
        `action ${actionId} cannot dispatch from ${record.status}`,
      );
    }

    record.status = "DISPATCHED";
    record.dispatchedAt = this.now();
    if (evidence) record.evidence = evidence;

    this.emitRecord("ACTION_DISPATCHED", record, record.why);
    return this.clone(record);
  }

  confirm(actionId: string, resolution: ActionResolution): ActionRecord {
    return this.resolve(actionId, "CONFIRMED", resolution);
  }

  reject(actionId: string, resolution: ActionResolution): ActionRecord {
    return this.resolve(actionId, "REJECTED", resolution);
  }

  unknown(actionId: string, resolution: ActionResolution): ActionRecord {
    return this.resolve(actionId, "UNKNOWN", resolution);
  }

  block(actionId: string, why: string): ActionRecord {
    const record = this.requireRecord(actionId);

    if (record.status && record.status !== "DISPATCHED") {
      throw new Error(
        `action ${actionId} cannot block from ${record.status}`,
      );
    }

    record.status = "BLOCKED";
    record.completedAt = this.now();
    record.durationMs = this.duration(record);

    this.emitRecord("ACTION_BLOCKED", record, why);
    return this.clone(record);
  }

  canRetry(actionId: string): boolean {
    const record = this.requireRecord(actionId);
    return record.status === "REJECTED" || record.status === "BLOCKED";
  }

  assertRetryAllowed(actionId: string): void {
    const record = this.requireRecord(actionId);

    if (record.status === "UNKNOWN") {
      throw new Error(
        `action ${actionId} is UNKNOWN and must not be retried blindly`,
      );
    }
    if (!this.canRetry(actionId)) {
      throw new Error(
        `action ${actionId} cannot retry from ${record.status || "PENDING"}`,
      );
    }
  }

  get(actionId: string): ActionRecord | undefined {
    const record = this.records.get(actionId);
    return record ? this.clone(record) : undefined;
  }

  list(limit = 100): ActionRecord[] {
    const count = Math.max(0, Math.trunc(limit));
    return this.order
      .slice(-count)
      .reverse()
      .map((id) => this.clone(this.requireRecord(id)));
  }

  private resolve(
    actionId: string,
    status: Extract<ActionOutcome, "CONFIRMED" | "REJECTED" | "UNKNOWN">,
    resolution: ActionResolution,
  ): ActionRecord {
    const record = this.requireRecord(actionId);

    if (record.status !== "DISPATCHED") {
      throw new Error(
        `action ${actionId} cannot resolve from ${record.status || "PENDING"}`,
      );
    }

    record.status = status;
    record.completedAt = this.now();
    record.durationMs = this.duration(record);
    if (resolution.after) record.after = resolution.after;
    if (resolution.evidence) record.evidence = resolution.evidence;
    if (resolution.error) record.error = resolution.error;

    this.emitRecord(`ACTION_${status}`, record, resolution.why);
    return this.clone(record);
  }

  private duration(record: ActionRecord): number {
    const start = record.dispatchedAt || record.createdAt;
    return Math.max(0, this.now() - start);
  }

  private emitRecord(
    type: string,
    record: ActionRecord,
    why: string,
  ): void {
    this.emit?.({
      module: record.module,
      type,
      why,
      actionId: record.id,
      correlationId: record.correlationId,
      data: {
        action: record.action,
        status: record.status,
        expectedCost: record.expectedCost,
        expectedEffect: record.expectedEffect,
        before: record.before,
        after: record.after,
        evidence: record.evidence,
        error: record.error,
        durationMs: record.durationMs,
        metadata: record.metadata,
      },
    });
  }

  private requireRecord(actionId: string): ActionRecord {
    const record = this.records.get(actionId);
    if (!record) {
      throw new Error(`unknown action: ${actionId}`);
    }
    return record;
  }

  private trim(): void {
    while (this.order.length > this.maxRecords) {
      const oldest = this.order.shift();
      if (oldest) this.records.delete(oldest);
    }
  }

  private clone(record: ActionRecord): ActionRecord {
    return {
      ...record,
      ...(record.expectedCost && { expectedCost: { ...record.expectedCost } }),
      ...(record.expectedEffect && {
        expectedEffect: { ...record.expectedEffect },
      }),
      ...(record.before && { before: { ...record.before } }),
      ...(record.after && { after: { ...record.after } }),
      ...(record.evidence && { evidence: { ...record.evidence } }),
      ...(record.metadata && { metadata: { ...record.metadata } }),
    };
  }
}

export class OutcomeTransaction {
  constructor(
    private readonly ledger: ActionLedger,
    readonly actionId: string,
  ) {}

  dispatch(evidence?: Record<string, unknown>): ActionRecord {
    return this.ledger.dispatch(this.actionId, evidence);
  }

  confirmed(resolution: ActionResolution): ActionRecord {
    return this.ledger.confirm(this.actionId, resolution);
  }

  rejected(resolution: ActionResolution): ActionRecord {
    return this.ledger.reject(this.actionId, resolution);
  }

  unknown(resolution: ActionResolution): ActionRecord {
    return this.ledger.unknown(this.actionId, resolution);
  }

  blocked(why: string): ActionRecord {
    return this.ledger.block(this.actionId, why);
  }
}

import type { GoalAdapterPreflightResult } from "./goal-adapter-preflight.lib";
import type {
  MaterialGatherTaskOptions,
  MaterialGatherTaskResult,
} from "./material-gathering-task.lib";

export type GoalAdapterDispatchOutcome =
  | "PASS"
  | "BLOCKED"
  | "FAIL"
  | "UNKNOWN"
  | "TIMEOUT";

export interface GoalAdapterDispatchResult {
  requestId: string;
  outcome: GoalAdapterDispatchOutcome;
  reason: string;
  goalId: string | null;
  taskId: string | null;
  kind: string | null;
  preflight: GoalAdapterPreflightResult | null;
  execution: Record<string, unknown> | null;
  scope: {
    authorized: boolean;
    preflightRequired: true;
    maxExecutionInvocations: 1;
    blindRetryUsed: false;
    mutationPathInvoked: boolean;
  };
  cleanup: {
    craftOverrideCleared: boolean;
    craftPlanningRefreshed: boolean;
  };
}

interface GoalAdapterDispatchDependencies {
  preflight(
    request: unknown,
    options: { requestId: string },
  ): Promise<GoalAdapterPreflightResult>;
  runMaterialGatherTask(
    options: MaterialGatherTaskOptions,
  ): Promise<MaterialGatherTaskResult>;
  craft: {
    setConfigOverride(config: unknown): void;
    clearConfigOverride(): void;
    tick(): unknown;
    executeNext(): Promise<unknown>;
  };
  now?: () => number;
}

interface GoalAdapterDispatchOptions {
  requestId?: string;
  authorized?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function identity(request: Record<string, unknown>): {
  goalId: string | null;
  taskId: string | null;
  kind: string | null;
} {
  return {
    goalId: text(request.goalId),
    taskId: text(request.taskId),
    kind: text(request.kind),
  };
}

function preflightMatches(
  preflight: GoalAdapterPreflightResult,
  request: Record<string, unknown>,
): boolean {
  const requestIdentity = identity(request);
  return (
    preflight.outcome === "PASS" &&
    preflight.goalId === requestIdentity.goalId &&
    preflight.taskId === requestIdentity.taskId &&
    preflight.kind === requestIdentity.kind &&
    preflight.scope.readOnly === true &&
    preflight.scope.gameplayMutationDispatched === false &&
    preflight.scope.valueMutationDispatched === false &&
    preflight.scope.lifecycleMutationDispatched === false &&
    preflight.scope.blindRetryAllowed === false
  );
}

export class GoalAdapterDispatchRunner {
  private readonly now: () => number;

  constructor(private readonly deps: GoalAdapterDispatchDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  async run(
    rawRequest: unknown,
    options: GoalAdapterDispatchOptions = {},
  ): Promise<GoalAdapterDispatchResult> {
    const request = record(rawRequest);
    const requestId =
      text(options.requestId) || `goal-adapter-dispatch-${this.now()}`;
    const requestIdentity = identity(request);
    const authorized = options.authorized === true;
    let preflight: GoalAdapterPreflightResult | null = null;
    let mutationPathInvoked = false;
    let craftOverrideCleared = true;
    let craftPlanningRefreshed = false;

    const finish = (
      outcome: GoalAdapterDispatchOutcome,
      reason: string,
      execution: Record<string, unknown> | null = null,
    ): GoalAdapterDispatchResult => ({
      requestId,
      outcome,
      reason,
      ...requestIdentity,
      preflight,
      execution,
      scope: {
        authorized,
        preflightRequired: true,
        maxExecutionInvocations: 1,
        blindRetryUsed: false,
        mutationPathInvoked,
      },
      cleanup: {
        craftOverrideCleared,
        craftPlanningRefreshed,
      },
    });

    if (!authorized) {
      return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_NOT_AUTHORIZED");
    }
    if (
      Number(request.version) !== 1 ||
      request.dispatchAllowed !== false ||
      request.dispatchImplemented !== false
    ) {
      return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_CONTRACT_INVALID");
    }
    if (!requestIdentity.goalId || !requestIdentity.taskId || !requestIdentity.kind) {
      return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_IDENTITY_INVALID");
    }

    try {
      preflight = await this.deps.preflight(request, {
        requestId: `${requestId}:preflight`,
      });
    } catch (error) {
      return finish("FAIL", "GOAL_ADAPTER_DISPATCH_PREFLIGHT_ERROR", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!preflightMatches(preflight, request)) {
      return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_PREFLIGHT_NOT_CONFIRMED");
    }

    if (requestIdentity.kind === "FARM_ITEM") {
      const args = record(request.arguments);
      const itemName = text(args.itemName);
      const monsterType = text(args.monsterType);
      const quantity = positiveInteger(args.quantity);
      const recipient = text(args.recipient);
      const position = record(args.recipientPosition);
      const recipientPosition =
        text(position.map) &&
        finite(position.x) !== null &&
        finite(position.y) !== null
          ? {
              map: text(position.map) as string,
              x: finite(position.x) as number,
              y: finite(position.y) as number,
            }
          : null;

      if (
        request.type !== "GOAL_RUNTIME_METHOD" ||
        text(request.bridge) !== "MaterialGatheringTaskRunner" ||
        text(request.runtimeMethod) !== "runMaterialGatherTask" ||
        !itemName ||
        !monsterType ||
        !quantity ||
        !recipient ||
        !recipientPosition
      ) {
        return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_FARM_CONTRACT_INVALID");
      }

      const itemLevel =
        args.itemLevel === undefined ? undefined : nonNegativeInteger(args.itemLevel);
      if (args.itemLevel !== undefined && itemLevel === null) {
        return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_FARM_ITEM_LEVEL_INVALID");
      }

      const timeoutMs =
        args.timeoutMs === undefined ? undefined : positiveInteger(args.timeoutMs);
      const pollMs =
        args.pollMs === undefined ? undefined : positiveInteger(args.pollMs);
      if (
        (args.timeoutMs !== undefined && timeoutMs === null) ||
        (args.pollMs !== undefined && pollMs === null)
      ) {
        return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_FARM_TIMING_INVALID");
      }

      mutationPathInvoked = true;
      try {
        const result = await this.deps.runMaterialGatherTask({
          requestId: `${requestId}:farm`,
          itemName,
          ...(itemLevel !== undefined && itemLevel !== null && { itemLevel }),
          monsterType,
          quantity,
          recipient,
          recipientPosition,
          ...(timeoutMs !== undefined && timeoutMs !== null && { timeoutMs }),
          ...(pollMs !== undefined && pollMs !== null && { pollMs }),
        });

        const outcome: GoalAdapterDispatchOutcome =
          result.outcome === "PASS"
            ? "PASS"
            : result.outcome === "UNKNOWN"
              ? "UNKNOWN"
              : result.outcome === "TIMEOUT"
                ? "TIMEOUT"
                : "FAIL";
        return finish(
          outcome,
          outcome === "PASS"
            ? "GOAL_ADAPTER_DISPATCH_FARM_CONFIRMED"
            : `GOAL_ADAPTER_DISPATCH_FARM_${result.reason || outcome}`,
          {
            materialGather: result as unknown as Record<string, unknown>,
          },
        );
      } catch (error) {
        return finish("FAIL", "GOAL_ADAPTER_DISPATCH_FARM_RUNTIME_ERROR", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (requestIdentity.kind === "PLAN_CRAFT") {
      const evidence = record(preflight.evidence);
      if (evidence.alreadyReady !== true) {
        return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_CRAFT_NOT_READY");
      }

      const preflightRequest = record(request.preflight);
      const preflightArgs = record(preflightRequest.arguments);
      const recipe = text(preflightArgs.recipe);
      const override = record(request.scopedConfigOverride);
      const craftOverride = record(override.craft);
      const allowedRecipes = Array.isArray(craftOverride.allowedRecipes)
        ? craftOverride.allowedRecipes
            .map((entry) => text(entry))
            .filter((entry): entry is string => entry !== null)
        : [];
      const execution = record(request.execution);
      const cleanup = record(request.cleanup);

      if (
        request.type !== "GOAL_RUNTIME_SEQUENCE" ||
        text(request.bridge) !== "CraftController" ||
        !recipe ||
        craftOverride.enabled !== true ||
        allowedRecipes.length !== 1 ||
        allowedRecipes[0] !== recipe ||
        text(execution.runtimeMethod) !== "executeCraftNext" ||
        Number(execution.maxInvocations) !== 1 ||
        cleanup.clearConfigOverride !== true ||
        cleanup.refreshPlanning !== true
      ) {
        return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_CRAFT_CONTRACT_INVALID");
      }

      craftOverrideCleared = false;
      try {
        this.deps.craft.setConfigOverride({
          craft: {
            enabled: true,
            allowedRecipes: [recipe],
          },
        });
        const planned = record(this.deps.craft.tick());
        const selected = record(planned.selected);
        if (
          planned.state !== "READY" ||
          text(selected.recipe) !== recipe
        ) {
          return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_CRAFT_SELECTION_DRIFT", {
            state: text(planned.state),
            selectedRecipe: text(selected.recipe),
          });
        }

        mutationPathInvoked = true;
        const executed = record(await this.deps.craft.executeNext());
        const lastAction = record(executed.lastAction);
        const actionStatus = text(lastAction.status);
        if (actionStatus === "UNKNOWN") {
          return finish("UNKNOWN", "GOAL_ADAPTER_DISPATCH_CRAFT_UNKNOWN", {
            craft: executed,
          });
        }
        if (actionStatus !== "CONFIRMED") {
          return finish("FAIL", "GOAL_ADAPTER_DISPATCH_CRAFT_NOT_CONFIRMED", {
            craft: executed,
          });
        }

        return finish("PASS", "GOAL_ADAPTER_DISPATCH_CRAFT_CONFIRMED", {
          craft: executed,
        });
      } catch (error) {
        return finish("FAIL", "GOAL_ADAPTER_DISPATCH_CRAFT_RUNTIME_ERROR", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.deps.craft.clearConfigOverride();
        craftOverrideCleared = true;
        this.deps.craft.tick();
        craftPlanningRefreshed = true;
      }
    }

    return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_KIND_UNSUPPORTED");
  }
}

export { preflightMatches };

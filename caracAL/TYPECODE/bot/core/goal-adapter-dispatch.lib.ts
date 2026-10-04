import type {
  CharacterGoldTaskOptions,
  CharacterGoldTaskResult,
} from "./character-gold-task.lib";
import type {
  CharacterTrainingTaskOptions,
  CharacterTrainingTaskResult,
} from "./character-training-task.lib";
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
  runCharacterTrainingTask(
    options: CharacterTrainingTaskOptions,
  ): Promise<CharacterTrainingTaskResult>;
  runCharacterGoldTask(
    options: CharacterGoldTaskOptions,
  ): Promise<CharacterGoldTaskResult>;
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

    if (requestIdentity.kind === "ACCUMULATE_GOLD") {
      const args = record(request.arguments);
      const goalAmount = positiveInteger(args.goalAmount);
      const scope = text(args.scope);
      const monsterType = text(args.monsterType);

      if (
        request.type !== "GOAL_RUNTIME_METHOD" ||
        text(request.bridge) !== "CharacterGoldTaskRunner" ||
        text(request.runtimeMethod) !== "runCharacterGoldTask" ||
        !text(request.characterName) ||
        !goalAmount ||
        !monsterType ||
        (scope !== "ACCOUNT" && scope !== "CHARACTER")
      ) {
        return finish(
          "BLOCKED",
          "GOAL_ADAPTER_DISPATCH_GOLD_CONTRACT_INVALID",
        );
      }

      const timeoutMs =
        args.timeoutMs === undefined
          ? undefined
          : positiveInteger(args.timeoutMs);
      const pollMs =
        args.pollMs === undefined ? undefined : positiveInteger(args.pollMs);
      if (
        (args.timeoutMs !== undefined && timeoutMs === null) ||
        (args.pollMs !== undefined && pollMs === null)
      ) {
        return finish(
          "BLOCKED",
          "GOAL_ADAPTER_DISPATCH_GOLD_TIMING_INVALID",
        );
      }

      mutationPathInvoked = true;
      try {
        const result = await this.deps.runCharacterGoldTask({
          requestId: `${requestId}:gold`,
          goalAmount,
          scope,
          monsterType,
          ...(timeoutMs !== undefined && timeoutMs !== null && { timeoutMs }),
          ...(pollMs !== undefined && pollMs !== null && { pollMs }),
        });

        if (
          result.outcome === "PASS" &&
          result.progress.targetReached !== true &&
          result.progress.goldIncreased !== true
        ) {
          return finish(
            "FAIL",
            "GOAL_ADAPTER_DISPATCH_GOLD_PROGRESS_NOT_CONFIRMED",
            {
              gold: result as unknown as Record<string, unknown>,
            },
          );
        }

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
            ? "GOAL_ADAPTER_DISPATCH_GOLD_CONFIRMED"
            : `GOAL_ADAPTER_DISPATCH_GOLD_${result.reason || outcome}`,
          {
            gold: result as unknown as Record<string, unknown>,
          },
        );
      } catch (error) {
        return finish(
          "FAIL",
          "GOAL_ADAPTER_DISPATCH_GOLD_RUNTIME_ERROR",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    if (requestIdentity.kind === "TRAIN_CHARACTER") {
      const args = record(request.arguments);
      const targetLevel = positiveInteger(args.targetLevel);
      const monsterType = text(args.monsterType);

      if (
        request.type !== "GOAL_RUNTIME_METHOD" ||
        text(request.bridge) !== "CharacterTrainingTaskRunner" ||
        text(request.runtimeMethod) !== "runCharacterTrainingTask" ||
        !text(request.characterName) ||
        !targetLevel ||
        !monsterType
      ) {
        return finish(
          "BLOCKED",
          "GOAL_ADAPTER_DISPATCH_TRAINING_CONTRACT_INVALID",
        );
      }

      const timeoutMs =
        args.timeoutMs === undefined
          ? undefined
          : positiveInteger(args.timeoutMs);
      const pollMs =
        args.pollMs === undefined ? undefined : positiveInteger(args.pollMs);
      if (
        (args.timeoutMs !== undefined && timeoutMs === null) ||
        (args.pollMs !== undefined && pollMs === null)
      ) {
        return finish(
          "BLOCKED",
          "GOAL_ADAPTER_DISPATCH_TRAINING_TIMING_INVALID",
        );
      }

      mutationPathInvoked = true;
      try {
        const result = await this.deps.runCharacterTrainingTask({
          requestId: `${requestId}:training`,
          targetLevel,
          monsterType,
          ...(timeoutMs !== undefined && timeoutMs !== null && { timeoutMs }),
          ...(pollMs !== undefined && pollMs !== null && { pollMs }),
        });

        if (
          result.outcome === "PASS" &&
          result.progress.targetReached !== true &&
          result.progress.levelIncreased !== true &&
          result.progress.xpIncreased !== true
        ) {
          return finish(
            "FAIL",
            "GOAL_ADAPTER_DISPATCH_TRAINING_PROGRESS_NOT_CONFIRMED",
            {
              training: result as unknown as Record<string, unknown>,
            },
          );
        }

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
            ? "GOAL_ADAPTER_DISPATCH_TRAINING_CONFIRMED"
            : `GOAL_ADAPTER_DISPATCH_TRAINING_${result.reason || outcome}`,
          {
            training: result as unknown as Record<string, unknown>,
          },
        );
      } catch (error) {
        return finish(
          "FAIL",
          "GOAL_ADAPTER_DISPATCH_TRAINING_RUNTIME_ERROR",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    if (
      requestIdentity.kind === "FARM_ITEM" ||
      requestIdentity.kind === "ACQUIRE_GEAR"
    ) {
      const args = record(request.arguments);
      const itemName = text(args.itemName);
      const monsterType = text(args.monsterType);
      const quantity = positiveInteger(args.quantity);
      const isGear = requestIdentity.kind === "ACQUIRE_GEAR";
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
      const deliveryMode = text(args.deliveryMode);

      if (
        request.type !== "GOAL_RUNTIME_METHOD" ||
        text(request.bridge) !== "MaterialGatheringTaskRunner" ||
        text(request.runtimeMethod) !== "runMaterialGatherTask" ||
        !itemName ||
        !monsterType ||
        !quantity ||
        (isGear
          ? quantity !== 1 || deliveryMode !== "KEEP_ON_WORKER"
          : !recipient || !recipientPosition)
      ) {
        return finish(
          "BLOCKED",
          isGear
            ? "GOAL_ADAPTER_DISPATCH_GEAR_CONTRACT_INVALID"
            : "GOAL_ADAPTER_DISPATCH_FARM_CONTRACT_INVALID",
        );
      }

      const itemLevel =
        args.itemLevel === undefined
          ? undefined
          : nonNegativeInteger(args.itemLevel);
      const minimumItemLevel =
        args.minimumItemLevel === undefined
          ? undefined
          : nonNegativeInteger(args.minimumItemLevel);
      if (
        (args.itemLevel !== undefined && itemLevel === null) ||
        (args.minimumItemLevel !== undefined && minimumItemLevel === null) ||
        (itemLevel !== undefined && minimumItemLevel !== undefined) ||
        (isGear && minimumItemLevel === undefined)
      ) {
        return finish(
          "BLOCKED",
          isGear
            ? "GOAL_ADAPTER_DISPATCH_GEAR_ITEM_LEVEL_INVALID"
            : "GOAL_ADAPTER_DISPATCH_FARM_ITEM_LEVEL_INVALID",
        );
      }

      const timeoutMs =
        args.timeoutMs === undefined
          ? undefined
          : positiveInteger(args.timeoutMs);
      const pollMs =
        args.pollMs === undefined ? undefined : positiveInteger(args.pollMs);
      if (
        (args.timeoutMs !== undefined && timeoutMs === null) ||
        (args.pollMs !== undefined && pollMs === null)
      ) {
        return finish(
          "BLOCKED",
          isGear
            ? "GOAL_ADAPTER_DISPATCH_GEAR_TIMING_INVALID"
            : "GOAL_ADAPTER_DISPATCH_FARM_TIMING_INVALID",
        );
      }

      mutationPathInvoked = true;
      try {
        const result = await this.deps.runMaterialGatherTask({
          requestId: `${requestId}:${isGear ? "gear" : "farm"}`,
          itemName,
          ...(itemLevel !== undefined && itemLevel !== null && { itemLevel }),
          ...(minimumItemLevel !== undefined &&
            minimumItemLevel !== null && { minimumItemLevel }),
          monsterType,
          quantity,
          ...(isGear
            ? { deliveryMode: "KEEP_ON_WORKER" as const }
            : {
                recipient: recipient as string,
                recipientPosition: recipientPosition as {
                  map: string;
                  x: number;
                  y: number;
                },
              }),
          ...(timeoutMs !== undefined && timeoutMs !== null && { timeoutMs }),
          ...(pollMs !== undefined && pollMs !== null && { pollMs }),
        });

        if (
          isGear &&
          result.outcome === "PASS" &&
          result.evidence.keptOnWorkerConfirmed !== true
        ) {
          return finish("FAIL", "GOAL_ADAPTER_DISPATCH_GEAR_NOT_CONFIRMED", {
            materialGather: result as unknown as Record<string, unknown>,
          });
        }

        const outcome: GoalAdapterDispatchOutcome =
          result.outcome === "PASS"
            ? "PASS"
            : result.outcome === "UNKNOWN"
              ? "UNKNOWN"
              : result.outcome === "TIMEOUT"
                ? "TIMEOUT"
                : "FAIL";
        const prefix = isGear ? "GEAR" : "FARM";
        return finish(
          outcome,
          outcome === "PASS"
            ? `GOAL_ADAPTER_DISPATCH_${prefix}_CONFIRMED`
            : `GOAL_ADAPTER_DISPATCH_${prefix}_${result.reason || outcome}`,
          {
            materialGather: result as unknown as Record<string, unknown>,
          },
        );
      } catch (error) {
        return finish(
          "FAIL",
          isGear
            ? "GOAL_ADAPTER_DISPATCH_GEAR_RUNTIME_ERROR"
            : "GOAL_ADAPTER_DISPATCH_FARM_RUNTIME_ERROR",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
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

      let craftOutcome: GoalAdapterDispatchOutcome = "FAIL";
      let craftReason = "GOAL_ADAPTER_DISPATCH_CRAFT_RUNTIME_ERROR";
      let craftExecution: Record<string, unknown> | null = null;

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
          craftOutcome = "BLOCKED";
          craftReason = "GOAL_ADAPTER_DISPATCH_CRAFT_SELECTION_DRIFT";
          craftExecution = {
            state: text(planned.state),
            selectedRecipe: text(selected.recipe),
          };
        } else {
          mutationPathInvoked = true;
          const executed = record(await this.deps.craft.executeNext());
          const lastAction = record(executed.lastAction);
          const actionStatus = text(lastAction.status);
          craftExecution = { craft: executed };

          if (actionStatus === "UNKNOWN") {
            craftOutcome = "UNKNOWN";
            craftReason = "GOAL_ADAPTER_DISPATCH_CRAFT_UNKNOWN";
          } else if (actionStatus !== "CONFIRMED") {
            craftOutcome = "FAIL";
            craftReason = "GOAL_ADAPTER_DISPATCH_CRAFT_NOT_CONFIRMED";
          } else {
            craftOutcome = "PASS";
            craftReason = "GOAL_ADAPTER_DISPATCH_CRAFT_CONFIRMED";
          }
        }
      } catch (error) {
        craftOutcome = "FAIL";
        craftReason = "GOAL_ADAPTER_DISPATCH_CRAFT_RUNTIME_ERROR";
        craftExecution = {
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        this.deps.craft.clearConfigOverride();
        craftOverrideCleared = true;
        this.deps.craft.tick();
        craftPlanningRefreshed = true;
      }

      return finish(craftOutcome, craftReason, craftExecution);
    }

    return finish("BLOCKED", "GOAL_ADAPTER_DISPATCH_KIND_UNSUPPORTED");
  }
}

export { preflightMatches };

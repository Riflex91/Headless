const GOAL_ADAPTER_REQUEST_VERSION = 1;

export type GoalAdapterPreflightOutcome = "PASS" | "BLOCKED" | "FAIL";

export interface GoalAdapterPreflightResult {
  requestId: string;
  outcome: GoalAdapterPreflightOutcome;
  reason: string;
  goalId: string | null;
  taskId: string | null;
  kind: string | null;
  character: {
    name: string | null;
    ctype: string | null;
  };
  evidence: Record<string, unknown>;
  scope: {
    readOnly: true;
    ipcResponseOnly: true;
    gameplayMutationDispatched: false;
    valueMutationDispatched: false;
    lifecycleMutationDispatched: false;
    blindRetryAllowed: false;
  };
  cleanup: {
    farmOverrideCleared: boolean;
  };
}

interface FarmCandidate {
  monster?: unknown;
  estimated?: {
    dropItems?: unknown;
  } | null;
}

interface FarmStatus {
  state?: unknown;
  reason?: unknown;
  candidates?: FarmCandidate[];
}

interface GoalAdapterPreflightDependencies {
  farmIntelligence: {
    setConfigOverride(config: unknown): void;
    clearConfigOverride(): void;
    tick(): FarmStatus;
  };
  character(): {
    name: string | null;
    ctype: string | null;
  };
  craftMaterialPlan(recipe: string): unknown | Promise<unknown>;
  now?: () => number;
}

interface GoalAdapterPreflightRunOptions {
  requestId?: string;
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

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function requestIdentity(request: Record<string, unknown>): {
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

export class GoalAdapterPreflightRunner {
  private readonly now: () => number;

  constructor(private readonly deps: GoalAdapterPreflightDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  async run(
    rawRequest: unknown,
    options: GoalAdapterPreflightRunOptions = {},
  ): Promise<GoalAdapterPreflightResult> {
    const request = record(rawRequest);
    const requestId =
      text(options.requestId) || `goal-adapter-preflight-${this.now()}`;
    const identity = requestIdentity(request);
    const character = this.deps.character();
    let farmOverrideCleared = true;

    const finish = (
      outcome: GoalAdapterPreflightOutcome,
      reason: string,
      evidence: Record<string, unknown> = {},
    ): GoalAdapterPreflightResult => ({
      requestId,
      outcome,
      reason,
      ...identity,
      character: {
        name: character.name,
        ctype: character.ctype,
      },
      evidence,
      scope: {
        readOnly: true,
        ipcResponseOnly: true,
        gameplayMutationDispatched: false,
        valueMutationDispatched: false,
        lifecycleMutationDispatched: false,
        blindRetryAllowed: false,
      },
      cleanup: {
        farmOverrideCleared,
      },
    });

    if (Number(request.version) !== GOAL_ADAPTER_REQUEST_VERSION) {
      return finish("BLOCKED", "GOAL_ADAPTER_PREFLIGHT_VERSION_UNSUPPORTED", {
        expectedVersion: GOAL_ADAPTER_REQUEST_VERSION,
        observedVersion: finite(request.version),
      });
    }

    if (identity.kind === "FARM_ITEM") {
      const args = record(request.arguments);
      const itemName = text(args.itemName);
      const monsterType = text(args.monsterType);
      const quantity = positiveInteger(args.quantity);
      const workerCharacter = text(request.characterName);
      const recipient = text(args.recipient);
      const position = record(args.recipientPosition);
      const recipientPositionValid =
        text(position.map) !== null &&
        finite(position.x) !== null &&
        finite(position.y) !== null;

      if (
        request.type !== "GOAL_RUNTIME_METHOD" ||
        text(request.runtimeMethod) !== "runMaterialGatherTask" ||
        text(request.bridge) !== "MaterialGatheringTaskRunner"
      ) {
        return finish("BLOCKED", "GOAL_ADAPTER_PREFLIGHT_FARM_CONTRACT_INVALID");
      }

      if (
        !itemName ||
        !monsterType ||
        !quantity ||
        !workerCharacter ||
        !recipient ||
        !recipientPositionValid
      ) {
        return finish("BLOCKED", "GOAL_ADAPTER_PREFLIGHT_FARM_ARGUMENTS_INVALID");
      }

      if (
        character.name !== workerCharacter ||
        character.ctype !== "ranger"
      ) {
        return finish("BLOCKED", "GOAL_ADAPTER_PREFLIGHT_FARM_WORKER_MISMATCH", {
          expectedCharacter: workerCharacter,
          actualCharacter: character.name,
          actualClass: character.ctype,
        });
      }

      farmOverrideCleared = false;
      let outcome: GoalAdapterPreflightOutcome = "FAIL";
      let reason = "GOAL_ADAPTER_PREFLIGHT_FARM_RUNTIME_ERROR";
      let evidence: Record<string, unknown> = {};

      try {
        this.deps.farmIntelligence.setConfigOverride({
          farming: {
            enabled: true,
            goalMonster: monsterType,
            goalItems: [itemName],
          },
        });
        const status = this.deps.farmIntelligence.tick();
        const candidates = Array.isArray(status.candidates)
          ? status.candidates
          : [];
        const exact = candidates.find(
          (candidate) =>
            text(candidate?.monster) === monsterType &&
            stringList(candidate?.estimated?.dropItems).includes(itemName),
        );

        if (!exact) {
          outcome = "BLOCKED";
          reason = "GOAL_ADAPTER_PREFLIGHT_FARM_SOURCE_NOT_CONFIRMED";
          evidence = {
            itemName,
            monsterType,
            farmState: text(status.state),
            farmReason: text(status.reason),
            candidateCount: candidates.length,
          };
        } else {
          outcome = "PASS";
          reason = "GOAL_ADAPTER_PREFLIGHT_FARM_CONFIRMED";
          evidence = {
            itemName,
            monsterType,
            quantity,
            farmState: text(status.state),
            farmReason: text(status.reason),
            dropItems: stringList(exact.estimated?.dropItems),
          };
        }
      } catch (error) {
        evidence = {
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        this.deps.farmIntelligence.clearConfigOverride();
        farmOverrideCleared = true;
        try {
          this.deps.farmIntelligence.tick();
        } catch (_error) {
          // Cleanup state is still restored even if the refresh projection fails.
        }
      }

      return finish(outcome, reason, evidence);
    }

    if (identity.kind === "PLAN_CRAFT") {
      const preflight = record(request.preflight);
      const preflightArguments = record(preflight.arguments);
      const recipe = text(preflightArguments.recipe);

      if (
        request.type !== "GOAL_RUNTIME_SEQUENCE" ||
        text(request.bridge) !== "CraftController" ||
        text(preflight.runtimeMethod) !== "runCraftMaterialPlan" ||
        preflight.readOnly !== true ||
        !recipe
      ) {
        return finish("BLOCKED", "GOAL_ADAPTER_PREFLIGHT_CRAFT_CONTRACT_INVALID");
      }

      try {
        const plan = record(await this.deps.craftMaterialPlan(recipe));
        const reason = text(plan.reason);
        const requestedRecipe = text(plan.requestedRecipe);
        const selected = record(plan.selected);
        const recipeMatches =
          requestedRecipe === recipe &&
          (reason === "CRAFT_MATERIAL_RECIPE_ALREADY_READY" ||
            (reason === "CRAFT_MATERIAL_TARGET_SELECTED" &&
              text(selected.recipe) === recipe));

        if (plan.outcome !== "PASS" || !recipeMatches) {
          return finish(
            "BLOCKED",
            "GOAL_ADAPTER_PREFLIGHT_CRAFT_NOT_READY",
            {
              recipe,
              outcome: text(plan.outcome),
              reason,
              requestedRecipe,
              selectedRecipe: text(selected.recipe),
              rejectedSources: Array.isArray(plan.rejectedSources)
                ? plan.rejectedSources.length
                : 0,
            },
          );
        }

        return finish("PASS", "GOAL_ADAPTER_PREFLIGHT_CRAFT_CONFIRMED", {
          recipe,
          reason,
          alreadyReady: reason === "CRAFT_MATERIAL_RECIPE_ALREADY_READY",
          materialTargetSelected: reason === "CRAFT_MATERIAL_TARGET_SELECTED",
          selectedRecipe: text(selected.recipe),
        });
      } catch (error) {
        return finish("FAIL", "GOAL_ADAPTER_PREFLIGHT_CRAFT_RUNTIME_ERROR", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return finish("BLOCKED", "GOAL_ADAPTER_PREFLIGHT_KIND_UNSUPPORTED");
  }
}

export { GOAL_ADAPTER_REQUEST_VERSION };

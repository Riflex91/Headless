import type {
  FarmIntelligenceController,
  FarmIntelligenceStatus,
} from "./farm-intelligence-controller.lib";
import type { CharacterSnapshot } from "./game-adapter.lib";

export type FarmLiveTestOutcome = "PASS" | "FAIL" | "TIMEOUT";

export interface FarmLiveTestOptions {
  requestId?: string;
  sampleMs?: number;
}

export interface FarmLiveTestResult {
  requestId: string;
  outcome: FarmLiveTestOutcome;
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  start: {
    map: string | null;
    x: number | null;
    y: number | null;
    xp: number | null;
    gold: number | null;
  };
  selection: {
    first: FarmIntelligenceStatus["selected"];
    sampled: FarmIntelligenceStatus["selected"];
    whyMonsterProjected: boolean;
    whySpotProjected: boolean;
    observedPerformanceProjected: boolean;
  };
  scope: {
    readOnly: true;
    movementMutationForced: false;
    combatMutationForced: false;
    valueMutationForced: false;
  };
  cleanup: {
    farmOverrideCleared: boolean;
  };
}

interface FarmLiveTestDependencies {
  farmIntelligence: Pick<
    FarmIntelligenceController,
    "setConfigOverride" | "clearConfigOverride" | "tick"
  >;
  character(): CharacterSnapshot;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function projected(
  selected: FarmIntelligenceStatus["selected"],
): boolean {
  return (
    !!selected &&
    typeof selected.monster === "string" &&
    selected.monster.length > 0 &&
    typeof selected.map === "string" &&
    selected.map.length > 0 &&
    Number.isFinite(selected.score)
  );
}

export class FarmLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: FarmLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep = deps.sleep || defaultSleep;
  }

  async run(options: FarmLiveTestOptions = {}): Promise<FarmLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `farm-live-${startedAt}`;
    const sampleMs = Math.max(1000, options.sampleMs || 1500);
    const firstCharacter = this.deps.character();
    let farmOverrideCleared = false;
    let first: FarmIntelligenceStatus["selected"] = null;
    let sampled: FarmIntelligenceStatus["selected"] = null;
    let outcome: FarmLiveTestOutcome = "FAIL";
    let reason = "FARM_LIVE_E2E_NOT_COMPLETED";

    this.deps.farmIntelligence.setConfigOverride({
      farming: {
        enabled: true,
        observationSampleMs: sampleMs,
        observationWindowMs: Math.max(5000, sampleMs * 4),
      },
    });

    try {
      const firstStatus = this.deps.farmIntelligence.tick();
      first = firstStatus.selected;
      if (!projected(first)) {
        reason =
          firstStatus.state === "NO_CANDIDATES"
            ? "FARM_LIVE_E2E_NO_CANDIDATES"
            : "FARM_LIVE_E2E_SELECTION_INVALID";
      } else if (!first?.whyMonster || !first?.whySpot) {
        reason = "FARM_LIVE_E2E_WHY_MISSING";
      } else {
        await this.sleep(sampleMs + 100);
        const sampledStatus = this.deps.farmIntelligence.tick();
        sampled = sampledStatus.selected;

        if (!projected(sampled)) {
          reason = "FARM_LIVE_E2E_SAMPLE_SELECTION_INVALID";
        } else if (!sampled?.whyMonster || !sampled?.whySpot) {
          reason = "FARM_LIVE_E2E_SAMPLE_WHY_MISSING";
        } else if (!sampled.observed) {
          reason = "FARM_LIVE_E2E_OBSERVED_PERFORMANCE_MISSING";
        } else {
          outcome = "PASS";
          reason = "FARM_LIVE_E2E_CONFIRMED";
        }
      }
    } finally {
      this.deps.farmIntelligence.clearConfigOverride();
      farmOverrideCleared = true;
      this.deps.farmIntelligence.tick();
    }

    const completedAt = this.now();
    return {
      requestId,
      outcome,
      reason,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      character: firstCharacter.name,
      start: {
        map: firstCharacter.map,
        x: firstCharacter.x,
        y: firstCharacter.y,
        xp: firstCharacter.xp,
        gold: firstCharacter.gold,
      },
      selection: {
        first,
        sampled,
        whyMonsterProjected: !!sampled?.whyMonster,
        whySpotProjected: !!sampled?.whySpot,
        observedPerformanceProjected: !!sampled?.observed,
      },
      scope: {
        readOnly: true,
        movementMutationForced: false,
        combatMutationForced: false,
        valueMutationForced: false,
      },
      cleanup: {
        farmOverrideCleared,
      },
    };
  }
}

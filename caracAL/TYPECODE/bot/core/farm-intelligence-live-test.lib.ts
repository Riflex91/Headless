import type {
  FarmIntelligenceController,
  FarmIntelligenceStatus,
} from "./farm-intelligence-controller.lib";
import type { CharacterSnapshot } from "./game-adapter.lib";

export type FarmIntelligenceLiveTestOutcome =
  | "PASS"
  | "FAIL"
  | "UNKNOWN"
  | "TIMEOUT";

export interface FarmIntelligenceLiveTestOptions {
  requestId?: string;
  sampleMs?: number;
}

export interface FarmIntelligenceLiveTestResult {
  requestId: string;
  outcome: FarmIntelligenceLiveTestOutcome;
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
  intelligence: {
    state: string | null;
    candidateCount: number;
    selectedFarmKey: string | null;
    selectedMonster: string | null;
    selectedMap: string | null;
    score: number | null;
    whyMonster: string | null;
    whySpot: string | null;
    observedSample: boolean;
    observedSampleMs: number | null;
    observedXpPerHour: number | null;
    observedGoldPerHour: number | null;
    observedDropsPerHour: number | null;
  };
  scope: {
    movementMutationForced: false;
    combatMutationForced: false;
    consumableMutationForced: false;
    valueMutationForced: false;
  };
  cleanup: {
    farmOverrideCleared: boolean;
  };
}

interface FarmIntelligenceLiveTestDependencies {
  farmIntelligence: Pick<
    FarmIntelligenceController,
    "status" | "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  character: () => CharacterSnapshot;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const TEST_CONFIG = {
  farming: {
    enabled: true,
    observationSampleMs: 1000,
    observationWindowMs: 5000,
    maxCandidates: 12,
  },
};

function selectedEvidence(status: FarmIntelligenceStatus): boolean {
  const selected = status.selected;
  return (
    status.state === "READY" &&
    status.candidates.length > 0 &&
    !!selected &&
    typeof selected.farmKey === "string" &&
    selected.farmKey.length > 0 &&
    typeof selected.monster === "string" &&
    selected.monster.length > 0 &&
    typeof selected.map === "string" &&
    selected.map.length > 0 &&
    Number.isFinite(selected.score) &&
    typeof selected.whyMonster === "string" &&
    selected.whyMonster.length > 0 &&
    typeof selected.whySpot === "string" &&
    selected.whySpot.length > 0
  );
}

export class FarmIntelligenceLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly dependencies: FarmIntelligenceLiveTestDependencies,
  ) {
    this.now = dependencies.now || (() => Date.now());
    this.sleep =
      dependencies.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: FarmIntelligenceLiveTestOptions = {},
  ): Promise<FarmIntelligenceLiveTestResult> {
    const startedAt = this.now();
    const requestId =
      options.requestId || `farm-intelligence-live-${startedAt}`;
    const sampleMs = Math.max(
      1000,
      Number.isFinite(options.sampleMs) ? Number(options.sampleMs) : 1200,
    );
    const character = this.dependencies.character();

    const result: FarmIntelligenceLiveTestResult = {
      requestId,
      outcome: "FAIL",
      reason: "NOT_RUN",
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      character: character.name,
      start: {
        map: character.map,
        x: character.x,
        y: character.y,
        xp: character.xp,
        gold: character.gold,
      },
      intelligence: {
        state: null,
        candidateCount: 0,
        selectedFarmKey: null,
        selectedMonster: null,
        selectedMap: null,
        score: null,
        whyMonster: null,
        whySpot: null,
        observedSample: false,
        observedSampleMs: null,
        observedXpPerHour: null,
        observedGoldPerHour: null,
        observedDropsPerHour: null,
      },
      scope: {
        movementMutationForced: false,
        combatMutationForced: false,
        consumableMutationForced: false,
        valueMutationForced: false,
      },
      cleanup: {
        farmOverrideCleared: false,
      },
    };

    try {
      this.dependencies.farmIntelligence.setConfigOverride(TEST_CONFIG);
      let status = this.dependencies.farmIntelligence.tick();
      this.captureStatus(result, status);

      if (!selectedEvidence(status)) {
        result.reason =
          status.state === "NO_CANDIDATES"
            ? "FARM_INTELLIGENCE_NO_CANDIDATES"
            : "FARM_INTELLIGENCE_SELECTION_INCOMPLETE";
        return this.finish(result);
      }

      await this.sleep(sampleMs);
      status = this.dependencies.farmIntelligence.tick();
      this.captureStatus(result, status);

      if (!selectedEvidence(status)) {
        result.reason = "FARM_INTELLIGENCE_SELECTION_LOST";
        return this.finish(result);
      }

      const observed = status.selected?.observed || null;
      if (
        !observed ||
        !Number.isFinite(observed.sampleMs) ||
        observed.sampleMs < 1000 ||
        !Number.isFinite(observed.xpPerHour) ||
        !Number.isFinite(observed.goldPerHour) ||
        !Number.isFinite(observed.dropsPerHour)
      ) {
        result.reason = "FARM_INTELLIGENCE_OBSERVATION_MISSING";
        return this.finish(result);
      }

      result.outcome = "PASS";
      result.reason = "FARM_INTELLIGENCE_LIVE_CONFIRMED";
      return this.finish(result);
    } catch (error) {
      result.reason =
        error instanceof Error
          ? `FARM_INTELLIGENCE_LIVE_ERROR:${error.message}`
          : "FARM_INTELLIGENCE_LIVE_ERROR";
      return this.finish(result);
    } finally {
      this.dependencies.farmIntelligence.clearConfigOverride();
      this.dependencies.farmIntelligence.tick();
      result.cleanup.farmOverrideCleared = true;
      result.completedAt = this.now();
      result.durationMs = result.completedAt - result.startedAt;
    }
  }

  private captureStatus(
    result: FarmIntelligenceLiveTestResult,
    status: FarmIntelligenceStatus,
  ): void {
    const selected = status.selected;
    const observed = selected?.observed || null;
    result.intelligence = {
      state: status.state,
      candidateCount: status.candidates.length,
      selectedFarmKey: selected?.farmKey || null,
      selectedMonster: selected?.monster || null,
      selectedMap: selected?.map || null,
      score:
        selected && Number.isFinite(selected.score) ? selected.score : null,
      whyMonster: selected?.whyMonster || null,
      whySpot: selected?.whySpot || null,
      observedSample: !!observed,
      observedSampleMs: observed?.sampleMs ?? null,
      observedXpPerHour: observed?.xpPerHour ?? null,
      observedGoldPerHour: observed?.goldPerHour ?? null,
      observedDropsPerHour: observed?.dropsPerHour ?? null,
    };
  }

  private finish(
    result: FarmIntelligenceLiveTestResult,
  ): FarmIntelligenceLiveTestResult {
    result.completedAt = this.now();
    result.durationMs = result.completedAt - result.startedAt;
    return result;
  }
}

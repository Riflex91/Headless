import type {
  MerchantFishingController,
  MerchantFishingStatus,
} from "./merchant-fishing-controller.lib";

export interface FishingLiveTestOptions {
  requestId?: string;
  timeoutMs?: number;
  pollMs?: number;
}

export interface FishingLiveTestEvidence {
  skillChecked: boolean;
  toolSatisfied: boolean;
  toolAcquisitionRequired: boolean;
  toolAcquisitionObserved: boolean;
  zoneLocated: boolean;
  travelSatisfied: boolean;
  rodEquipped: boolean;
  skillAttempted: boolean;
  resultObserved: boolean;
  resultFound: boolean | null;
  mainhandRestoreRequired: boolean;
  mainhandRestored: boolean;
  unknownOutcomeAvoided: boolean;
  roadmapComplete: boolean;
}

export interface FishingLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: {
    name: string | null;
    map: string | null;
  };
  finalStatus: MerchantFishingStatus;
  stagesSeen: MerchantFishingStatus["roadmapStage"][];
  evidence: FishingLiveTestEvidence;
  scope: {
    movementMutationAllowed: true;
    combatMutationAllowed: false;
    lootMutationAllowed: false;
    prerequisitePurchaseAllowed: true;
    craftMutationAllowed: true;
    equipmentMutationAllowed: true;
    fishingSkillMutationAllowed: true;
    blindRetryAllowed: false;
    standMutationAllowed: false;
    wishlistMutationAllowed: false;
    pontyPurchaseAllowed: false;
    giveawayMutationAllowed: false;
    miningMutationAllowed: false;
    mutationScope: "fishing-only";
  };
  cleanup: {
    mainhandRestored: boolean | null;
    autonomyOverrideCleared: boolean;
  };
}

interface FishingLiveTestDependencies {
  fishing: Pick<
    MerchantFishingController,
    | "setConfigOverride"
    | "clearConfigOverride"
    | "tick"
    | "status"
    | "cleanupTemporaryState"
  >;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 750;

function pushStage(
  stages: MerchantFishingStatus["roadmapStage"][],
  stage: MerchantFishingStatus["roadmapStage"],
): void {
  if (!stages.includes(stage)) stages.push(stage);
}

function evidenceFrom(
  history: MerchantFishingStatus[],
): FishingLiveTestEvidence {
  const first = history[0] || null;
  const final = history[history.length - 1] || null;
  const toolAcquisitionObserved = history.some(
    (status) =>
      status.roadmapStage === "Tool beschaffen" ||
      status.tool.acquiredByController === true,
  );
  const toolInitiallySatisfied =
    !!first &&
    (first.tool.equipped === true || first.tool.inventorySlot !== null);
  const result = history
    .slice()
    .reverse()
    .find((status) => status.result.attempted);

  return {
    skillChecked: history.some(
      (status) =>
        status.skill.present === true &&
        status.skill.requiredLevel !== null &&
        status.skill.requiredMp !== null,
    ),
    toolSatisfied: history.some(
      (status) =>
        status.tool.equipped === true ||
        status.tool.inventorySlot !== null ||
        status.tool.acquiredByController === true,
    ),
    toolAcquisitionRequired: !toolInitiallySatisfied,
    toolAcquisitionObserved,
    zoneLocated: history.some(
      (status) =>
        status.zone.map !== null &&
        status.zone.x !== null &&
        status.zone.y !== null,
    ),
    travelSatisfied: history.some(
      (status) => status.state === "TRAVEL" || status.zone.inside === true,
    ),
    rodEquipped: history.some((status) => status.tool.equipped === true),
    skillAttempted: history.some(
      (status) =>
        status.result.attempted === true ||
        status.lastAction?.action === "SKILL",
    ),
    resultObserved: typeof result?.result.found === "boolean",
    resultFound:
      typeof result?.result.found === "boolean"
        ? result.result.found
        : null,
    mainhandRestoreRequired:
      history.some((status) => status.restore.required === true),
    mainhandRestored:
      final?.restore.required === true
        ? final.restore.restored === true
        : true,
    unknownOutcomeAvoided: !history.some(
      (status) => status.state === "UNKNOWN",
    ),
    roadmapComplete: final?.state === "COMPLETE",
  };
}

function passEvidence(evidence: FishingLiveTestEvidence): boolean {
  return (
    evidence.skillChecked &&
    evidence.toolSatisfied &&
    (!evidence.toolAcquisitionRequired ||
      evidence.toolAcquisitionObserved) &&
    evidence.zoneLocated &&
    evidence.travelSatisfied &&
    evidence.rodEquipped &&
    evidence.skillAttempted &&
    evidence.resultObserved &&
    evidence.mainhandRestored &&
    evidence.unknownOutcomeAvoided &&
    evidence.roadmapComplete
  );
}

export class FishingLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: FishingLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: FishingLiveTestOptions = {},
  ): Promise<FishingLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `fishing-live-${startedAt}`;
    const timeoutMs = Math.max(30000, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const pollMs = Math.max(250, options.pollMs || DEFAULT_POLL_MS);
    const history: MerchantFishingStatus[] = [];
    const stagesSeen: MerchantFishingStatus["roadmapStage"][] = [];
    let finalStatus = this.deps.fishing.status();
    let outcome: FishingLiveTestResult["outcome"] = "FAIL";
    let reason = "FISHING_LIVE_EVIDENCE_INCOMPLETE";
    let autonomyOverrideCleared = false;
    let mainhandRestored: boolean | null = null;

    this.deps.fishing.setConfigOverride({
      merchantAutonomy: {
        enabled: true,
        fishing: {
          enabled: true,
          acquireTool: true,
          goldReserve: 1000,
        },
      },
    });

    try {
      while (this.now() - startedAt < timeoutMs) {
        finalStatus = await this.deps.fishing.tick();
        history.push(finalStatus);
        pushStage(stagesSeen, finalStatus.roadmapStage);

        if (
          finalStatus.reason === "FISHING_COOLDOWN_ACTIVE" &&
          !finalStatus.result.attempted
        ) {
          outcome = "FAIL";
          reason = "FISHING_LIVE_COOLDOWN_ACTIVE";
          break;
        }

        if (finalStatus.state === "UNKNOWN") {
          outcome = "FAIL";
          reason = "FISHING_LIVE_ACTION_OUTCOME_UNKNOWN";
          break;
        }

        if (finalStatus.state === "BLOCKED") {
          outcome = "FAIL";
          reason = finalStatus.reason || "FISHING_LIVE_BLOCKED";
          break;
        }

        if (finalStatus.state === "COMPLETE") {
          const evidence = evidenceFrom(history);
          outcome = passEvidence(evidence) ? "PASS" : "FAIL";
          reason =
            outcome === "PASS"
              ? "FISHING_LIVE_RUNTIME_CONFIRMED"
              : "FISHING_LIVE_EVIDENCE_INCOMPLETE";
          break;
        }

        await this.sleep(pollMs);
      }

      if (
        outcome === "FAIL" &&
        reason === "FISHING_LIVE_EVIDENCE_INCOMPLETE" &&
        this.now() - startedAt >= timeoutMs
      ) {
        outcome = "TIMEOUT";
        reason = "FISHING_LIVE_TIMEOUT";
      }
    } finally {
      const cleanup = await this.deps.fishing.cleanupTemporaryState();
      mainhandRestored =
        cleanup === null ? null : cleanup.status === "CONFIRMED";
      this.deps.fishing.clearConfigOverride();
      autonomyOverrideCleared = true;
    }

    finalStatus = this.deps.fishing.status();
    if (
      history.length &&
      history[history.length - 1] !== finalStatus
    ) {
      history.push(finalStatus);
      pushStage(stagesSeen, finalStatus.roadmapStage);
    }
    const evidence = evidenceFrom(history);
    if (outcome === "PASS" && !passEvidence(evidence)) {
      outcome = "FAIL";
      reason = "FISHING_LIVE_EVIDENCE_INCOMPLETE";
    }
    if (
      outcome === "PASS" &&
      (!autonomyOverrideCleared ||
        mainhandRestored === false ||
        evidence.mainhandRestored === false)
    ) {
      outcome = "FAIL";
      reason = "FISHING_LIVE_CLEANUP_FAILED";
    }

    return {
      requestId,
      outcome,
      reason,
      startedAt,
      completedAt: this.now(),
      durationMs: Math.max(0, this.now() - startedAt),
      character: {
        name: finalStatus.character.name,
        map: finalStatus.character.map,
      },
      finalStatus,
      stagesSeen,
      evidence,
      scope: {
        movementMutationAllowed: true,
        combatMutationAllowed: false,
        lootMutationAllowed: false,
        prerequisitePurchaseAllowed: true,
        craftMutationAllowed: true,
        equipmentMutationAllowed: true,
        fishingSkillMutationAllowed: true,
        blindRetryAllowed: false,
        standMutationAllowed: false,
        wishlistMutationAllowed: false,
        pontyPurchaseAllowed: false,
        giveawayMutationAllowed: false,
        miningMutationAllowed: false,
        mutationScope: "fishing-only",
      },
      cleanup: {
        mainhandRestored,
        autonomyOverrideCleared,
      },
    };
  }
}

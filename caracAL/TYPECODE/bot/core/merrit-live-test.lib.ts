import type {
  MerchantMerritController,
  MerchantMerritStatus,
} from "./merchant-merrit-controller.lib";

export interface MerritLiveTestOptions {
  requestId?: string;
  timeoutMs?: number;
  pollMs?: number;
}

export interface MerritLiveTestEvidence {
  cooldownChecked: boolean;
  zoneSatisfied: boolean;
  travelObserved: boolean;
  positionConfirmed: boolean;
  standConfirmed: boolean;
  listingConfirmed: boolean;
  settleObserved: boolean;
  handoffSatisfied: boolean;
  parcelConfirmed: boolean;
  cooldownReadyAtPresent: boolean;
  unknownOutcomeAvoided: boolean;
}

export interface MerritLiveTestResult {
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
  finalStatus: MerchantMerritStatus;
  stagesSeen: MerchantMerritStatus["roadmapStage"][];
  evidence: MerritLiveTestEvidence;
  scope: {
    movementMutationAllowed: true;
    standMutationAllowed: true;
    listingMutationAllowed: true;
    prerequisitePurchaseAllowed: true;
    blindRetryAllowed: false;
    wishlistMutationAllowed: false;
    pontyPurchaseAllowed: false;
    giveawayMutationAllowed: false;
    gatheringMutationAllowed: false;
    equipmentMutationAllowed: false;
    mutationScope: "merrit-only";
  };
  cleanup: {
    temporaryListingRestored: boolean | null;
    standRestored: boolean | null;
    autonomyOverrideCleared: boolean;
  };
}

interface MerritLiveTestDependencies {
  merrit: Pick<
    MerchantMerritController,
    | "setConfigOverride"
    | "clearConfigOverride"
    | "tick"
    | "status"
    | "cleanupTemporaryState"
  >;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 360000;
const DEFAULT_POLL_MS = 1000;

function pushStage(
  stages: MerchantMerritStatus["roadmapStage"][],
  stage: MerchantMerritStatus["roadmapStage"],
): void {
  if (!stages.includes(stage)) stages.push(stage);
}

function evidenceFrom(
  history: MerchantMerritStatus[],
): MerritLiveTestEvidence {
  const statuses = history;
  const parcel = statuses.find((status) => status.state === "PARCEL");
  return {
    cooldownChecked: statuses.some(
      (status) =>
        status.server.statusKnown === true && status.server.serverNow !== null,
    ),
    zoneSatisfied: statuses.some(
      (status) =>
        status.target.inEligibleArea === true ||
        status.target.positioned === true,
    ),
    travelObserved: statuses.some(
      (status) =>
        status.state === "TRAVEL" ||
        status.lastAction?.action === "SMART_MOVE",
    ),
    positionConfirmed: statuses.some(
      (status) => status.target.positioned === true,
    ),
    standConfirmed: statuses.some((status) => status.stand.open === true),
    listingConfirmed: statuses.some(
      (status) => status.listing.valid === true,
    ),
    settleObserved: statuses.some(
      (status) =>
        status.state === "SETTLING" ||
        status.roadmapStage === "120 s settle",
    ),
    handoffSatisfied:
      statuses.some((status) => status.state === "HANDOFF") || !!parcel,
    parcelConfirmed: !!parcel?.parcel.confirmedAt,
    cooldownReadyAtPresent: !!parcel?.parcel.readyAt,
    unknownOutcomeAvoided: !statuses.some(
      (status) => status.state === "UNKNOWN",
    ),
  };
}

function passEvidence(evidence: MerritLiveTestEvidence): boolean {
  return (
    evidence.cooldownChecked &&
    evidence.zoneSatisfied &&
    evidence.positionConfirmed &&
    evidence.standConfirmed &&
    evidence.listingConfirmed &&
    evidence.settleObserved &&
    evidence.handoffSatisfied &&
    evidence.parcelConfirmed &&
    evidence.cooldownReadyAtPresent &&
    evidence.unknownOutcomeAvoided
  );
}

export class MerritLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: MerritLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: MerritLiveTestOptions = {},
  ): Promise<MerritLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `merrit-live-${startedAt}`;
    const timeoutMs = Math.max(30000, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const pollMs = Math.max(250, options.pollMs || DEFAULT_POLL_MS);
    const history: MerchantMerritStatus[] = [];
    const stagesSeen: MerchantMerritStatus["roadmapStage"][] = [];
    let finalStatus = this.deps.merrit.status();
    let outcome: MerritLiveTestResult["outcome"] = "FAIL";
    let reason = "MERRIT_LIVE_EVIDENCE_INCOMPLETE";
    let autonomyOverrideCleared = false;
    let temporaryListingRestored: boolean | null = null;
    let standRestored: boolean | null = null;

    this.deps.merrit.setConfigOverride({
      merchantAutonomy: {
        enabled: true,
        merrit: {
          enabled: true,
          listingItem: "hpot0",
          listingQuantity: 1,
          listingPrice: 999999999,
          goldReserve: 1000,
          autoAcquireStand: true,
          autoAcquireListingItem: true,
          statusRefreshMs: 1000,
        },
      },
    });

    try {
      while (this.now() - startedAt < timeoutMs) {
        finalStatus = await this.deps.merrit.tick();
        history.push(finalStatus);
        pushStage(stagesSeen, finalStatus.roadmapStage);

        if (
          finalStatus.state === "COOLDOWN" &&
          !history.some((status) => status.state === "PARCEL")
        ) {
          outcome = "FAIL";
          reason = "MERRIT_LIVE_ACCOUNT_COOLDOWN_ACTIVE";
          break;
        }

        if (finalStatus.state === "UNKNOWN") {
          outcome = "FAIL";
          reason = "MERRIT_LIVE_ACTION_OUTCOME_UNKNOWN";
          break;
        }

        if (finalStatus.state === "BLOCKED") {
          outcome = "FAIL";
          reason = finalStatus.reason || "MERRIT_LIVE_BLOCKED";
          break;
        }

        if (finalStatus.state === "PARCEL") {
          const evidence = evidenceFrom(history);
          outcome = passEvidence(evidence) ? "PASS" : "FAIL";
          reason =
            outcome === "PASS"
              ? "MERRIT_LIVE_RUNTIME_CONFIRMED"
              : "MERRIT_LIVE_EVIDENCE_INCOMPLETE";
          break;
        }

        await this.sleep(pollMs);
      }

      if (
        outcome === "FAIL" &&
        reason === "MERRIT_LIVE_EVIDENCE_INCOMPLETE" &&
        this.now() - startedAt >= timeoutMs
      ) {
        outcome = "TIMEOUT";
        reason = "MERRIT_LIVE_TIMEOUT";
      }
    } finally {
      const cleanup = await this.deps.merrit.cleanupTemporaryState();
      temporaryListingRestored =
        cleanup.listing === null ? null : cleanup.listing.status === "CONFIRMED";
      standRestored =
        cleanup.stand === null ? null : cleanup.stand.status === "CONFIRMED";
      this.deps.merrit.clearConfigOverride();
      autonomyOverrideCleared = true;
    }

    const completedAt = this.now();
    const evidence = evidenceFrom(history);
    if (outcome === "PASS" && !passEvidence(evidence)) {
      outcome = "FAIL";
      reason = "MERRIT_LIVE_EVIDENCE_INCOMPLETE";
    }
    if (
      outcome === "PASS" &&
      (!autonomyOverrideCleared ||
        temporaryListingRestored === false ||
        standRestored === false)
    ) {
      outcome = "FAIL";
      reason = "MERRIT_LIVE_CLEANUP_FAILED";
    }

    return {
      requestId,
      outcome,
      reason,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      character: {
        name: finalStatus.character.name,
        map: finalStatus.character.map,
      },
      finalStatus,
      stagesSeen,
      evidence,
      scope: {
        movementMutationAllowed: true,
        standMutationAllowed: true,
        listingMutationAllowed: true,
        prerequisitePurchaseAllowed: true,
        blindRetryAllowed: false,
        wishlistMutationAllowed: false,
        pontyPurchaseAllowed: false,
        giveawayMutationAllowed: false,
        gatheringMutationAllowed: false,
        equipmentMutationAllowed: false,
        mutationScope: "merrit-only",
      },
      cleanup: {
        temporaryListingRestored,
        standRestored,
        autonomyOverrideCleared,
      },
    };
  }
}

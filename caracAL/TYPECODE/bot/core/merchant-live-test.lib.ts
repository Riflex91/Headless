import type {
  MerchantAutonomyController,
  MerchantAutonomyStatus,
} from "./merchant-autonomy-controller.lib";

export interface MerchantLiveTestOptions {
  requestId?: string;
}

export interface MerchantLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: {
    name: string | null;
    ctype: string | null;
    map: string | null;
  };
  autonomy: MerchantAutonomyStatus;
  evidence: {
    featureCoverageComplete: boolean;
    realGameDataVisible: boolean;
    merritDataVisible: boolean;
    fishingDataVisible: boolean;
    miningDataVisible: boolean;
    wishlistBoundaryVisible: boolean;
    pontyBoundaryVisible: boolean;
    giveawaysReadOnly: boolean;
  };
  scope: {
    readOnly: true;
    movementMutationForced: false;
    valueMutationForced: false;
    standMutationForced: false;
    wishlistMutationForced: false;
    pontyPurchaseForced: false;
    giveawayJoinForced: false;
    gatheringSkillForced: false;
    equipmentMutationForced: false;
    mutationScope: "not forced";
  };
  cleanup: {
    autonomyOverrideCleared: boolean;
  };
}

interface MerchantLiveTestDependencies {
  merchantAutonomy: Pick<
    MerchantAutonomyController,
    "setConfigOverride" | "clearConfigOverride" | "tick"
  >;
  now?: () => number;
}

const EXPECTED_FEATURES = [
  "MERRIT",
  "FISHING",
  "MINING",
  "WISHLIST",
  "GIVEAWAYS",
  "PONTY",
  "MERCHANT_SKILLS",
];

export class MerchantLiveTestRunner {
  private readonly now: () => number;

  constructor(private readonly deps: MerchantLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  run(options: MerchantLiveTestOptions = {}): MerchantLiveTestResult {
    const startedAt = this.now();
    const requestId = options.requestId || "merchant-live-" + startedAt;
    let autonomyOverrideCleared = false;
    let autonomy: MerchantAutonomyStatus;

    this.deps.merchantAutonomy.setConfigOverride({
      merchantAutonomy: {
        enabled: true,
      },
    });
    try {
      autonomy = this.deps.merchantAutonomy.tick();
    } finally {
      this.deps.merchantAutonomy.clearConfigOverride();
      autonomyOverrideCleared = true;
    }

    const featureCoverageComplete = EXPECTED_FEATURES.every((feature) =>
      autonomy.featureOrder.includes(feature as never),
    );
    const realGameDataVisible =
      autonomy.merrit.mainMapPresent &&
      autonomy.merrit.standItems.length > 0 &&
      autonomy.merchantSkills.available.length > 0;
    const merritDataVisible =
      autonomy.merrit.npcPresent && autonomy.merrit.mainMapPresent;
    const fishingDataVisible =
      autonomy.gathering.fishing.skillPresent &&
      autonomy.gathering.fishing.zones.length > 0;
    const miningDataVisible =
      autonomy.gathering.mining.skillPresent &&
      autonomy.gathering.mining.zones.length > 0;
    const wishlistBoundaryVisible = autonomy.wishlist.boundarySupported;
    const pontyBoundaryVisible = autonomy.ponty.boundarySupported;
    const giveawaysReadOnly =
      autonomy.giveaways.joinOnly === true &&
      autonomy.mutationPolicy.giveawayCreationSupported === false;

    const pass =
      autonomy.state === "READY" &&
      featureCoverageComplete &&
      realGameDataVisible &&
      merritDataVisible &&
      fishingDataVisible &&
      miningDataVisible &&
      wishlistBoundaryVisible &&
      pontyBoundaryVisible &&
      giveawaysReadOnly &&
      autonomy.mutationPolicy.executionEnabled === false &&
      autonomy.mutationPolicy.valueMutationForced === false &&
      autonomyOverrideCleared;

    const completedAt = this.now();
    return {
      requestId,
      outcome: pass ? "PASS" : "FAIL",
      reason: pass
        ? "MERCHANT_LIVE_RUNTIME_CONFIRMED"
        : "MERCHANT_LIVE_EVIDENCE_INCOMPLETE",
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      character: { ...autonomy.character },
      autonomy,
      evidence: {
        featureCoverageComplete,
        realGameDataVisible,
        merritDataVisible,
        fishingDataVisible,
        miningDataVisible,
        wishlistBoundaryVisible,
        pontyBoundaryVisible,
        giveawaysReadOnly,
      },
      scope: {
        readOnly: true,
        movementMutationForced: false,
        valueMutationForced: false,
        standMutationForced: false,
        wishlistMutationForced: false,
        pontyPurchaseForced: false,
        giveawayJoinForced: false,
        gatheringSkillForced: false,
        equipmentMutationForced: false,
        mutationScope: "not forced",
      },
      cleanup: {
        autonomyOverrideCleared,
      },
    };
  }
}

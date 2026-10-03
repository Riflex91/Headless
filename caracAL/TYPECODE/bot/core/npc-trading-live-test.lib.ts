import type {
  NpcTradingController,
  NpcTradingRoundTripResult,
} from "./npc-trading-controller.lib";

export interface NpcTradingLiveTestOptions {
  requestId?: string;
}

export interface NpcTradingLiveEvidence {
  safeItemSelected: boolean;
  travelDispatchedOnce: boolean;
  buyDispatchedOnce: boolean;
  buySettled: boolean;
  sellDispatchedOnce: boolean;
  sellSettled: boolean;
  itemBaselineRestored: boolean;
  boundedGoldCost: boolean;
  blindRetryAvoided: boolean;
}

export interface NpcTradingLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  roundTrip: NpcTradingRoundTripResult;
  evidence: NpcTradingLiveEvidence;
  scope: {
    movementMutationAllowed: true;
    npcBuyMutationAllowed: true;
    npcSellMutationAllowed: true;
    marketTradingMutationAllowed: false;
    bankMutationAllowed: false;
    blindRetryAllowed: false;
    mutationScope: "npc-trading-round-trip-only";
  };
}

interface NpcTradingLiveDependencies {
  npcTrading: Pick<NpcTradingController, "roundTrip">;
  now?: () => number;
}

function evidenceFrom(
  result: NpcTradingRoundTripResult,
): NpcTradingLiveEvidence {
  const boundedGoldCost =
    result.netGoldCost !== null &&
    result.unitPrice !== null &&
    result.netGoldCost >= 0 &&
    result.netGoldCost <= result.unitPrice;

  return {
    safeItemSelected: !!result.itemName && result.unitPrice !== null,
    travelDispatchedOnce: !!result.travel.actionId,
    buyDispatchedOnce: !!result.buy.actionId,
    buySettled: result.buy.settled,
    sellDispatchedOnce: !!result.sell.actionId,
    sellSettled: result.sell.settled,
    itemBaselineRestored: result.itemBaselineRestored,
    boundedGoldCost,
    blindRetryAvoided: result.blindRetryPerformed === false,
  };
}

function completeEvidence(evidence: NpcTradingLiveEvidence): boolean {
  return (
    evidence.safeItemSelected &&
    evidence.travelDispatchedOnce &&
    evidence.buyDispatchedOnce &&
    evidence.buySettled &&
    evidence.sellDispatchedOnce &&
    evidence.sellSettled &&
    evidence.itemBaselineRestored &&
    evidence.boundedGoldCost &&
    evidence.blindRetryAvoided
  );
}

export class NpcTradingLiveTestRunner {
  private readonly now: () => number;

  constructor(private readonly deps: NpcTradingLiveDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  async run(
    options: NpcTradingLiveTestOptions = {},
  ): Promise<NpcTradingLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `npc-trading-live-${startedAt}`;
    const roundTrip = await this.deps.npcTrading.roundTrip(requestId);
    const evidence = evidenceFrom(roundTrip);

    let outcome = roundTrip.outcome;
    let reason =
      roundTrip.outcome === "PASS"
        ? "NPC_TRADING_LIVE_E2E_CONFIRMED"
        : roundTrip.reason;

    if (outcome === "PASS" && !completeEvidence(evidence)) {
      outcome = "FAIL";
      reason = "NPC_TRADING_LIVE_EVIDENCE_INCOMPLETE";
    }

    const completedAt = this.now();
    return {
      requestId,
      outcome,
      reason,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      roundTrip,
      evidence,
      scope: {
        movementMutationAllowed: true,
        npcBuyMutationAllowed: true,
        npcSellMutationAllowed: true,
        marketTradingMutationAllowed: false,
        bankMutationAllowed: false,
        blindRetryAllowed: false,
        mutationScope: "npc-trading-round-trip-only",
      },
    };
  }
}

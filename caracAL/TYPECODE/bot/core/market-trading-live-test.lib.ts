import type {
  MarketTradingController,
  MarketTradingRoundTripResult,
} from "./market-trading-controller.lib";

export interface MarketTradingLiveTestOptions {
  requestId?: string;
}

export interface MarketTradingLiveEvidence {
  safeItemSelected: boolean;
  standOpened: boolean;
  listDispatchedOnce: boolean;
  listingObserved: boolean;
  unlistDispatchedOnce: boolean;
  unlistSettled: boolean;
  tradeSlotCleared: boolean;
  itemBaselineRestored: boolean;
  standBaselineRestored: boolean;
  blindRetryAvoided: boolean;
  foreignTradeMutationAvoided: boolean;
}

export interface MarketTradingLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  roundTrip: MarketTradingRoundTripResult;
  evidence: MarketTradingLiveEvidence;
  scope: {
    standMutationAllowed: true;
    marketListMutationAllowed: true;
    marketUnlistMutationAllowed: true;
    foreignMarketBuyMutationAllowed: false;
    foreignMarketSellMutationAllowed: false;
    npcTradingMutationAllowed: false;
    bankMutationAllowed: false;
    blindRetryAllowed: false;
    mutationScope: "market-own-listing-round-trip-only";
  };
  cleanup: {
    itemBaselineRestored: boolean;
    standBaselineRestored: boolean;
    tradeSlotCleared: boolean;
  };
}

interface MarketTradingLiveDependencies {
  marketTrading: Pick<MarketTradingController, "roundTrip">;
  now?: () => number;
}

function evidenceFrom(
  result: MarketTradingRoundTripResult,
): MarketTradingLiveEvidence {
  return {
    safeItemSelected: !!result.itemName && result.listingPrice !== null,
    standOpened: result.openStand.actionId !== null && result.openStand.settled,
    listDispatchedOnce: result.list.actionId !== null,
    listingObserved: result.listingObserved,
    unlistDispatchedOnce: result.unlist.actionId !== null,
    unlistSettled: result.unlist.settled,
    tradeSlotCleared: result.tradeSlotCleared,
    itemBaselineRestored: result.itemBaselineRestored,
    standBaselineRestored: result.standBaselineRestored,
    blindRetryAvoided: result.blindRetryPerformed === false,
    foreignTradeMutationAvoided:
      result.foreignTradeMutationPerformed === false,
  };
}

function completeEvidence(evidence: MarketTradingLiveEvidence): boolean {
  return (
    evidence.safeItemSelected &&
    evidence.standOpened &&
    evidence.listDispatchedOnce &&
    evidence.listingObserved &&
    evidence.unlistDispatchedOnce &&
    evidence.unlistSettled &&
    evidence.tradeSlotCleared &&
    evidence.itemBaselineRestored &&
    evidence.standBaselineRestored &&
    evidence.blindRetryAvoided &&
    evidence.foreignTradeMutationAvoided
  );
}

export class MarketTradingLiveTestRunner {
  private readonly now: () => number;

  constructor(private readonly deps: MarketTradingLiveDependencies) {
    this.now = deps.now || (() => Date.now());
  }

  async run(
    options: MarketTradingLiveTestOptions = {},
  ): Promise<MarketTradingLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `market-trading-live-${startedAt}`;
    const roundTrip = await this.deps.marketTrading.roundTrip(requestId);
    const evidence = evidenceFrom(roundTrip);

    let outcome = roundTrip.outcome;
    let reason =
      roundTrip.outcome === "PASS"
        ? "MARKET_TRADING_LIVE_E2E_CONFIRMED"
        : roundTrip.reason;

    if (outcome === "PASS" && !completeEvidence(evidence)) {
      outcome = "FAIL";
      reason = "MARKET_TRADING_LIVE_EVIDENCE_INCOMPLETE";
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
        standMutationAllowed: true,
        marketListMutationAllowed: true,
        marketUnlistMutationAllowed: true,
        foreignMarketBuyMutationAllowed: false,
        foreignMarketSellMutationAllowed: false,
        npcTradingMutationAllowed: false,
        bankMutationAllowed: false,
        blindRetryAllowed: false,
        mutationScope: "market-own-listing-round-trip-only",
      },
      cleanup: {
        itemBaselineRestored: roundTrip.itemBaselineRestored,
        standBaselineRestored: roundTrip.standBaselineRestored,
        tradeSlotCleared: roundTrip.tradeSlotCleared,
      },
    };
  }
}

import type {
  BankGoldRoundTripResult,
  BankGoldSettlementController,
} from "./bank-gold-settlement.lib";
import type {
  BankTravelController,
  BankTravelStatus,
} from "./bank-travel-controller.lib";

export interface BankGoldLiveTestOptions {
  requestId?: string;
  amount?: number;
  travelTimeoutMs?: number;
  travelPollMs?: number;
}

export interface BankGoldLiveTestEvidence {
  bankReady: boolean;
  depositDispatchedOnce: boolean;
  depositSettled: boolean;
  withdrawDispatchedOnce: boolean;
  withdrawSettled: boolean;
  baselineRestored: boolean;
  blindRetryAvoided: boolean;
}

export interface BankGoldLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  amount: number;
  bankTravel: BankTravelStatus;
  roundTrip: BankGoldRoundTripResult | null;
  evidence: BankGoldLiveTestEvidence;
  scope: {
    movementMutationAllowed: true;
    bankGoldMutationAllowed: true;
    bankItemMutationAllowed: false;
    npcTradingMutationAllowed: false;
    marketTradingMutationAllowed: false;
    blindRetryAllowed: false;
    mutationScope: "bank-gold-round-trip-only";
  };
  cleanup: {
    configOverrideCleared: boolean;
    goldBaselineRestored: boolean;
  };
}

interface BankGoldLiveTestDependencies {
  bankTravel: Pick<
    BankTravelController,
    "setConfigOverride" | "clearConfigOverride" | "tick" | "status"
  >;
  bankGold: Pick<BankGoldSettlementController, "roundTrip">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TRAVEL_TIMEOUT_MS = 180000;
const DEFAULT_TRAVEL_POLL_MS = 500;

function evidenceFrom(
  bankTravel: BankTravelStatus,
  roundTrip: BankGoldRoundTripResult | null,
): BankGoldLiveTestEvidence {
  return {
    bankReady: bankTravel.state === "READY" && bankTravel.bank.available,
    depositDispatchedOnce: !!roundTrip?.deposit.action.id,
    depositSettled:
      roundTrip?.deposit.outcome === "PASS" &&
      roundTrip.deposit.evidence?.exactSettlement === true,
    withdrawDispatchedOnce: !!roundTrip?.withdraw?.action.id,
    withdrawSettled:
      roundTrip?.withdraw?.outcome === "PASS" &&
      roundTrip.withdraw.evidence?.exactSettlement === true,
    baselineRestored: roundTrip?.baselineRestored === true,
    blindRetryAvoided: roundTrip?.blindRetryPerformed === false,
  };
}

function completeEvidence(evidence: BankGoldLiveTestEvidence): boolean {
  return (
    evidence.bankReady &&
    evidence.depositDispatchedOnce &&
    evidence.depositSettled &&
    evidence.withdrawDispatchedOnce &&
    evidence.withdrawSettled &&
    evidence.baselineRestored &&
    evidence.blindRetryAvoided
  );
}

export class BankGoldLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: BankGoldLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: BankGoldLiveTestOptions = {},
  ): Promise<BankGoldLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `bank-gold-live-${startedAt}`;
    const amount = Number.isInteger(options.amount)
      ? Number(options.amount)
      : 1;
    const travelTimeoutMs = Math.max(
      10000,
      options.travelTimeoutMs || DEFAULT_TRAVEL_TIMEOUT_MS,
    );
    const travelPollMs = Math.max(
      100,
      options.travelPollMs || DEFAULT_TRAVEL_POLL_MS,
    );

    let bankTravel = this.deps.bankTravel.status();
    let roundTrip: BankGoldRoundTripResult | null = null;
    let outcome: BankGoldLiveTestResult["outcome"] = "FAIL";
    let reason = "BANK_GOLD_LIVE_EVIDENCE_INCOMPLETE";
    let configOverrideCleared = false;

    this.deps.bankTravel.setConfigOverride({
      bank: {
        enabled: true,
      },
    });

    try {
      const travelStartedAt = this.now();
      while (this.now() - travelStartedAt < travelTimeoutMs) {
        bankTravel = await this.deps.bankTravel.tick();

        if (bankTravel.state === "READY") break;
        if (bankTravel.state === "UNKNOWN") {
          outcome = "UNKNOWN";
          reason = "BANK_GOLD_LIVE_BANK_TRAVEL_UNKNOWN";
          break;
        }
        if (bankTravel.state === "BLOCKED") {
          outcome = "FAIL";
          reason = bankTravel.reason || "BANK_GOLD_LIVE_BANK_TRAVEL_BLOCKED";
          break;
        }

        await this.sleep(travelPollMs);
      }

      if (bankTravel.state !== "READY") {
        if (
          outcome === "FAIL" &&
          reason === "BANK_GOLD_LIVE_EVIDENCE_INCOMPLETE"
        ) {
          outcome = "TIMEOUT";
          reason = "BANK_GOLD_LIVE_BANK_TRAVEL_TIMEOUT";
        }
      } else {
        try {
          roundTrip = await this.deps.bankGold.roundTrip({
            amount,
            correlationId: requestId,
          });
          outcome = roundTrip.outcome;
          reason =
            roundTrip.outcome === "PASS"
              ? "BANK_GOLD_LIVE_E2E_CONFIRMED"
              : roundTrip.reason;
        } catch (error) {
          outcome = "FAIL";
          reason = `BANK_GOLD_LIVE_RUNTIME_ERROR:${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }
    } finally {
      this.deps.bankTravel.clearConfigOverride();
      configOverrideCleared = true;
    }

    const evidence = evidenceFrom(bankTravel, roundTrip);
    if (outcome === "PASS" && !completeEvidence(evidence)) {
      outcome = "FAIL";
      reason = "BANK_GOLD_LIVE_EVIDENCE_INCOMPLETE";
    }

    const completedAt = this.now();
    return {
      requestId,
      outcome,
      reason,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      amount,
      bankTravel,
      roundTrip,
      evidence,
      scope: {
        movementMutationAllowed: true,
        bankGoldMutationAllowed: true,
        bankItemMutationAllowed: false,
        npcTradingMutationAllowed: false,
        marketTradingMutationAllowed: false,
        blindRetryAllowed: false,
        mutationScope: "bank-gold-round-trip-only",
      },
      cleanup: {
        configOverrideCleared,
        goldBaselineRestored: roundTrip?.baselineRestored === true,
      },
    };
  }
}

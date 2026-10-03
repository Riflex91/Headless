import type {
  BankTravelController,
  BankTravelStatus,
} from "./bank-travel-controller.lib";

export interface BankTravelLiveTestOptions {
  requestId?: string;
  timeoutMs?: number;
  pollMs?: number;
}

export interface BankTravelLiveTestEvidence {
  accessLocated: boolean;
  travelObserved: boolean;
  bankAvailable: boolean;
  bankPacksVisible: boolean;
  unknownOutcomeAvoided: boolean;
}

export interface BankTravelLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "TIMEOUT" | "UNKNOWN";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: {
    name: string | null;
    map: string | null;
  };
  finalStatus: BankTravelStatus;
  stagesSeen: BankTravelStatus["roadmapStage"][];
  evidence: BankTravelLiveTestEvidence;
  scope: {
    movementMutationAllowed: true;
    bankItemMutationAllowed: false;
    bankGoldMutationAllowed: false;
    npcTradingMutationAllowed: false;
    marketTradingMutationAllowed: false;
    blindRetryAllowed: false;
    mutationScope: "bank-travel-only";
  };
  cleanup: {
    configOverrideCleared: boolean;
  };
}

interface BankTravelLiveTestDependencies {
  bankTravel: Pick<
    BankTravelController,
    "setConfigOverride" | "clearConfigOverride" | "tick" | "status"
  >;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_POLL_MS = 500;

function pushStage(
  stages: BankTravelStatus["roadmapStage"][],
  stage: BankTravelStatus["roadmapStage"],
): void {
  if (!stages.includes(stage)) stages.push(stage);
}

function evidenceFrom(
  history: BankTravelStatus[],
): BankTravelLiveTestEvidence {
  return {
    accessLocated: history.some((status) => !!status.target.map),
    travelObserved: history.some(
      (status) =>
        status.state === "TRAVEL" ||
        status.lastAction?.destination === status.target.map,
    ),
    bankAvailable: history.some((status) => status.bank.available === true),
    bankPacksVisible: history.some(
      (status) => status.bank.available && status.bank.packs.length > 0,
    ),
    unknownOutcomeAvoided: !history.some(
      (status) => status.state === "UNKNOWN",
    ),
  };
}

function passEvidence(evidence: BankTravelLiveTestEvidence): boolean {
  return (
    evidence.accessLocated &&
    evidence.travelObserved &&
    evidence.bankAvailable &&
    evidence.bankPacksVisible &&
    evidence.unknownOutcomeAvoided
  );
}

export class BankTravelLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: BankTravelLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(
    options: BankTravelLiveTestOptions = {},
  ): Promise<BankTravelLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `bank-travel-live-${startedAt}`;
    const timeoutMs = Math.max(10000, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const pollMs = Math.max(100, options.pollMs || DEFAULT_POLL_MS);
    const history: BankTravelStatus[] = [];
    const stagesSeen: BankTravelStatus["roadmapStage"][] = [];
    let finalStatus = this.deps.bankTravel.status();
    let outcome: BankTravelLiveTestResult["outcome"] = "FAIL";
    let reason = "BANK_TRAVEL_LIVE_EVIDENCE_INCOMPLETE";
    let configOverrideCleared = false;

    this.deps.bankTravel.setConfigOverride({
      bank: {
        enabled: true,
      },
    });

    try {
      while (this.now() - startedAt < timeoutMs) {
        finalStatus = await this.deps.bankTravel.tick();
        history.push(finalStatus);
        pushStage(stagesSeen, finalStatus.roadmapStage);

        if (finalStatus.state === "UNKNOWN") {
          outcome = "UNKNOWN";
          reason = "BANK_TRAVEL_LIVE_OUTCOME_UNKNOWN";
          break;
        }

        if (finalStatus.state === "BLOCKED") {
          outcome = "FAIL";
          reason = finalStatus.reason || "BANK_TRAVEL_LIVE_BLOCKED";
          break;
        }

        if (finalStatus.state === "READY") {
          const evidence = evidenceFrom(history);
          outcome = passEvidence(evidence) ? "PASS" : "FAIL";
          reason =
            outcome === "PASS"
              ? "BANK_TRAVEL_LIVE_E2E_CONFIRMED"
              : "BANK_TRAVEL_LIVE_EVIDENCE_INCOMPLETE";
          break;
        }

        await this.sleep(pollMs);
      }

      if (
        outcome === "FAIL" &&
        reason === "BANK_TRAVEL_LIVE_EVIDENCE_INCOMPLETE" &&
        this.now() - startedAt >= timeoutMs
      ) {
        outcome = "TIMEOUT";
        reason = "BANK_TRAVEL_LIVE_TIMEOUT";
      }
    } finally {
      this.deps.bankTravel.clearConfigOverride();
      configOverrideCleared = true;
    }

    const completedAt = this.now();
    const evidence = evidenceFrom(history);
    if (outcome === "PASS" && !passEvidence(evidence)) {
      outcome = "FAIL";
      reason = "BANK_TRAVEL_LIVE_EVIDENCE_INCOMPLETE";
    }
    if (outcome === "PASS" && !configOverrideCleared) {
      outcome = "FAIL";
      reason = "BANK_TRAVEL_LIVE_CLEANUP_FAILED";
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
        bankItemMutationAllowed: false,
        bankGoldMutationAllowed: false,
        npcTradingMutationAllowed: false,
        marketTradingMutationAllowed: false,
        blindRetryAllowed: false,
        mutationScope: "bank-travel-only",
      },
      cleanup: {
        configOverrideCleared,
      },
    };
  }
}

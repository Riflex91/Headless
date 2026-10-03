import type { ActionRecord } from "./action-ledger.lib";
import type { BankSnapshot, CharacterSnapshot } from "./game-adapter.lib";

export type BankGoldOperation = "DEPOSIT" | "WITHDRAW";

export interface BankGoldSnapshot {
  characterGold: number;
  bankGold: number;
}

export interface BankGoldSettlementEvidence {
  operation: BankGoldOperation;
  amount: number;
  before: BankGoldSnapshot;
  after: BankGoldSnapshot;
  characterDelta: number;
  bankDelta: number;
  exactSettlement: boolean;
}

export interface BankGoldOperationResult {
  operation: BankGoldOperation;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  action: {
    id: string | null;
    status: string | null;
  };
  evidence: BankGoldSettlementEvidence | null;
}

export interface BankGoldRoundTripResult {
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  amount: number;
  baseline: BankGoldSnapshot;
  deposit: BankGoldOperationResult;
  withdraw: BankGoldOperationResult | null;
  final: BankGoldSnapshot;
  baselineRestored: boolean;
  blindRetryPerformed: false;
}

interface BankGoldGame {
  character(): CharacterSnapshot;
  bank(): BankSnapshot;
}

interface BankGoldActions {
  bankDepositGold(request: {
    amount: number;
    module: string;
    why: string;
    correlationId?: string;
  }): Promise<ActionRecord>;
  bankWithdrawGold(request: {
    amount: number;
    module: string;
    why: string;
    correlationId?: string;
  }): Promise<ActionRecord>;
}

export interface BankGoldSettlementOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  settlementTimeoutMs?: number;
  pollMs?: number;
}

export interface BankGoldRoundTripOptions {
  amount?: number;
  correlationId?: string;
}

const MODULE = "BankGoldSettlementController";
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 10000;
const DEFAULT_POLL_MS = 100;

function finiteGold(value: number | null): number | null {
  return Number.isFinite(value) && value !== null ? Number(value) : null;
}

function snapshot(game: BankGoldGame): BankGoldSnapshot | null {
  const characterGold = finiteGold(game.character().gold);
  const bankGold = finiteGold(game.bank().gold);
  if (characterGold === null || bankGold === null) return null;
  return { characterGold, bankGold };
}

function evidenceFor(
  operation: BankGoldOperation,
  amount: number,
  before: BankGoldSnapshot,
  after: BankGoldSnapshot,
): BankGoldSettlementEvidence {
  const characterDelta =
    operation === "DEPOSIT"
      ? before.characterGold - after.characterGold
      : after.characterGold - before.characterGold;
  const bankDelta =
    operation === "DEPOSIT"
      ? after.bankGold - before.bankGold
      : before.bankGold - after.bankGold;

  return {
    operation,
    amount,
    before,
    after,
    characterDelta,
    bankDelta,
    exactSettlement: characterDelta === amount && bankDelta === amount,
  };
}

function actionFailureReason(action: ActionRecord): string | null {
  if (action.status === "BLOCKED") return "BANK_GOLD_ACTION_BLOCKED";
  if (action.status === "REJECTED") return "BANK_GOLD_ACTION_REJECTED";
  return null;
}

export class BankGoldSettlementController {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly settlementTimeoutMs: number;
  private readonly pollMs: number;

  constructor(
    private readonly game: BankGoldGame,
    private readonly actions: BankGoldActions,
    options: BankGoldSettlementOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.sleep =
      options.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.settlementTimeoutMs = Math.max(
      100,
      options.settlementTimeoutMs || DEFAULT_SETTLEMENT_TIMEOUT_MS,
    );
    this.pollMs = Math.max(10, options.pollMs || DEFAULT_POLL_MS);
  }

  async roundTrip(
    options: BankGoldRoundTripOptions = {},
  ): Promise<BankGoldRoundTripResult> {
    const amount = Number.isInteger(options.amount) ? Number(options.amount) : 1;
    if (amount <= 0) {
      throw new Error("bank gold round trip amount must be a positive integer");
    }

    const bank = this.game.bank();
    if (!bank.available) {
      throw new Error("bank gold round trip requires visible bank state");
    }

    const baseline = snapshot(this.game);
    if (!baseline) {
      throw new Error("bank gold round trip requires visible gold balances");
    }
    if (baseline.characterGold < amount) {
      throw new Error("bank gold round trip requires sufficient character gold");
    }

    const deposit = await this.executeOperation(
      "DEPOSIT",
      amount,
      baseline,
      options.correlationId,
    );
    if (deposit.outcome !== "PASS" || !deposit.evidence) {
      return {
        outcome: deposit.outcome,
        reason: deposit.reason,
        amount,
        baseline,
        deposit,
        withdraw: null,
        final: snapshot(this.game) || baseline,
        baselineRestored: false,
        blindRetryPerformed: false,
      };
    }

    const withdraw = await this.executeOperation(
      "WITHDRAW",
      amount,
      deposit.evidence.after,
      options.correlationId,
    );
    const final = snapshot(this.game) || deposit.evidence.after;
    const baselineRestored =
      final.characterGold === baseline.characterGold &&
      final.bankGold === baseline.bankGold;

    if (withdraw.outcome !== "PASS") {
      return {
        outcome: withdraw.outcome,
        reason: withdraw.reason,
        amount,
        baseline,
        deposit,
        withdraw,
        final,
        baselineRestored,
        blindRetryPerformed: false,
      };
    }

    return {
      outcome: baselineRestored ? "PASS" : "FAIL",
      reason: baselineRestored
        ? "BANK_GOLD_ROUND_TRIP_SETTLED"
        : "BANK_GOLD_BASELINE_NOT_RESTORED",
      amount,
      baseline,
      deposit,
      withdraw,
      final,
      baselineRestored,
      blindRetryPerformed: false,
    };
  }

  private async executeOperation(
    operation: BankGoldOperation,
    amount: number,
    before: BankGoldSnapshot,
    correlationId?: string,
  ): Promise<BankGoldOperationResult> {
    let action: ActionRecord;
    try {
      action =
        operation === "DEPOSIT"
          ? await this.actions.bankDepositGold({
              amount,
              module: MODULE,
              why: "PHASE13_BANK_GOLD_DEPOSIT",
              correlationId,
            })
          : await this.actions.bankWithdrawGold({
              amount,
              module: MODULE,
              why: "PHASE13_BANK_GOLD_WITHDRAW",
              correlationId,
            });
    } catch (error) {
      return {
        operation,
        outcome: "UNKNOWN",
        reason: `BANK_GOLD_${operation}_DISPATCH_ERROR:${
          error instanceof Error ? error.message : String(error)
        }`,
        action: {
          id: null,
          status: null,
        },
        evidence: null,
      };
    }

    const failureReason = actionFailureReason(action);
    if (failureReason) {
      return {
        operation,
        outcome: "FAIL",
        reason: `${failureReason}:${operation}`,
        action: {
          id: action.id,
          status: action.status,
        },
        evidence: null,
      };
    }

    const startedAt = this.now();
    while (this.now() - startedAt <= this.settlementTimeoutMs) {
      const after = snapshot(this.game);
      if (after) {
        const evidence = evidenceFor(operation, amount, before, after);
        if (evidence.exactSettlement) {
          return {
            operation,
            outcome: "PASS",
            reason: `BANK_GOLD_${operation}_SETTLED`,
            action: {
              id: action.id,
              status: action.status,
            },
            evidence,
          };
        }
      }

      await this.sleep(this.pollMs);
    }

    const after = snapshot(this.game);
    const evidence = after ? evidenceFor(operation, amount, before, after) : null;
    const unresolvedUnknown = action.status === "UNKNOWN";

    return {
      operation,
      outcome: unresolvedUnknown ? "UNKNOWN" : "TIMEOUT",
      reason: unresolvedUnknown
        ? `BANK_GOLD_${operation}_OUTCOME_UNKNOWN`
        : `BANK_GOLD_${operation}_SETTLEMENT_TIMEOUT`,
      action: {
        id: action.id,
        status: action.status,
      },
      evidence,
    };
  }
}

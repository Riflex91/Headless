import type { InventorySlotSnapshot } from "./game-adapter.lib";
import type {
  UpgradeCandidate,
  UpgradeStatus,
} from "./upgrade-controller.lib";
import type {
  CompoundCandidate,
  CompoundStatus,
} from "./compound-controller.lib";

export type ExpectedValueState = "DISABLED" | "EMPTY" | "READY" | "PARTIAL";
export type ExpectedValueKind = "UPGRADE" | "COMPOUND";
export type ExpectedValueDecision =
  | "POSITIVE_EV"
  | "NEGATIVE_EV"
  | "BREAK_EVEN"
  | "UNKNOWN";

export interface ExpectedValueEstimate {
  kind: ExpectedValueKind;
  name: string;
  currentLevel: number;
  targetLevel: number;
  itemSlots: number[];
  scrollName: string;
  scrollSlot: number;
  probabilityGrade: number | null;
  itemGrade: number | null;
  scrollGrade: number | null;
  successProbability: number | null;
  currentItemValueGold: number | null;
  successItemValueGold: number | null;
  failureOutcomeValueGold: number | null;
  scrollReplacementCostGold: number | null;
  inputValueGold: number | null;
  expectedOutcomeValueGold: number | null;
  expectedDeltaGold: number | null;
  breakEvenProbability: number | null;
  decision: ExpectedValueDecision;
  reason: string;
}

export interface ExpectedValueSummary {
  upgradeCandidates: number;
  compoundCandidates: number;
  evaluated: number;
  positive: number;
  negative: number;
  breakEven: number;
  unknown: number;
  bestKind: ExpectedValueKind | null;
  bestName: string | null;
  bestExpectedDeltaGold: number | null;
}

export interface ExpectedValueStatus {
  timestamp: number;
  enabled: boolean;
  state: ExpectedValueState;
  reason: string;
  model: {
    valueModel: "ADVENTURE_LAND_INTRINSIC_GOLD_VALUE";
    probabilityModel: "OFFICIAL_BASE_NO_DYNAMIC_GRACE_NO_OFFERING";
    sourceRepository: "kaansoral/adventureland";
    sourceCommit: "f927df37da777eb7f048fd9209c039653a3406bd";
    marketPricesIncluded: false;
    dynamicGraceIncluded: false;
    offeringsIncluded: false;
  };
  estimates: ExpectedValueEstimate[];
  summary: ExpectedValueSummary;
}

export interface ExpectedValueEvent {
  type: "EXPECTED_VALUE_UPDATED";
  timestamp: number;
  reason: string;
  status: ExpectedValueStatus;
}

export interface ExpectedValueControllerOptions {
  now?: () => number;
  config?: () => unknown;
  onEvent?: (event: ExpectedValueEvent) => void;
}

interface ExpectedValueGameAdapter {
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
}

interface ExpectedValueUpgradeSource {
  status(): UpgradeStatus;
}

interface ExpectedValueCompoundSource {
  status(): CompoundStatus;
}

interface NormalizedExpectedValueConfig {
  enabled: boolean;
  includeUpgrade: boolean;
  includeCompound: boolean;
}

const MODEL = {
  valueModel: "ADVENTURE_LAND_INTRINSIC_GOLD_VALUE",
  probabilityModel: "OFFICIAL_BASE_NO_DYNAMIC_GRACE_NO_OFFERING",
  sourceRepository: "kaansoral/adventureland",
  sourceCommit: "f927df37da777eb7f048fd9209c039653a3406bd",
  marketPricesIncluded: false,
  dynamicGraceIncluded: false,
  offeringsIncluded: false,
} as const;

const UPGRADE_BASE_PROBABILITIES: Record<
  number,
  Record<number, number>
> = {
  0: {
    1: 0.9999999,
    2: 0.98,
    3: 0.95,
    4: 0.7,
    5: 0.6,
    6: 0.4,
    7: 0.25,
    8: 0.15,
    9: 0.07,
    10: 0.024,
    11: 0.14,
    12: 0.11,
  },
  1: {
    1: 0.99998,
    2: 0.97,
    3: 0.94,
    4: 0.68,
    5: 0.58,
    6: 0.38,
    7: 0.24,
    8: 0.14,
    9: 0.066,
    10: 0.018,
    11: 0.13,
    12: 0.1,
  },
  2: {
    1: 0.97,
    2: 0.94,
    3: 0.92,
    4: 0.64,
    5: 0.52,
    6: 0.32,
    7: 0.232,
    8: 0.13,
    9: 0.062,
    10: 0.015,
    11: 0.12,
    12: 0.09,
  },
};

const COMPOUND_BASE_PROBABILITIES: Record<
  number,
  Record<number, number>
> = {
  0: {
    1: 0.99,
    2: 0.75,
    3: 0.4,
    4: 0.25,
    5: 0.2,
    6: 0.1,
    7: 0.08,
    8: 0.05,
    9: 0.05,
    10: 0.05,
  },
  1: {
    1: 0.9,
    2: 0.7,
    3: 0.4,
    4: 0.2,
    5: 0.15,
    6: 0.08,
    7: 0.05,
    8: 0.05,
    9: 0.05,
    10: 0.03,
  },
  2: {
    1: 0.8,
    2: 0.6,
    3: 0.32,
    4: 0.16,
    5: 0.1,
    6: 0.05,
    7: 0.03,
    8: 0.03,
    9: 0.03,
    10: 0.02,
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  const normalized = finite(value);
  return normalized !== null && Number.isInteger(normalized)
    ? normalized
    : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function round(value: number): number {
  return Math.round(value);
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeConfig(value: unknown): NormalizedExpectedValueConfig {
  const root = record(value);
  const expectedValue = record(root.expectedValue);
  return {
    enabled: bool(expectedValue.enabled, true),
    includeUpgrade: bool(expectedValue.includeUpgrade, true),
    includeCompound: bool(expectedValue.includeCompound, true),
  };
}

function definitionFor(
  itemDefinitions: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const value = itemDefinitions[name];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemAt(
  inventory: InventorySlotSnapshot[],
  slot: number,
): Record<string, unknown> | null {
  return inventory.find((entry) => entry.slot === slot)?.item || null;
}

function itemGrade(
  definition: Record<string, unknown>,
  level: number,
): number {
  if (!("upgrade" in definition) && !("compound" in definition)) return 0;
  const rawGrades = Array.isArray(definition.grades)
    ? definition.grades
    : [9, 10, 11, 12];
  const grades = [0, 1, 2, 3].map(
    (index) => finite(rawGrades[index]) ?? [9, 10, 11, 12][index],
  );

  if (level >= grades[3]) return 4;
  if (level >= grades[2]) return 3;
  if (level >= grades[1]) return 2;
  if (level >= grades[0]) return 1;
  return 0;
}

function intrinsicProbabilityGrade(
  definition: Record<string, unknown>,
): number | null {
  const configured = integer(definition.igrade);
  if (configured !== null && configured >= 0 && configured <= 2) {
    return configured;
  }
  const derived = itemGrade(definition, 0);
  return derived >= 0 && derived <= 2 ? derived : null;
}

function catalogGold(definition: Record<string, unknown> | null): number | null {
  if (!definition) return null;
  const value = finite(definition.g);
  return value !== null && value >= 0 ? value : null;
}

function intrinsicItemValue(
  item: Record<string, unknown>,
  itemDefinitions: Record<string, unknown>,
): number | null {
  const name = typeof item.name === "string" ? item.name : null;
  if (!name) return null;
  if (item.gift) return 1;

  const definition = definitionFor(itemDefinitions, name);
  const baseGold = catalogGold(definition);
  if (!definition || baseGold === null) return null;

  let value = definition.cash ? baseGold : baseGold * 0.6;
  const markup = finite(definition.markup);
  if (markup !== null && markup !== 0) value /= markup;

  const level = Math.max(0, integer(item.level) ?? 0);

  if ("compound" in definition && level > 0) {
    const rawGrades = Array.isArray(definition.grades)
      ? definition.grades
      : [11, 12];
    const firstGrade = finite(rawGrades[0]) ?? 11;
    const secondGrade = finite(rawGrades[1]) ?? 12;
    let grade = 0;

    for (let current = 1; current <= level; current += 1) {
      if (current > secondGrade) grade = 2;
      else if (current > firstGrade) grade = 1;

      if (definition.cash) value *= 1.5;
      else value *= 3.2;

      if (definition.type !== "booster") {
        const scroll = definitionFor(itemDefinitions, `cscroll${grade}`);
        const scrollGold = catalogGold(scroll);
        if (scrollGold === null) return null;
        value += scrollGold / 2.4;
      } else {
        value *= 0.75;
      }
    }
  }

  if ("upgrade" in definition && level > 0) {
    const rawGrades = Array.isArray(definition.grades)
      ? definition.grades
      : [11, 12];
    const firstGrade = finite(rawGrades[0]) ?? 11;
    const secondGrade = finite(rawGrades[1]) ?? 12;
    let grade = 0;
    let scrollValue = 0;

    for (let current = 1; current <= level; current += 1) {
      if (current > secondGrade) grade = 2;
      else if (current > firstGrade) grade = 1;

      const scroll = definitionFor(itemDefinitions, `scroll${grade}`);
      const scrollGold = catalogGold(scroll);
      if (scrollGold === null) return null;
      scrollValue += scrollGold / 2;

      if (current >= 7) {
        value *= 3;
        scrollValue *= 1.32;
      } else if (current === 6) {
        value *= 2.4;
      } else if (current >= 4) {
        value *= 2;
      }

      if (current === 9) {
        value *= 2.64;
        value += 400000;
      }
      if (current === 10) value *= 5;
      if (current === 12) value *= 0.8;
    }

    value += scrollValue;
  }

  if (item.expires) value /= 8;
  return round(value) || 0;
}

function upgradeSuccessProbability(
  definition: Record<string, unknown>,
  currentLevel: number,
  scrollDefinition: Record<string, unknown>,
): {
  probabilityGrade: number | null;
  itemGrade: number;
  scrollGrade: number | null;
  probability: number | null;
} {
  const probabilityGrade = intrinsicProbabilityGrade(definition);
  const targetLevel = currentLevel + 1;
  const grade = itemGrade(definition, currentLevel);
  const scrollGrade = finite(scrollDefinition.grade);

  if (
    probabilityGrade === null ||
    scrollGrade === null ||
    !Number.isInteger(scrollGrade)
  ) {
    return {
      probabilityGrade,
      itemGrade: grade,
      scrollGrade,
      probability: null,
    };
  }

  const base = UPGRADE_BASE_PROBABILITIES[probabilityGrade]?.[targetLevel];
  if (base === undefined) {
    return {
      probabilityGrade,
      itemGrade: grade,
      scrollGrade,
      probability: null,
    };
  }

  let probability = base;
  let high = false;
  if (scrollGrade > grade && targetLevel <= 10) {
    probability = probability * 1.2 + 0.01;
    high = true;
  }

  probability = high
    ? Math.min(probability, Math.min(base + 0.36, base * 3))
    : Math.min(probability, Math.min(base + 0.24, base * 2));

  return {
    probabilityGrade,
    itemGrade: grade,
    scrollGrade,
    probability: roundProbability(Math.max(0, Math.min(1, probability))),
  };
}

function compoundSuccessProbability(
  definition: Record<string, unknown>,
  currentLevel: number,
  scrollDefinition: Record<string, unknown>,
): {
  probabilityGrade: number | null;
  itemGrade: number;
  scrollGrade: number | null;
  probability: number | null;
} {
  const probabilityGrade =
    currentLevel >= 3
      ? itemGrade(definition, Math.max(0, currentLevel - 2))
      : intrinsicProbabilityGrade(definition);
  const grade = itemGrade(definition, currentLevel);
  const scrollGrade = finite(scrollDefinition.grade);
  const targetLevel = currentLevel + 1;

  if (
    probabilityGrade === null ||
    probabilityGrade < 0 ||
    probabilityGrade > 2 ||
    scrollGrade === null ||
    !Number.isInteger(scrollGrade)
  ) {
    return {
      probabilityGrade,
      itemGrade: grade,
      scrollGrade,
      probability: null,
    };
  }

  const base = COMPOUND_BASE_PROBABILITIES[probabilityGrade]?.[targetLevel];
  if (base === undefined) {
    return {
      probabilityGrade,
      itemGrade: grade,
      scrollGrade,
      probability: null,
    };
  }

  let probability = base;
  const high = scrollGrade > grade ? scrollGrade - grade : 0;
  if (high > 0) probability = probability * 1.1 + 0.001;

  probability = Math.min(
    probability,
    Math.min(
      base * (3 + high * 0.6),
      base + 0.2 + high * 0.05,
    ),
  );

  return {
    probabilityGrade,
    itemGrade: grade,
    scrollGrade,
    probability: roundProbability(Math.max(0, Math.min(1, probability))),
  };
}

function decisionFor(delta: number | null): ExpectedValueDecision {
  if (delta === null) return "UNKNOWN";
  if (Math.abs(delta) < 0.5) return "BREAK_EVEN";
  return delta > 0 ? "POSITIVE_EV" : "NEGATIVE_EV";
}

function breakEvenProbability(
  inputValue: number,
  successValue: number,
  failureValue: number,
): number | null {
  const denominator = successValue - failureValue;
  if (denominator <= 0) return null;
  return roundProbability((inputValue - failureValue) / denominator);
}

function unknownEstimate(
  kind: ExpectedValueKind,
  candidate: UpgradeCandidate | CompoundCandidate,
  reason: string,
): ExpectedValueEstimate {
  const itemSlots =
    kind === "UPGRADE"
      ? [(candidate as UpgradeCandidate).itemSlot]
      : [...(candidate as CompoundCandidate).itemSlots];
  return {
    kind,
    name: candidate.name,
    currentLevel: candidate.currentLevel,
    targetLevel: candidate.currentLevel + 1,
    itemSlots,
    scrollName: candidate.scrollName,
    scrollSlot: candidate.scrollSlot,
    probabilityGrade: null,
    itemGrade: null,
    scrollGrade: null,
    successProbability: null,
    currentItemValueGold: null,
    successItemValueGold: null,
    failureOutcomeValueGold: null,
    scrollReplacementCostGold: null,
    inputValueGold: null,
    expectedOutcomeValueGold: null,
    expectedDeltaGold: null,
    breakEvenProbability: null,
    decision: "UNKNOWN",
    reason,
  };
}

function evaluateUpgrade(
  candidate: UpgradeCandidate,
  inventory: InventorySlotSnapshot[],
  itemDefinitions: Record<string, unknown>,
): ExpectedValueEstimate {
  const definition = definitionFor(itemDefinitions, candidate.name);
  const scrollDefinition = definitionFor(
    itemDefinitions,
    candidate.scrollName,
  );
  const item = itemAt(inventory, candidate.itemSlot);
  if (!definition || !scrollDefinition || !item) {
    return unknownEstimate(
      "UPGRADE",
      candidate,
      "EXPECTED_VALUE_UPGRADE_METADATA_MISSING",
    );
  }

  const currentValue = intrinsicItemValue(item, itemDefinitions);
  const successValue = intrinsicItemValue(
    { ...item, level: candidate.currentLevel + 1 },
    itemDefinitions,
  );
  const scrollCost = catalogGold(scrollDefinition);
  const chance = upgradeSuccessProbability(
    definition,
    candidate.currentLevel,
    scrollDefinition,
  );

  if (
    currentValue === null ||
    successValue === null ||
    scrollCost === null ||
    chance.probability === null
  ) {
    const unknown = unknownEstimate(
      "UPGRADE",
      candidate,
      "EXPECTED_VALUE_UPGRADE_MODEL_INPUT_UNKNOWN",
    );
    return {
      ...unknown,
      probabilityGrade: chance.probabilityGrade,
      itemGrade: chance.itemGrade,
      scrollGrade: chance.scrollGrade,
    };
  }

  const protectedFailure = chance.scrollGrade === 3.6;
  const failureValue = protectedFailure ? currentValue : 0;
  const inputValue = currentValue + scrollCost;
  const expectedOutcome =
    chance.probability * successValue +
    (1 - chance.probability) * failureValue;
  const delta = roundMoney(expectedOutcome - inputValue);

  return {
    kind: "UPGRADE",
    name: candidate.name,
    currentLevel: candidate.currentLevel,
    targetLevel: candidate.currentLevel + 1,
    itemSlots: [candidate.itemSlot],
    scrollName: candidate.scrollName,
    scrollSlot: candidate.scrollSlot,
    probabilityGrade: chance.probabilityGrade,
    itemGrade: chance.itemGrade,
    scrollGrade: chance.scrollGrade,
    successProbability: chance.probability,
    currentItemValueGold: currentValue,
    successItemValueGold: successValue,
    failureOutcomeValueGold: failureValue,
    scrollReplacementCostGold: scrollCost,
    inputValueGold: inputValue,
    expectedOutcomeValueGold: roundMoney(expectedOutcome),
    expectedDeltaGold: delta,
    breakEvenProbability: breakEvenProbability(
      inputValue,
      successValue,
      failureValue,
    ),
    decision: decisionFor(delta),
    reason: "EXPECTED_VALUE_UPGRADE_BASE_MODEL_READY",
  };
}

function evaluateCompound(
  candidate: CompoundCandidate,
  inventory: InventorySlotSnapshot[],
  itemDefinitions: Record<string, unknown>,
): ExpectedValueEstimate {
  const definition = definitionFor(itemDefinitions, candidate.name);
  const scrollDefinition = definitionFor(
    itemDefinitions,
    candidate.scrollName,
  );
  const items = candidate.itemSlots.map((slot) => itemAt(inventory, slot));
  if (!definition || !scrollDefinition || items.some((item) => !item)) {
    return unknownEstimate(
      "COMPOUND",
      candidate,
      "EXPECTED_VALUE_COMPOUND_METADATA_MISSING",
    );
  }

  const currentValues = items.map((item) =>
    intrinsicItemValue(item as Record<string, unknown>, itemDefinitions),
  );
  const firstItem = items[0] as Record<string, unknown>;
  const successValue = intrinsicItemValue(
    { ...firstItem, level: candidate.currentLevel + 1 },
    itemDefinitions,
  );
  const scrollCost = catalogGold(scrollDefinition);
  const chance = compoundSuccessProbability(
    definition,
    candidate.currentLevel,
    scrollDefinition,
  );

  if (
    currentValues.some((value) => value === null) ||
    successValue === null ||
    scrollCost === null ||
    chance.probability === null
  ) {
    const unknown = unknownEstimate(
      "COMPOUND",
      candidate,
      "EXPECTED_VALUE_COMPOUND_MODEL_INPUT_UNKNOWN",
    );
    return {
      ...unknown,
      probabilityGrade: chance.probabilityGrade,
      itemGrade: chance.itemGrade,
      scrollGrade: chance.scrollGrade,
    };
  }

  const currentValue = (currentValues as number[]).reduce(
    (sum, value) => sum + value,
    0,
  );
  const failureValue = 0;
  const inputValue = currentValue + scrollCost;
  const expectedOutcome = chance.probability * successValue;
  const delta = roundMoney(expectedOutcome - inputValue);

  return {
    kind: "COMPOUND",
    name: candidate.name,
    currentLevel: candidate.currentLevel,
    targetLevel: candidate.currentLevel + 1,
    itemSlots: [...candidate.itemSlots],
    scrollName: candidate.scrollName,
    scrollSlot: candidate.scrollSlot,
    probabilityGrade: chance.probabilityGrade,
    itemGrade: chance.itemGrade,
    scrollGrade: chance.scrollGrade,
    successProbability: chance.probability,
    currentItemValueGold: currentValue,
    successItemValueGold: successValue,
    failureOutcomeValueGold: failureValue,
    scrollReplacementCostGold: scrollCost,
    inputValueGold: inputValue,
    expectedOutcomeValueGold: roundMoney(expectedOutcome),
    expectedDeltaGold: delta,
    breakEvenProbability: breakEvenProbability(
      inputValue,
      successValue,
      failureValue,
    ),
    decision: decisionFor(delta),
    reason: "EXPECTED_VALUE_COMPOUND_BASE_MODEL_READY",
  };
}

function emptySummary(): ExpectedValueSummary {
  return {
    upgradeCandidates: 0,
    compoundCandidates: 0,
    evaluated: 0,
    positive: 0,
    negative: 0,
    breakEven: 0,
    unknown: 0,
    bestKind: null,
    bestName: null,
    bestExpectedDeltaGold: null,
  };
}

export class ExpectedValueController {
  private readonly now: () => number;
  private readonly configSource: () => unknown;
  private readonly onEvent?: (event: ExpectedValueEvent) => void;
  private lastEventSignature: string | null = null;
  private lastStatus: ExpectedValueStatus;

  constructor(
    private readonly game: ExpectedValueGameAdapter,
    private readonly upgrade: ExpectedValueUpgradeSource,
    private readonly compound: ExpectedValueCompoundSource,
    options: ExpectedValueControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.configSource = options.config || (() => ({}));
    this.onEvent = options.onEvent;
    this.lastStatus = this.emptyStatus(
      this.now(),
      true,
      "EMPTY",
      "EXPECTED_VALUE_NO_CANDIDATES",
    );
  }

  status(): ExpectedValueStatus {
    return this.lastStatus;
  }

  tick(): ExpectedValueStatus {
    const timestamp = this.now();
    const config = normalizeConfig(this.configSource());

    if (!config.enabled) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          false,
          "DISABLED",
          "EXPECTED_VALUE_DISABLED",
        ),
      );
    }

    const upgradeStatus = this.upgrade.status();
    const compoundStatus = this.compound.status();
    const upgradeCandidates = config.includeUpgrade
      ? upgradeStatus.candidates
      : [];
    const compoundCandidates = config.includeCompound
      ? compoundStatus.candidates
      : [];

    if (upgradeCandidates.length + compoundCandidates.length === 0) {
      return this.publish(
        this.emptyStatus(
          timestamp,
          true,
          "EMPTY",
          "EXPECTED_VALUE_NO_CANDIDATES",
        ),
      );
    }

    const inventory = this.game.inventory();
    const itemDefinitions = record(this.game.gameData().items);
    const estimates: ExpectedValueEstimate[] = [
      ...upgradeCandidates.map((candidate) =>
        evaluateUpgrade(candidate, inventory, itemDefinitions),
      ),
      ...compoundCandidates.map((candidate) =>
        evaluateCompound(candidate, inventory, itemDefinitions),
      ),
    ];

    const summary = emptySummary();
    summary.upgradeCandidates = upgradeCandidates.length;
    summary.compoundCandidates = compoundCandidates.length;
    summary.evaluated = estimates.filter(
      (estimate) => estimate.expectedDeltaGold !== null,
    ).length;
    summary.positive = estimates.filter(
      (estimate) => estimate.decision === "POSITIVE_EV",
    ).length;
    summary.negative = estimates.filter(
      (estimate) => estimate.decision === "NEGATIVE_EV",
    ).length;
    summary.breakEven = estimates.filter(
      (estimate) => estimate.decision === "BREAK_EVEN",
    ).length;
    summary.unknown = estimates.filter(
      (estimate) => estimate.decision === "UNKNOWN",
    ).length;

    const best = estimates
      .filter(
        (
          estimate,
        ): estimate is ExpectedValueEstimate & {
          expectedDeltaGold: number;
        } => estimate.expectedDeltaGold !== null,
      )
      .sort(
        (left, right) =>
          right.expectedDeltaGold - left.expectedDeltaGold ||
          left.kind.localeCompare(right.kind) ||
          left.name.localeCompare(right.name),
      )[0];

    if (best) {
      summary.bestKind = best.kind;
      summary.bestName = best.name;
      summary.bestExpectedDeltaGold = best.expectedDeltaGold;
    }

    const state: ExpectedValueState =
      summary.unknown > 0
        ? summary.evaluated > 0
          ? "PARTIAL"
          : "EMPTY"
        : "READY";

    return this.publish({
      timestamp,
      enabled: true,
      state,
      reason:
        state === "READY"
          ? "EXPECTED_VALUE_READY"
          : state === "PARTIAL"
            ? "EXPECTED_VALUE_PARTIAL"
            : "EXPECTED_VALUE_MODEL_INPUT_UNKNOWN",
      model: { ...MODEL },
      estimates,
      summary,
    });
  }

  private emptyStatus(
    timestamp: number,
    enabled: boolean,
    state: ExpectedValueState,
    reason: string,
  ): ExpectedValueStatus {
    return {
      timestamp,
      enabled,
      state,
      reason,
      model: { ...MODEL },
      estimates: [],
      summary: emptySummary(),
    };
  }

  private publish(status: ExpectedValueStatus): ExpectedValueStatus {
    this.lastStatus = status;
    const signature = JSON.stringify({
      enabled: status.enabled,
      state: status.state,
      reason: status.reason,
      model: status.model,
      estimates: status.estimates,
      summary: status.summary,
    });

    if (signature !== this.lastEventSignature) {
      this.lastEventSignature = signature;
      this.onEvent?.({
        type: "EXPECTED_VALUE_UPDATED",
        timestamp: status.timestamp,
        reason: status.reason,
        status,
      });
    }

    return status;
  }
}

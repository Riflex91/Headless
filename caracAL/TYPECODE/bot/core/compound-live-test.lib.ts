import type {
  InventoryIntelligenceController,
  InventoryIntelligenceEntry,
} from "./inventory-intelligence-controller.lib";
import type { InventorySlotSnapshot } from "./game-adapter.lib";
import type {
  CompoundController,
  CompoundStatus,
} from "./compound-controller.lib";

export interface CompoundLiveTestOptions {
  requestId?: string;
  itemName: string;
  itemSlots: [number, number, number];
  scrollName: string;
  settleTimeoutMs?: number;
  settlePollMs?: number;
}

export interface CompoundLiveRuntimePreflight {
  map: string | null;
  compoundInProgress: boolean;
}

export interface CompoundLiveItemState {
  slot: number;
  name: string | null;
  level: number | null;
  quantity: number;
  property: unknown;
  present: boolean;
}

export interface CompoundLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  target: {
    itemName: string;
    itemSlots: [number, number, number];
    fromLevel: number | null;
    itemGrade: number | null;
    scrollName: string;
    scrollSlot: number | null;
  };
  before: {
    items: CompoundLiveItemState[];
    scroll: CompoundLiveItemState | null;
  };
  after: {
    items: CompoundLiveItemState[];
    scroll: CompoundLiveItemState | null;
  };
  compound: CompoundStatus | null;
  evidence: {
    inventoryIntelligenceReady: boolean;
    itemDefinitionCompoundable: boolean;
    exactTripleObserved: boolean;
    sameName: boolean;
    sameLevel: boolean;
    itemGradesKnown: boolean;
    itemGradesMatch: boolean;
    scrollGradeCompatible: boolean;
    allItemsUnprotectedBefore: boolean;
    scrollUnprotectedBefore: boolean;
    exactCandidateSelected: boolean;
    localPreflightReadOnly: boolean;
    compoundOperationIdle: boolean;
    itemLocksClear: boolean;
    scrollLocksClear: boolean;
    mapAllowsCompound: boolean;
    runtimeMap: string | null;
    actionDispatchedOnce: boolean;
    actionConfirmed: boolean;
    compoundSucceeded: boolean | null;
    itemStateChanged: boolean;
    scrollStateChanged: boolean;
    mutationObserved: boolean;
    blindRetryAvoided: boolean;
    offeringOmitted: boolean;
  };
  scope: {
    upgradeMutationAllowed: false;
    compoundMutationAllowed: true;
    irreversibleMutation: true;
    offeringMutationAllowed: false;
    exchangeMutationAllowed: false;
    craftMutationAllowed: false;
    blindRetryAllowed: false;
    mutationScope: "single-compound-attempt-only";
  };
  cleanup: {
    inventoryConfigOverrideCleared: boolean;
    compoundConfigOverrideCleared: boolean;
  };
}

interface CompoundLiveGameAdapter {
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
  itemGrade(item: Record<string, unknown>): number | null;
}

interface CompoundLiveTestDependencies {
  game: CompoundLiveGameAdapter;
  inventoryIntelligence: Pick<
    InventoryIntelligenceController,
    "status" | "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  compound: Pick<
    CompoundController,
    "status" | "tick" | "executeNext" | "setConfigOverride" | "clearConfigOverride"
  >;
  characterName?: () => string | null;
  runtimePreflight: () => CompoundLiveRuntimePreflight;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface SelectedCompoundTarget {
  itemName: string;
  itemSlots: [number, number, number];
  level: number;
  itemGrade: number;
  scrollName: string;
  scrollSlot: number;
  itemEntries: [InventoryIntelligenceEntry, InventoryIntelligenceEntry, InventoryIntelligenceEntry];
  scrollEntry: InventoryIntelligenceEntry;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function inventoryItem(
  inventory: InventorySlotSnapshot[],
  slot: number,
): Record<string, unknown> | null {
  const raw = inventory.find((entry) => entry.slot === slot)?.item;
  return raw ? record(raw) : null;
}

function itemLocked(item: Record<string, unknown> | null): boolean {
  if (!item) return false;
  return item.locked === true || (typeof item.l === "string" && item.l.length > 0);
}

function itemState(
  inventory: InventorySlotSnapshot[],
  slot: number,
): CompoundLiveItemState {
  const item = inventoryItem(inventory, slot);
  return {
    slot,
    name: item ? text(item.name) : null,
    level: item ? nonNegativeInteger(item.level) ?? 0 : null,
    quantity: item ? Math.max(1, nonNegativeInteger(item.q) ?? 1) : 0,
    property: item?.p ?? null,
    present: !!item,
  };
}

function stateSignature(state: CompoundLiveItemState | null): string {
  return JSON.stringify(
    state
      ? [
          state.slot,
          state.name,
          state.level,
          state.quantity,
          state.property,
          state.present,
        ]
      : null,
  );
}

function tripleSignature(states: CompoundLiveItemState[]): string {
  return JSON.stringify(states.map((state) => stateSignature(state)));
}

function isCompoundableDefinition(
  gameData: Record<string, unknown>,
  itemName: string,
): boolean {
  const items = record(gameData.items);
  const definition = record(items[itemName]);
  return Object.prototype.hasOwnProperty.call(definition, "compound");
}

function normalizeRequestedSlots(
  slots: [number, number, number],
): [number, number, number] | null {
  const normalized = slots.map((slot) => nonNegativeInteger(slot));
  if (normalized.some((slot) => slot === null)) return null;
  const values = normalized as [number, number, number];
  if (new Set(values).size !== 3) return null;
  return [...values].sort((left, right) => left - right) as [
    number,
    number,
    number,
  ];
}

function selectCompoundLiveTarget(
  inventory: InventorySlotSnapshot[],
  intelligenceEntries: InventoryIntelligenceEntry[],
  gameData: Record<string, unknown>,
  itemGrade: (item: Record<string, unknown>) => number | null,
  options: CompoundLiveTestOptions,
): SelectedCompoundTarget | null {
  const requestedSlots = normalizeRequestedSlots(options.itemSlots);
  if (!requestedSlots) return null;

  const entriesBySlot = new Map(
    intelligenceEntries.map((entry) => [entry.slot, entry]),
  );

  const items = requestedSlots.map((slot) => inventoryItem(inventory, slot));
  if (items.some((item) => !item)) return null;

  const names = items.map((item) => (item ? text(item.name) : null));
  if (
    names.some((name) => name !== options.itemName) ||
    new Set(names).size !== 1
  ) {
    return null;
  }

  const levels = items.map((item) =>
    item ? nonNegativeInteger(item.level) ?? 0 : null,
  );
  if (levels.some((level) => level === null) || new Set(levels).size !== 1) {
    return null;
  }

  if (!isCompoundableDefinition(gameData, options.itemName)) return null;

  const itemEntries = requestedSlots.map((slot) => entriesBySlot.get(slot));
  if (
    itemEntries.some(
      (entry) => !entry || entry.protected || entry.protections.length > 0,
    )
  ) {
    return null;
  }

  const grades = items.map((item) => (item ? itemGrade(item) : null));
  if (
    grades.some(
      (grade) =>
        grade === null ||
        !Number.isInteger(grade) ||
        Number(grade) < 0,
    ) ||
    new Set(grades).size !== 1
  ) {
    return null;
  }

  const grade = grades[0] as number;
  const expectedScrollName = "cscroll" + grade;
  if (options.scrollName !== expectedScrollName) return null;

  const scrollSlot =
    inventory
      .filter((slot) => !requestedSlots.includes(slot.slot))
      .filter((slot) => text(slot.item?.name) === options.scrollName)
      .filter((slot) => {
        const entry = entriesBySlot.get(slot.slot);
        return (
          !!entry &&
          !entry.protected &&
          entry.protections.length === 0
        );
      })
      .map((slot) => slot.slot)
      .sort((left, right) => left - right)[0] ?? null;

  if (scrollSlot === null) return null;
  const scrollEntry = entriesBySlot.get(scrollSlot);
  if (!scrollEntry) return null;

  return {
    itemName: options.itemName,
    itemSlots: requestedSlots,
    level: levels[0] as number,
    itemGrade: grade,
    scrollName: options.scrollName,
    scrollSlot,
    itemEntries: itemEntries as [
      InventoryIntelligenceEntry,
      InventoryIntelligenceEntry,
      InventoryIntelligenceEntry,
    ],
    scrollEntry,
  };
}

function baseEvidence(): CompoundLiveTestResult["evidence"] {
  return {
    inventoryIntelligenceReady: false,
    itemDefinitionCompoundable: false,
    exactTripleObserved: false,
    sameName: false,
    sameLevel: false,
    itemGradesKnown: false,
    itemGradesMatch: false,
    scrollGradeCompatible: false,
    allItemsUnprotectedBefore: false,
    scrollUnprotectedBefore: false,
    exactCandidateSelected: false,
    localPreflightReadOnly: false,
    compoundOperationIdle: false,
    itemLocksClear: false,
    scrollLocksClear: false,
    mapAllowsCompound: false,
    runtimeMap: null,
    actionDispatchedOnce: false,
    actionConfirmed: false,
    compoundSucceeded: null,
    itemStateChanged: false,
    scrollStateChanged: false,
    mutationObserved: false,
    blindRetryAvoided: true,
    offeringOmitted: true,
  };
}

export class CompoundLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: CompoundLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(options: CompoundLiveTestOptions): Promise<CompoundLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `compound-live-${startedAt}`;
    const itemName = text(options.itemName);
    const scrollName = text(options.scrollName);
    const requestedSlots = normalizeRequestedSlots(options.itemSlots);
    const settleTimeoutMs = Math.max(500, options.settleTimeoutMs || 3000);
    const settlePollMs = Math.max(25, options.settlePollMs || 100);
    const evidence = baseEvidence();

    let selected: SelectedCompoundTarget | null = null;
    let beforeItems: CompoundLiveItemState[] = [];
    let beforeScroll: CompoundLiveItemState | null = null;
    let afterItems: CompoundLiveItemState[] = [];
    let afterScroll: CompoundLiveItemState | null = null;
    let compoundStatus: CompoundStatus | null = null;
    let outcome: CompoundLiveTestResult["outcome"] = "FAIL";
    let reason = "COMPOUND_LIVE_EVIDENCE_INCOMPLETE";
    let inventoryConfigOverrideCleared = false;
    let compoundConfigOverrideCleared = false;
    let executionAttempts = 0;
    let finalResult: CompoundLiveTestResult | null = null;

    const finish = (): CompoundLiveTestResult => {
      const completedAt = this.now();
      return {
        requestId,
        outcome,
        reason,
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        character: this.deps.characterName?.() || null,
        target: {
          itemName: itemName || "",
          itemSlots: requestedSlots || [0, 0, 0],
          fromLevel: selected?.level ?? null,
          itemGrade: selected?.itemGrade ?? null,
          scrollName: scrollName || "",
          scrollSlot: selected?.scrollSlot ?? null,
        },
        before: {
          items: beforeItems,
          scroll: beforeScroll,
        },
        after: {
          items: afterItems,
          scroll: afterScroll,
        },
        compound: compoundStatus,
        evidence: {
          ...evidence,
          actionDispatchedOnce:
            executionAttempts === 1 && !!compoundStatus?.lastAction?.id,
          actionConfirmed:
            compoundStatus?.lastAction?.status === "CONFIRMED",
          compoundSucceeded:
            typeof compoundStatus?.lastAction?.compoundSucceeded === "boolean"
              ? compoundStatus.lastAction.compoundSucceeded
              : null,
          blindRetryAvoided: executionAttempts <= 1,
          offeringOmitted: compoundStatus?.selected
            ? compoundStatus.selected.offeringSlot === null
            : true,
        },
        scope: {
          upgradeMutationAllowed: false,
          compoundMutationAllowed: true,
          irreversibleMutation: true,
          offeringMutationAllowed: false,
          exchangeMutationAllowed: false,
          craftMutationAllowed: false,
          blindRetryAllowed: false,
          mutationScope: "single-compound-attempt-only",
        },
        cleanup: {
          inventoryConfigOverrideCleared,
          compoundConfigOverrideCleared,
        },
      };
    };

    if (!itemName || !scrollName || !requestedSlots) {
      reason =
        "COMPOUND_LIVE_EXPLICIT_ITEM_SLOTS_AND_SCROLL_REQUIRED";
      return (finalResult = finish());
    }

    try {
      const originalIntelligence = this.deps.inventoryIntelligence.tick();
      evidence.inventoryIntelligenceReady = ["READY", "EMPTY"].includes(
        originalIntelligence.state,
      );
      if (!evidence.inventoryIntelligenceReady) {
        reason = "COMPOUND_LIVE_INVENTORY_INTELLIGENCE_NOT_READY";
        return (finalResult = finish());
      }

      const initialInventory = this.deps.game.inventory();
      const gameData = this.deps.game.gameData();
      evidence.itemDefinitionCompoundable = isCompoundableDefinition(
        gameData,
        itemName,
      );
      if (!evidence.itemDefinitionCompoundable) {
        reason = "COMPOUND_LIVE_ITEM_NOT_COMPOUNDABLE";
        return (finalResult = finish());
      }

      selected = selectCompoundLiveTarget(
        initialInventory,
        originalIntelligence.entries,
        gameData,
        (item) => this.deps.game.itemGrade(item),
        {
          ...options,
          itemName,
          scrollName,
          itemSlots: requestedSlots,
        },
      );
      if (!selected) {
        reason = "COMPOUND_LIVE_SAFE_TRIPLE_OR_SCROLL_NOT_FOUND";
        return (finalResult = finish());
      }

      evidence.exactTripleObserved = true;
      evidence.sameName = true;
      evidence.sameLevel = true;
      evidence.itemGradesKnown = true;
      evidence.itemGradesMatch = true;
      evidence.scrollGradeCompatible =
        scrollName === "cscroll" + selected.itemGrade;
      evidence.allItemsUnprotectedBefore = selected.itemEntries.every(
        (entry) => !entry.protected && entry.protections.length === 0,
      );
      evidence.scrollUnprotectedBefore =
        !selected.scrollEntry.protected &&
        selected.scrollEntry.protections.length === 0;

      beforeItems = selected.itemSlots.map((slot) =>
        itemState(initialInventory, slot),
      );
      beforeScroll = itemState(initialInventory, selected.scrollSlot);

      this.deps.inventoryIntelligence.setConfigOverride({
        inventory: {
          intelligence: {
            enabled: true,
          },
          rules: {
            [itemName]: "COMPOUND",
          },
        },
      });
      this.deps.inventoryIntelligence.tick();

      this.deps.compound.setConfigOverride({
        compound: {
          enabled: true,
          allowedSlots: selected.itemSlots,
          maxLevel: selected.level + 1,
          scrollByGrade: {
            [selected.itemGrade]: scrollName,
          },
        },
      });

      const planned = this.deps.compound.tick();
      evidence.exactCandidateSelected =
        planned.state === "READY" &&
        planned.selected?.name === itemName &&
        planned.selected?.currentLevel === selected.level &&
        planned.selected?.itemGrade === selected.itemGrade &&
        planned.selected?.scrollName === scrollName &&
        planned.selected?.scrollSlot === selected.scrollSlot &&
        planned.selected?.offeringSlot === null &&
        JSON.stringify(planned.selected?.itemSlots) ===
          JSON.stringify(selected.itemSlots);

      if (!evidence.exactCandidateSelected) {
        compoundStatus = planned;
        reason =
          planned.reason || "COMPOUND_LIVE_EXACT_CANDIDATE_NOT_READY";
        return (finalResult = finish());
      }

      const runtimePreflight = this.deps.runtimePreflight();
      const dispatchInventory = this.deps.game.inventory();
      evidence.localPreflightReadOnly = true;
      evidence.runtimeMap = text(runtimePreflight.map);
      evidence.compoundOperationIdle =
        runtimePreflight.compoundInProgress !== true;
      evidence.itemLocksClear = selected.itemSlots.every(
        (slot) => !itemLocked(inventoryItem(dispatchInventory, slot)),
      );
      evidence.scrollLocksClear = !itemLocked(
        inventoryItem(dispatchInventory, selected.scrollSlot),
      );
      evidence.mapAllowsCompound =
        !!evidence.runtimeMap &&
        !evidence.runtimeMap.toLowerCase().startsWith("bank");

      if (
        !evidence.compoundOperationIdle ||
        !evidence.itemLocksClear ||
        !evidence.scrollLocksClear ||
        !evidence.mapAllowsCompound
      ) {
        compoundStatus = planned;
        reason = "COMPOUND_LIVE_LOCAL_PREFLIGHT_BLOCKED";
        return (finalResult = finish());
      }

      executionAttempts += 1;
      compoundStatus = await this.deps.compound.executeNext();

      if (compoundStatus.lastAction?.status === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "COMPOUND_LIVE_OUTCOME_UNKNOWN_NO_RETRY";
        const observedInventory = this.deps.game.inventory();
        afterItems = selected.itemSlots.map((slot) =>
          itemState(observedInventory, slot),
        );
        afterScroll = itemState(observedInventory, selected.scrollSlot);
        return (finalResult = finish());
      }

      if (compoundStatus.lastAction?.status !== "CONFIRMED") {
        reason =
          compoundStatus.lastAction?.why ||
          "COMPOUND_LIVE_ACTION_NOT_CONFIRMED";
        const observedInventory = this.deps.game.inventory();
        afterItems = selected.itemSlots.map((slot) =>
          itemState(observedInventory, slot),
        );
        afterScroll = itemState(observedInventory, selected.scrollSlot);
        return (finalResult = finish());
      }

      const itemsBeforeSignature = tripleSignature(beforeItems);
      const scrollBeforeSignature = stateSignature(beforeScroll);
      const settleStartedAt = this.now();

      do {
        const observedInventory = this.deps.game.inventory();
        afterItems = selected.itemSlots.map((slot) =>
          itemState(observedInventory, slot),
        );
        afterScroll = itemState(observedInventory, selected.scrollSlot);
        evidence.itemStateChanged =
          tripleSignature(afterItems) !== itemsBeforeSignature;
        evidence.scrollStateChanged =
          stateSignature(afterScroll) !== scrollBeforeSignature;
        evidence.mutationObserved =
          evidence.itemStateChanged || evidence.scrollStateChanged;
        if (evidence.mutationObserved) break;
        await this.sleep(settlePollMs);
      } while (this.now() - settleStartedAt < settleTimeoutMs);

      if (!evidence.mutationObserved) {
        outcome = "TIMEOUT";
        reason =
          "COMPOUND_LIVE_CONFIRMED_BUT_STATE_CHANGE_NOT_OBSERVED";
        return (finalResult = finish());
      }

      outcome = "PASS";
      reason = "COMPOUND_LIVE_E2E_CONFIRMED";
      return (finalResult = finish());
    } finally {
      this.deps.inventoryIntelligence.clearConfigOverride();
      inventoryConfigOverrideCleared = true;
      this.deps.compound.clearConfigOverride();
      compoundConfigOverrideCleared = true;
      this.deps.inventoryIntelligence.tick();
      this.deps.compound.tick();

      if (finalResult) {
        finalResult.cleanup.inventoryConfigOverrideCleared =
          inventoryConfigOverrideCleared;
        finalResult.cleanup.compoundConfigOverrideCleared =
          compoundConfigOverrideCleared;
      }
    }
  }
}

export {
  itemState as compoundLiveItemState,
  selectCompoundLiveTarget,
  stateSignature as compoundLiveStateSignature,
  tripleSignature as compoundLiveTripleSignature,
};

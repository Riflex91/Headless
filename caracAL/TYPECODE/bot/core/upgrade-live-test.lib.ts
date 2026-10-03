import type {
  InventoryIntelligenceController,
  InventoryIntelligenceEntry,
} from "./inventory-intelligence-controller.lib";
import type { InventorySlotSnapshot } from "./game-adapter.lib";
import type {
  UpgradeController,
  UpgradeStatus,
} from "./upgrade-controller.lib";

export interface UpgradeLiveTestOptions {
  requestId?: string;
  itemName: string;
  scrollName: string;
  itemSlot?: number;
  settleTimeoutMs?: number;
  settlePollMs?: number;
}

export interface UpgradeLiveItemState {
  slot: number;
  name: string | null;
  level: number | null;
  quantity: number;
  property: unknown;
  present: boolean;
}

export interface UpgradeLiveTestResult {
  requestId: string;
  outcome: "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
  reason: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  character: string | null;
  target: {
    itemName: string;
    itemSlot: number | null;
    fromLevel: number | null;
    scrollName: string;
    scrollSlot: number | null;
  };
  before: {
    item: UpgradeLiveItemState | null;
    scroll: UpgradeLiveItemState | null;
  };
  after: {
    item: UpgradeLiveItemState | null;
    scroll: UpgradeLiveItemState | null;
  };
  upgrade: UpgradeStatus | null;
  evidence: {
    inventoryIntelligenceReady: boolean;
    itemDefinitionUpgradable: boolean;
    itemGradeKnown: boolean;
    scrollGradeCompatible: boolean;
    itemUnprotectedBefore: boolean;
    scrollUnprotectedBefore: boolean;
    exactCandidateSelected: boolean;
    actionDispatchedOnce: boolean;
    actionConfirmed: boolean;
    upgradeSucceeded: boolean | null;
    itemStateChanged: boolean;
    scrollStateChanged: boolean;
    mutationObserved: boolean;
    blindRetryAvoided: boolean;
    offeringOmitted: boolean;
  };
  scope: {
    upgradeMutationAllowed: true;
    irreversibleMutation: true;
    offeringMutationAllowed: false;
    compoundMutationAllowed: false;
    exchangeMutationAllowed: false;
    craftMutationAllowed: false;
    blindRetryAllowed: false;
    mutationScope: "single-upgrade-attempt-only";
  };
  cleanup: {
    inventoryConfigOverrideCleared: boolean;
    upgradeConfigOverrideCleared: boolean;
  };
}

export interface UpgradePreflightCandidate {
  itemSlot: number;
  itemName: string;
  level: number;
  itemGrade: number | null;
  expectedScrollName: string | null;
  protected: boolean;
  protections: string[];
  matchingScrollSlots: number[];
  eligible: boolean;
  reason:
    | "UPGRADE_PREFLIGHT_READY"
    | "UPGRADE_PREFLIGHT_ITEM_PROTECTED"
    | "UPGRADE_PREFLIGHT_ITEM_GRADE_UNKNOWN"
    | "UPGRADE_PREFLIGHT_MATCHING_SCROLL_MISSING";
}

export interface UpgradePreflightResult {
  outcome: "PASS" | "FAIL";
  reason: "UPGRADE_PREFLIGHT_COMPLETED" | "UPGRADE_PREFLIGHT_RUNTIME_NOT_READY";
  timestamp: number;
  character: string | null;
  inventoryState: string | null;
  candidates: UpgradePreflightCandidate[];
  summary: {
    upgradableItems: number;
    eligibleCandidates: number;
    protectedItems: number;
    unknownGradeItems: number;
    missingScrollItems: number;
  };
  scope: {
    readOnly: true;
    upgradeMutationForced: false;
    offeringMutationForced: false;
    compoundMutationForced: false;
    exchangeMutationForced: false;
    craftMutationForced: false;
  };
}

interface UpgradeLiveGameAdapter {
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
  itemGrade(item: Record<string, unknown>): number | null;
}

interface UpgradeLiveTestDependencies {
  game: UpgradeLiveGameAdapter;
  inventoryIntelligence: Pick<
    InventoryIntelligenceController,
    "status" | "tick" | "setConfigOverride" | "clearConfigOverride"
  >;
  upgrade: Pick<
    UpgradeController,
    "status" | "tick" | "executeNext" | "setConfigOverride" | "clearConfigOverride"
  >;
  characterName?: () => string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface SelectedLiveTarget {
  itemSlot: number;
  itemName: string;
  level: number;
  itemGrade: number;
  expectedScrollName: string;
  scrollSlot: number;
  scrollName: string;
  itemEntry: InventoryIntelligenceEntry;
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

function itemState(
  inventory: InventorySlotSnapshot[],
  slot: number,
): UpgradeLiveItemState {
  const item = inventoryItem(inventory, slot);
  return {
    slot,
    name: item ? text(item.name) : null,
    level: item ? nonNegativeInteger(item.level) ?? 0 : null,
    quantity: item
      ? Math.max(1, nonNegativeInteger(item.q) ?? 1)
      : 0,
    property: item?.p ?? null,
    present: !!item,
  };
}

function stateSignature(state: UpgradeLiveItemState | null): string {
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

function isUpgradableDefinition(
  gameData: Record<string, unknown>,
  itemName: string,
): boolean {
  const items = record(gameData.items);
  const definition = record(items[itemName]);
  return Object.prototype.hasOwnProperty.call(definition, "upgrade");
}

function selectLiveTarget(
  inventory: InventorySlotSnapshot[],
  intelligenceEntries: InventoryIntelligenceEntry[],
  gameData: Record<string, unknown>,
  itemGrade: (item: Record<string, unknown>) => number | null,
  options: UpgradeLiveTestOptions,
): SelectedLiveTarget | null {
  const requestedSlot = nonNegativeInteger(options.itemSlot);
  const entriesBySlot = new Map(
    intelligenceEntries.map((entry) => [entry.slot, entry]),
  );

  const itemCandidates = inventory
    .filter((slot) => {
      if (requestedSlot !== null && slot.slot !== requestedSlot) return false;
      const item = slot.item ? record(slot.item) : null;
      if (!item || text(item.name) !== options.itemName) return false;
      const level = nonNegativeInteger(item.level) ?? 0;
      if (level < 0) return false;
      const entry = entriesBySlot.get(slot.slot);
      if (!entry || entry.protected || entry.protections.length > 0) {
        return false;
      }
      return isUpgradableDefinition(gameData, options.itemName);
    })
    .sort((left, right) => left.slot - right.slot);

  for (const candidate of itemCandidates) {
    const item = candidate.item ? record(candidate.item) : null;
    const level = item ? nonNegativeInteger(item.level) ?? 0 : null;
    if (level === null || !item) continue;

    const grade = itemGrade(item);
    if (grade === null || !Number.isInteger(grade) || grade < 0) continue;
    const expectedScrollName = `scroll${grade}`;
    if (options.scrollName !== expectedScrollName) continue;

    const scroll = inventory
      .filter((slot) => slot.slot !== candidate.slot)
      .filter((slot) => {
        const raw = slot.item ? record(slot.item) : null;
        if (!raw || text(raw.name) !== options.scrollName) return false;
        const entry = entriesBySlot.get(slot.slot);
        return !!entry && !entry.protected && entry.protections.length === 0;
      })
      .sort((left, right) => left.slot - right.slot)[0];

    if (!scroll) continue;

    return {
      itemSlot: candidate.slot,
      itemName: options.itemName,
      level,
      itemGrade: grade,
      expectedScrollName,
      scrollSlot: scroll.slot,
      scrollName: options.scrollName,
      itemEntry: entriesBySlot.get(candidate.slot) as InventoryIntelligenceEntry,
      scrollEntry: entriesBySlot.get(scroll.slot) as InventoryIntelligenceEntry,
    };
  }

  return null;
}

function baseEvidence(): UpgradeLiveTestResult["evidence"] {
  return {
    inventoryIntelligenceReady: false,
    itemDefinitionUpgradable: false,
    itemGradeKnown: false,
    scrollGradeCompatible: false,
    itemUnprotectedBefore: false,
    scrollUnprotectedBefore: false,
    exactCandidateSelected: false,
    actionDispatchedOnce: false,
    actionConfirmed: false,
    upgradeSucceeded: null,
    itemStateChanged: false,
    scrollStateChanged: false,
    mutationObserved: false,
    blindRetryAvoided: true,
    offeringOmitted: true,
  };
}

export class UpgradeLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: UpgradeLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep =
      deps.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  preflight(): UpgradePreflightResult {
    const timestamp = this.now();
    const intelligence = this.deps.inventoryIntelligence.tick();
    const inventoryState =
      typeof intelligence?.state === "string" ? intelligence.state : null;
    const ready = ["READY", "EMPTY"].includes(inventoryState || "");

    if (!ready) {
      return {
        outcome: "FAIL",
        reason: "UPGRADE_PREFLIGHT_RUNTIME_NOT_READY",
        timestamp,
        character: this.deps.characterName?.() || null,
        inventoryState,
        candidates: [],
        summary: {
          upgradableItems: 0,
          eligibleCandidates: 0,
          protectedItems: 0,
          unknownGradeItems: 0,
          missingScrollItems: 0,
        },
        scope: {
          readOnly: true,
          upgradeMutationForced: false,
          offeringMutationForced: false,
          compoundMutationForced: false,
          exchangeMutationForced: false,
          craftMutationForced: false,
        },
      };
    }

    const inventory = this.deps.game.inventory();
    const gameData = this.deps.game.gameData();
    const intelligenceBySlot = new Map(
      intelligence.entries.map((entry) => [entry.slot, entry]),
    );
    const candidates: UpgradePreflightCandidate[] = [];

    for (const slot of inventory) {
      const item = slot.item ? record(slot.item) : null;
      const name = item ? text(item.name) : null;
      if (!item || !name || !isUpgradableDefinition(gameData, name)) continue;

      const level = nonNegativeInteger(item.level) ?? 0;
      const intelligenceEntry = intelligenceBySlot.get(slot.slot);
      const protections = Array.isArray(intelligenceEntry?.protections)
        ? [...intelligenceEntry.protections]
        : [];
      const protectedItem =
        intelligenceEntry?.protected === true || protections.length > 0;
      const grade = this.deps.game.itemGrade(item);
      const expectedScrollName =
        grade !== null && Number.isInteger(grade) && grade >= 0
          ? `scroll${grade}`
          : null;
      const matchingScrollSlots = expectedScrollName
        ? inventory
            .filter((candidate) => candidate.slot !== slot.slot)
            .filter((candidate) => {
              const raw = candidate.item ? record(candidate.item) : null;
              if (!raw || text(raw.name) !== expectedScrollName) return false;
              const scrollIntelligence = intelligenceBySlot.get(candidate.slot);
              return (
                !!scrollIntelligence &&
                scrollIntelligence.protected !== true &&
                scrollIntelligence.protections.length === 0
              );
            })
            .map((candidate) => candidate.slot)
            .sort((left, right) => left - right)
        : [];

      let reason: UpgradePreflightCandidate["reason"];
      if (protectedItem) {
        reason = "UPGRADE_PREFLIGHT_ITEM_PROTECTED";
      } else if (expectedScrollName === null) {
        reason = "UPGRADE_PREFLIGHT_ITEM_GRADE_UNKNOWN";
      } else if (matchingScrollSlots.length === 0) {
        reason = "UPGRADE_PREFLIGHT_MATCHING_SCROLL_MISSING";
      } else {
        reason = "UPGRADE_PREFLIGHT_READY";
      }

      candidates.push({
        itemSlot: slot.slot,
        itemName: name,
        level,
        itemGrade: grade,
        expectedScrollName,
        protected: protectedItem,
        protections,
        matchingScrollSlots,
        eligible: reason === "UPGRADE_PREFLIGHT_READY",
        reason,
      });
    }

    candidates.sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        left.itemSlot - right.itemSlot ||
        left.itemName.localeCompare(right.itemName),
    );

    return {
      outcome: "PASS",
      reason: "UPGRADE_PREFLIGHT_COMPLETED",
      timestamp,
      character: this.deps.characterName?.() || null,
      inventoryState,
      candidates,
      summary: {
        upgradableItems: candidates.length,
        eligibleCandidates: candidates.filter((entry) => entry.eligible).length,
        protectedItems: candidates.filter((entry) => entry.protected).length,
        unknownGradeItems: candidates.filter(
          (entry) => entry.reason === "UPGRADE_PREFLIGHT_ITEM_GRADE_UNKNOWN",
        ).length,
        missingScrollItems: candidates.filter(
          (entry) => entry.reason === "UPGRADE_PREFLIGHT_MATCHING_SCROLL_MISSING",
        ).length,
      },
      scope: {
        readOnly: true,
        upgradeMutationForced: false,
        offeringMutationForced: false,
        compoundMutationForced: false,
        exchangeMutationForced: false,
        craftMutationForced: false,
      },
    };
  }

  async run(options: UpgradeLiveTestOptions): Promise<UpgradeLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || `upgrade-live-${startedAt}`;
    const itemName = text(options.itemName);
    const scrollName = text(options.scrollName);
    const settleTimeoutMs = Math.max(500, options.settleTimeoutMs || 3000);
    const settlePollMs = Math.max(25, options.settlePollMs || 100);
    const evidence = baseEvidence();
    let selected: SelectedLiveTarget | null = null;
    let beforeItem: UpgradeLiveItemState | null = null;
    let beforeScroll: UpgradeLiveItemState | null = null;
    let afterItem: UpgradeLiveItemState | null = null;
    let afterScroll: UpgradeLiveItemState | null = null;
    let upgradeStatus: UpgradeStatus | null = null;
    let outcome: UpgradeLiveTestResult["outcome"] = "FAIL";
    let reason = "UPGRADE_LIVE_EVIDENCE_INCOMPLETE";
    let inventoryConfigOverrideCleared = false;
    let upgradeConfigOverrideCleared = false;
    let executionAttempts = 0;
    let finalResult: UpgradeLiveTestResult | null = null;

    const finish = (): UpgradeLiveTestResult => {
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
          itemSlot: selected?.itemSlot ?? null,
          fromLevel: selected?.level ?? null,
          scrollName: scrollName || "",
          scrollSlot: selected?.scrollSlot ?? null,
        },
        before: {
          item: beforeItem,
          scroll: beforeScroll,
        },
        after: {
          item: afterItem,
          scroll: afterScroll,
        },
        upgrade: upgradeStatus,
        evidence: {
          ...evidence,
          actionDispatchedOnce:
            executionAttempts === 1 && !!upgradeStatus?.lastAction?.id,
          actionConfirmed: upgradeStatus?.lastAction?.status === "CONFIRMED",
          upgradeSucceeded:
            typeof upgradeStatus?.lastAction?.upgradeSucceeded === "boolean"
              ? upgradeStatus.lastAction.upgradeSucceeded
              : null,
          blindRetryAvoided: executionAttempts <= 1,
          offeringOmitted: upgradeStatus?.selected
            ? upgradeStatus.selected.offeringSlot === null
            : true,
        },
        scope: {
          upgradeMutationAllowed: true,
          irreversibleMutation: true,
          offeringMutationAllowed: false,
          compoundMutationAllowed: false,
          exchangeMutationAllowed: false,
          craftMutationAllowed: false,
          blindRetryAllowed: false,
          mutationScope: "single-upgrade-attempt-only",
        },
        cleanup: {
          inventoryConfigOverrideCleared,
          upgradeConfigOverrideCleared,
        },
      };
    };

    if (!itemName || !scrollName) {
      reason = "UPGRADE_LIVE_EXPLICIT_ITEM_AND_SCROLL_REQUIRED";
      return (finalResult = finish());
    }

    try {
      const originalIntelligence = this.deps.inventoryIntelligence.tick();
      evidence.inventoryIntelligenceReady = ["READY", "EMPTY"].includes(
        originalIntelligence.state,
      );
      if (!evidence.inventoryIntelligenceReady) {
        reason = "UPGRADE_LIVE_INVENTORY_INTELLIGENCE_NOT_READY";
        return (finalResult = finish());
      }

      const initialInventory = this.deps.game.inventory();
      const gameData = this.deps.game.gameData();
      evidence.itemDefinitionUpgradable = isUpgradableDefinition(
        gameData,
        itemName,
      );
      if (!evidence.itemDefinitionUpgradable) {
        reason = "UPGRADE_LIVE_ITEM_NOT_UPGRADABLE";
        return (finalResult = finish());
      }

      selected = selectLiveTarget(
        initialInventory,
        originalIntelligence.entries,
        gameData,
        (item) => this.deps.game.itemGrade(item),
        {
          ...options,
          itemName,
          scrollName,
        },
      );
      if (!selected) {
        reason = "UPGRADE_LIVE_SAFE_TARGET_OR_SCROLL_NOT_FOUND";
        return (finalResult = finish());
      }

      evidence.itemGradeKnown = true;
      evidence.scrollGradeCompatible =
        scrollName === selected.expectedScrollName;
      evidence.itemUnprotectedBefore =
        !selected.itemEntry.protected &&
        selected.itemEntry.protections.length === 0;
      evidence.scrollUnprotectedBefore =
        !selected.scrollEntry.protected &&
        selected.scrollEntry.protections.length === 0;
      beforeItem = itemState(initialInventory, selected.itemSlot);
      beforeScroll = itemState(initialInventory, selected.scrollSlot);

      this.deps.inventoryIntelligence.setConfigOverride({
        inventory: {
          intelligence: {
            enabled: true,
          },
          rules: {
            [itemName]: "UPGRADE",
          },
        },
      });
      this.deps.inventoryIntelligence.tick();

      this.deps.upgrade.setConfigOverride({
        upgrade: {
          enabled: true,
          allowedSlots: [selected.itemSlot],
          maxLevel: selected.level + 1,
          scrollByCurrentLevel: {
            [selected.level]: scrollName,
          },
        },
      });
      const planned = this.deps.upgrade.tick();
      evidence.exactCandidateSelected =
        planned.state === "READY" &&
        planned.selected?.itemSlot === selected.itemSlot &&
        planned.selected?.scrollSlot === selected.scrollSlot &&
        planned.selected?.name === itemName &&
        planned.selected?.scrollName === scrollName &&
        planned.selected?.offeringSlot === null;

      if (!evidence.exactCandidateSelected) {
        upgradeStatus = planned;
        reason = planned.reason || "UPGRADE_LIVE_EXACT_CANDIDATE_NOT_READY";
        return (finalResult = finish());
      }

      executionAttempts += 1;
      upgradeStatus = await this.deps.upgrade.executeNext();

      if (upgradeStatus.lastAction?.status === "UNKNOWN") {
        outcome = "UNKNOWN";
        reason = "UPGRADE_LIVE_OUTCOME_UNKNOWN_NO_RETRY";
        afterItem = itemState(
          this.deps.game.inventory(),
          selected.itemSlot,
        );
        afterScroll = itemState(
          this.deps.game.inventory(),
          selected.scrollSlot,
        );
        return (finalResult = finish());
      }

      if (upgradeStatus.lastAction?.status !== "CONFIRMED") {
        reason =
          upgradeStatus.lastAction?.why ||
          "UPGRADE_LIVE_ACTION_NOT_CONFIRMED";
        afterItem = itemState(
          this.deps.game.inventory(),
          selected.itemSlot,
        );
        afterScroll = itemState(
          this.deps.game.inventory(),
          selected.scrollSlot,
        );
        return (finalResult = finish());
      }

      const itemBeforeSignature = stateSignature(beforeItem);
      const scrollBeforeSignature = stateSignature(beforeScroll);
      const settleStartedAt = this.now();

      do {
        const observedInventory = this.deps.game.inventory();
        afterItem = itemState(observedInventory, selected.itemSlot);
        afterScroll = itemState(observedInventory, selected.scrollSlot);
        evidence.itemStateChanged =
          stateSignature(afterItem) !== itemBeforeSignature;
        evidence.scrollStateChanged =
          stateSignature(afterScroll) !== scrollBeforeSignature;
        evidence.mutationObserved =
          evidence.itemStateChanged || evidence.scrollStateChanged;
        if (evidence.mutationObserved) break;
        await this.sleep(settlePollMs);
      } while (this.now() - settleStartedAt < settleTimeoutMs);

      if (!evidence.mutationObserved) {
        outcome = "TIMEOUT";
        reason = "UPGRADE_LIVE_CONFIRMED_BUT_STATE_CHANGE_NOT_OBSERVED";
        return (finalResult = finish());
      }

      outcome = "PASS";
      reason = "UPGRADE_LIVE_E2E_CONFIRMED";
      return (finalResult = finish());
    } finally {
      this.deps.inventoryIntelligence.clearConfigOverride();
      inventoryConfigOverrideCleared = true;
      this.deps.upgrade.clearConfigOverride();
      upgradeConfigOverrideCleared = true;
      this.deps.inventoryIntelligence.tick();
      this.deps.upgrade.tick();

      if (finalResult) {
        finalResult.cleanup.inventoryConfigOverrideCleared =
          inventoryConfigOverrideCleared;
        finalResult.cleanup.upgradeConfigOverrideCleared =
          upgradeConfigOverrideCleared;
      }
    }
  }
}

export {
  itemState as upgradeLiveItemState,
  selectLiveTarget as selectUpgradeLiveTarget,
  stateSignature as upgradeLiveStateSignature,
};

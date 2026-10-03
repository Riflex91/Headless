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

interface UpgradeLiveGameAdapter {
  inventory(): InventorySlotSnapshot[];
  gameData(): Record<string, unknown>;
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
    if (level === null) continue;

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
      return finish();
    }

    try {
      const originalIntelligence = this.deps.inventoryIntelligence.tick();
      evidence.inventoryIntelligenceReady = ["READY", "EMPTY"].includes(
        originalIntelligence.state,
      );
      if (!evidence.inventoryIntelligenceReady) {
        reason = "UPGRADE_LIVE_INVENTORY_INTELLIGENCE_NOT_READY";
        return finish();
      }

      const initialInventory = this.deps.game.inventory();
      const gameData = this.deps.game.gameData();
      evidence.itemDefinitionUpgradable = isUpgradableDefinition(
        gameData,
        itemName,
      );
      if (!evidence.itemDefinitionUpgradable) {
        reason = "UPGRADE_LIVE_ITEM_NOT_UPGRADABLE";
        return finish();
      }

      selected = selectLiveTarget(
        initialInventory,
        originalIntelligence.entries,
        gameData,
        {
          ...options,
          itemName,
          scrollName,
        },
      );
      if (!selected) {
        reason = "UPGRADE_LIVE_SAFE_TARGET_OR_SCROLL_NOT_FOUND";
        return finish();
      }

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
        return finish();
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
        return finish();
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
        return finish();
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
        return finish();
      }

      outcome = "PASS";
      reason = "UPGRADE_LIVE_E2E_CONFIRMED";
      return finish();
    } finally {
      this.deps.inventoryIntelligence.clearConfigOverride();
      inventoryConfigOverrideCleared = true;
      this.deps.upgrade.clearConfigOverride();
      upgradeConfigOverrideCleared = true;
      this.deps.inventoryIntelligence.tick();
      this.deps.upgrade.tick();
    }
  }
}

export {
  itemState as upgradeLiveItemState,
  selectLiveTarget as selectUpgradeLiveTarget,
  stateSignature as upgradeLiveStateSignature,
};

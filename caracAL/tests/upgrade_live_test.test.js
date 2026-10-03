"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function coreModule(fileName) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", fileName),
  );
}

function intelligenceStatus() {
  return {
    timestamp: 1000,
    enabled: true,
    state: "READY",
    reason: "INVENTORY_INTELLIGENCE_READY",
    entries: [
      {
        slot: 0,
        name: "sword",
        level: 0,
        quantity: 1,
        definitionKnown: true,
        itemType: "weapon",
        disposition: "KEEP",
        protected: false,
        protections: [],
        why: "test",
      },
      {
        slot: 1,
        name: "scroll0",
        level: 0,
        quantity: 2,
        definitionKnown: true,
        itemType: "scroll",
        disposition: "KEEP",
        protected: false,
        protections: [],
        why: "test",
      },
    ],
    summary: {
      totalItems: 2,
      protectedItems: 0,
      dispositions: {},
      protections: {},
    },
  };
}

function makeRunner({
  actionStatus = "CONFIRMED",
  upgradeSucceeded = true,
  mutate = true,
  itemProtected = false,
  scrollProtected = false,
} = {}) {
  const { UpgradeLiveTestRunner } = coreModule("upgrade-live-test.lib.ts");
  const state = {
    items: [
      { name: "sword", level: 0 },
      { name: "scroll0", q: 2 },
    ],
  };
  let inventoryOverride = null;
  let upgradeOverride = null;
  let executeCalls = 0;
  let now = 1000;

  const intelligence = {
    status() {
      return this.tick();
    },
    tick() {
      const status = intelligenceStatus();
      status.entries[0].protected = itemProtected;
      status.entries[0].protections = itemProtected ? ["RESERVED"] : [];
      status.entries[1].protected = scrollProtected;
      status.entries[1].protections = scrollProtected ? ["LOCKED"] : [];
      if (inventoryOverride?.inventory?.rules?.sword === "UPGRADE") {
        status.entries[0].disposition = "UPGRADE";
      }
      return status;
    },
    setConfigOverride(value) {
      inventoryOverride = value;
    },
    clearConfigOverride() {
      inventoryOverride = null;
    },
  };

  const upgrade = {
    tick() {
      if (!upgradeOverride) {
        return {
          state: "EMPTY",
          reason: "UPGRADE_NO_ELIGIBLE_CANDIDATE",
          selected: null,
          lastAction: null,
        };
      }
      return {
        state: "READY",
        reason: "UPGRADE_CANDIDATE_READY",
        selected: {
          itemSlot: 0,
          name: "sword",
          currentLevel: 0,
          maxLevel: 1,
          scrollName: "scroll0",
          scrollSlot: 1,
          offeringSlot: null,
          reason: "UPGRADE_POLICY_ELIGIBLE",
        },
        lastAction: null,
      };
    },
    async executeNext() {
      executeCalls += 1;
      if (actionStatus === "CONFIRMED" && mutate) {
        if (upgradeSucceeded) {
          state.items[0] = { name: "sword", level: 1 };
        } else {
          state.items[0] = null;
        }
        state.items[1] = { name: "scroll0", q: 1 };
      }
      return {
        ...this.tick(),
        state: actionStatus === "UNKNOWN" ? "UNKNOWN_HOLD" : "EMPTY",
        reason:
          actionStatus === "UNKNOWN"
            ? "UPGRADE_UNKNOWN_HOLD_ACTIVE"
            : "UPGRADE_NO_ELIGIBLE_CANDIDATE",
        selected: null,
        lastAction: {
          id: actionStatus === "UNKNOWN" ? "A-unknown" : "A-confirmed",
          status: actionStatus,
          why: "UPGRADE_POLICY_SELECTED",
          error: actionStatus === "UNKNOWN" ? "socket timeout" : null,
          itemSlot: 0,
          name: "sword",
          fromLevel: 0,
          scrollSlot: 1,
          scrollName: "scroll0",
          upgradeSucceeded:
            actionStatus === "CONFIRMED" ? upgradeSucceeded : null,
        },
      };
    },
    setConfigOverride(value) {
      upgradeOverride = value;
    },
    clearConfigOverride() {
      upgradeOverride = null;
    },
  };

  const runner = new UpgradeLiveTestRunner({
    game: {
      inventory() {
        return state.items.map((item, slot) => ({
          slot,
          item: item ? { ...item } : null,
        }));
      },
      gameData() {
        return {
          items: {
            sword: { upgrade: { attack: 2 } },
            scroll0: {},
          },
        };
      },
    },
    inventoryIntelligence: intelligence,
    upgrade,
    characterName: () => "RangerA",
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  return {
    runner,
    executeCalls: () => executeCalls,
    overrides() {
      return { inventoryOverride, upgradeOverride };
    },
  };
}

test("Upgrade live runner confirms one real successful mutation", async () => {
  const setup = makeRunner();

  const result = await setup.runner.run({
    itemName: "sword",
    scrollName: "scroll0",
    itemSlot: 0,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "UPGRADE_LIVE_E2E_CONFIRMED");
  assert.equal(setup.executeCalls(), 1);
  assert.equal(result.evidence.actionDispatchedOnce, true);
  assert.equal(result.evidence.actionConfirmed, true);
  assert.equal(result.evidence.upgradeSucceeded, true);
  assert.equal(result.evidence.itemStateChanged, true);
  assert.equal(result.evidence.scrollStateChanged, true);
  assert.equal(result.evidence.mutationObserved, true);
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(result.evidence.offeringOmitted, true);
  assert.equal(result.cleanup.inventoryConfigOverrideCleared, true);
  assert.equal(result.cleanup.upgradeConfigOverrideCleared, true);
  assert.deepEqual(setup.overrides(), {
    inventoryOverride: null,
    upgradeOverride: null,
  });
});

test("Upgrade live runner accepts a confirmed chance failure when mutation is observed", async () => {
  const setup = makeRunner({ upgradeSucceeded: false });

  const result = await setup.runner.run({
    itemName: "sword",
    scrollName: "scroll0",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidence.upgradeSucceeded, false);
  assert.equal(result.after.item.present, false);
  assert.equal(result.evidence.mutationObserved, true);
  assert.equal(setup.executeCalls(), 1);
});

test("Upgrade live runner returns UNKNOWN without any retry", async () => {
  const setup = makeRunner({ actionStatus: "UNKNOWN", mutate: false });

  const result = await setup.runner.run({
    itemName: "sword",
    scrollName: "scroll0",
  });

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "UPGRADE_LIVE_OUTCOME_UNKNOWN_NO_RETRY");
  assert.equal(result.evidence.blindRetryAvoided, true);
  assert.equal(setup.executeCalls(), 1);
});

test("Upgrade live runner refuses protected item or scroll before mutation", async () => {
  const protectedItem = makeRunner({ itemProtected: true });
  const itemResult = await protectedItem.runner.run({
    itemName: "sword",
    scrollName: "scroll0",
  });
  assert.equal(itemResult.outcome, "FAIL");
  assert.equal(
    itemResult.reason,
    "UPGRADE_LIVE_SAFE_TARGET_OR_SCROLL_NOT_FOUND",
  );
  assert.equal(protectedItem.executeCalls(), 0);

  const protectedScroll = makeRunner({ scrollProtected: true });
  const scrollResult = await protectedScroll.runner.run({
    itemName: "sword",
    scrollName: "scroll0",
  });
  assert.equal(scrollResult.outcome, "FAIL");
  assert.equal(protectedScroll.executeCalls(), 0);
});

test("Upgrade live runner requires an observed post-confirmation state change", async () => {
  const setup = makeRunner({ mutate: false });

  const result = await setup.runner.run({
    itemName: "sword",
    scrollName: "scroll0",
    settleTimeoutMs: 500,
    settlePollMs: 100,
  });

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(
    result.reason,
    "UPGRADE_LIVE_CONFIRMED_BUT_STATE_CHANGE_NOT_OBSERVED",
  );
  assert.equal(setup.executeCalls(), 1);
});

test("Upgrade live runner requires explicit target and scroll without dispatch", async () => {
  const setup = makeRunner();

  const result = await setup.runner.run({
    itemName: "",
    scrollName: "",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(
    result.reason,
    "UPGRADE_LIVE_EXPLICIT_ITEM_AND_SCROLL_REQUIRED",
  );
  assert.equal(setup.executeCalls(), 0);
});

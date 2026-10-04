"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadEconomyModule() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-arbiter-controller.lib.ts",
    ),
  );
}

function loadController() {
  return loadEconomyModule().EconomyArbiterController;
}

function makeController({ signals = {}, config = {}, events = [] } = {}) {
  const EconomyArbiterController = loadController();
  let now = 1000;
  let currentSignals = signals;
  const controller = new EconomyArbiterController({
    now: () => now,
    config: () => config,
    signals: () => currentSignals,
    onEvent: (event) => events.push(event),
  });

  return {
    controller,
    events,
    setNow(value) {
      now = value;
    },
    setSignals(value) {
      currentSignals = value;
    },
  };
}

function active(reason, overrides = {}) {
  return {
    active: true,
    reason,
    ...overrides,
  };
}

test("Economy Arbiter exposes the roadmap lane order and remains read-only", () => {
  const setup = makeController();
  const status = setup.controller.tick();

  assert.deepEqual(status.policy.laneOrder, [
    "SAFETY",
    "MERRIT",
    "CRITICAL_FARMER_LOGISTICS",
    "ECONOMY_PREBUFF",
    "ECONOMY",
    "MERCHANT_STAND",
    "BACKGROUND",
  ]);
  assert.equal(status.policy.unknownBlocksLowerPriority, true);
  assert.equal(status.policy.safetyBlocksLowerPriority, true);
  assert.equal(status.policy.backgroundDynamicScoring, false);
  assert.equal(status.policy.enforcementEnabled, false);
  assert.equal(status.policy.executionEnabled, false);
  assert.equal(status.policy.valueMutationForced, false);
  assert.equal(status.state, "IDLE");
  assert.equal(status.selected, null);
});

test("Economy Arbiter selects the highest active roadmap lane deterministically", () => {
  const setup = makeController({
    signals: {
      BACKGROUND: active("BACKGROUND_READY"),
      ECONOMY: active("ECONOMY_READY"),
      CRITICAL_FARMER_LOGISTICS: active("LOGISTICS_READY"),
      MERRIT: active("MERRIT_READY"),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "ECONOMY_ARBITER_SELECTED");
  assert.equal(status.selected.lane, "MERRIT");
  assert.equal(status.selected.reason, "MERRIT_READY");
  assert.equal(status.summary.active, 4);
});

test("Economy Arbiter honors Economy Prebuff ahead of Economy", () => {
  const setup = makeController({
    signals: {
      ECONOMY: active("ECONOMY_READY"),
      ECONOMY_PREBUFF: active("PREBUFF_READY"),
      MERCHANT_STAND: active("STAND_READY"),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.selected.lane, "ECONOMY_PREBUFF");
  assert.equal(status.selected.reason, "PREBUFF_READY");
});

test("Economy Arbiter safety blocks every lower priority lane", () => {
  const setup = makeController({
    signals: {
      SAFETY: active("EMERGENCY_STOP_ACTIVE", { blocked: true }),
      MERRIT: active("MERRIT_READY"),
      ECONOMY: active("ECONOMY_READY"),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_ARBITER_SAFETY_BLOCK");
  assert.equal(status.selected.lane, "SAFETY");
  assert.equal(status.policy.safetyBlocksLowerPriority, true);
});

test("Economy Arbiter keeps UNKNOWN terminal ahead of lower priority work", () => {
  const setup = makeController({
    signals: {
      CRITICAL_FARMER_LOGISTICS: active("LOGISTICS_OUTCOME_UNCERTAIN", {
        unknown: true,
      }),
      ECONOMY: active("ECONOMY_READY"),
      BACKGROUND: active("BACKGROUND_READY"),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "UNKNOWN");
  assert.equal(status.reason, "ECONOMY_ARBITER_SELECTED_UNKNOWN");
  assert.equal(status.selected.lane, "CRITICAL_FARMER_LOGISTICS");
  assert.equal(status.selected.unknown, true);
  assert.equal(status.summary.unknown, 1);
});

test("Economy Arbiter can expose a blocked selected lane without falling through", () => {
  const setup = makeController({
    signals: {
      MERRIT: active("MERRIT_MOVEMENT_OWNED_BY_OTHER", { blocked: true }),
      ECONOMY: active("ECONOMY_READY"),
    },
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "ECONOMY_ARBITER_SELECTED_BLOCKED");
  assert.equal(status.selected.lane, "MERRIT");
});

test("Economy Arbiter supports disabling and event de-duplication", () => {
  const events = [];
  const setup = makeController({
    config: {
      economyArbiter: {
        enabled: false,
      },
    },
    events,
  });

  const first = setup.controller.tick();
  setup.setNow(2000);
  const second = setup.controller.tick();

  assert.equal(first.state, "DISABLED");
  assert.equal(first.reason, "ECONOMY_ARBITER_DISABLED");
  assert.equal(second.state, "DISABLED");
  assert.equal(events.length, 1);
});

test("Economy Arbiter classifies only governed Phase 15 intents", () => {
  const { economyArbiterLaneForIntent } = loadEconomyModule();

  assert.equal(
    economyArbiterLaneForIntent({
      module: "MerchantMerritController",
      action: "SMART_MOVE",
      why: "MERRIT_TRAVEL_TO_ZONE",
    }),
    "MERRIT",
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "MerchantLogistics",
      action: "SEND_ITEM",
      why: "POTION_DELIVERY",
    }),
    "CRITICAL_FARMER_LOGISTICS",
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "MerchantSkillController",
      action: "SKILL",
      why: "CONFIGURED_CLASS_SKILL_READY",
      metadata: { skill: "massproduction" },
    }),
    "ECONOMY_PREBUFF",
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "UpgradeLiveTest",
      action: "UPGRADE",
      why: "EXPLICIT_SINGLE_UPGRADE",
    }),
    "ECONOMY",
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "MerchantFishingController",
      action: "SMART_MOVE",
      why: "FISHING_TRAVEL_TO_ZONE",
    }),
    "BACKGROUND",
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "MerchantSkillController",
      action: "SKILL",
      why: "CONFIGURED_CLASS_SKILL_READY",
      metadata: { skill: "mcourage" },
    }),
    null,
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "MerchantMerritController",
      action: "MERRIT_STATUS_REQUEST",
      why: "MERRIT_STATUS_REFRESH",
    }),
    null,
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "MerchantFishingController",
      action: "EQUIP",
      why: "FISHING_RESTORE_ORIGINAL_MAINHAND",
    }),
    null,
  );
  assert.equal(
    economyArbiterLaneForIntent({
      module: "CombatController",
      action: "ATTACK",
      why: "TARGET_READY",
    }),
    null,
  );
});

test("Economy Arbiter enforcement is opt-in and allows the selected READY lane", () => {
  const disabled = makeController({
    signals: {
      MERRIT: active("MERRIT_READY"),
      ECONOMY: active("ECONOMY_READY"),
    },
  });
  const compatibility = disabled.controller.authorize("ECONOMY");
  assert.equal(compatibility.enforced, false);
  assert.equal(compatibility.allowed, true);

  const enabled = makeController({
    config: {
      economyArbiter: {
        enforcementEnabled: true,
      },
    },
    signals: {
      MERRIT: active("MERRIT_READY"),
      ECONOMY: active("ECONOMY_READY"),
    },
  });

  const lower = enabled.controller.authorize("ECONOMY");
  assert.equal(lower.enforced, true);
  assert.equal(lower.allowed, false);
  assert.equal(lower.selectedLane, "MERRIT");
  assert.equal(lower.reason, "ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED");

  const selected = enabled.controller.authorize("MERRIT");
  assert.equal(selected.enforced, true);
  assert.equal(selected.allowed, true);
  assert.equal(selected.reason, "ECONOMY_ARBITER_LANE_AUTHORIZED");
});

test("Economy Arbiter enforcement fails closed for UNKNOWN and inactive Prebuff", () => {
  const unknown = makeController({
    config: {
      economyArbiter: {
        enforcementEnabled: true,
      },
    },
    signals: {
      CRITICAL_FARMER_LOGISTICS: active("LOGISTICS_OUTCOME_UNCERTAIN", {
        unknown: true,
      }),
      BACKGROUND: active("BACKGROUND_READY"),
    },
  });

  const background = unknown.controller.authorize("BACKGROUND");
  assert.equal(background.allowed, false);
  assert.equal(background.state, "UNKNOWN");
  assert.equal(background.reason, "ECONOMY_ARBITER_UNKNOWN_BLOCK");

  const prebuff = makeController({
    config: {
      economyArbiter: {
        enforcementEnabled: true,
      },
    },
    signals: {
      ECONOMY: active("ECONOMY_READY"),
    },
  }).controller.authorize("ECONOMY_PREBUFF");

  assert.equal(prebuff.allowed, false);
  assert.equal(prebuff.selectedLane, "ECONOMY");
});

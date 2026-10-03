"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prettier = require("prettier");
const test = require("node:test");
const { loadTypeScriptModule } = require("./load_typescript_module");

function loadController() {
  return loadTypeScriptModule(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "risk-policy-controller.lib.ts",
    ),
  ).RiskPolicyController;
}

function estimate(overrides = {}) {
  return {
    kind: "UPGRADE",
    name: "sword",
    currentLevel: 0,
    targetLevel: 1,
    itemSlots: [3],
    scrollName: "scroll0",
    scrollSlot: 4,
    probabilityGrade: 0,
    itemGrade: 0,
    scrollGrade: 0,
    successProbability: 0.8,
    currentItemValueGold: 1000,
    successItemValueGold: 2000,
    failureOutcomeValueGold: 0,
    scrollReplacementCostGold: 100,
    inputValueGold: 1100,
    expectedOutcomeValueGold: 1600,
    expectedDeltaGold: 500,
    breakEvenProbability: 0.55,
    decision: "POSITIVE_EV",
    reason: "EXPECTED_VALUE_UPGRADE_BASE_MODEL_READY",
    ...overrides,
  };
}

function expectedValueStatus(estimates = []) {
  const unknown = estimates.filter(
    (entry) => entry.decision === "UNKNOWN",
  ).length;
  const evaluated = estimates.length - unknown;
  let state = "READY";
  let reason = "EXPECTED_VALUE_READY";
  if (estimates.length === 0) {
    state = "EMPTY";
    reason = "EXPECTED_VALUE_NO_CANDIDATES";
  } else if (unknown > 0 && evaluated > 0) {
    state = "PARTIAL";
    reason = "EXPECTED_VALUE_PARTIAL";
  } else if (unknown > 0) {
    state = "EMPTY";
    reason = "EXPECTED_VALUE_MODEL_INPUT_UNKNOWN";
  }

  return {
    timestamp: 1000,
    enabled: true,
    state,
    reason,
    model: {
      valueModel: "ADVENTURE_LAND_INTRINSIC_GOLD_VALUE",
      probabilityModel: "OFFICIAL_BASE_NO_DYNAMIC_GRACE_NO_OFFERING",
      sourceRepository: "kaansoral/adventureland",
      sourceCommit: "f927df37da777eb7f048fd9209c039653a3406bd",
      marketPricesIncluded: false,
      dynamicGraceIncluded: false,
      offeringsIncluded: false,
    },
    estimates,
    summary: {
      upgradeCandidates: estimates.filter((entry) => entry.kind === "UPGRADE")
        .length,
      compoundCandidates: estimates.filter(
        (entry) => entry.kind === "COMPOUND",
      ).length,
      evaluated,
      positive: estimates.filter(
        (entry) => entry.decision === "POSITIVE_EV",
      ).length,
      negative: estimates.filter(
        (entry) => entry.decision === "NEGATIVE_EV",
      ).length,
      breakEven: estimates.filter(
        (entry) => entry.decision === "BREAK_EVEN",
      ).length,
      unknown,
      bestKind: null,
      bestName: null,
      bestExpectedDeltaGold: null,
    },
  };
}

function makeController({
  estimates = [],
  config = {},
  events = [],
} = {}) {
  const RiskPolicyController = loadController();
  let now = 1000;
  let currentEstimates = estimates;
  const controller = new RiskPolicyController(
    {
      status: () => expectedValueStatus(currentEstimates),
    },
    {
      now: () => now,
      config: () => config,
      onEvent: (event) => events.push(event),
    },
  );
  return {
    controller,
    events,
    setNow(value) {
      now = value;
    },
    setEstimates(value) {
      currentEstimates = value;
    },
  };
}

test("Risk Policy allows known non-negative EV by default", () => {
  const setup = makeController({
    estimates: [estimate()],
  });

  const status = setup.controller.tick();
  const decision = status.decisions[0];

  assert.equal(status.state, "READY");
  assert.equal(status.reason, "RISK_POLICY_CANDIDATE_ALLOWED");
  assert.equal(decision.decision, "ALLOW");
  assert.equal(decision.reason, "RISK_POLICY_ALLOWED");
  assert.equal(decision.failureLossGold, 1100);
  assert.equal(status.summary.allowed, 1);
  assert.equal(status.summary.blocked, 0);
  assert.equal(status.summary.unknown, 0);
  assert.equal(status.selected.name, "sword");
  assert.equal(status.policy.minExpectedDeltaGold, 0);
  assert.equal(status.policy.unknownAlwaysBlocked, true);
});

test("Risk Policy blocks negative EV by default", () => {
  const setup = makeController({
    estimates: [
      estimate({
        expectedOutcomeValueGold: 900,
        expectedDeltaGold: -200,
        decision: "NEGATIVE_EV",
      }),
    ],
  });

  const status = setup.controller.tick();
  const decision = status.decisions[0];

  assert.equal(status.state, "BLOCKED");
  assert.equal(status.reason, "RISK_POLICY_ALL_CANDIDATES_BLOCKED");
  assert.equal(decision.decision, "BLOCK");
  assert.equal(decision.reason, "RISK_POLICY_EXPECTED_DELTA_BELOW_MINIMUM");
  assert.equal(status.selected, null);
});

test("Risk Policy never allows UNKNOWN Expected Value", () => {
  const setup = makeController({
    estimates: [
      estimate({
        successProbability: null,
        expectedOutcomeValueGold: null,
        expectedDeltaGold: null,
        breakEvenProbability: null,
        decision: "UNKNOWN",
        reason: "EXPECTED_VALUE_UPGRADE_MODEL_INPUT_UNKNOWN",
      }),
    ],
  });

  const status = setup.controller.tick();
  const decision = status.decisions[0];

  assert.equal(status.state, "PARTIAL");
  assert.equal(status.reason, "RISK_POLICY_PARTIAL_UNKNOWN");
  assert.equal(decision.decision, "UNKNOWN");
  assert.equal(decision.reason, "RISK_POLICY_EXPECTED_VALUE_UNKNOWN");
  assert.equal(status.summary.unknown, 1);
  assert.equal(status.summary.allowed, 0);
  assert.equal(status.policy.unknownAlwaysBlocked, true);
});

test("Risk Policy applies configured probability and value limits", () => {
  const setup = makeController({
    estimates: [
      estimate({
        name: "lowprob",
        successProbability: 0.4,
      }),
      estimate({
        name: "expensive",
        inputValueGold: 5000,
        failureOutcomeValueGold: 4500,
      }),
      estimate({
        name: "downside",
        inputValueGold: 2000,
        failureOutcomeValueGold: 0,
      }),
    ],
    config: {
      riskPolicy: {
        minSuccessProbability: 0.5,
        maxInputValueGold: 3000,
        maxFailureLossGold: 1500,
      },
    },
  });

  const status = setup.controller.tick();
  const byName = new Map(
    status.decisions.map((decision) => [decision.name, decision]),
  );

  assert.equal(byName.get("lowprob").decision, "BLOCK");
  assert.equal(
    byName.get("lowprob").reason,
    "RISK_POLICY_SUCCESS_PROBABILITY_BELOW_MINIMUM",
  );
  assert.equal(byName.get("expensive").decision, "BLOCK");
  assert.equal(
    byName.get("expensive").reason,
    "RISK_POLICY_INPUT_VALUE_LIMIT_EXCEEDED",
  );
  assert.equal(byName.get("downside").decision, "BLOCK");
  assert.equal(
    byName.get("downside").reason,
    "RISK_POLICY_FAILURE_LOSS_LIMIT_EXCEEDED",
  );
  assert.equal(status.state, "BLOCKED");
});

test("Risk Policy can restrict mutation kinds", () => {
  const setup = makeController({
    estimates: [
      estimate(),
      estimate({
        kind: "COMPOUND",
        name: "ring",
        itemSlots: [5, 6, 7],
      }),
    ],
    config: {
      riskPolicy: {
        allowedKinds: ["UPGRADE"],
      },
    },
  });

  const status = setup.controller.tick();
  const compound = status.decisions.find(
    (decision) => decision.kind === "COMPOUND",
  );

  assert.equal(status.summary.upgradeAllowed, 1);
  assert.equal(status.summary.compoundAllowed, 0);
  assert.equal(compound.decision, "BLOCK");
  assert.equal(compound.reason, "RISK_POLICY_KIND_NOT_ALLOWED");
});

test("Risk Policy selects the best allowed EV candidate deterministically", () => {
  const setup = makeController({
    estimates: [
      estimate({
        name: "first",
        expectedDeltaGold: 200,
      }),
      estimate({
        kind: "COMPOUND",
        name: "best",
        itemSlots: [5, 6, 7],
        expectedDeltaGold: 800,
        successProbability: 0.6,
      }),
      estimate({
        name: "second",
        expectedDeltaGold: 500,
      }),
    ],
  });

  const status = setup.controller.tick();

  assert.equal(status.state, "READY");
  assert.equal(status.summary.allowed, 3);
  assert.equal(status.selected.kind, "COMPOUND");
  assert.equal(status.selected.name, "best");
  assert.equal(status.summary.selectedExpectedDeltaGold, 800);
});

test("Risk Policy supports disabling and event de-duplication", () => {
  const events = [];
  const setup = makeController({
    config: {
      riskPolicy: {
        enabled: false,
      },
    },
    events,
  });

  const first = setup.controller.tick();
  setup.setNow(2000);
  const second = setup.controller.tick();

  assert.equal(first.state, "DISABLED");
  assert.equal(first.reason, "RISK_POLICY_DISABLED");
  assert.equal(second.state, "DISABLED");
  assert.equal(events.length, 1);
});

// PRETTIER_PROBE_START
test("temporary Prettier probe", async () => {
  const source = fs.readFileSync(__filename, "utf8");
  const cleaned = source
    .replace('const fs = require("node:fs");\n', "")
    .replace('const prettier = require("prettier");\n', "")
    .replace(
      /\/\/ PRETTIER_PROBE_START[\s\S]*?\/\/ PRETTIER_PROBE_END\n?/,
      "",
    );
  const formatted = await prettier.format(cleaned, { filepath: __filename });
  console.log("PRETTIER_FORMATTED_START");
  console.log(formatted);
  console.log("PRETTIER_FORMATTED_END");
  assert.ok(formatted.length > 0);
});
// PRETTIER_PROBE_END

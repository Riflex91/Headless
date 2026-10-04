"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("bot main entrypoint stays role-neutral and mutation-free", () => {
  const main = fs.readFileSync(
    path.join(__dirname, "..", "TYPECODE", "bot", "main.ts"),
    "utf8",
  );
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const source = `${main}\n${kernel}`;

  assert.match(main, /bootRuntime/);

  for (const forbidden of [
    /\battack\s*\(/,
    /\bsmart_move\s*\(/,
    /\bbuy\s*\(/,
    /\bsell\s*\(/,
    /\bsend_item\s*\(/,
    /\bsend_gold\s*\(/,
    /\bupgrade\s*\(/,
    /\bcompound\s*\(/,
    /\bexchange\s*\(/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("runtime feature code cannot call Adventure Land mutations directly", () => {
  const botRoot = path.join(__dirname, "..", "TYPECODE", "bot");
  const mutationBoundary = path.join(botRoot, "core", "action-boundary.lib.ts");
  const mutationCalls = [
    "move",
    "smart_move",
    "attack",
    "use_skill",
    "loot",
    "buy",
    "sell",
    "send_item",
    "send_gold",
    "bank_store",
    "bank_retrieve",
    "bank_deposit",
    "bank_withdraw",
    "equip",
    "unequip",
    "upgrade",
    "compound",
    "exchange",
    "craft",
    "wishlist",
    "send_party_invite",
    "send_party_request",
    "accept_party_invite",
    "accept_party_request",
    "leave_party",
    "respawn",
  ];

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".ts") || fullPath === mutationBoundary) {
        continue;
      }

      const source = fs.readFileSync(fullPath, "utf8");
      for (const mutation of mutationCalls) {
        const directCall = new RegExp(`(?<![\\w.])${mutation}\\s*\\(`);
        assert.doesNotMatch(
          source,
          directCall,
          `${path.relative(
            botRoot,
            fullPath,
          )} must route ${mutation} through ActionBoundary`,
        );
      }

      assert.doesNotMatch(
        source,
        /["']sbuy["']/,
        `${path.relative(
          botRoot,
          fullPath,
        )} must route Ponty sbuy through ActionBoundary`,
      );

      assert.doesNotMatch(
        source,
        /\bstop\s*\(\s*["']move["']\s*\)/,
        `${path.relative(
          botRoot,
          fullPath,
        )} must route movement cancellation through ActionBoundary`,
      );
    }
  };

  visit(botRoot);
});

test("webpack keeps shared bot libraries out of direct entrypoints", () => {
  const webpackConfig = fs.readFileSync(
    path.join(__dirname, "..", "webpack.config.js"),
    "utf8",
  );

  assert.match(webpackConfig, /TYPECODE\/\*\*\/\*\.ts/);
  assert.match(webpackConfig, /ignore:\s*"\*\*\/\*\.lib\.ts"/);
});

test("runtime kernel emits periodic health without gameplay work", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /RUNTIME_STATUS/);
  assert.match(kernel, /PERIODIC_RUNTIME_HEALTH/);
  assert.match(kernel, /runtimeState/);
  assert.match(kernel, /codeRevision/);
  assert.match(kernel, /configRevision/);
  assert.match(kernel, /sourceRevision/);
  assert.match(kernel, /emergencyStop/);
  assert.match(kernel, /actionLedger/);
  assert.match(kernel, /recentActions/);
  assert.match(kernel, /schedulerJobs/);
  assert.match(kernel, /gameAdapterReads/);
  assert.match(kernel, /actionBoundaryMutations/);
  assert.match(kernel, /movement/);
  assert.match(kernel, /classSkills/);
  assert.match(kernel, /groupCombat/);
  assert.match(kernel, /GROUP_COMBAT_JOB_ID/);
  assert.match(kernel, /CLASS_SKILL_JOB_ID/);
  assert.match(kernel, /MOVEMENT_SETTLEMENT_JOB_ID/);
});

test("CharacterThread exposes supervisor-assigned revisions", () => {
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.match(thread, /extensions\.code_revision/);
  assert.match(thread, /extensions\.config_revision/);
  assert.match(thread, /extensions\.source_revision/);
});

test("combat live E2E is wired through runtime and character IPC", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.match(kernel, /runCombatLiveTest/);
  assert.match(kernel, /CombatLiveTestRunner/);
  assert.match(kernel, /runBankTravelLiveTest/);
  assert.match(kernel, /BankTravelLiveTestRunner/);
  assert.match(kernel, /runBankGoldLiveTest/);
  assert.match(kernel, /BankGoldLiveTestRunner/);
  assert.match(kernel, /runUpgradeLiveTest/);
  assert.match(kernel, /UpgradeLiveTestRunner/);
  assert.match(kernel, /runNpcTradingLiveTest/);
  assert.match(kernel, /NpcTradingLiveTestRunner/);
  assert.match(kernel, /runMarketTradingLiveTest/);
  assert.match(kernel, /MarketTradingLiveTestRunner/);
  assert.match(kernel, /runClassSkillLiveTest/);
  assert.match(kernel, /ClassSkillLiveTestRunner/);
  assert.match(kernel, /runGroupLiveTest/);
  assert.match(kernel, /GroupLiveTestRunner/);
  assert.match(thread, /combat_live_test/);
  assert.match(thread, /combat_live_test_result/);
  assert.match(thread, /bank_travel_live_test/);
  assert.match(thread, /bank_travel_live_test_result/);
  assert.match(thread, /bank_gold_live_test/);
  assert.match(thread, /bank_gold_live_test_result/);
  assert.match(thread, /upgrade_live_test/);
  assert.match(thread, /upgrade_live_test_result/);
  assert.match(thread, /npc_trading_live_test/);
  assert.match(thread, /npc_trading_live_test_result/);
  assert.match(thread, /market_trading_live_test/);
  assert.match(thread, /market_trading_live_test_result/);
  assert.match(thread, /class_skill_live_test/);
  assert.match(thread, /class_skill_live_test_result/);
  assert.match(thread, /group_live_test/);
  assert.match(thread, /group_live_test_result/);
});

test("account Gear Reservation sync stays classification-only", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const inventory = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "inventory-intelligence-controller.lib.ts",
    ),
    "utf8",
  );
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );

  assert.match(kernel, /setAccountGearReservedSlots/);
  assert.match(inventory, /setDynamicReservedSlots/);
  assert.match(inventory, /protections\.push\("RESERVED"\)/);
  assert.match(thread, /account_gear_reservations/);
  assert.match(thread, /account_gear_reservations_applied/);

  const runnerReturn = thread.indexOf("return runner_context;");
  const reservationCase = thread.indexOf('case "account_gear_reservations"');
  assert.ok(reservationCase >= 0);
  assert.ok(runnerReturn > reservationCase);
  assert.equal(
    thread.indexOf('case "account_gear_reservations"', runnerReturn),
    -1,
  );
  assert.doesNotMatch(kernel, /\bsend_item\s*\(/);
  assert.doesNotMatch(kernel, /\bequip\s*\(/);
  assert.doesNotMatch(kernel, /\bupgrade\s*\(/);
});

test("Upgrade scheduler plans only and mutation stays explicit one-shot", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "upgrade-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /UPGRADE_JOB_ID/);
  assert.match(kernel, /executeUpgradeNext/);
  assert.match(kernel, /this\.upgrade\.executeNext\(\)/);
  assert.match(controller, /executionMode: "EXPLICIT_ONE_SHOT"/);
  assert.match(controller, /UPGRADE_UNKNOWN_HOLD_ACTIVE/);

  const schedulerStart = kernel.indexOf("id: UPGRADE_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: FARM_INTELLIGENCE_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.upgrade\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /executeNext/);
});

test("Compound scheduler plans only and mutation stays explicit one-shot", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "compound-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /COMPOUND_JOB_ID/);
  assert.match(kernel, /executeCompoundNext/);
  assert.match(kernel, /this\.compound\.executeNext\(\)/);
  assert.match(controller, /executionMode: "EXPLICIT_ONE_SHOT"/);
  assert.match(controller, /COMPOUND_UNKNOWN_HOLD_ACTIVE/);

  const schedulerStart = kernel.indexOf("id: COMPOUND_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: FARM_INTELLIGENCE_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.compound\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /executeNext/);
});

test("Exchange scheduler plans only and mutation stays explicit one-shot", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "exchange-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /EXCHANGE_JOB_ID/);
  assert.match(kernel, /executeExchangeNext/);
  assert.match(kernel, /this\.exchange\.executeNext\(\)/);
  assert.match(controller, /executionMode: "EXPLICIT_ONE_SHOT"/);
  assert.match(controller, /EXCHANGE_UNKNOWN_HOLD_ACTIVE/);

  const schedulerStart = kernel.indexOf("id: EXCHANGE_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: FARM_INTELLIGENCE_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.exchange\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /executeNext/);
});

test("Craft scheduler plans only and mutation stays explicit one-shot", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "craft-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /CRAFT_JOB_ID/);
  assert.match(kernel, /executeCraftNext/);
  assert.match(kernel, /this\.craft\.executeNext\(\)/);
  assert.match(controller, /executionMode: "EXPLICIT_ONE_SHOT"/);
  assert.match(controller, /CRAFT_UNKNOWN_HOLD_ACTIVE/);
  assert.match(controller, /CRAFT_POLICY_NO_ALLOWED_RECIPES/);

  const schedulerStart = kernel.indexOf("id: CRAFT_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: FARM_INTELLIGENCE_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.craft\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /executeNext/);
});

test("Expected Value runtime remains read-only and exposes scheduler status", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "expected-value-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /EXPECTED_VALUE_JOB_ID/);
  assert.match(kernel, /expectedValue: this\.expectedValue\.status\(\)/);
  assert.match(kernel, /this\.expectedValue\.tick\(\)/);

  const schedulerStart = kernel.indexOf("id: EXPECTED_VALUE_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: FARM_INTELLIGENCE_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.expectedValue\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /executeNext/);

  assert.doesNotMatch(controller, /this\.actions/);
  assert.doesNotMatch(controller, /executeNext/);
  assert.doesNotMatch(controller, /\.upgrade\s*\(/);
  assert.doesNotMatch(controller, /\.compound\s*\(/);
  assert.match(controller, /OFFICIAL_BASE_NO_DYNAMIC_GRACE_NO_OFFERING/);
});

test("Risk Policy runtime remains read-only and blocks unknown EV", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "risk-policy-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /RISK_POLICY_JOB_ID/);
  assert.match(kernel, /riskPolicy: this\.riskPolicy\.status\(\)/);
  assert.match(kernel, /this\.riskPolicy\.tick\(\)/);

  const schedulerStart = kernel.indexOf("id: RISK_POLICY_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: FARM_INTELLIGENCE_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.riskPolicy\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /executeNext/);

  assert.doesNotMatch(controller, /this\.actions/);
  assert.doesNotMatch(controller, /executeNext/);
  assert.match(controller, /RISK_POLICY_EXPECTED_VALUE_UNKNOWN/);
  assert.match(controller, /unknownAlwaysBlocked: true/);
});

test("Economy Prebuff coupled live runner is explicit and single-mutation scoped", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const runner = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-prebuff-execution-live-test.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /runEconomyPrebuffExecutionLiveTest/);
  assert.match(kernel, /EconomyPrebuffExecutionLiveTestRunner/);
  assert.match(kernel, /maxValueMutations: preflightOnly \? 0 : 1/);
  assert.match(kernel, /allowedSlots: expectedSlots/);
  assert.match(kernel, /maxLevel: level \+ 1/);
  assert.match(kernel, /this\.economyPrebuff\.setConfigOverride/);
  assert.match(kernel, /massproductionpp/);
  assert.match(kernel, /massproduction/);
  assert.match(kernel, /this\.economyPrebuff\.clearConfigOverride/);
  assert.match(kernel, /blindRetryAllowed: false/);
  assert.match(kernel, /scheduler\.unregister\(MERCHANT_AUTONOMY_JOB_ID\)/);
  assert.match(kernel, /scheduler\.unregister\(CLASS_SKILL_JOB_ID\)/);
  assert.match(kernel, /scheduler\.unregister\(COMBAT_JOB_ID\)/);
  assert.match(kernel, /this\.economyPrebuffExecutionRunning = true/);
  assert.match(kernel, /this\.economyPrebuffExecutionRunning = false/);

  assert.match(runner, /expectedCandidateMatches/);
  assert.match(runner, /ECONOMY_PREBUFF_EXECUTION_LIVE_PREFLIGHT_BLOCKED/);
  assert.match(runner, /ECONOMY_PREBUFF_EXECUTION_LIVE_UNKNOWN_NO_RETRY/);
  assert.match(runner, /inventoryMutationObserved/);
  assert.match(runner, /maxValueMutations: 1/);
  assert.match(runner, /blindRetryAllowed: false/);
  assert.doesNotMatch(runner, /upgrade\.executeNext/);
  assert.doesNotMatch(runner, /compound\.executeNext/);
  assert.doesNotMatch(runner, /useSkill/);
});

test("Economy Prebuff coupled execution is explicit, guarded, and one-shot", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const executor = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-prebuff-execution-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /EconomyPrebuffExecutionController/);
  assert.match(kernel, /executeEconomyPrebuffNext/);
  assert.match(kernel, /economyPrebuffExecutionRunning/);
  assert.match(kernel, /prebuffExecution\.activeLane === "ECONOMY_PREBUFF"/);
  assert.match(kernel, /prebuffExecution\.activeLane === "ECONOMY"/);
  assert.match(
    kernel,
    /economyPrebuffExecution: this\.economyPrebuffExecution\.status\(\)/,
  );
  assert.match(kernel, /this\.economyPrebuffExecution\.executeNext\(\)/);

  assert.match(executor, /arbiterEnforcementRequired: true/);
  assert.match(executor, /prebuffMustConfirmBeforeEconomy: true/);
  assert.match(executor, /revalidateAfterPrebuff: true/);
  assert.match(executor, /maxValueMutations: 1/);
  assert.match(executor, /blindRetryAllowed: false/);
  assert.match(executor, /supportedKinds: \["UPGRADE", "COMPOUND"\]/);
  assert.match(executor, /exchangeSupported: false/);

  const skillIndex = executor.indexOf("await this.actions.useSkill");
  const revalidateIndex = executor.indexOf(
    "ECONOMY_PREBUFF_REVALIDATION_FAILED",
  );
  const upgradeIndex = executor.indexOf("await this.upgrade.executeNext()");
  const compoundIndex = executor.indexOf("await this.compound.executeNext()");
  assert.ok(skillIndex >= 0);
  assert.ok(revalidateIndex > skillIndex);
  assert.ok(upgradeIndex > revalidateIndex);
  assert.ok(compoundIndex > revalidateIndex);
});

test("Economy Prebuff runtime plans read-only before the Arbiter", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-prebuff-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /ECONOMY_PREBUFF_JOB_ID/);
  assert.match(kernel, /economyPrebuff: this\.economyPrebuff\.status\(\)/);
  assert.match(kernel, /this\.economyPrebuff\.tick\(\)/);
  assert.match(kernel, /priority: 77/);
  assert.match(kernel, /active: prebuffExecutionActive/);
  assert.match(kernel, /ECONOMY_PREBUFF_READY_EXECUTION_DEFERRED/);

  const schedulerStart = kernel.indexOf("id: ECONOMY_PREBUFF_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: ECONOMY_ARBITER_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.economyPrebuff\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /execute/);

  assert.doesNotMatch(controller, /ActionBoundary/);
  assert.doesNotMatch(controller, /useSkill/);
  assert.doesNotMatch(controller, /executeNext/);
  assert.match(controller, /massproductionpp/);
  assert.match(controller, /massproduction/);
  assert.match(controller, /massexchangepp/);
  assert.match(controller, /massexchange/);
  assert.match(controller, /buffLifetimeMs: 10000/);
  assert.match(controller, /exchangeDemandSupported: false/);
  assert.match(controller, /arbiterLaneActivationEnabled: false/);
  assert.match(controller, /executionEnabled: false/);
  assert.match(controller, /valueMutationForced: false/);
});

test("Economy Arbiter runtime is read-only and projects fixed lane priority", () => {
  const kernel = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "runtime-kernel.lib.ts",
    ),
    "utf8",
  );
  const controller = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "economy-arbiter-controller.lib.ts",
    ),
    "utf8",
  );

  assert.match(kernel, /ECONOMY_ARBITER_JOB_ID/);
  assert.match(kernel, /economyArbiter: this\.economyArbiter\.status\(\)/);
  assert.match(kernel, /this\.economyArbiter\.tick\(\)/);
  assert.match(
    kernel,
    /authorizeIntent: \(intent\) => this\.authorizeEconomyIntent\(intent\)/,
  );
  assert.match(kernel, /this\.economyArbiter\.authorize\(lane\)/);
  assert.match(kernel, /economyArbiterLaneForIntent/);
  assert.match(kernel, /priority: 72/);
  assert.match(kernel, /ECONOMY_PREBUFF_READY_EXECUTION_DEFERRED/);
  assert.match(kernel, /arbiterLaneActivationEnabled/);
  assert.match(kernel, /LOGISTICS_OUTCOME_UNCERTAIN/);

  const schedulerStart = kernel.indexOf("id: ECONOMY_ARBITER_JOB_ID");
  const schedulerEnd = kernel.indexOf(
    "id: FARM_INTELLIGENCE_JOB_ID",
    schedulerStart,
  );
  assert.ok(schedulerStart >= 0);
  assert.ok(schedulerEnd > schedulerStart);
  const schedulerBlock = kernel.slice(schedulerStart, schedulerEnd);
  assert.match(schedulerBlock, /this\.economyArbiter\.tick\(\)/);
  assert.doesNotMatch(schedulerBlock, /execute/);

  assert.doesNotMatch(controller, /ActionBoundary/);
  assert.doesNotMatch(controller, /executeNext/);
  assert.match(controller, /"SAFETY"/);
  assert.match(controller, /"MERRIT"/);
  assert.match(controller, /"CRITICAL_FARMER_LOGISTICS"/);
  assert.match(controller, /"ECONOMY_PREBUFF"/);
  assert.match(controller, /"ECONOMY"/);
  assert.match(controller, /"MERCHANT_STAND"/);
  assert.match(controller, /"BACKGROUND"/);
  assert.match(controller, /unknownBlocksLowerPriority: true/);
  assert.match(controller, /enforcementEnabled/);
  assert.match(controller, /ECONOMY_ARBITER_HIGHER_PRIORITY_LANE_SELECTED/);
  assert.match(controller, /MERRIT_STATUS_REQUEST/);
  assert.match(controller, /why\.includes\("RESTORE"\)/);
  assert.match(controller, /executionEnabled: false/);
  assert.match(controller, /valueMutationForced: false/);
});

test("Upgrade live IPC stays in runner context and exposes one attempt only", () => {
  const thread = fs.readFileSync(
    path.join(__dirname, "..", "src", "CharacterThread.js"),
    "utf8",
  );
  const liveTest = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "upgrade-live-test.lib.ts",
    ),
    "utf8",
  );

  const runnerReturn = thread.indexOf("return runner_context;");
  const upgradeCase = thread.indexOf('case "upgrade_live_test"');
  assert.ok(upgradeCase >= 0);
  assert.ok(runnerReturn > upgradeCase);
  assert.equal(thread.indexOf('case "upgrade_live_test"', runnerReturn), -1);

  assert.match(liveTest, /executionAttempts \+= 1/);
  assert.match(liveTest, /UPGRADE_LIVE_OUTCOME_UNKNOWN_NO_RETRY/);
  assert.match(liveTest, /single-upgrade-attempt-only/);
  assert.doesNotMatch(liveTest, /\bcompound\s*\(/);
  assert.doesNotMatch(liveTest, /\bexchange\s*\(/);
  assert.doesNotMatch(liveTest, /\bcraft\s*\(/);
});

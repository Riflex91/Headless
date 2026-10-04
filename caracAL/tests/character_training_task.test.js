"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

function action(status = "CONFIRMED") {
  return {
    id: "move-1",
    correlationId: "training-1",
    module: "CharacterTrainingTask",
    action: "SMART_MOVE",
    why: "CHARACTER_TRAINING_FIND_MONSTER",
    createdAt: 1,
    status,
  };
}

function setup({
  level = 10,
  xp = 100,
  navigationStatus = "CONFIRMED",
  combatReason = "TARGET_SELECTED",
  progressOnSleep = "XP",
} = {}) {
  let now = 1000;
  const calls = [];
  const state = {
    character: {
      name: "My_Mage",
      ctype: "mage",
      map: "main",
      x: 0,
      y: 0,
      hp: 500,
      maxHp: 500,
      mp: 500,
      maxMp: 500,
      level,
      xp,
      attack: 50,
      frequency: 1,
      armor: 0,
      resistance: 0,
      range: 120,
      gold: 0,
      target: null,
      rip: false,
      moving: false,
    },
  };

  let override = null;
  let sleeps = 0;
  const combat = {
    status() {
      calls.push(["combatStatus"]);
      return {
        state: combatReason.includes("UNKNOWN") ? "BLOCKED" : "TARGETING",
        reason: combatReason,
        target: {
          id: "goo-1",
          name: "Goo",
          mtype: "goo",
          hp: 100,
          maxHp: 100,
          distance: 20,
          attackRange: 120,
          inRange: true,
        },
      };
    },
    setConfigOverride(value) {
      override = value;
      calls.push(["combatOverride", value]);
    },
    clearConfigOverride() {
      override = null;
      calls.push(["combatOverride", null]);
    },
  };

  const movement = {
    async smart(request) {
      calls.push(["smart", request.destination]);
      return action(navigationStatus);
    },
  };

  const { CharacterTrainingTaskRunner } = core(
    "character-training-task.lib.ts",
  );
  const runner = new CharacterTrainingTaskRunner({
    game: {
      character: () => ({ ...state.character }),
    },
    combat,
    movement,
    now: () => now,
    sleep: async (ms) => {
      sleeps += 1;
      now += ms;
      if (sleeps === 1 && progressOnSleep === "XP") state.character.xp += 5;
      if (sleeps === 1 && progressOnSleep === "LEVEL") {
        state.character.level += 1;
        state.character.xp = 0;
      }
    },
  });

  return {
    runner,
    state,
    calls,
    get override() {
      return override;
    },
  };
}

function options(overrides = {}) {
  return {
    requestId: "training-1",
    targetLevel: 12,
    monsterType: "goo",
    timeoutMs: 10000,
    pollMs: 50,
    ...overrides,
  };
}

test("training target already reached completes without navigation or combat override", async () => {
  const s = setup({ level: 12, progressOnSleep: null });

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CHARACTER_TRAINING_TARGET_ALREADY_REACHED");
  assert.equal(result.progress.targetReached, true);
  assert.equal(result.evidence.schedulerDrivenCombat, true);
  assert.equal(
    s.calls.some(([name]) => name === "smart"),
    false,
  );
  assert.equal(
    s.calls.some(([name]) => name === "combatOverride"),
    false,
  );
});

test("training uses scoped exact-monster Combat override and confirms XP progress", async () => {
  const s = setup();

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CHARACTER_TRAINING_PROGRESS_CONFIRMED");
  assert.equal(result.progress.startLevel, 10);
  assert.equal(result.progress.startXp, 100);
  assert.equal(result.progress.finalLevel, 10);
  assert.equal(result.progress.finalXp, 105);
  assert.equal(result.progress.xpIncreased, true);
  assert.equal(result.evidence.schedulerDrivenCombat, true);
  assert.equal(result.evidence.combatStatusObserved, true);
  assert.equal(result.evidence.targetMonsterObserved, true);
  assert.equal(result.evidence.navigationStatus, "CONFIRMED");
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.deepEqual(s.calls[0], [
    "combatOverride",
    {
      combat: {
        enabled: true,
        autoTarget: true,
        avoidKillSteal: true,
        targetMaxDistance: 1500,
        targetMonsterTypes: ["goo"],
        retreat: false,
      },
      potionUsage: {
        enabled: true,
        hpBelowPercent: 55,
        mpBelowPercent: 35,
        criticalHpPercent: 25,
      },
      safety: {
        autoRespawn: false,
      },
    },
  ]);
  assert.deepEqual(s.calls[1], ["smart", "goo"]);
  assert.equal(s.override, null);
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("training confirms a level-up even when XP resets", async () => {
  const s = setup({ progressOnSleep: "LEVEL" });

  const result = await s.runner.run(options({ targetLevel: 11 }));

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CHARACTER_TRAINING_TARGET_LEVEL_REACHED");
  assert.equal(result.progress.levelIncreased, true);
  assert.equal(result.progress.targetReached, true);
  assert.equal(result.progress.finalLevel, 11);
  assert.equal(result.progress.finalXp, 0);
  assert.equal(s.override, null);
});

test("training treats navigation UNKNOWN as terminal and never observes combat", async () => {
  const s = setup({
    navigationStatus: "UNKNOWN",
    progressOnSleep: null,
  });

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CHARACTER_TRAINING_NAVIGATION_UNKNOWN");
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(
    s.calls.some(([name]) => name === "combatStatus"),
    false,
  );
  assert.equal(result.cleanup.combatOverrideCleared, true);
  assert.equal(s.override, null);
});

test("training stops on Combat UNKNOWN without blind retry", async () => {
  const s = setup({
    combatReason: "ATTACK_OUTCOME_UNKNOWN",
    progressOnSleep: null,
  });

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CHARACTER_TRAINING_ATTACK_OUTCOME_UNKNOWN");
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(
    s.calls.filter(([name]) => name === "combatStatus").length,
    1,
  );
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("training times out cleanly when scheduler makes no XP progress", async () => {
  const s = setup({ progressOnSleep: null });

  const result = await s.runner.run(
    options({
      timeoutMs: 10000,
      pollMs: 5000,
    }),
  );

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.reason, "CHARACTER_TRAINING_PROGRESS_TIMEOUT");
  assert.equal(result.progress.levelIncreased, false);
  assert.equal(result.progress.xpIncreased, false);
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(result.cleanup.combatOverrideCleared, true);
  assert.equal(s.override, null);
});

test("training rejects incomplete telemetry before mutation", async () => {
  const s = setup();
  s.state.character.xp = null;

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CHARACTER_TRAINING_REQUEST_INVALID");
  assert.equal(
    s.calls.some(([name]) => name === "smart"),
    false,
  );
  assert.equal(
    s.calls.some(([name]) => name === "combatOverride"),
    false,
  );
});

test("training worker and runtime retain the normal Combat scheduler without a second tick loop", () => {
  const worker = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "character-training-task.lib.ts",
    ),
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

  assert.doesNotMatch(worker, /combat\.tick\s*\(/);
  assert.doesNotMatch(worker, /setInterval\s*\(/);
  assert.doesNotMatch(worker, /while\s*\([^)]*retry/i);
  assert.match(worker, /targetMonsterTypes:\s*\[monsterType\]/);
  assert.match(worker, /schedulerDrivenCombat:\s*true/);
  assert.match(worker, /blindRetryUsed:\s*false/);

  const start = kernel.indexOf("async runCharacterTrainingTask(");
  const end = kernel.indexOf("async runMaterialGatherTask(", start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const trainingBlock = kernel.slice(start, end);

  assert.match(trainingBlock, /scheduler\.has\(COMBAT_JOB_ID\)/);
  assert.match(
    trainingBlock,
    /scheduler\.unregister\(GROUP_COMBAT_JOB_ID\)/,
  );
  assert.match(
    trainingBlock,
    /scheduler\.unregister\(CLASS_SKILL_JOB_ID\)/,
  );
  assert.doesNotMatch(
    trainingBlock,
    /scheduler\.unregister\(COMBAT_JOB_ID\)/,
  );
  assert.match(trainingBlock, /combatSchedulerRetained:\s*true/);
  assert.match(trainingBlock, /new CharacterTrainingTaskRunner/);

  const dispatchStart = kernel.indexOf("async runGoalAdapterDispatch(");
  const dispatchEnd = kernel.indexOf(
    "async runCharacterTrainingTask(",
    dispatchStart,
  );
  const dispatchBlock = kernel.slice(dispatchStart, dispatchEnd);
  assert.match(
    dispatchBlock,
    /runCharacterTrainingTask:\s*\(trainingOptions\)\s*=>/,
  );
  assert.match(dispatchBlock, /this\.runCharacterTrainingTask\(trainingOptions\)/);

  const preflightStart = kernel.indexOf("async runGoalAdapterPreflight(");
  const preflightEnd = kernel.indexOf(
    "async runGoalAdapterDispatch(",
    preflightStart,
  );
  const preflightBlock = kernel.slice(preflightStart, preflightEnd);
  assert.match(preflightBlock, /level:\s*snapshot\.level/);
  assert.match(preflightBlock, /xp:\s*snapshot\.xp/);
});

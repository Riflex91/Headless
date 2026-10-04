"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

function action(status = "CONFIRMED") {
  return {
    id: "move-gold-1",
    correlationId: "gold-1",
    module: "CharacterGoldTask",
    action: "SMART_MOVE",
    why: "CHARACTER_GOLD_FIND_MONSTER",
    createdAt: 1,
    status,
  };
}

function setup({
  gold = 1000,
  navigationStatus = "CONFIRMED",
  combatReason = "TARGET_SELECTED",
  progressOnSleep = true,
} = {}) {
  let now = 1000;
  let sleeps = 0;
  const calls = [];
  const state = {
    character: {
      name: "My_Rogue",
      ctype: "rogue",
      map: "main",
      x: 0,
      y: 0,
      hp: 500,
      maxHp: 500,
      mp: 500,
      maxMp: 500,
      level: 40,
      xp: 123,
      attack: 50,
      frequency: 1,
      armor: 0,
      resistance: 0,
      range: 40,
      gold,
      target: null,
      rip: false,
      moving: false,
    },
  };

  let override = null;
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
          attackRange: 40,
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

  const { CharacterGoldTaskRunner } = core("character-gold-task.lib.ts");
  const runner = new CharacterGoldTaskRunner({
    game: {
      character: () => ({ ...state.character }),
    },
    combat,
    movement,
    now: () => now,
    sleep: async (ms) => {
      sleeps += 1;
      now += ms;
      if (sleeps === 1 && progressOnSleep) state.character.gold += 25;
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
    requestId: "gold-1",
    goalAmount: 2000,
    scope: "ACCOUNT",
    monsterType: "goo",
    timeoutMs: 10000,
    pollMs: 50,
    ...overrides,
  };
}

test("character-scoped gold task exits without mutation when target is already reached", async () => {
  const s = setup({ gold: 2500, progressOnSleep: false });

  const result = await s.runner.run(
    options({
      scope: "CHARACTER",
      goalAmount: 2000,
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CHARACTER_GOLD_TARGET_ALREADY_REACHED");
  assert.equal(result.progress.targetReached, true);
  assert.equal(result.progress.goldIncreased, false);
  assert.equal(
    s.calls.some(([name]) => name === "smart"),
    false,
  );
  assert.equal(
    s.calls.some(([name]) => name === "combatOverride"),
    false,
  );
});

test("account-scoped gold task confirms real worker gold progress", async () => {
  const s = setup();

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CHARACTER_GOLD_PROGRESS_CONFIRMED");
  assert.equal(result.scope, "ACCOUNT");
  assert.equal(result.progress.startGold, 1000);
  assert.equal(result.progress.finalGold, 1025);
  assert.equal(result.progress.goldIncreased, true);
  assert.equal(result.progress.targetReached, false);
  assert.equal(result.evidence.schedulerDrivenCombat, true);
  assert.equal(result.evidence.combatStatusObserved, true);
  assert.equal(result.evidence.targetMonsterObserved, true);
  assert.equal(result.evidence.navigationStatus, "CONFIRMED");
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(result.cleanup.combatOverrideCleared, true);
  assert.equal(s.override, null);
});

test("character-scoped gold task confirms target reach", async () => {
  const s = setup({ gold: 1990 });

  const result = await s.runner.run(
    options({
      scope: "CHARACTER",
      goalAmount: 2000,
    }),
  );

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "CHARACTER_GOLD_TARGET_REACHED");
  assert.equal(result.progress.targetReached, true);
  assert.equal(result.progress.goldIncreased, true);
  assert.equal(result.progress.finalGold, 2015);
});

test("gold task treats navigation UNKNOWN as terminal", async () => {
  const s = setup({
    navigationStatus: "UNKNOWN",
    progressOnSleep: false,
  });

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CHARACTER_GOLD_NAVIGATION_UNKNOWN");
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(
    s.calls.some(([name]) => name === "combatStatus"),
    false,
  );
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("gold task stops on Combat UNKNOWN without retry", async () => {
  const s = setup({
    combatReason: "ATTACK_OUTCOME_UNKNOWN",
    progressOnSleep: false,
  });

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "UNKNOWN");
  assert.equal(result.reason, "CHARACTER_GOLD_ATTACK_OUTCOME_UNKNOWN");
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(s.calls.filter(([name]) => name === "combatStatus").length, 1);
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("gold task times out cleanly without progress", async () => {
  const s = setup({ progressOnSleep: false });

  const result = await s.runner.run(
    options({
      timeoutMs: 10000,
      pollMs: 5000,
    }),
  );

  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.reason, "CHARACTER_GOLD_PROGRESS_TIMEOUT");
  assert.equal(result.progress.goldIncreased, false);
  assert.equal(result.evidence.blindRetryUsed, false);
  assert.equal(result.cleanup.combatOverrideCleared, true);
});

test("gold task rejects missing runtime gold telemetry before mutation", async () => {
  const s = setup();
  s.state.character.gold = null;

  const result = await s.runner.run(options());

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "CHARACTER_GOLD_REQUEST_INVALID");
  assert.equal(
    s.calls.some(([name]) => name === "smart"),
    false,
  );
  assert.equal(
    s.calls.some(([name]) => name === "combatOverride"),
    false,
  );
});

test("gold task contains no direct Combat tick or retry loop", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "TYPECODE",
      "bot",
      "core",
      "character-gold-task.lib.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /combat\.tick\s*\(/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /trainingCombatOverride\(monsterType\)/);
  assert.match(source, /blindRetryUsed:\s*false/);
});

test("gold runtime retains Combat scheduler and wires Goal preflight/dispatch safely", () => {
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

  const start = kernel.indexOf("async runCharacterGoldTask(");
  const end = kernel.indexOf("async runCharacterTrainingTask(", start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const goldBlock = kernel.slice(start, end);

  assert.match(goldBlock, /scheduler\.has\(COMBAT_JOB_ID\)/);
  assert.match(goldBlock, /scheduler\.unregister\(GROUP_COMBAT_JOB_ID\)/);
  assert.match(goldBlock, /scheduler\.unregister\(CLASS_SKILL_JOB_ID\)/);
  assert.doesNotMatch(goldBlock, /scheduler\.unregister\(COMBAT_JOB_ID\)/);
  assert.match(goldBlock, /combatSchedulerRetained:\s*true/);
  assert.match(goldBlock, /new CharacterGoldTaskRunner/);

  const dispatchStart = kernel.indexOf("async runGoalAdapterDispatch(");
  const dispatchEnd = kernel.indexOf("async runCharacterGoldTask(", dispatchStart);
  const dispatchBlock = kernel.slice(dispatchStart, dispatchEnd);
  assert.match(
    dispatchBlock,
    /runCharacterGoldTask:\s*\(goldOptions\)\s*=>/,
  );
  assert.match(dispatchBlock, /this\.runCharacterGoldTask\(goldOptions\)/);
  assert.ok((dispatchBlock.match(/gold:\s*snapshot\.gold/g) || []).length >= 1);

  const preflightStart = kernel.indexOf("async runGoalAdapterPreflight(");
  const preflightEnd = kernel.indexOf(
    "async runGoalAdapterDispatch(",
    preflightStart,
  );
  const preflightBlock = kernel.slice(preflightStart, preflightEnd);
  assert.match(preflightBlock, /gold:\s*snapshot\.gold/);
});

test("temporary Phase 19.14 formatter probe", async () => {
  const target = path.join(__dirname, "character_gold_task.test.js");
  const source = fs.readFileSync(target, "utf8");
  const formatted = await prettier.format(source, { filepath: target });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase19-14-prettier-"));
  const temp = path.join(tempDir, path.basename(target));
  try {
    fs.writeFileSync(temp, formatted);
    let diff = "";
    try {
      childProcess.execFileSync("diff", ["-u", target, temp], {
        encoding: "utf8",
      });
    } catch (error) {
      diff = String(error.stdout || "");
    }
    console.log("PHASE19_14_PRETTIER_DIFF", path.basename(target));
    console.log(diff || "NO_DIFF");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

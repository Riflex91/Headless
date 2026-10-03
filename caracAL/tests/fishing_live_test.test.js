"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTypeScriptModule } = require("./load_typescript_module");

function core(file) {
  return loadTypeScriptModule(
    path.join(__dirname, "..", "TYPECODE", "bot", "core", file),
  );
}

function status(overrides = {}) {
  const base = {
    timestamp: 1000,
    enabled: true,
    state: "SKILL",
    reason: "TEST",
    roadmapStage: "Skill",
    character: {
      name: "My_Merchant",
      level: 30,
      map: "main",
      x: 0,
      y: 0,
      mp: 500,
      moving: false,
    },
    skill: {
      present: true,
      requiredLevel: 16,
      requiredMp: 120,
      cooldownRemainingMs: 0,
    },
    tool: {
      name: "rod",
      equipped: false,
      inventorySlot: 0,
      acquiredByController: false,
    },
    zone: {
      map: "main",
      x: -1572,
      y: 552,
      inside: false,
      source: "fisherman",
    },
    result: {
      attempted: false,
      found: null,
      response: null,
    },
    restore: {
      required: false,
      restored: false,
      originalMainhand: null,
    },
    lastAction: null,
  };
  return {
    ...base,
    ...overrides,
    character: { ...base.character, ...(overrides.character || {}) },
    skill: { ...base.skill, ...(overrides.skill || {}) },
    tool: { ...base.tool, ...(overrides.tool || {}) },
    zone: { ...base.zone, ...(overrides.zone || {}) },
    result: { ...base.result, ...(overrides.result || {}) },
    restore: { ...base.restore, ...(overrides.restore || {}) },
  };
}

function setup(sequence, cleanupStatus = null) {
  let index = 0;
  let now = 1000;
  let current = sequence[0];
  let overrideSet = false;
  let overrideCleared = false;
  const controller = {
    setConfigOverride() {
      overrideSet = true;
    },
    clearConfigOverride() {
      overrideCleared = true;
    },
    status() {
      return current;
    },
    async tick() {
      current = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      return current;
    },
    async cleanupTemporaryState() {
      return cleanupStatus
        ? {
            id: "cleanup-1",
            status: cleanupStatus,
            action: "EQUIP",
          }
        : null;
    },
  };
  const { FishingLiveTestRunner } = core("fishing-live-test.lib.ts");
  const runner = new FishingLiveTestRunner({
    fishing: controller,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return {
    runner,
    state: () => ({ index, overrideSet, overrideCleared }),
  };
}

test("Fishing live runner accepts a real found=false attempt and restored weapon", async () => {
  const s = setup([
    status({
      state: "TRAVEL",
      roadmapStage: "Travel",
    }),
    status({
      state: "EQUIP",
      roadmapStage: "Equip",
      zone: { inside: true },
      tool: { equipped: true, inventorySlot: null },
      restore: {
        required: true,
        originalMainhand: { name: "sword", level: 3 },
      },
    }),
    status({
      state: "RESULT",
      roadmapStage: "Ergebnis",
      zone: { inside: true },
      tool: { equipped: true, inventorySlot: null },
      result: {
        attempted: true,
        found: false,
        response: "fishing_none",
      },
      restore: {
        required: true,
        restored: false,
        originalMainhand: { name: "sword", level: 3 },
      },
      lastAction: {
        id: "skill-1",
        action: "SKILL",
        status: "CONFIRMED",
        why: "FISHING_EXECUTE_SKILL",
      },
    }),
    status({
      state: "RESTORE",
      roadmapStage: "alte Waffe restaurieren",
      zone: { inside: true },
      tool: { equipped: false, inventorySlot: 0 },
      result: {
        attempted: true,
        found: false,
        response: "fishing_none",
      },
      restore: {
        required: true,
        restored: true,
        originalMainhand: { name: "sword", level: 3 },
      },
    }),
    status({
      state: "COMPLETE",
      reason: "FISHING_ROADMAP_COMPLETE",
      roadmapStage: "alte Waffe restaurieren",
      zone: { inside: true },
      tool: { equipped: false, inventorySlot: 0 },
      result: {
        attempted: true,
        found: false,
        response: "fishing_none",
      },
      restore: {
        required: true,
        restored: true,
        originalMainhand: { name: "sword", level: 3 },
      },
    }),
  ]);

  const result = await s.runner.run({
    requestId: "fishing-live-test",
    timeoutMs: 30000,
    pollMs: 250,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "FISHING_LIVE_RUNTIME_CONFIRMED");
  assert.equal(result.evidence.resultObserved, true);
  assert.equal(result.evidence.resultFound, false);
  assert.equal(result.evidence.mainhandRestored, true);
  assert.equal(result.evidence.unknownOutcomeAvoided, true);
  assert.equal(result.scope.blindRetryAllowed, false);
  assert.equal(result.cleanup.autonomyOverrideCleared, true);
  assert.deepEqual(s.state(), {
    index: 5,
    overrideSet: true,
    overrideCleared: true,
  });
});

test("Fishing live runner requires tool acquisition evidence only when needed", async () => {
  const s = setup([
    status({
      state: "TOOL_ACQUIRE",
      roadmapStage: "Tool beschaffen",
      tool: {
        equipped: false,
        inventorySlot: null,
        acquiredByController: false,
      },
    }),
    status({
      state: "TOOL_ACQUIRE",
      roadmapStage: "Tool beschaffen",
      tool: {
        equipped: false,
        inventorySlot: 1,
        acquiredByController: true,
      },
    }),
    status({
      state: "RESULT",
      roadmapStage: "Ergebnis",
      zone: { inside: true },
      tool: {
        equipped: true,
        inventorySlot: null,
        acquiredByController: true,
      },
      result: {
        attempted: true,
        found: true,
        response: "fishing_success",
      },
    }),
    status({
      state: "COMPLETE",
      reason: "FISHING_ROADMAP_COMPLETE",
      roadmapStage: "alte Waffe restaurieren",
      zone: { inside: true },
      tool: {
        equipped: true,
        inventorySlot: null,
        acquiredByController: true,
      },
      result: {
        attempted: true,
        found: true,
        response: "fishing_success",
      },
      restore: {
        required: false,
        restored: true,
      },
    }),
  ]);

  const result = await s.runner.run({
    timeoutMs: 30000,
    pollMs: 250,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.evidence.toolAcquisitionRequired, true);
  assert.equal(result.evidence.toolAcquisitionObserved, true);
  assert.equal(result.evidence.resultFound, true);
});

test("Fishing live runner fails immediately on an active 48 minute cooldown", async () => {
  const s = setup([
    status({
      state: "SKILL",
      reason: "FISHING_COOLDOWN_ACTIVE",
      roadmapStage: "Skill",
      skill: { cooldownRemainingMs: 120000 },
    }),
  ]);

  const result = await s.runner.run({
    timeoutMs: 30000,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "FISHING_LIVE_COOLDOWN_ACTIVE");
  assert.equal(s.state().index, 1);
  assert.equal(result.cleanup.autonomyOverrideCleared, true);
});

test("Fishing live runner stops after UNKNOWN and does not tick again", async () => {
  const s = setup([
    status({
      state: "UNKNOWN",
      reason: "FISHING_ACTION_OUTCOME_UNKNOWN",
      roadmapStage: "Equip",
    }),
    status({
      state: "COMPLETE",
      reason: "FISHING_ROADMAP_COMPLETE",
      roadmapStage: "alte Waffe restaurieren",
    }),
  ]);

  const result = await s.runner.run({
    timeoutMs: 30000,
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "FISHING_LIVE_ACTION_OUTCOME_UNKNOWN");
  assert.equal(s.state().index, 1);
});

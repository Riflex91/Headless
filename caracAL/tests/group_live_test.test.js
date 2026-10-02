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

function makeRunner({
  role = "leader",
  initialParty = {},
  onSleep = null,
} = {}) {
  const { GroupLiveTestRunner } = coreModule("group-live-test.lib.ts");
  let now = 1000;
  let groupConfig = null;
  let lastAction = null;
  const state = {
    character: {
      name: role === "leader" ? "Leader" : "Follower",
      ctype: "ranger",
      map: "main",
      x: 0,
      y: 0,
      hp: 1000,
      maxHp: 1000,
      mp: 1000,
      maxMp: 1000,
      range: 140,
      gold: 0,
      target: null,
      rip: false,
      moving: false,
    },
    party: { ...initialParty },
  };

  const groupCombat = {
    setConfigOverride(config) {
      groupConfig = config;
    },
    clearConfigOverride() {
      groupConfig = null;
    },
    status() {
      return {
        role: role === "leader" ? "LEADER" : "FOLLOWER",
        leader: "Leader",
        partyMembers: Object.keys(state.party),
        party: { pendingAction: null },
        lastAction,
      };
    },
    async tick() {
      if (groupConfig?.groupCombat?.enabled) {
        const current = new Set(Object.keys(state.party));
        const alreadyFormed =
          current.has("Leader") && current.has("Follower");
        if (!alreadyFormed) {
          state.party = {
            Leader: { name: "Leader" },
            Follower: { name: "Follower" },
          };
          lastAction = {
            id: "party-action-1",
            status: "DISPATCHED",
            kind: role === "leader" ? "PARTY_INVITE" : "PARTY_ACCEPT_INVITE",
          };
        }
      }
      return this.status();
    },
  };
  const combat = {
    setConfigOverride() {},
    clearConfigOverride() {},
  };
  const classSkills = {
    setConfigOverride() {},
    clearConfigOverride() {},
  };
  const actions = {
    async partyLeave() {
      state.party = {};
      return { id: "leave-1", status: "CONFIRMED" };
    },
  };

  return new GroupLiveTestRunner({
    groupCombat,
    combat,
    classSkills,
    actions,
    character: () => ({ ...state.character }),
    party: () => ({ ...state.party }),
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      onSleep?.({ now, state, groupConfig });
    },
  });
}

test("group live runner forms and cleans an autonomous pair", async () => {
  const runner = makeRunner({ role: "leader" });
  const result = await runner.run({
    role: "leader",
    leader: "Leader",
    peer: "Follower",
    holdMs: 1000,
    pollIntervalMs: 50,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.reason, "GROUP_LIVE_E2E_CONFIRMED");
  assert.equal(result.party.formed, true);
  assert.equal(result.party.partyActionObserved, true);
  assert.equal(result.party.roleProjected, true);
  assert.equal(result.cleanup.initialPartyRestored, true);
  assert.equal(result.scope.combatMutationForced, false);
  assert.equal(result.scope.aoeMutationForced, false);
});

test("group live runner restores a pair that existed before the test", async () => {
  const runner = makeRunner({
    role: "follower",
    initialParty: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
  });
  const result = await runner.run({
    role: "follower",
    leader: "Leader",
    peer: "Follower",
    holdMs: 1000,
    pollIntervalMs: 50,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.preparation.initialPairFormed, true);
  assert.equal(result.preparation.dissolvedInitialPair, true);
  assert.equal(result.cleanup.initialPartyRestored, true);
});

test("group live runner refuses unrelated existing party membership", async () => {
  const runner = makeRunner({
    role: "leader",
    initialParty: {
      Leader: { name: "Leader" },
      Stranger: { name: "Stranger" },
    },
  });
  const result = await runner.run({
    role: "leader",
    leader: "Leader",
    peer: "Follower",
  });

  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "GROUP_LIVE_E2E_EXISTING_PARTY_CONFLICT");
});


test("coordinated follower does not mistake leader-created pair for original baseline", async () => {
  let leaderCleanupObserved = false;
  const runner = makeRunner({
    role: "follower",
    initialParty: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
    onSleep: ({ now, state }) => {
      if (now >= 2000 && !leaderCleanupObserved) {
        state.party = {};
        leaderCleanupObserved = true;
      }
    },
  });

  const result = await runner.run({
    role: "follower",
    leader: "Leader",
    peer: "Follower",
    baselinePairFormed: false,
    coordinatedPair: true,
    holdMs: 1000,
    pollIntervalMs: 50,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.preparation.observedInitialPairFormed, true);
  assert.equal(result.preparation.initialPairFormed, false);
  assert.equal(result.preparation.baselinePairOverrideApplied, true);
  assert.equal(result.preparation.pairLifecycleOwner, false);
  assert.equal(result.preparation.coordinatedPeerPairObserved, true);
  assert.equal(result.preparation.dissolvedInitialPair, false);
  assert.equal(result.party.partyActionObserved, false);
  assert.equal(result.cleanup.partyLeaveStatus, null);
  assert.equal(leaderCleanupObserved, true);
  assert.equal(result.cleanup.initialPartyRestored, true);
});

test("coordinated follower preserves a true shared baseline without owning lifecycle", async () => {
  const runner = makeRunner({
    role: "follower",
    initialParty: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
  });

  const result = await runner.run({
    role: "follower",
    leader: "Leader",
    peer: "Follower",
    baselinePairFormed: true,
    coordinatedPair: true,
    holdMs: 1000,
    pollIntervalMs: 50,
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.preparation.initialPairFormed, true);
  assert.equal(result.preparation.pairLifecycleOwner, false);
  assert.equal(result.preparation.dissolvedInitialPair, false);
  assert.equal(result.cleanup.initialPartyRestored, true);
});

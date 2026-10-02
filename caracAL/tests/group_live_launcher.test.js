"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  pairInitiallyFormed,
  runGroupPair,
  selectGroupPair,
  waitForGroupTestRunning,
} = require("../scripts/run_group_live_e2e");

test("group launcher selects two owned non-merchants and prefers idle pair", () => {
  const pair = selectGroupPair({
    characters: [
      {
        name: "Busy",
        ctype: "ranger",
        account_owned: true,
        connected: true,
        desired_runtime_state: "RUNNING",
      },
      {
        name: "IdleA",
        ctype: "ranger",
        account_owned: true,
        connected: false,
        desired_runtime_state: "STOPPED",
      },
      {
        name: "IdleB",
        ctype: "warrior",
        account_owned: true,
        connected: false,
        desired_runtime_state: "STOPPED",
      },
      {
        name: "Merchant",
        ctype: "merchant",
        account_owned: true,
        connected: false,
      },
    ],
  });

  assert.equal(pair.leader.name, "IdleA");
  assert.equal(pair.follower.name, "IdleB");
});

test("group launcher respects explicit distinct pair", () => {
  const pair = selectGroupPair(
    {
      characters: [
        { name: "A", ctype: "ranger", account_owned: true },
        { name: "B", ctype: "warrior", account_owned: true },
      ],
    },
    "B",
    "A",
  );

  assert.equal(pair.leader.name, "B");
  assert.equal(pair.follower.name, "A");
});

test("group launcher waits for leader RUNNING before starting follower", async () => {
  const calls = [];
  const pair = {
    leader: { name: "Leader" },
    follower: { name: "Follower" },
  };

  const payloads = await runGroupPair(pair, {
    runCharacterImpl: async (character, role, leader, peer, options) => {
      calls.push("run:" + role + ":" + character.name);
      assert.equal(options.coordinatedPair, true);
      assert.equal(options.baselinePairFormed, false);
      return { result: { outcome: "PASS", role, leader, peer } };
    },
    waitForRunningImpl: async (characterName) => {
      calls.push("wait:" + characterName);
      assert.equal(calls.includes("run:follower:Follower"), false);
    },
  });

  assert.deepEqual(calls, [
    "run:leader:Leader",
    "wait:Leader",
    "run:follower:Follower",
  ]);
  assert.equal(payloads.length, 2);
});

test("group launcher observes STARTING until leader reaches RUNNING", async () => {
  const states = [
    {
      characters: [
        {
          name: "Leader",
          group_live_test: { status: "STARTING", reason: null },
        },
      ],
    },
    {
      characters: [
        {
          name: "Leader",
          group_live_test: { status: "RUNNING", reason: null },
        },
      ],
    },
  ];
  let now = 0;
  let reads = 0;

  const result = await waitForGroupTestRunning("Leader", {
    readStateImpl: async () => {
      const snapshot = states[Math.min(reads, states.length - 1)];
      reads += 1;
      return snapshot;
    },
    timeoutMs: 5000,
    pollMs: 100,
    now: () => now,
    sleepImpl: async (ms) => {
      now += ms;
    },
  });

  assert.equal(reads, 2);
  assert.equal(result.characters[0].group_live_test.status, "RUNNING");
});

test("group launcher stops bootstrap when leader test becomes terminal", async () => {
  await assert.rejects(
    () =>
      waitForGroupTestRunning("Leader", {
        readStateImpl: async () => ({
          characters: [
            {
              name: "Leader",
              group_live_test: {
                status: "FAILED",
                reason: "GROUP_LIVE_TEST_RUNTIME_TIMEOUT",
              },
            },
          ],
        }),
        timeoutMs: 5000,
        now: () => 0,
        sleepImpl: async () => {},
      }),
    /GROUP_LIVE_TEST_RUNTIME_TIMEOUT/,
  );
});

test("group launcher captures one shared live pair baseline before bootstrap", () => {
  const pair = {
    leader: { name: "Leader" },
    follower: { name: "Follower" },
  };

  assert.equal(
    pairInitiallyFormed(
      {
        characters: [
          {
            name: "Leader",
            connected: true,
            group_combat_runtime: {
              partyMembers: ["Follower", "Leader"],
            },
          },
          {
            name: "Follower",
            connected: true,
            group_combat_runtime: {
              partyMembers: ["Follower", "Leader"],
            },
          },
        ],
      },
      pair,
    ),
    true,
  );

  assert.equal(
    pairInitiallyFormed(
      {
        characters: [
          {
            name: "Leader",
            connected: false,
            group_combat_runtime: {
              partyMembers: ["Follower", "Leader"],
            },
          },
          {
            name: "Follower",
            connected: false,
            group_combat_runtime: {
              partyMembers: ["Follower", "Leader"],
            },
          },
        ],
      },
      pair,
    ),
    false,
  );
});

test("group launcher gives both members the same shared baseline", async () => {
  const seen = [];
  const pair = {
    leader: { name: "Leader" },
    follower: { name: "Follower" },
  };

  await runGroupPair(pair, {
    baselinePairFormed: true,
    runCharacterImpl: async (character, role, leader, peer, options) => {
      seen.push({ character: character.name, role, leader, peer, ...options });
      return { result: { outcome: "PASS" } };
    },
    waitForRunningImpl: async () => {},
  });

  assert.deepEqual(
    seen.map(({ character, role, baselinePairFormed, coordinatedPair }) => ({
      character,
      role,
      baselinePairFormed,
      coordinatedPair,
    })),
    [
      {
        character: "Leader",
        role: "leader",
        baselinePairFormed: true,
        coordinatedPair: true,
      },
      {
        character: "Follower",
        role: "follower",
        baselinePairFormed: true,
        coordinatedPair: true,
      },
    ],
  );
});

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

function makeSetup({
  ctype = "ranger",
  name = "Follower",
  config = {},
  party = {},
  entities = [],
  skills = [],
  cooldowns = [],
  movement = null,
  actionOverrides = {},
  combatTarget = null,
} = {}) {
  const { GroupCombatController } = coreModule(
    "group-combat-controller.lib.ts",
  );
  let now = 1000;
  const preferred = [];
  const calls = [];
  const state = {
    character: {
      name,
      ctype,
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
    party: { ...party },
    entities: entities.map((entity) => ({ ...entity })),
    cooldowns: cooldowns.map((entry) => ({ ...entry })),
  };

  const game = {
    character: () => ({ ...state.character }),
    entities: () => state.entities.map((entity) => ({ ...entity })),
    entity: (id) => state.entities.find((entity) => entity.id === id) || null,
    party: () => ({ ...state.party }),
    skills: () => skills.map((skill) => ({ ...skill })),
    cooldowns: () => state.cooldowns.map((entry) => ({ ...entry })),
  };
  const actions = {
    partyInvite(request) {
      calls.push(["invite", request.name]);
      return { id: "party-1", status: "DISPATCHED" };
    },
    partyRequest(request) {
      calls.push(["request", request.name]);
      return { id: "party-2", status: "DISPATCHED" };
    },
    partyAcceptInvite(request) {
      calls.push(["acceptInvite", request.name]);
      return { id: "party-3", status: "DISPATCHED" };
    },
    partyAcceptRequest(request) {
      calls.push(["acceptRequest", request.name]);
      return { id: "party-4", status: "DISPATCHED" };
    },
    async useSkill(request) {
      calls.push([
        "skill",
        request.skill,
        request.targetId || null,
        request.targetIds || null,
      ]);
      return { id: "skill-1", status: "CONFIRMED" };
    },
    ...actionOverrides,
  };
  const movementState = movement || {
    owner: null,
    mode: "IDLE",
    active: null,
    path: null,
    safePoint: null,
    stuck: { stuck: false },
  };
  const movementCalls = [];
  const movementController = {
    status: () => ({ ...movementState }),
    async cancel(request) {
      movementCalls.push(["cancel", request.force]);
      movementState.owner = null;
      movementState.active = null;
      return { id: "move-cancel", status: "CONFIRMED" };
    },
    async smart(request) {
      movementCalls.push(["smart", request.destination]);
      return { id: "move-smart", status: "CONFIRMED" };
    },
    direct(request) {
      movementCalls.push(["direct", request.x, request.y]);
      return { id: "move-direct", status: "DISPATCHED" };
    },
    release() {
      movementState.owner = null;
      return true;
    },
  };
  const combat = {
    status: () => ({
      target: combatTarget ? { id: combatTarget } : null,
    }),
    setPreferredTargetId(id) {
      preferred.push(id);
    },
  };

  const controller = new GroupCombatController(
    game,
    actions,
    movementController,
    combat,
    {
      config: () => config,
      now: () => now,
    },
  );

  return {
    controller,
    state,
    calls,
    preferred,
    movementCalls,
    advance(ms) {
      now += ms;
    },
  };
}

const rangerAoeSkills = [
  {
    key: "3shot",
    name: "3-Shot",
    classes: ["ranger"],
    mp: 200,
    cooldown: null,
    range: 140,
    hostile: true,
    party: false,
    passive: false,
  },
  {
    key: "5shot",
    name: "5-Shot",
    classes: ["ranger"],
    mp: 320,
    cooldown: null,
    range: 140,
    hostile: true,
    party: false,
    passive: false,
  },
];

test("group combat is disabled by default", async () => {
  const setup = makeSetup();
  const status = await setup.controller.tick();

  assert.equal(status.state, "DISABLED");
  assert.equal(setup.calls.length, 0);
  assert.equal(setup.preferred.at(-1), null);
});

test("leader only forms party with configured trusted members", async () => {
  const setup = makeSetup({
    name: "Leader",
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Leader",
        members: ["Follower"],
      },
    },
    party: { Leader: { name: "Leader" } },
  });

  let status = await setup.controller.tick();
  assert.equal(status.state, "FORMING");
  assert.deepEqual(setup.calls[0], ["invite", "Follower"]);

  await setup.controller.tick();
  assert.equal(setup.calls.length, 1);

  setup.state.party.Follower = { name: "Follower" };
  status = await setup.controller.tick();
  assert.equal(status.missingMembers.length, 0);
});

test("follower accepts configured leader and holds dispatched action", async () => {
  const setup = makeSetup({
    name: "Follower",
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        members: ["Follower"],
      },
    },
  });

  await setup.controller.tick();
  assert.deepEqual(setup.calls[0], ["acceptInvite", "Leader"]);
  await setup.controller.tick();
  assert.equal(setup.calls.length, 1);
});

test("follower adopts visible leader target as group focus", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
      },
    },
    party: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 50,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: "monster-1",
        dead: false,
        rip: false,
      },
      {
        id: "monster-1",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 80,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: "Leader",
        dead: false,
        rip: false,
      },
    ],
  });

  const status = await setup.controller.tick();
  assert.equal(status.focusTargetId, "monster-1");
  assert.equal(setup.preferred.at(-1), "monster-1");
});

test("follower retains a live focus through a transient leader target gap", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
      },
    },
    party: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 50,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: "monster-1",
        dead: false,
        rip: false,
      },
      {
        id: "monster-1",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 80,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: "Follower",
        dead: false,
        rip: false,
      },
    ],
  });

  let status = await setup.controller.tick();
  assert.equal(status.focusTargetId, "monster-1");

  setup.state.entities.find((entity) => entity.id === "leader-id").target =
    null;
  status = await setup.controller.tick();

  assert.equal(status.focusTargetId, "monster-1");
  assert.equal(setup.preferred.at(-1), "monster-1");
});

test("follower reacquires a live monster attacking the leader when leader target is missing", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
      },
    },
    party: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 50,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
      {
        id: "monster-2",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 100,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: "Leader",
        dead: false,
        rip: false,
      },
      {
        id: "monster-1",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 70,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: "Leader",
        dead: false,
        rip: false,
      },
    ],
  });

  const status = await setup.controller.tick();

  assert.equal(status.focusTargetId, "monster-1");
  assert.equal(setup.preferred.at(-1), "monster-1");
});

test("follower applies relayed leader focus before the next scheduler tick", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
      },
    },
    party: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 50,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
      {
        id: "monster-1",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 80,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: null,
        dead: false,
        rip: false,
      },
    ],
  });

  assert.equal(
    setup.controller.setLeaderFocusHint("Leader", "monster-1", 1000),
    true,
  );

  const immediateStatus = setup.controller.status();
  assert.equal(immediateStatus.focusTargetId, "monster-1");
  assert.equal(setup.preferred.at(-1), "monster-1");

  const status = await setup.controller.tick();
  assert.equal(status.focusTargetId, "monster-1");
});

test("follower rejects an older relayed leader focus", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
      },
    },
    party: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 50,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
      {
        id: "monster-1",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 80,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: null,
        dead: false,
        rip: false,
      },
      {
        id: "monster-2",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 90,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: null,
        dead: false,
        rip: false,
      },
    ],
  });

  assert.equal(
    setup.controller.setLeaderFocusHint("Leader", "monster-1", 2000),
    true,
  );
  assert.equal(
    setup.controller.setLeaderFocusHint("Leader", "monster-2", 1500),
    false,
  );

  const status = await setup.controller.tick();
  assert.equal(status.focusTargetId, "monster-1");
});

test("follower drops a retained focus once the target is dead and no leader target exists", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
      },
    },
    party: {
      Leader: { name: "Leader" },
      Follower: { name: "Follower" },
    },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 50,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: "monster-1",
        dead: false,
        rip: false,
      },
      {
        id: "monster-1",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 80,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: "Follower",
        dead: false,
        rip: false,
      },
    ],
  });

  let status = await setup.controller.tick();
  assert.equal(status.focusTargetId, "monster-1");

  setup.state.entities.find((entity) => entity.id === "leader-id").target =
    null;
  const monster = setup.state.entities.find(
    (entity) => entity.id === "monster-1",
  );
  monster.dead = true;
  monster.hp = 0;

  status = await setup.controller.tick();

  assert.equal(status.focusTargetId, null);
  assert.equal(setup.preferred.at(-1), null);
});

test("hard tether preempts movement and regroups to leader", async () => {
  const movement = {
    owner: "Other",
    mode: "SMART",
    active: { id: 1 },
    path: null,
    safePoint: null,
    stuck: { stuck: false },
  };
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
        tether: { soft: 50, hard: 100 },
      },
    },
    party: {
      Leader: {},
      Follower: {},
    },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 300,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
    ],
    movement,
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "REGROUPING");
  assert.deepEqual(setup.movementCalls[0], ["cancel", true]);
  assert.equal(setup.movementCalls[1][0], "smart");
});

test("soft tether never preempts another movement owner", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
        tether: { soft: 50, hard: 300 },
      },
    },
    party: { Leader: {}, Follower: {} },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 100,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
    ],
    movement: {
      owner: "CombatController",
      mode: "RETURN",
      active: { id: 1 },
      path: null,
      safePoint: null,
      stuck: { stuck: false },
    },
  });

  await setup.controller.tick();
  assert.equal(setup.movementCalls.length, 0);
});

test("ranger AoE dispatches 5shot with five resolved target IDs", async () => {
  const monsters = Array.from({ length: 5 }, (_, index) => ({
    id: `m-${index}`,
    type: "monster",
    name: null,
    mtype: "goo",
    map: "main",
    x: 40 + index * 5,
    y: 0,
    hp: 100,
    maxHp: 100,
    target: "Leader",
    dead: false,
    rip: false,
  }));
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Follower",
        party: { enabled: false },
        aoe: { enabled: true, minTargets: 3 },
      },
    },
    entities: monsters,
    skills: rangerAoeSkills,
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "AOE");
  assert.equal(status.aoe.lastSkill, "5shot");
  const skillCall = setup.calls.find((call) => call[0] === "skill");
  assert.equal(skillCall[1], "5shot");
  assert.equal(skillCall[3].length, 5);
});

test("priest healing chooses visible low-health party member", async () => {
  const setup = makeSetup({
    ctype: "priest",
    name: "Priest",
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
        healing: { enabled: true, belowPercent: 70 },
      },
    },
    party: { Leader: {}, Priest: {} },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 40,
        y: 0,
        hp: 400,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
    ],
    skills: [
      {
        key: "heal",
        name: "Heal",
        classes: ["priest"],
        mp: null,
        cooldown: null,
        range: 140,
        hostile: false,
        party: false,
        passive: false,
      },
    ],
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "HEALING");
  assert.equal(status.healing.lastTargetId, "leader-id");
  assert.deepEqual(
    setup.calls.find((call) => call[0] === "skill").slice(0, 3),
    ["skill", "heal", "leader-id"],
  );
});

test("warrior leader exposes anchor state", async () => {
  const setup = makeSetup({
    ctype: "warrior",
    name: "Warrior",
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Warrior",
        party: { enabled: false },
      },
    },
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "ANCHORING");
  assert.equal(status.anchor.active, true);
  assert.equal(status.anchor.x, 0);
});

test("ranger kiting moves away from a too-close focused target", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Follower",
        party: { enabled: false },
        rangerKiting: { enabled: true, minDistance: 90, step: 80 },
      },
    },
    entities: [
      {
        id: "monster-1",
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 20,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: "Follower",
        dead: false,
        rip: false,
      },
    ],
    combatTarget: "monster-1",
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "KITING");
  assert.equal(status.kiting.active, true);
  assert.equal(setup.movementCalls[0][0], "direct");
  assert.equal(setup.movementCalls[0][1] < 0, true);
});

test("soft tether regroups to leader when movement is free", async () => {
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
        tether: { soft: 50, hard: 300 },
      },
    },
    party: { Leader: {}, Follower: {} },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 100,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
    ],
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "REGROUPING");
  assert.equal(status.reason, "SOFT_TETHER_EXCEEDED");
  assert.equal(setup.movementCalls[0][0], "smart");
});

test("priest party heal triggers when enough party members are low", async () => {
  const setup = makeSetup({
    ctype: "priest",
    name: "Priest",
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
        healing: {
          enabled: true,
          belowPercent: 70,
          partyHealMinTargets: 2,
        },
      },
    },
    party: { Leader: {}, Priest: {} },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 40,
        y: 0,
        hp: 400,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
    ],
    skills: [
      {
        key: "partyheal",
        name: "Party Heal",
        classes: ["priest"],
        mp: 200,
        cooldown: null,
        range: null,
        hostile: false,
        party: true,
        passive: false,
      },
    ],
  });
  setup.state.character.hp = 500;

  const status = await setup.controller.tick();
  assert.equal(status.state, "HEALING");
  assert.equal(status.reason, "PARTY_HEAL_DISPATCHED");
  assert.deepEqual(
    setup.calls.find((call) => call[0] === "skill").slice(0, 2),
    ["skill", "partyheal"],
  );
});

test("priest support absorbs aggro pressure from party member", async () => {
  const setup = makeSetup({
    ctype: "priest",
    name: "Priest",
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
        support: { enabled: true, absorbAggroCount: 2 },
      },
    },
    party: { Leader: {}, Priest: {} },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 40,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        id: `m-${index}`,
        type: "monster",
        name: null,
        mtype: "goo",
        map: "main",
        x: 60 + index * 5,
        y: 0,
        hp: 100,
        maxHp: 100,
        target: "Leader",
        dead: false,
        rip: false,
      })),
    ],
    skills: [
      {
        key: "absorb",
        name: "Absorb",
        classes: ["priest"],
        mp: 200,
        cooldown: null,
        range: 320,
        hostile: false,
        party: false,
        passive: false,
      },
    ],
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "SUPPORTING");
  assert.equal(status.support.lastSkill, "absorb");
  assert.equal(status.support.lastTargetId, "leader-id");
});

test("mage support reflects configured group leader", async () => {
  const setup = makeSetup({
    ctype: "mage",
    name: "Mage",
    config: {
      groupCombat: {
        enabled: true,
        role: "follower",
        leader: "Leader",
        party: { enabled: false },
        support: { enabled: true },
      },
    },
    party: { Leader: {}, Mage: {} },
    entities: [
      {
        id: "leader-id",
        type: "character",
        name: "Leader",
        map: "main",
        x: 40,
        y: 0,
        hp: 1000,
        maxHp: 1000,
        target: null,
        dead: false,
        rip: false,
      },
    ],
    skills: [
      {
        key: "reflection",
        name: "Reflection",
        classes: ["mage"],
        mp: 200,
        cooldown: null,
        range: 320,
        hostile: false,
        party: false,
        passive: false,
      },
    ],
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "SUPPORTING");
  assert.equal(status.support.lastSkill, "reflection");
  assert.equal(status.support.lastTargetId, "leader-id");
});

test("warrior AoE uses agitate for party aggro pressure", async () => {
  const setup = makeSetup({
    ctype: "warrior",
    name: "Warrior",
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Warrior",
        party: { enabled: false },
        aoe: { enabled: true, minTargets: 2 },
      },
    },
    party: { Warrior: {}, Follower: {} },
    entities: Array.from({ length: 2 }, (_, index) => ({
      id: `m-${index}`,
      type: "monster",
      name: null,
      mtype: "goo",
      map: "main",
      x: 40 + index * 5,
      y: 0,
      hp: 100,
      maxHp: 100,
      target: "Follower",
      dead: false,
      rip: false,
    })),
    skills: [
      {
        key: "agitate",
        name: "Agitate",
        classes: ["warrior"],
        mp: 200,
        cooldown: null,
        range: 320,
        hostile: true,
        party: false,
        passive: false,
      },
    ],
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "AOE");
  assert.equal(status.aoe.lastSkill, "agitate");
});

test("warrior AoE uses cleave for enough nearby targets", async () => {
  const setup = makeSetup({
    ctype: "warrior",
    name: "Warrior",
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Warrior",
        party: { enabled: false },
        aoe: { enabled: true, minTargets: 2 },
      },
    },
    party: { Warrior: {}, Follower: {} },
    entities: Array.from({ length: 2 }, (_, index) => ({
      id: `m-${index}`,
      type: "monster",
      name: null,
      mtype: "goo",
      map: "main",
      x: 40 + index * 5,
      y: 0,
      hp: 100,
      maxHp: 100,
      target: "Warrior",
      dead: false,
      rip: false,
    })),
    skills: [
      {
        key: "cleave",
        name: "Cleave",
        classes: ["warrior"],
        mp: 200,
        cooldown: null,
        range: 160,
        hostile: true,
        party: false,
        passive: false,
      },
    ],
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "AOE");
  assert.equal(status.aoe.lastSkill, "cleave");
});

test("ranger AoE excludes monsters outside skill range", async () => {
  const monsters = [
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `near-${index}`,
      type: "monster",
      name: null,
      mtype: "goo",
      map: "main",
      x: 40 + index * 10,
      y: 0,
      hp: 100,
      maxHp: 100,
      target: "Follower",
      dead: false,
      rip: false,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `far-${index}`,
      type: "monster",
      name: null,
      mtype: "goo",
      map: "main",
      x: 300 + index * 50,
      y: 0,
      hp: 100,
      maxHp: 100,
      target: "Follower",
      dead: false,
      rip: false,
    })),
  ];
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Follower",
        party: { enabled: false },
        aoe: { enabled: true, minTargets: 3 },
      },
    },
    entities: monsters,
    skills: rangerAoeSkills,
  });

  const status = await setup.controller.tick();
  assert.equal(status.state, "AOE");
  assert.equal(status.aoe.lastSkill, "3shot");
  const skillCall = setup.calls.find((call) => call[0] === "skill");
  assert.deepEqual(skillCall[3], ["near-0", "near-1", "near-2"]);
});

test("warrior anchor keeps its original point and returns after drift", async () => {
  const setup = makeSetup({
    ctype: "warrior",
    name: "Warrior",
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Warrior",
        party: { enabled: false },
      },
    },
  });

  let status = await setup.controller.tick();
  assert.equal(status.state, "ANCHORING");
  assert.equal(status.anchor.x, 0);
  assert.equal(status.anchor.y, 0);

  setup.state.character.x = 80;
  setup.state.character.y = 20;
  status = await setup.controller.tick();

  assert.equal(status.state, "ANCHORING");
  assert.equal(status.reason, "WARRIOR_ANCHOR_RETURN_DISPATCHED");
  assert.equal(status.anchor.x, 0);
  assert.equal(status.anchor.y, 0);
  assert.deepEqual(setup.movementCalls.at(-1), ["direct", 0, 0]);
});

test("UNKNOWN group skill blocks blind retry until evidence appears", async () => {
  let uses = 0;
  const setup = makeSetup({
    config: {
      groupCombat: {
        enabled: true,
        role: "leader",
        leader: "Follower",
        party: { enabled: false },
        aoe: { enabled: true, minTargets: 3 },
      },
    },
    entities: Array.from({ length: 3 }, (_, index) => ({
      id: `m-${index}`,
      type: "monster",
      name: null,
      mtype: "goo",
      map: "main",
      x: 40 + index * 5,
      y: 0,
      hp: 100,
      maxHp: 100,
      target: "Follower",
      dead: false,
      rip: false,
    })),
    skills: rangerAoeSkills,
    actionOverrides: {
      async useSkill() {
        uses += 1;
        return { id: "unknown-skill", status: "UNKNOWN" };
      },
    },
  });

  let status = await setup.controller.tick();
  assert.equal(status.reason, "GROUP_SKILL_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);

  status = await setup.controller.tick();
  assert.equal(status.reason, "GROUP_SKILL_OUTCOME_UNKNOWN");
  assert.equal(uses, 1);

  setup.state.cooldowns = [
    {
      skill: "3shot",
      readyAt: 5000,
      remainingMs: 1000,
      ready: false,
    },
  ];
  await setup.controller.tick();
  assert.equal(uses, 1);
});

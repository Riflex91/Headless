"use strict";

const {
  ensureDashboardAvailable,
  stopManagedRuntime,
} = require("../src/MovementLiveTestLauncher");

const baseUrl = String(
  process.env.CARACAL_HEADLESS_URL || "http://127.0.0.1:924",
).replace(/\/$/, "");

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload.message ||
        payload.error ||
        "HTTP " + response.status + " from " + response.url,
    );
  }
  return payload;
}

async function readState() {
  return readJson(
    await fetch(baseUrl + "/headless/api/state", {
      cache: "no-store",
    }),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGroupTestRunning(
  characterName,
  {
    readStateImpl = readState,
    timeoutMs = Number(
      process.env.CARACAL_GROUP_LIVE_BOOTSTRAP_TIMEOUT_MS || 60000,
    ),
    pollMs = Number(process.env.CARACAL_GROUP_LIVE_BOOTSTRAP_POLL_MS || 250),
    now = Date.now,
    sleepImpl = sleep,
  } = {},
) {
  const deadline = now() + Math.max(1000, timeoutMs);
  let lastStatus = null;
  let lastReason = null;

  while (now() < deadline) {
    const snapshot = await readStateImpl();
    const character = (snapshot.characters || []).find(
      (entry) => entry.name === characterName,
    );
    if (!character) {
      throw new Error(
        "Group live bootstrap character disappeared: " + characterName,
      );
    }

    const testState = character.group_live_test || null;
    lastStatus = testState?.status || null;
    lastReason = testState?.reason || null;

    if (lastStatus === "RUNNING") {
      return snapshot;
    }
    if (["FAILED", "COMPLETED"].includes(lastStatus)) {
      throw new Error(
        "Group live bootstrap became " +
          lastStatus +
          " for " +
          characterName +
          (lastReason ? " (" + lastReason + ")" : ""),
      );
    }

    await sleepImpl(Math.max(25, pollMs));
  }

  throw new Error(
    "Timed out waiting for Group live runtime bootstrap for " +
      characterName +
      (lastStatus ? " (last status " + lastStatus + ")" : ""),
  );
}

function pairScore(character) {
  const partyMembers = character.group_combat_runtime?.partyMembers;
  const partyPenalty =
    Array.isArray(partyMembers) && partyMembers.length > 1 ? 100 : 0;
  const onlinePenalty = character.connected === true ? 10 : 0;
  const runningPenalty = character.desired_runtime_state === "RUNNING" ? 5 : 0;
  return partyPenalty + onlinePenalty + runningPenalty;
}

function selectGroupPair(
  snapshot,
  requestedLeader = null,
  requestedFollower = null,
) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];
  const eligible = characters.filter(
    (character) =>
      character.account_owned === true && character.ctype !== "merchant",
  );

  if (requestedLeader || requestedFollower) {
    const leader = requestedLeader
      ? eligible.find((character) => character.name === requestedLeader)
      : null;
    const follower = requestedFollower
      ? eligible.find((character) => character.name === requestedFollower)
      : null;
    if (requestedLeader && !leader) {
      throw new Error("Unknown eligible leader: " + requestedLeader);
    }
    if (requestedFollower && !follower) {
      throw new Error("Unknown eligible follower: " + requestedFollower);
    }
    if (leader && follower && leader.name === follower.name) {
      throw new Error("Group live E2E requires two different characters");
    }

    const remaining = eligible
      .filter(
        (character) =>
          character.name !== leader?.name && character.name !== follower?.name,
      )
      .sort((a, b) => pairScore(a) - pairScore(b));

    return {
      leader: leader || remaining.shift() || null,
      follower: follower || remaining.shift() || null,
    };
  }

  const sorted = [...eligible].sort(
    (a, b) =>
      pairScore(a) - pairScore(b) ||
      String(a.name).localeCompare(String(b.name)),
  );
  return {
    leader: sorted[0] || null,
    follower: sorted[1] || null,
  };
}

async function runCharacter(character, role, leader, peer) {
  return readJson(
    await fetch(
      baseUrl +
        "/headless/api/characters/" +
        encodeURIComponent(character.name) +
        "/tests/group",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, leader, peer }),
      },
    ),
  );
}

async function runGroupPair(
  pair,
  {
    runCharacterImpl = runCharacter,
    waitForRunningImpl = waitForGroupTestRunning,
  } = {},
) {
  const leaderPromise = runCharacterImpl(
    pair.leader,
    "leader",
    pair.leader.name,
    pair.follower.name,
  );
  leaderPromise.catch(() => {});

  await waitForRunningImpl(pair.leader.name);

  const followerPromise = runCharacterImpl(
    pair.follower,
    "follower",
    pair.leader.name,
    pair.follower.name,
  );

  return Promise.all([leaderPromise, followerPromise]);
}

async function main() {
  const requestedLeader = process.argv[2] || null;
  const requestedFollower = process.argv[3] || null;
  const dashboard = await ensureDashboardAvailable(readState);
  const managedRuntime = dashboard.runtime;

  try {
    process.stdout.write(
      dashboard.startedRuntime
        ? "Temporary caracAL runtime is ready at " + baseUrl + "\n"
        : "Using existing caracAL runtime at " + baseUrl + "\n",
    );

    const pair = selectGroupPair(
      dashboard.state,
      requestedLeader,
      requestedFollower,
    );
    if (!pair.leader || !pair.follower) {
      throw new Error(
        "Two account-owned non-merchant characters are required for Group E2E",
      );
    }

    process.stdout.write(
      "Running autonomous Group E2E with leader " +
        pair.leader.name +
        " and follower " +
        pair.follower.name +
        "\n",
    );

    const [leaderPayload, followerPayload] = await runGroupPair(pair);

    process.stdout.write(
      "Leader runtime reached RUNNING before follower bootstrap\n",
    );

    const leaderResult = leaderPayload.result;
    const followerResult = followerPayload.result;
    const pass =
      leaderResult?.outcome === "PASS" && followerResult?.outcome === "PASS";

    const result = {
      outcome: pass ? "PASS" : "FAIL",
      reason: pass
        ? "GROUP_LIVE_E2E_CONFIRMED"
        : "GROUP_LIVE_E2E_MEMBER_FAILED",
      leader: leaderResult,
      follower: followerResult,
      scope: {
        partyFormation: true,
        leaderFollower: true,
        combatMutationForced: false,
        aoeMutationForced: false,
        healingMutationForced: false,
      },
    };

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!pass) {
      process.exitCode = [leaderResult?.outcome, followerResult?.outcome].some(
        (outcome) => ["UNKNOWN", "TIMEOUT"].includes(outcome),
      )
        ? 2
        : 1;
    }
  } finally {
    if (managedRuntime) {
      process.stdout.write("Stopping temporary caracAL runtime\n");
      await stopManagedRuntime(managedRuntime);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  runGroupPair,
  selectGroupPair,
  waitForGroupTestRunning,
};

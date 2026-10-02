"use strict";

const childProcess = require("node:child_process");
const path = require("node:path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectionFailure(error) {
  if (error instanceof TypeError) return true;
  const code = error?.cause?.code || error?.code || null;
  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ETIMEDOUT",
  ].includes(code);
}

function selectMovementLiveTestCharacter(snapshot, requested = null) {
  const characters = Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];

  if (requested) {
    const exact = characters.find((character) => character.name === requested);
    if (!exact) {
      throw new Error(`Unknown character in dashboard state: ${requested}`);
    }
    return exact;
  }

  const combatCharacters = characters.filter(
    (character) =>
      character.account_owned === true && character.ctype !== "merchant",
  );

  return (
    combatCharacters.find(
      (character) =>
        character.connected === true && character.lifecycle_state === "ONLINE",
    ) ||
    combatCharacters.find(
      (character) =>
        character.enabled === true &&
        character.desired_runtime_state === "RUNNING",
    ) ||
    combatCharacters.find((character) => character.enabled === true) ||
    combatCharacters.find((character) => character.connected === true) ||
    combatCharacters[0] ||
    characters.find(
      (character) =>
        character.account_owned === true &&
        character.connected === true &&
        character.lifecycle_state === "ONLINE",
    ) ||
    characters.find(
      (character) =>
        character.account_owned === true && character.enabled === true,
    ) ||
    characters.find((character) => character.account_owned === true) ||
    characters[0] ||
    null
  );
}

function startManagedRuntime({
  cwd = path.resolve(__dirname, ".."),
  spawnImpl = childProcess.spawn,
  env = process.env,
} = {}) {
  return spawnImpl(process.execPath, ["main.js"], {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: false,
  });
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      ...options,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function stopManagedRuntime(
  child,
  {
    platform = process.platform,
    gracefulTimeoutMs = 10000,
    forceTimeoutMs = 5000,
    runProcessImpl = runProcess,
  } = {},
) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (platform === "win32") {
    await runProcessImpl("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    await waitForChildExit(child, forceTimeoutMs);
    return;
  }

  child.kill("SIGINT");
  if (await waitForChildExit(child, gracefulTimeoutMs)) return;

  child.kill("SIGKILL");
  await waitForChildExit(child, forceTimeoutMs);
}

async function waitForDashboard(
  probe,
  runtime,
  { timeoutMs = 60000, pollMs = 500, now = Date.now, sleepImpl = sleep } = {},
) {
  const deadline = now() + timeoutMs;
  let lastError = null;

  while (now() < deadline) {
    if (runtime && (runtime.exitCode !== null || runtime.signalCode !== null)) {
      throw new Error(
        `caracAL runtime exited before dashboard became ready (code=${runtime.exitCode}, signal=${runtime.signalCode})`,
      );
    }

    try {
      return await probe();
    } catch (error) {
      if (!isConnectionFailure(error)) throw error;
      lastError = error;
    }

    await sleepImpl(pollMs);
  }

  const detail = lastError?.cause?.code || lastError?.message || "unreachable";
  throw new Error(
    `Timed out waiting for caracAL dashboard after ${timeoutMs}ms (${detail})`,
  );
}

async function ensureDashboardAvailable(
  probe,
  {
    startRuntime = startManagedRuntime,
    stopRuntime = stopManagedRuntime,
    timeoutMs = Number(
      process.env.CARACAL_LIVE_TEST_STARTUP_TIMEOUT_MS || 60000,
    ),
    pollMs = Number(process.env.CARACAL_LIVE_TEST_STARTUP_POLL_MS || 500),
  } = {},
) {
  try {
    return {
      state: await probe(),
      runtime: null,
      startedRuntime: false,
    };
  } catch (error) {
    if (!isConnectionFailure(error)) throw error;
  }

  process.stdout.write(
    "caracAL dashboard is not running; starting a temporary runtime for the live test\n",
  );
  const runtime = startRuntime();

  try {
    const state = await waitForDashboard(probe, runtime, {
      timeoutMs,
      pollMs,
    });
    return {
      state,
      runtime,
      startedRuntime: true,
    };
  } catch (error) {
    await stopRuntime(runtime);
    throw error;
  }
}

module.exports = {
  ensureDashboardAvailable,
  isConnectionFailure,
  selectMovementLiveTestCharacter,
  startManagedRuntime,
  stopManagedRuntime,
  waitForDashboard,
};

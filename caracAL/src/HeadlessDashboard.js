"use strict";

const path = require("node:path");

function publicCharacterState(name, charBlock = {}) {
  return {
    name,
    enabled: !!charBlock.enabled,
    connected: !!charBlock.connected,
    lifecycle_state: charBlock.lifecycle_state || "STOPPED",
    realm: charBlock.realm || null,
    pid: charBlock.instance?.pid || null,
    last_heartbeat_at: charBlock.last_heartbeat_at || null,
    restart_attempts: charBlock.restart_attempts || 0,
    script: charBlock.typescript || charBlock.script || null,
  };
}

function buildSupervisorSnapshot(characterManage = {}, lifecyclePolicy = {}) {
  const characters = Object.entries(characterManage)
    .map(([name, charBlock]) => publicCharacterState(name, charBlock))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    generated_at: Date.now(),
    max_online_characters: lifecyclePolicy.maxOnlineCharacters || 4,
    active_characters: characters.filter((character) =>
      ["STARTING", "CONNECTING", "ONLINE", "PAUSED", "STOPPING"].includes(
        character.lifecycle_state,
      ),
    ).length,
    characters,
  };
}

function encodeSseEvent(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function attachHeadlessDashboard({
  router,
  express,
  characterManage,
  lifecyclePolicy,
  publicDir,
}) {
  if (!router) {
    throw new Error("headless dashboard requires an Express router");
  }

  const clients = new Set();
  const getSnapshot = () =>
    buildSupervisorSnapshot(characterManage, lifecyclePolicy);

  router.get("/headless/api/state", (_req, res) => {
    res.json(getSnapshot());
  });

  router.get("/headless/api/events", (req, res) => {
    res.status(200);
    res.set({
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    res.flushHeaders?.();

    clients.add(res);
    res.write(encodeSseEvent("snapshot", getSnapshot()));

    req.on("close", () => {
      clients.delete(res);
    });
  });

  const staticDir =
    publicDir || path.join(__dirname, "..", "dashboard");
  router.use("/headless", express.static(staticDir));

  function publish(event) {
    const payload = {
      ...event,
      timestamp: event.timestamp || Date.now(),
    };
    for (const client of clients) {
      client.write(encodeSseEvent("supervisor", payload));
    }
  }

  function close() {
    for (const client of clients) {
      client.end();
    }
    clients.clear();
  }

  return {
    close,
    getSnapshot,
    publish,
  };
}

module.exports = {
  attachHeadlessDashboard,
  buildSupervisorSnapshot,
  encodeSseEvent,
  publicCharacterState,
};

"use strict";

const path = require("node:path");
const { normalizeControlAction } = require("./CharacterControl");
const {
  formatAccountDiagnostic,
  formatCharacterDiagnostic,
} = require("./DiagnosticStore");

function publicLiveState(liveState) {
  if (!liveState) return null;

  const result = {};
  [
    "timestamp",
    "name",
    "ctype",
    "map",
    "x",
    "y",
    "heading",
    "direction",
    "moving",
    "going_x",
    "going_y",
    "movement_destination",
    "movement_state",
    "planned_path",
    "planned_destination",
    "rip",
    "hp",
    "max_hp",
    "mp",
    "max_mp",
    "level",
    "xp",
    "max_xp",
    "gold",
    "party",
    "isize",
    "esize",
    "t_mtype",
    "t_name",
    "target",
    "current_status",
    "items",
    "slots",
  ].forEach((key) => {
    if (liveState[key] !== undefined) {
      result[key] = liveState[key];
    }
  });
  return result;
}

function publicCharacterState(name, charBlock = {}) {
  return {
    name,
    enabled: !!charBlock.enabled,
    connected: !!charBlock.connected,
    lifecycle_state: charBlock.lifecycle_state || "STOPPED",
    desired_runtime_state:
      charBlock.desired_runtime_state ||
      (charBlock.enabled ? "RUNNING" : "STOPPED"),
    realm: charBlock.realm || null,
    pid: charBlock.instance?.pid || null,
    last_heartbeat_at: charBlock.last_heartbeat_at || null,
    restart_attempts: charBlock.restart_attempts || 0,
    script: charBlock.typescript || charBlock.script || null,
    game: publicLiveState(charBlock.live_state),
    movement_trail: Array.isArray(charBlock.movement_trail)
      ? charBlock.movement_trail
      : [],
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

function isLoopbackAddress(address) {
  const normalized = String(address || "").toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function diagnosticSinceFromQuery(query = {}) {
  const minutes = Number(query.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  return Date.now() - Math.min(minutes, 24 * 60) * 60 * 1000;
}

function attachHeadlessDashboard({
  router,
  express,
  characterManage,
  lifecyclePolicy,
  publicDir,
  controlCharacter,
  diagnosticStore,
  assetCache,
}) {
  if (!router) {
    throw new Error("headless dashboard requires an Express router");
  }

  const clients = new Set();
  let snapshotPublishTimer = null;
  const getSnapshot = () =>
    buildSupervisorSnapshot(characterManage, lifecyclePolicy);

  router.use("/headless", (req, res, next) => {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(403).json({ error: "LOCAL_ACCESS_ONLY" });
      return;
    }
    next();
  });

  router.get("/headless/api/state", (_req, res) => {
    res.json(getSnapshot());
  });

  router.get("/headless/api/assets/adventure-land", async (req, res) => {
    if (!assetCache) {
      res.status(503).json({ error: "ASSET_CACHE_UNAVAILABLE" });
      return;
    }

    try {
      const asset = await assetCache.ensure(req.query.path);
      res.set({
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": asset.contentType,
      });
      res.sendFile(asset.path);
    } catch (error) {
      res.status(Number(error.statusCode) || 502).json({
        error: error.code || "ASSET_FETCH_FAILED",
        message: error.message,
      });
    }
  });

  router.get("/headless/api/diagnostic", (req, res) => {
    if (!diagnosticStore) {
      res.status(503).json({ error: "DIAGNOSTICS_UNAVAILABLE" });
      return;
    }

    const since = diagnosticSinceFromQuery(req.query);
    const events = diagnosticStore.getEvents({ since });
    res.type("text/plain").send(formatAccountDiagnostic(getSnapshot(), events));
  });

  router.get("/headless/api/characters/:name/diagnostic", (req, res) => {
    if (!diagnosticStore) {
      res.status(503).json({ error: "DIAGNOSTICS_UNAVAILABLE" });
      return;
    }

    try {
      const since = diagnosticSinceFromQuery(req.query);
      const events = diagnosticStore.getEvents({
        character: req.params.name,
        since,
      });
      res
        .type("text/plain")
        .send(
          formatCharacterDiagnostic(req.params.name, getSnapshot(), events),
        );
    } catch (error) {
      res.status(Number(error.statusCode) || 500).json({
        error: error.code || "DIAGNOSTIC_FAILED",
        message: error.message,
      });
    }
  });

  router.post(
    "/headless/api/characters/:name/control",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      const action = normalizeControlAction(req.body?.action);
      if (!action) {
        res.status(400).json({ error: "INVALID_CONTROL_ACTION" });
        return;
      }
      if (!controlCharacter) {
        res.status(503).json({ error: "CONTROL_UNAVAILABLE" });
        return;
      }

      try {
        const result = await controlCharacter(req.params.name, action);
        res.json({
          ok: true,
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CONTROL_FAILED",
          message: error.message,
        });
      }
    },
  );

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

  const staticDir = publicDir || path.join(__dirname, "..", "dashboard");
  router.use("/headless", express.static(staticDir));

  function publishSnapshot() {
    if (snapshotPublishTimer) return;

    snapshotPublishTimer = setTimeout(() => {
      snapshotPublishTimer = null;
      const snapshot = getSnapshot();
      for (const client of clients) {
        client.write(encodeSseEvent("snapshot", snapshot));
      }
    }, 500);
    snapshotPublishTimer.unref?.();
  }

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
    if (snapshotPublishTimer) {
      clearTimeout(snapshotPublishTimer);
      snapshotPublishTimer = null;
    }
    for (const client of clients) {
      client.end();
    }
    clients.clear();
  }

  return {
    close,
    getSnapshot,
    publish,
    publishSnapshot,
  };
}

module.exports = {
  attachHeadlessDashboard,
  buildSupervisorSnapshot,
  diagnosticSinceFromQuery,
  encodeSseEvent,
  isLoopbackAddress,
  publicCharacterState,
  publicLiveState,
};

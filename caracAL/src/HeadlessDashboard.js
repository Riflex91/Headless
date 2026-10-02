"use strict";

const path = require("node:path");
const { normalizeControlAction } = require("./CharacterControl");
const { IPC_PROTOCOL_VERSION } = require("./IpcProtocol");
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
    "movement_mode",
    "movement_owner",
    "movement_reason",
    "movement_command",
    "movement_stuck",
    "runtime_planned_path",
    "runtime_planned_destination",
    "safe_point",
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
    "nearby_entities",
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
    rotation_source: charBlock.rotation_source || null,
    rotation_replacement: charBlock.rotation_replacement || null,
    account_owned: charBlock.account_owned === true,
    registration_source: charBlock.registration_source || "CONFIG",
    ctype:
      charBlock.account_character_type || charBlock.live_state?.ctype || null,
    realm: charBlock.realm || null,
    pid: charBlock.instance?.pid || null,
    last_heartbeat_at: charBlock.last_heartbeat_at || null,
    restart_attempts: charBlock.restart_attempts || 0,
    script: charBlock.typescript || charBlock.script || null,
    code_revision: charBlock.running_code_revision || null,
    installed_code_revision: charBlock.installed_code_revision || null,
    config_revision: charBlock.running_config_revision || null,
    installed_config_revision: charBlock.installed_config_revision || null,
    runtime_config_revision: Number.isInteger(charBlock.runtime_config_revision)
      ? charBlock.runtime_config_revision
      : 0,
    applied_runtime_config_revision: Number.isInteger(
      charBlock.applied_runtime_config_revision,
    )
      ? charBlock.applied_runtime_config_revision
      : null,
    runtime_config_source: charBlock.runtime_config_source || "CONFIG",
    config_push_status: charBlock.config_push_status || "UNKNOWN",
    config_push_error: charBlock.config_push_error || null,
    revision_status: charBlock.revision_status || "UNKNOWN",
    movement_live_test: charBlock.movement_live_test || null,
    combat_live_test: charBlock.combat_live_test || null,
    class_skill_live_test: charBlock.class_skill_live_test || null,
    group_live_test: charBlock.group_live_test || null,
    combat_runtime: charBlock.combat_runtime || null,
    class_skill_runtime: charBlock.class_skill_runtime || null,
    group_combat_runtime: charBlock.group_combat_runtime || null,
    game: publicLiveState(charBlock.live_state),
    movement_trail: Array.isArray(charBlock.movement_trail)
      ? charBlock.movement_trail
      : [],
  };
}

function buildSupervisorSnapshot(
  characterManage = {},
  lifecyclePolicy = {},
  emergencyStopState = null,
  revisionSummary = null,
  persistenceHealth = null,
) {
  const characters = Object.entries(characterManage)
    .map(([name, charBlock]) => publicCharacterState(name, charBlock))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    generated_at: Date.now(),
    ipc_protocol_version: IPC_PROTOCOL_VERSION,
    max_online_characters: lifecyclePolicy.maxOnlineCharacters || 4,
    active_characters: characters.filter((character) =>
      ["STARTING", "CONNECTING", "ONLINE", "PAUSED", "STOPPING"].includes(
        character.lifecycle_state,
      ),
    ).length,
    emergency_stop: emergencyStopState || {
      active: false,
      reason: null,
      activated_at: null,
      cleared_at: null,
      revision: 0,
    },
    revision_summary: revisionSummary || {
      source_revision: null,
      installed_config_revision: null,
      status: "UNKNOWN",
    },
    persistence: persistenceHealth || {
      status: "UNKNOWN",
      database_path: null,
      schema_version: null,
      current_schema_version: null,
      flush_count: 0,
      closed: true,
      last_error: null,
    },
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
  updateCharacterConfig,
  controlRotation,
  runMovementLiveTest,
  runCombatLiveTest,
  runClassSkillLiveTest,
  runGroupLiveTest,
  controlEmergencyStop,
  getEmergencyStopState,
  getRevisionSummary,
  getPersistenceHealth,
  getMapScene,
  diagnosticStore,
  incidentRecorder,
  assetCache,
}) {
  if (!router) {
    throw new Error("headless dashboard requires an Express router");
  }

  const clients = new Set();
  let snapshotPublishTimer = null;
  const getSnapshot = () =>
    buildSupervisorSnapshot(
      characterManage,
      lifecyclePolicy,
      getEmergencyStopState?.(),
      getRevisionSummary?.(),
      getPersistenceHealth?.(),
    );

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

  router.put(
    "/headless/api/characters/:name/config",
    express.json({ limit: "96kb" }),
    async (req, res) => {
      if (!updateCharacterConfig) {
        res.status(503).json({ error: "CONFIG_PUSH_UNAVAILABLE" });
        return;
      }

      try {
        const result = await updateCharacterConfig(
          req.params.name,
          req.body?.config,
        );
        res.json({
          ok: true,
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CONFIG_PUSH_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/rotation",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!controlRotation) {
        res.status(503).json({ error: "ROTATION_UNAVAILABLE" });
        return;
      }

      try {
        const result = await controlRotation({
          startCharacter: req.body?.start_character,
          stopCharacter: req.body?.stop_character,
        });
        res.json({
          ok: true,
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "ROTATION_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/movement",
    async (req, res) => {
      if (!runMovementLiveTest) {
        res.status(503).json({ error: "MOVEMENT_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runMovementLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "MOVEMENT_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/combat",
    async (req, res) => {
      if (!runCombatLiveTest) {
        res.status(503).json({ error: "COMBAT_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runCombatLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "COMBAT_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );
  router.post(
    "/headless/api/characters/:name/tests/class-skill",
    async (req, res) => {
      if (!runClassSkillLiveTest) {
        res.status(503).json({ error: "CLASS_SKILL_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runClassSkillLiveTest(req.params.name);
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "CLASS_SKILL_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/characters/:name/tests/group",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      if (!runGroupLiveTest) {
        res.status(503).json({ error: "GROUP_LIVE_TEST_UNAVAILABLE" });
        return;
      }

      try {
        const result = await runGroupLiveTest(req.params.name, {
          role: req.body?.role,
          leader: req.body?.leader,
          peer: req.body?.peer,
        });
        res.json({
          ok: result?.outcome === "PASS",
          result,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "GROUP_LIVE_TEST_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/headless/api/emergency-stop",
    express.json({ limit: "8kb" }),
    async (req, res) => {
      const action = String(req.body?.action || "").toLowerCase();
      if (!["activate", "clear"].includes(action)) {
        res.status(400).json({ error: "INVALID_EMERGENCY_STOP_ACTION" });
        return;
      }
      if (!controlEmergencyStop) {
        res.status(503).json({ error: "EMERGENCY_STOP_UNAVAILABLE" });
        return;
      }

      try {
        const state = await controlEmergencyStop(
          action,
          req.body?.reason || undefined,
        );
        res.json({
          ok: true,
          emergency_stop: state,
          snapshot: getSnapshot(),
        });
      } catch (error) {
        res.status(Number(error.statusCode) || 500).json({
          error: error.code || "EMERGENCY_STOP_FAILED",
          message: error.message,
        });
      }
    },
  );

  router.get("/headless/api/maps/:name/scene", (req, res) => {
    if (!getMapScene) {
      res.status(503).json({ error: "MAP_SCENE_UNAVAILABLE" });
      return;
    }

    const scene = getMapScene(req.params.name);
    if (!scene) {
      res.status(404).json({ error: "MAP_SCENE_NOT_FOUND" });
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json(scene);
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

  router.get("/headless/api/incidents", async (req, res) => {
    if (!incidentRecorder) {
      res.status(503).json({ error: "INCIDENTS_UNAVAILABLE" });
      return;
    }

    try {
      const incidents = await incidentRecorder.list({
        limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
        character: req.query.character || undefined,
      });
      res.json({ incidents });
    } catch (error) {
      res.status(500).json({
        error: "INCIDENT_LIST_FAILED",
        message: error.message,
      });
    }
  });

  router.get("/headless/api/incidents/latest", async (req, res) => {
    if (!incidentRecorder) {
      res.status(503).json({ error: "INCIDENTS_UNAVAILABLE" });
      return;
    }

    try {
      const incident = await incidentRecorder.latest({
        character: req.query.character || undefined,
      });
      if (!incident) {
        res.status(404).json({ error: "INCIDENT_NOT_FOUND" });
        return;
      }

      res
        .type("text/plain")
        .send(await incidentRecorder.readText(incident.incident_id));
    } catch (error) {
      res.status(Number(error.statusCode) || 500).json({
        error: error.code || "INCIDENT_READ_FAILED",
        message: error.message,
      });
    }
  });

  router.get("/headless/api/incidents/:id", async (req, res) => {
    if (!incidentRecorder) {
      res.status(503).json({ error: "INCIDENTS_UNAVAILABLE" });
      return;
    }

    try {
      res
        .type("text/plain")
        .send(await incidentRecorder.readText(req.params.id));
    } catch (error) {
      res.status(Number(error.statusCode) || 404).json({
        error: error.code || "INCIDENT_NOT_FOUND",
        message: error.message,
      });
    }
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

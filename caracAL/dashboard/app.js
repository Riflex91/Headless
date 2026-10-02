"use strict";

const state = {
  characters: new Map(),
  events: [],
  maxOnlineCharacters: 4,
  emergencyStop: {
    active: false,
    reason: null,
    activated_at: null,
    cleared_at: null,
    revision: 0,
  },
  revisionSummary: {
    source_revision: null,
    installed_config_revision: null,
    status: "UNKNOWN",
  },
};

const cards = new Map();
const grid = document.querySelector("#character-grid");
const eventList = document.querySelector("#event-list");
const activeCount = document.querySelector("#active-count");
const lastUpdate = document.querySelector("#last-update");
const connectionStatus = document.querySelector("#connection-status");
const template = document.querySelector("#character-card-template");
const clearEvents = document.querySelector("#clear-events");
const copyAccountLog = document.querySelector("#copy-account-log");
const accountDiagnosticRange = document.querySelector(
  "#account-diagnostic-range",
);
const movementMapApi = window.HeadlessMovementMap;
const movementMapSvg = document.querySelector("#movement-map");
const movementMapEmpty = document.querySelector("#movement-map-empty");
const movementLegend = document.querySelector("#movement-legend");
const movementMapSelect = document.querySelector("#movement-map-select");
const movementTrailRange = document.querySelector("#movement-trail-range");
const showMovementTrail = document.querySelector("#show-movement-trail");
const showPlannedPath = document.querySelector("#show-planned-path");
const showFacing = document.querySelector("#show-facing");
const showTargetLine = document.querySelector("#show-target-line");
const inventoryEquipmentApi = window.HeadlessInventoryEquipment;
const accountInventoryGrid = document.querySelector("#account-inventory-grid");
const emergencyStopControl = document.querySelector("#emergency-stop-control");
const emergencyStopStatus = document.querySelector("#emergency-stop-status");
const emergencyStopReason = document.querySelector("#emergency-stop-reason");
const activateEmergencyStop = document.querySelector(
  "#activate-emergency-stop",
);
const clearEmergencyStop = document.querySelector("#clear-emergency-stop");
const revisionSummary = document.querySelector("#revision-summary");
const revisionSummaryStatus = document.querySelector(
  "#revision-summary-status",
);
const revisionSummarySource = document.querySelector(
  "#revision-summary-source",
);
const revisionSummaryConfig = document.querySelector(
  "#revision-summary-config",
);

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("de-DE");
}

function formatHeartbeat(timestamp) {
  if (!timestamp) return "noch keiner";
  const ageSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return `${formatTimestamp(timestamp)} (${ageSeconds}s)`;
}

function formatCoordinate(value) {
  return Number.isFinite(value) ? Math.round(value) : "—";
}

function formatHeading(value, direction) {
  if (Number.isFinite(value)) return `${Math.round(value)}°`;
  return direction || "—";
}

function formatResources(game) {
  if (!game) return "—";
  return `HP ${game.hp ?? "—"}/${game.max_hp ?? "—"} · MP ${game.mp ?? "—"}/${
    game.max_mp ?? "—"
  }`;
}

function formatMovement(game) {
  if (!game) return "—";
  const movementState =
    game.movement_state || (game.moving ? "MOVING" : "IDLE");

  const destination = game.planned_destination || game.movement_destination;
  if (!destination) return movementState;

  return `${movementState} → ${formatCoordinate(
    destination.x,
  )}, ${formatCoordinate(destination.y)}`;
}

function formatTarget(game) {
  if (!game) return "—";
  const target = game.target;
  if (target) {
    return target.name || target.mtype || target.id || "Target";
  }
  return game.t_name || game.t_mtype || "—";
}

function formatInventory(game) {
  if (!game || !Number.isFinite(game.isize)) return "—";
  const free = Number.isFinite(game.esize) ? game.esize : 0;
  const used = Math.max(0, game.isize - free);
  return `${used}/${game.isize} belegt · ${free} frei`;
}

function badgeClass(lifecycleState) {
  return `state-${String(lifecycleState || "STOPPED").toLowerCase()}`;
}

function diagnosticUrl(path, range) {
  if (range === "incident") {
    if (path === "/headless/api/diagnostic") {
      return "/headless/api/incidents/latest";
    }

    const characterMatch = path.match(
      /^\/headless\/api\/characters\/([^/]+)\/diagnostic$/,
    );
    if (characterMatch) {
      return `/headless/api/incidents/latest?character=${characterMatch[1]}`;
    }
  }

  if (!range) return path;
  return `${path}?minutes=${encodeURIComponent(range)}`;
}

async function fetchDiagnostic(path, minutes) {
  const response = await fetch(diagnosticUrl(path, minutes), {
    cache: "no-store",
  });
  if (!response.ok) {
    let message = `Diagnostic request failed: ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.message || payload.error || message;
    } catch (_error) {
      // Plain-text error responses keep the status-based fallback.
    }
    throw new Error(message);
  }
  return response.text();
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Zwischenablage konnte nicht beschrieben werden");
  }
}

async function sendEmergencyStop(action) {
  const response = await fetch("/headless/api/emergency-stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      reason:
        action === "activate"
          ? "MANUAL_DASHBOARD_EMERGENCY_STOP"
          : "MANUAL_DASHBOARD_EMERGENCY_CLEAR",
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload.message || payload.error || "Emergency stop control failed",
    );
  }

  if (payload.snapshot) {
    applySnapshot(payload.snapshot);
  }
}

function formatRevision(value) {
  return value || "—";
}

function renderRevisionSummary() {
  const summary = state.revisionSummary || {
    source_revision: null,
    installed_config_revision: null,
    status: "UNKNOWN",
  };
  const status = summary.status || "UNKNOWN";

  revisionSummary.className = `revision-summary revision-${status.toLowerCase()}`;
  revisionSummaryStatus.textContent = `Revision: ${status}`;
  revisionSummarySource.textContent = `Source: ${formatRevision(
    summary.source_revision,
  )}`;
  revisionSummaryConfig.textContent = `Config: ${formatRevision(
    summary.installed_config_revision,
  )}`;
}

function renderEmergencyStop() {
  const emergency = state.emergencyStop || { active: false };

  emergencyStopControl.classList.toggle("active", !!emergency.active);
  emergencyStopStatus.textContent = emergency.active
    ? "Mutation Safety: EMERGENCY STOP"
    : "Mutation Safety: READY";
  emergencyStopReason.textContent = emergency.active
    ? emergency.reason || "Emergency stop active"
    : "Keine Sperre aktiv";

  activateEmergencyStop.hidden = !!emergency.active;
  clearEmergencyStop.hidden = !emergency.active;
}

async function sendCharacterControl(characterName, action) {
  const response = await fetch(
    `/headless/api/characters/${encodeURIComponent(characterName)}/control`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Control failed");
  }

  if (payload.snapshot) {
    applySnapshot(payload.snapshot);
  }
}

function updateControlButtons(card, character) {
  const desired =
    character.desired_runtime_state ||
    (character.enabled ? "RUNNING" : "STOPPED");
  const busy = card.dataset.controlBusy === "true";

  for (const button of card.querySelectorAll("[data-control]")) {
    const action = button.dataset.control;
    if (busy) {
      button.disabled = true;
    } else if (action === "start") {
      button.disabled =
        desired === "RUNNING" &&
        ["STARTING", "CONNECTING", "ONLINE"].includes(
          character.lifecycle_state,
        );
    } else if (action === "pause") {
      button.disabled =
        !character.pid || desired === "PAUSED" || desired === "STOPPED";
    } else if (action === "stop") {
      button.disabled = desired === "STOPPED" && !character.pid;
    }
  }
}

function configureCardInteractions(card) {
  const feedback = card.querySelector(".control-feedback");

  for (const button of card.querySelectorAll("[data-control]")) {
    button.addEventListener("click", async () => {
      const characterName = card.dataset.character;
      const character = state.characters.get(characterName);
      if (!character) return;

      const action = button.dataset.control;
      card.dataset.controlBusy = "true";
      updateControlButtons(card, character);
      feedback.textContent = `${action.toUpperCase()} wird ausgeführt …`;

      try {
        await sendCharacterControl(characterName, action);
        feedback.textContent = `${action.toUpperCase()} angefordert ✓`;
      } catch (error) {
        feedback.textContent = error.message;
        addEvent({
          timestamp: Date.now(),
          event: "CONTROL_ERROR",
          character: characterName,
          reason: error.message,
        });
        await loadInitialState().catch(() => {});
      } finally {
        card.dataset.controlBusy = "false";
        const current = state.characters.get(characterName);
        if (current) updateControlButtons(card, current);
      }
    });
  }

  const copyButton = card.querySelector("[data-copy-log]");
  const range = card.querySelector(".diagnostic-range");
  copyButton.addEventListener("click", async () => {
    const characterName = card.dataset.character;
    copyButton.disabled = true;
    feedback.textContent = "Diagnose wird erstellt …";

    try {
      const diagnostic = await fetchDiagnostic(
        `/headless/api/characters/${encodeURIComponent(
          characterName,
        )}/diagnostic`,
        range.value,
      );
      await writeClipboard(diagnostic);
      feedback.textContent = "Log in Zwischenablage kopiert ✓";
    } catch (error) {
      feedback.textContent = error.message;
      addEvent({
        timestamp: Date.now(),
        event: "DIAGNOSTIC_COPY_ERROR",
        character: characterName,
        reason: error.message,
      });
    } finally {
      copyButton.disabled = false;
    }
  });
}

function createCharacterCard(characterName) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.character = characterName;
  card.dataset.controlBusy = "false";
  configureCardInteractions(card);
  cards.set(characterName, card);
  return card;
}

function updateCharacterCard(card, character) {
  const game = character.game;
  const badge = card.querySelector(".state-badge");

  card.querySelector(".character-name").textContent = character.name;
  card.querySelector(".character-realm").textContent =
    character.realm || "Realm unbekannt";
  card.querySelector(".character-connected").textContent = character.connected
    ? "ONLINE"
    : "OFFLINE";
  card.querySelector(".character-desired-state").textContent =
    character.desired_runtime_state ||
    (character.enabled ? "RUNNING" : "STOPPED");
  card.querySelector(".character-class").textContent = game?.ctype || "—";
  card.querySelector(".character-map").textContent = game?.map || "—";
  card.querySelector(".character-position").textContent = game
    ? `${formatCoordinate(game.x)}, ${formatCoordinate(game.y)}`
    : "—";
  card.querySelector(".character-heading").textContent = formatHeading(
    game?.heading,
    game?.direction,
  );
  card.querySelector(".character-resources").textContent =
    formatResources(game);
  card.querySelector(".character-movement").textContent = formatMovement(game);
  card.querySelector(".character-target").textContent = formatTarget(game);
  card.querySelector(".character-inventory-summary").textContent =
    formatInventory(game);
  card.querySelector(".character-pid").textContent = character.pid || "—";
  card.querySelector(".character-script").textContent = character.script || "—";
  card.querySelector(".character-code-revision").textContent = formatRevision(
    character.code_revision,
  );
  card.querySelector(".character-installed-code-revision").textContent =
    formatRevision(character.installed_code_revision);
  card.querySelector(".character-config-revision").textContent = formatRevision(
    character.config_revision,
  );
  card.querySelector(".character-installed-config-revision").textContent =
    formatRevision(character.installed_config_revision);
  const revisionStatus = card.querySelector(".character-revision-status");
  revisionStatus.textContent = character.revision_status || "UNKNOWN";
  revisionStatus.className = `character-revision-status revision-text-${String(
    character.revision_status || "UNKNOWN",
  ).toLowerCase()}`;
  card.querySelector(".character-restarts").textContent =
    character.restart_attempts ?? 0;
  card.querySelector(".character-heartbeat").textContent = formatHeartbeat(
    character.last_heartbeat_at,
  );

  badge.textContent = character.lifecycle_state || "STOPPED";
  badge.className = `state-badge ${badgeClass(character.lifecycle_state)}`;
  updateControlButtons(card, character);
}

function synchronizeMovementMapOptions() {
  if (!movementMapApi) return;

  const maps = movementMapApi.availableMaps([...state.characters.values()]);
  const previous = movementMapSelect.value;

  movementMapSelect.replaceChildren();
  for (const mapName of maps) {
    const option = document.createElement("option");
    option.value = mapName;
    option.textContent = mapName;
    movementMapSelect.append(option);
  }

  if (maps.includes(previous)) {
    movementMapSelect.value = previous;
  } else if (maps.length > 0) {
    movementMapSelect.value = maps[0];
  }
}

function renderMovementMap() {
  if (!movementMapApi) return;

  synchronizeMovementMapOptions();
  movementMapApi.renderMovementMap({
    svg: movementMapSvg,
    legend: movementLegend,
    emptyState: movementMapEmpty,
    characters: [...state.characters.values()],
    mapName: movementMapSelect.value,
    trailMs: Number(movementTrailRange.value) || 120000,
    showTrail: showMovementTrail.checked,
    showPlan: showPlannedPath.checked,
    showFacing: showFacing.checked,
    showTarget: showTargetLine.checked,
  });
}

function renderInventoryEquipment() {
  if (!inventoryEquipmentApi) return;

  inventoryEquipmentApi.renderAccountInventory({
    container: accountInventoryGrid,
    characters: [...state.characters.values()],
  });
}

function renderCharacters() {
  const characters = [...state.characters.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const activeNames = new Set();

  for (const character of characters) {
    activeNames.add(character.name);
    const card =
      cards.get(character.name) || createCharacterCard(character.name);
    updateCharacterCard(card, character);
    grid.append(card);
  }

  for (const [name, card] of cards) {
    if (activeNames.has(name)) continue;
    card.remove();
    cards.delete(name);
  }

  const active = characters.filter((character) =>
    ["STARTING", "CONNECTING", "ONLINE", "PAUSED", "STOPPING"].includes(
      character.lifecycle_state,
    ),
  ).length;

  activeCount.textContent = `${active} / ${state.maxOnlineCharacters} aktiv`;
}

function refreshHeartbeatAges() {
  for (const [name, card] of cards) {
    const character = state.characters.get(name);
    if (!character) continue;
    card.querySelector(".character-heartbeat").textContent = formatHeartbeat(
      character.last_heartbeat_at,
    );
  }
}

function addEvent(event) {
  state.events.unshift(event);
  state.events = state.events.slice(0, 100);
  renderEvents();
}

function renderEvents() {
  eventList.replaceChildren();

  if (state.events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Noch keine Supervisor-Ereignisse.";
    eventList.append(empty);
    return;
  }

  for (const event of state.events) {
    const row = document.createElement("div");
    row.className = "event-row";

    const time = document.createElement("time");
    time.textContent = formatTimestamp(event.timestamp);

    const type = document.createElement("strong");
    type.textContent = event.event || event.type || "EVENT";

    const character = document.createElement("span");
    character.textContent = event.character || "Supervisor";

    const reason = document.createElement("span");
    reason.className = "event-reason";
    reason.textContent = [event.module || "", event.why || event.reason || ""]
      .filter(Boolean)
      .join(" · ");

    row.append(time, type, character, reason);
    eventList.append(row);
  }
}

function applySnapshot(snapshot) {
  state.maxOnlineCharacters = snapshot.max_online_characters || 4;
  state.emergencyStop = snapshot.emergency_stop || {
    active: false,
    reason: null,
    activated_at: null,
    cleared_at: null,
    revision: 0,
  };
  state.revisionSummary = snapshot.revision_summary || {
    source_revision: null,
    installed_config_revision: null,
    status: "UNKNOWN",
  };
  state.characters.clear();

  for (const character of snapshot.characters || []) {
    state.characters.set(character.name, character);
  }

  renderCharacters();
  renderMovementMap();
  renderInventoryEquipment();
  renderEmergencyStop();
  renderRevisionSummary();
  lastUpdate.textContent = `Update ${formatTimestamp(snapshot.generated_at)}`;
}

async function loadInitialState() {
  const response = await fetch("/headless/api/state", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Supervisor state request failed: ${response.status}`);
  }
  applySnapshot(await response.json());
}

function connectEvents() {
  const source = new EventSource("/headless/api/events");

  source.addEventListener("open", () => {
    connectionStatus.textContent = "Supervisor verbunden";
    connectionStatus.className = "connected";
  });

  source.addEventListener("snapshot", (message) => {
    applySnapshot(JSON.parse(message.data));
  });

  source.addEventListener("supervisor", (message) => {
    const event = JSON.parse(message.data);
    addEvent(event);
    loadInitialState().catch(() => {});
  });

  source.addEventListener("error", () => {
    connectionStatus.textContent =
      "Supervisor-Verbindung wird wiederhergestellt …";
    connectionStatus.className = "disconnected";
  });
}

clearEvents.addEventListener("click", () => {
  state.events = [];
  renderEvents();
});

activateEmergencyStop.addEventListener("click", async () => {
  activateEmergencyStop.disabled = true;

  try {
    await sendEmergencyStop("activate");
  } catch (error) {
    addEvent({
      timestamp: Date.now(),
      event: "EMERGENCY_STOP_CONTROL_ERROR",
      reason: error.message,
    });
  } finally {
    activateEmergencyStop.disabled = false;
  }
});

clearEmergencyStop.addEventListener("click", async () => {
  clearEmergencyStop.disabled = true;

  try {
    await sendEmergencyStop("clear");
  } catch (error) {
    addEvent({
      timestamp: Date.now(),
      event: "EMERGENCY_STOP_CONTROL_ERROR",
      reason: error.message,
    });
  } finally {
    clearEmergencyStop.disabled = false;
  }
});

for (const control of [
  movementMapSelect,
  movementTrailRange,
  showMovementTrail,
  showPlannedPath,
  showFacing,
  showTargetLine,
]) {
  control.addEventListener("change", renderMovementMap);
}

copyAccountLog.addEventListener("click", async () => {
  const originalText = copyAccountLog.textContent;
  copyAccountLog.disabled = true;
  copyAccountLog.textContent = "Kopiere …";

  try {
    const diagnostic = await fetchDiagnostic(
      "/headless/api/diagnostic",
      accountDiagnosticRange.value,
    );
    await writeClipboard(diagnostic);
    copyAccountLog.textContent = "Kopiert ✓";
  } catch (error) {
    copyAccountLog.textContent = "Fehler";
    addEvent({
      timestamp: Date.now(),
      event: "ACCOUNT_DIAGNOSTIC_COPY_ERROR",
      reason: error.message,
    });
  } finally {
    setTimeout(() => {
      copyAccountLog.disabled = false;
      copyAccountLog.textContent = originalText;
    }, 1200);
  }
});

setInterval(refreshHeartbeatAges, 1000);

loadInitialState()
  .then(connectEvents)
  .catch((error) => {
    connectionStatus.textContent = error.message;
    connectionStatus.className = "disconnected";
    connectEvents();
  });

renderEvents();

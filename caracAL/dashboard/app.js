"use strict";

const state = {
  characters: new Map(),
  events: [],
  maxOnlineCharacters: 4,
};

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

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("de-DE");
}

function formatHeartbeat(timestamp) {
  if (!timestamp) return "noch keiner";
  const ageSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return `${formatTimestamp(timestamp)} (${ageSeconds}s)`;
}

function badgeClass(lifecycleState) {
  return `state-${String(lifecycleState || "STOPPED").toLowerCase()}`;
}

function diagnosticUrl(path, minutes) {
  if (!minutes) return path;
  return `${path}?minutes=${encodeURIComponent(minutes)}`;
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

function configureControlButtons(card, character) {
  const desired =
    character.desired_runtime_state ||
    (character.enabled ? "RUNNING" : "STOPPED");
  const buttons = card.querySelectorAll("[data-control]");
  const feedback = card.querySelector(".control-feedback");

  for (const button of buttons) {
    const action = button.dataset.control;

    if (action === "start") {
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

    button.addEventListener("click", async () => {
      for (const control of buttons) {
        control.disabled = true;
      }
      feedback.textContent = `${action.toUpperCase()} wird ausgeführt …`;

      try {
        await sendCharacterControl(character.name, action);
      } catch (error) {
        feedback.textContent = error.message;
        addEvent({
          timestamp: Date.now(),
          event: "CONTROL_ERROR",
          character: character.name,
          reason: error.message,
        });
        await loadInitialState().catch(() => {});
      }
    });
  }
}

function configureDiagnosticCopy(card, character) {
  const button = card.querySelector("[data-copy-log]");
  const range = card.querySelector(".diagnostic-range");
  const feedback = card.querySelector(".control-feedback");

  button.addEventListener("click", async () => {
    button.disabled = true;
    feedback.textContent = "Diagnose wird erstellt …";

    try {
      const diagnostic = await fetchDiagnostic(
        `/headless/api/characters/${encodeURIComponent(character.name)}/diagnostic`,
        range.value,
      );
      await writeClipboard(diagnostic);
      feedback.textContent = "Log in Zwischenablage kopiert ✓";
    } catch (error) {
      feedback.textContent = error.message;
      addEvent({
        timestamp: Date.now(),
        event: "DIAGNOSTIC_COPY_ERROR",
        character: character.name,
        reason: error.message,
      });
    } finally {
      button.disabled = false;
    }
  });
}

function refreshHeartbeatAges() {
  for (const card of grid.querySelectorAll("[data-character]")) {
    const character = state.characters.get(card.dataset.character);
    if (!character) continue;
    card.querySelector(".character-heartbeat").textContent = formatHeartbeat(
      character.last_heartbeat_at,
    );
  }
}

function renderCharacters() {
  grid.replaceChildren();

  const characters = [...state.characters.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const character of characters) {
    const card = template.content.firstElementChild.cloneNode(true);
    const badge = card.querySelector(".state-badge");
    card.dataset.character = character.name;

    card.querySelector(".character-name").textContent = character.name;
    card.querySelector(".character-realm").textContent =
      character.realm || "Realm unbekannt";
    card.querySelector(".character-connected").textContent = character.connected
      ? "ONLINE"
      : "OFFLINE";
    card.querySelector(".character-desired-state").textContent =
      character.desired_runtime_state ||
      (character.enabled ? "RUNNING" : "STOPPED");
    card.querySelector(".character-pid").textContent = character.pid || "—";
    card.querySelector(".character-script").textContent =
      character.script || "—";
    card.querySelector(".character-restarts").textContent =
      character.restart_attempts ?? 0;
    card.querySelector(".character-heartbeat").textContent = formatHeartbeat(
      character.last_heartbeat_at,
    );

    badge.textContent = character.lifecycle_state || "STOPPED";
    badge.className = `state-badge ${badgeClass(character.lifecycle_state)}`;

    configureControlButtons(card, character);
    configureDiagnosticCopy(card, character);
    grid.append(card);
  }

  const active = characters.filter((character) =>
    ["STARTING", "CONNECTING", "ONLINE", "PAUSED", "STOPPING"].includes(
      character.lifecycle_state,
    ),
  ).length;

  activeCount.textContent = `${active} / ${state.maxOnlineCharacters} aktiv`;
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
    reason.textContent = event.reason || "";

    row.append(time, type, character, reason);
    eventList.append(row);
  }
}

function applySnapshot(snapshot) {
  state.maxOnlineCharacters = snapshot.max_online_characters || 4;
  state.characters.clear();

  for (const character of snapshot.characters || []) {
    state.characters.set(character.name, character);
  }

  renderCharacters();
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

    // Lifecycle events affect card state, so fetch one authoritative snapshot.
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

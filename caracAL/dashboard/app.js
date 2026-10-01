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

function renderCharacters() {
  grid.replaceChildren();

  const characters = [...state.characters.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const character of characters) {
    const card = template.content.firstElementChild.cloneNode(true);
    const badge = card.querySelector(".state-badge");

    card.querySelector(".character-name").textContent = character.name;
    card.querySelector(".character-realm").textContent =
      character.realm || "Realm unbekannt";
    card.querySelector(".character-connected").textContent = character.connected
      ? "ONLINE"
      : "OFFLINE";
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
    connectionStatus.textContent = "Supervisor-Verbindung wird wiederhergestellt …";
    connectionStatus.className = "disconnected";
  });
}

clearEvents.addEventListener("click", () => {
  state.events = [];
  renderEvents();
});

setInterval(() => {
  renderCharacters();
}, 1000);

loadInitialState()
  .then(connectEvents)
  .catch((error) => {
    connectionStatus.textContent = error.message;
    connectionStatus.className = "disconnected";
    connectEvents();
  });

renderEvents();

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
  persistence: {
    status: "UNKNOWN",
    database_path: null,
    schema_version: null,
    current_schema_version: null,
    flush_count: 0,
    closed: true,
    last_error: null,
  },
  fullAutonomy: {
    state: "EMPTY",
    readOnly: true,
    executionEnabled: false,
    desiredStateMutationDispatched: false,
    maxOnlineCharacters: 4,
    recommendations: [],
    summary: {
      selectedCharacters: 0,
      selectedMerchant: 0,
      selectedCombat: 0,
      manualStopProtected: 0,
    },
  },
  mapScenes: new Map(),
  mapSceneRequests: new Map(),
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
const movementMapBackground = document.querySelector(
  "#movement-map-background",
);
const movementMapSvg = document.querySelector("#movement-map");
const movementMapEmpty = document.querySelector("#movement-map-empty");
const movementLegend = document.querySelector("#movement-legend");
const movementMapSelect = document.querySelector("#movement-map-select");
const movementTrailRange = document.querySelector("#movement-trail-range");
const showMovementTrail = document.querySelector("#show-movement-trail");
const showPlannedPath = document.querySelector("#show-planned-path");
const showFacing = document.querySelector("#show-facing");
const showTargetLine = document.querySelector("#show-target-line");
const showNearbyMonsters = document.querySelector("#show-nearby-monsters");
const showNearbyNpcs = document.querySelector("#show-nearby-npcs");
const inventoryEquipmentApi = window.HeadlessInventoryEquipment;
const configFormApi = window.HeadlessConfigForm;
const configDialog = document.querySelector("#config-dialog");
const configDialogForm = document.querySelector("#config-dialog-form");
const configDialogTitle = document.querySelector("#config-dialog-title");
const configDialogMeta = document.querySelector("#config-dialog-meta");
const configDialogFeedback = document.querySelector("#config-dialog-feedback");
const configDialogClose = document.querySelector("#config-dialog-close");
const configDialogCancel = document.querySelector("#config-dialog-cancel");
const configDialogReload = document.querySelector("#config-dialog-reload");
const configDialogSave = document.querySelector("#config-dialog-save");
const configFormRoot = document.querySelector("#config-form-root");
const configEditor = {
  characterName: null,
  baseConfig: {},
  revision: null,
};
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
const persistenceSummary = document.querySelector("#persistence-summary");
const persistenceSummaryStatus = document.querySelector(
  "#persistence-summary-status",
);
const persistenceSummarySchema = document.querySelector(
  "#persistence-summary-schema",
);
const persistenceSummaryFlushes = document.querySelector(
  "#persistence-summary-flushes",
);
const fullAutonomySummary = document.querySelector("#full-autonomy-summary");
const fullAutonomyStatus = document.querySelector("#full-autonomy-status");
const fullAutonomySelection = document.querySelector(
  "#full-autonomy-selection",
);
const fullAutonomyExecution = document.querySelector(
  "#full-autonomy-execution",
);
const rotationStopCharacter = document.querySelector(
  "#rotation-stop-character",
);
const rotationStartCharacter = document.querySelector(
  "#rotation-start-character",
);
const rotateCharacters = document.querySelector("#rotate-characters");

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
  const physicalState =
    game.movement_state || (game.moving ? "MOVING" : "IDLE");
  const movementMode = game.movement_mode || null;
  const movementState =
    movementMode && movementMode !== physicalState
      ? `${movementMode} / ${physicalState}`
      : movementMode || physicalState;

  const destination =
    game.runtime_planned_destination ||
    game.planned_destination ||
    game.movement_destination;
  if (!destination) return movementState;

  const map = destination.map ? `${destination.map} · ` : "";
  return `${movementState} → ${map}${formatCoordinate(
    destination.x,
  )}, ${formatCoordinate(destination.y)}`;
}

function formatMovementOwner(game) {
  return game?.movement_owner || "—";
}

function formatMovementCommand(game) {
  const command = game?.movement_command;
  if (!command) return "—";

  const id = Number.isInteger(command.id) ? `#${command.id}` : "";
  const action = command.actionId ? ` · ${command.actionId}` : "";
  return `${command.type || "COMMAND"}${id}${action}`;
}

function formatMovementReason(game) {
  return game?.movement_reason || game?.movement_command?.reason || "—";
}

function formatSafePoint(game) {
  const point = game?.safe_point;
  if (!point) return "—";
  const map = point.map ? `${point.map} · ` : "";
  return `${map}${formatCoordinate(point.x)}, ${formatCoordinate(point.y)}`;
}

function formatMovementStuck(game) {
  const stuck = game?.movement_stuck;
  if (!stuck) return "—";
  if (!stuck.stuck) {
    return stuck.lastProgressAt
      ? `OK · Progress ${formatTimestamp(stuck.lastProgressAt)}`
      : "OK";
  }

  return stuck.stuckSince
    ? `STUCK seit ${formatTimestamp(stuck.stuckSince)}`
    : "STUCK";
}

function formatMovementLiveTest(liveTest) {
  if (!liveTest) return "noch nicht ausgeführt";
  if (liveTest.status === "STARTING" || liveTest.status === "RUNNING") {
    return `${liveTest.status} · ${liveTest.request_id || "—"}`;
  }

  const outcome = liveTest.outcome || liveTest.status || "UNKNOWN";
  const reason = liveTest.reason ? ` · ${liveTest.reason}` : "";
  const completed = liveTest.completed_at
    ? ` · ${formatTimestamp(liveTest.completed_at)}`
    : "";
  return `${outcome}${reason}${completed}`;
}

function formatClassSkills(runtime) {
  if (!runtime) return "—";
  const className = runtime.className || "unknown";
  const state = runtime.state || "UNKNOWN";
  const reason = runtime.reason ? ` · ${runtime.reason}` : "";
  const configured =
    Array.isArray(runtime.configuredSkills) && runtime.configuredSkills.length
      ? ` · ${runtime.configuredSkills.join(", ")}`
      : "";
  return `${className} · ${state}${reason}${configured}`;
}

function formatClassSkillAction(runtime) {
  if (!runtime) return "—";
  const action = runtime.lastAction;
  if (!action) {
    return runtime.selectedSkill ? `${runtime.selectedSkill} · bereit` : "—";
  }
  const target = runtime.targetId ? ` · Target ${runtime.targetId}` : "";
  return `${action.skill || runtime.selectedSkill || "Skill"} · ${
    action.status || "UNKNOWN"
  }${target}`;
}

function formatGroupCombat(runtime) {
  if (!runtime) return "—";
  const role = runtime.role || "NONE";
  const state = runtime.state || "UNKNOWN";
  const reason = runtime.reason ? ` · ${runtime.reason}` : "";
  const party =
    Array.isArray(runtime.partyMembers) && runtime.partyMembers.length
      ? ` · Party ${runtime.partyMembers.join(", ")}`
      : "";
  return `${role} · ${state}${reason}${party}`;
}

function formatGroupTether(runtime) {
  if (!runtime?.tether) return "—";
  const tether = runtime.tether;
  const distance = Number.isFinite(tether.distance)
    ? `Dist ${Math.round(tether.distance)}`
    : tether.leaderVisible
    ? "Dist unbekannt"
    : "Leader nicht sichtbar";
  const focus = runtime.focusTargetId
    ? ` · Focus ${runtime.focusTargetId}`
    : "";
  return `${distance} · Soft ${Math.round(
    tether.softDistance || 0,
  )} · Hard ${Math.round(tether.hardDistance || 0)}${focus}`;
}

function formatFarmIntelligence(runtime) {
  if (!runtime) return "—";
  if (runtime.state === "DISABLED") return "DISABLED";
  const selected = runtime.selected;
  if (!selected) return runtime.reason || runtime.state || "NO_CANDIDATES";
  const observed = selected.observed
    ? ` · Obs XP/h ${Math.round(
        selected.observed.xpPerHour || 0,
      )} · Gold/h ${Math.round(selected.observed.goldPerHour || 0)}`
    : "";
  return `${selected.monster} · ${selected.map} · Score ${selected.score}${observed}`;
}

function formatFarmWhyMonster(runtime) {
  return runtime?.selected?.whyMonster || "—";
}

function formatFarmWhySpot(runtime) {
  return runtime?.selected?.whySpot || "—";
}

function formatCombat(combat) {
  if (!combat) return "—";
  const reason = combat.reason ? ` · ${combat.reason}` : "";
  return `${combat.state || "UNKNOWN"}${reason}`;
}

function formatCombatTarget(combat) {
  const target = combat?.target;
  if (!target) return "—";
  const label = target.name || target.mtype || target.id || "Target";
  const distance = Number.isFinite(target.distance)
    ? ` · Dist ${Math.round(target.distance)}`
    : "";
  const range = Number.isFinite(target.attackRange)
    ? ` / Range ${Math.round(target.attackRange)}`
    : "";
  const inRange =
    target.inRange === true
      ? " · IN RANGE"
      : target.inRange === false
      ? " · OUT"
      : "";
  return `${label}${distance}${range}${inRange}`;
}

function formatCombatCooldowns(combat) {
  if (!combat?.cooldowns) return "—";
  return `Attack ${combat.cooldowns.attackRemainingMs || 0}ms · HP Pot ${
    combat.cooldowns.hpPotionRemainingMs || 0
  }ms · MP Pot ${combat.cooldowns.mpPotionRemainingMs || 0}ms`;
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

function renderPersistenceSummary() {
  const persistence = state.persistence || {
    status: "UNKNOWN",
    schema_version: null,
    current_schema_version: null,
    flush_count: 0,
    last_error: null,
  };
  const status = persistence.status || "UNKNOWN";

  persistenceSummary.className = `persistence-summary persistence-${status.toLowerCase()}`;
  persistenceSummaryStatus.textContent = `Persistence: ${status}`;
  persistenceSummarySchema.textContent = `Schema: ${
    persistence.schema_version ?? "—"
  }/${persistence.current_schema_version ?? "—"}`;
  persistenceSummaryFlushes.textContent = persistence.last_error
    ? `Fehler: ${persistence.last_error}`
    : `Flushes: ${persistence.flush_count ?? 0}`;
}

function renderFullAutonomySummary() {
  const autonomy = state.fullAutonomy || {};
  const status = autonomy.state || "EMPTY";
  const summary = autonomy.summary || {};
  const selected = Number(summary.selectedCharacters) || 0;
  const maxOnline =
    Number(autonomy.maxOnlineCharacters) || state.maxOnlineCharacters || 4;
  const protectedStops = Number(summary.manualStopProtected) || 0;

  fullAutonomySummary.className =
    `revision-summary revision-${status.toLowerCase()}`;
  fullAutonomyStatus.textContent = `Full Autonomy: ${status}`;
  fullAutonomySelection.textContent =
    `Plan: ${selected} / ${maxOnline} · Merchant ${summary.selectedMerchant ?? 0} · Combat ${summary.selectedCombat ?? 0}`;
  fullAutonomyExecution.textContent = autonomy.executionEnabled
    ? `Execution: ENABLED · STOP-Schutz ${protectedStops}`
    : `Execution: READ-ONLY · STOP-Schutz ${protectedStops}`;
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

async function sendCharacterRotation(stopCharacter, startCharacter) {
  const response = await fetch("/headless/api/rotation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stop_character: stopCharacter,
      start_character: startCharacter,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Rotation failed");
  }

  if (payload.snapshot) {
    applySnapshot(payload.snapshot);
  }
}

function replaceRotationOptions(select, characters, placeholder) {
  const previous = select.value;
  select.replaceChildren();

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.append(empty);

  for (const character of characters) {
    const option = document.createElement("option");
    option.value = character.name;
    option.textContent = character.name;
    select.append(option);
  }

  if (characters.some((character) => character.name === previous)) {
    select.value = previous;
  }
}

function onlineCharacters() {
  return [...state.characters.values()].filter(
    (character) => character.connected === true,
  );
}

function renderRotationControls() {
  const characters = [...state.characters.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const sources = characters.filter((character) => {
    const desired =
      character.desired_runtime_state ||
      (character.enabled ? "RUNNING" : "STOPPED");
    return (
      !!character.pid &&
      desired !== "STOPPED" &&
      character.lifecycle_state !== "STOPPING" &&
      !character.rotation_replacement
    );
  });

  const targets = characters.filter((character) => {
    const desired =
      character.desired_runtime_state ||
      (character.enabled ? "RUNNING" : "STOPPED");
    return (
      character.account_owned === true &&
      !character.pid &&
      desired === "STOPPED" &&
      !character.rotation_source
    );
  });

  replaceRotationOptions(rotationStopCharacter, sources, "Auswechseln …");
  replaceRotationOptions(rotationStartCharacter, targets, "Einwechseln …");

  rotateCharacters.disabled =
    !rotationStopCharacter.value || !rotationStartCharacter.value;
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

async function sendMovementLiveTest(characterName) {
  const response = await fetch(
    `/headless/api/characters/${encodeURIComponent(
      characterName,
    )}/tests/movement`,
    {
      method: "POST",
    },
  );
  const payload = await response.json();

  if (payload.snapshot) {
    applySnapshot(payload.snapshot);
  }
  if (!response.ok) {
    throw new Error(
      payload.message || payload.error || "Movement live test failed",
    );
  }
  return payload.result;
}

async function sendCombatLiveTest(characterName) {
  const response = await fetch(
    `/headless/api/characters/${encodeURIComponent(
      characterName,
    )}/tests/combat`,
    {
      method: "POST",
    },
  );
  const payload = await response.json();

  if (payload.snapshot) {
    applySnapshot(payload.snapshot);
  }
  if (!response.ok) {
    throw new Error(
      payload.message || payload.error || "Combat live test failed",
    );
  }
  return payload.result;
}

async function fetchCharacterConfig(characterName) {
  const response = await fetch(
    `/headless/api/characters/${encodeURIComponent(characterName)}/config`,
    { cache: "no-store" },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload.message || payload.error || "Config konnte nicht geladen werden",
    );
  }
  return payload;
}

async function sendCharacterConfig(characterName, config) {
  const response = await fetch(
    `/headless/api/characters/${encodeURIComponent(characterName)}/config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    },
  );
  const payload = await response.json();

  if (payload.snapshot) applySnapshot(payload.snapshot);
  if (!response.ok) {
    throw new Error(
      payload.message ||
        payload.error ||
        "Config konnte nicht gespeichert werden",
    );
  }
  return payload;
}

function renderConfigDialogMeta(characterName) {
  const character = state.characters.get(characterName);
  if (!character) {
    configDialogMeta.textContent = "Character nicht im Supervisor-Status.";
    return;
  }

  const applied = character.applied_runtime_config_revision ?? "—";
  const status = character.config_push_status || "UNKNOWN";
  const source = character.runtime_config_source || "CONFIG";
  const error = character.config_push_error
    ? ` · ${character.config_push_error}`
    : "";
  configDialogMeta.textContent =
    `Rev ${character.runtime_config_revision ?? 0} · angewendet ${applied} · ` +
    `${status} · ${source}${error}`;
}

async function loadConfigEditor(characterName) {
  if (!configFormApi) {
    throw new Error("Config Form Engine ist nicht verfügbar");
  }

  configDialogFeedback.textContent = "Konfiguration wird geladen …";
  configDialogSave.disabled = true;
  configDialogReload.disabled = true;

  try {
    const payload = await fetchCharacterConfig(characterName);
    const character = state.characters.get(characterName);
    configEditor.characterName = characterName;
    configEditor.baseConfig = payload.config || {};
    configEditor.revision = payload.revision ?? 0;
    configDialogTitle.textContent = `Konfiguration · ${characterName}`;
    configFormApi.renderConfigForm({
      container: configFormRoot,
      config: configEditor.baseConfig,
      ctype: character?.ctype || character?.game?.ctype || null,
      characterNames: [...state.characters.keys()],
    });
    renderConfigDialogMeta(characterName);
    configDialogFeedback.textContent = payload.redacted_paths?.length
      ? `Geladen · ${payload.redacted_paths.length} sensible Werte werden nicht angezeigt.`
      : "Konfiguration geladen.";
  } finally {
    configDialogSave.disabled = false;
    configDialogReload.disabled = false;
  }
}

async function openCharacterConfig(characterName) {
  configEditor.characterName = characterName;
  configDialogTitle.textContent = `Konfiguration · ${characterName}`;
  configDialogMeta.textContent = "Lade Revision …";
  configDialogFeedback.textContent = "";
  configFormRoot.replaceChildren();

  if (typeof configDialog.showModal === "function") {
    if (!configDialog.open) configDialog.showModal();
  } else {
    configDialog.setAttribute("open", "");
  }

  try {
    await loadConfigEditor(characterName);
  } catch (error) {
    configDialogFeedback.textContent = error.message;
    addEvent({
      timestamp: Date.now(),
      event: "CONFIG_UI_LOAD_ERROR",
      character: characterName,
      reason: error.message,
    });
  }
}

function closeConfigDialog() {
  if (typeof configDialog.close === "function" && configDialog.open) {
    configDialog.close();
  } else {
    configDialog.removeAttribute("open");
  }
  configEditor.characterName = null;
  configEditor.baseConfig = {};
  configEditor.revision = null;
}

async function saveOpenCharacterConfig() {
  const characterName = configEditor.characterName;
  if (!characterName) return;

  let config;
  try {
    config = configFormApi.collectConfig({
      container: configFormRoot,
      baseConfig: configEditor.baseConfig,
    });
  } catch (error) {
    configDialogFeedback.textContent = error.message;
    return;
  }

  configDialogSave.disabled = true;
  configDialogReload.disabled = true;
  configDialogFeedback.textContent = "Speichere und übernehme live …";

  try {
    const payload = await sendCharacterConfig(characterName, config);
    configEditor.baseConfig = config;
    configEditor.revision = payload.result?.revision ?? configEditor.revision;
    renderConfigDialogMeta(characterName);
    configDialogFeedback.textContent =
      `Gespeichert · Rev ${payload.result?.revision ?? "—"} · ` +
      `${payload.result?.status || "UNKNOWN"}`;
  } catch (error) {
    configDialogFeedback.textContent = error.message;
    addEvent({
      timestamp: Date.now(),
      event: "CONFIG_UI_SAVE_ERROR",
      character: characterName,
      reason: error.message,
    });
  } finally {
    configDialogSave.disabled = false;
    configDialogReload.disabled = false;
  }
}

async function sendClassSkillLiveTest(characterName) {
  const response = await fetch(
    `/headless/api/characters/${encodeURIComponent(
      characterName,
    )}/tests/class-skill`,
    {
      method: "POST",
    },
  );
  const payload = await response.json();

  if (payload.snapshot) {
    applySnapshot(payload.snapshot);
  }
  if (!response.ok) {
    throw new Error(
      payload.message || payload.error || "Class skill live test failed",
    );
  }
  return payload.result;
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
    } else if (action === "restart") {
      button.disabled =
        !character.pid ||
        desired === "STOPPED" ||
        character.lifecycle_state === "STOPPING";
    } else if (action === "stop") {
      button.disabled = desired === "STOPPED" && !character.pid;
    }
  }

  const configButton = card.querySelector("[data-config]");
  const movementLiveTestButton = card.querySelector(
    "[data-movement-live-test]",
  );
  const combatLiveTestButton = card.querySelector("[data-combat-live-test]");
  const classSkillLiveTestButton = card.querySelector(
    "[data-class-skill-live-test]",
  );
  const movementTestRunning = ["STARTING", "RUNNING"].includes(
    character.movement_live_test?.status || "",
  );
  const combatTestRunning = ["STARTING", "RUNNING"].includes(
    character.combat_live_test?.status || "",
  );
  const classSkillTestRunning = ["STARTING", "RUNNING"].includes(
    character.class_skill_live_test?.status || "",
  );
  const anyLiveTestRunning =
    movementTestRunning || combatTestRunning || classSkillTestRunning;

  if (configButton) {
    configButton.disabled = busy;
  }
  if (movementLiveTestButton) {
    movementLiveTestButton.disabled = busy || anyLiveTestRunning;
  }
  if (combatLiveTestButton) {
    combatLiveTestButton.disabled =
      busy || anyLiveTestRunning || character.ctype === "merchant";
  }
  if (classSkillLiveTestButton) {
    classSkillLiveTestButton.disabled =
      busy || anyLiveTestRunning || character.ctype !== "ranger";
  }
}

function collapseStorageKey(scope, identity) {
  return `headless.dashboard.collapse.${scope}.${identity}`;
}

function storedCollapsed(key) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch (_error) {
    return false;
  }
}

function storeCollapsed(key, collapsed) {
  try {
    window.localStorage.setItem(key, collapsed ? "1" : "0");
  } catch (_error) {
    // localStorage may be unavailable in privacy-restricted contexts.
  }
}

function initializeCollapsible(container, headingSelector, key) {
  if (!container || container.dataset.collapsibleReady === "true") return;

  const heading = container.querySelector(headingSelector);
  if (!heading) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "collapse-toggle";
  button.setAttribute("aria-label", "Bereich ein- oder ausklappen");

  const apply = (collapsed, persist = true) => {
    container.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.textContent = collapsed ? "▸" : "▾";
    button.title = collapsed ? "Bereich ausklappen" : "Bereich einklappen";
    if (persist) storeCollapsed(key, collapsed);

    if (!collapsed && container.classList.contains("movement-panel")) {
      requestAnimationFrame(() => renderMovementMap());
    }
  };

  heading.append(button);
  container.dataset.collapsibleReady = "true";
  button.addEventListener("click", () => {
    apply(!container.classList.contains("is-collapsed"));
  });
  apply(storedCollapsed(key), false);
}

function initializeDashboardCollapsibles() {
  document.querySelectorAll("main > .panel").forEach((panel, index) => {
    const title = panel.querySelector(".panel-heading h2")?.textContent?.trim();
    initializeCollapsible(
      panel,
      ".panel-heading",
      collapseStorageKey("panel", title || String(index)),
    );
  });
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

  const configButton = card.querySelector("[data-config]");
  configButton?.addEventListener("click", async () => {
    const characterName = card.dataset.character;
    await openCharacterConfig(characterName);
  });

  const movementLiveTestButton = card.querySelector(
    "[data-movement-live-test]",
  );
  movementLiveTestButton?.addEventListener("click", async () => {
    const characterName = card.dataset.character;
    const character = state.characters.get(characterName);
    if (!character) return;

    card.dataset.controlBusy = "true";
    updateControlButtons(card, character);
    feedback.textContent = "Autonomer Movement-E2E-Test läuft …";

    try {
      const result = await sendMovementLiveTest(characterName);
      feedback.textContent = `Movement E2E: ${result?.outcome || "UNKNOWN"} · ${
        result?.reason || "ohne Reason"
      }`;
    } catch (error) {
      feedback.textContent = error.message;
      addEvent({
        timestamp: Date.now(),
        event: "MOVEMENT_LIVE_TEST_UI_ERROR",
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

  const combatLiveTestButton = card.querySelector("[data-combat-live-test]");
  combatLiveTestButton?.addEventListener("click", async () => {
    const characterName = card.dataset.character;
    const character = state.characters.get(characterName);
    if (!character) return;

    card.dataset.controlBusy = "true";
    updateControlButtons(card, character);
    feedback.textContent = "Autonomer Combat-E2E-Test läuft …";

    try {
      const result = await sendCombatLiveTest(characterName);
      feedback.textContent = `Combat E2E: ${result?.outcome || "UNKNOWN"} · ${
        result?.reason || "ohne Reason"
      }`;
    } catch (error) {
      feedback.textContent = error.message;
      addEvent({
        timestamp: Date.now(),
        event: "COMBAT_LIVE_TEST_UI_ERROR",
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

  const classSkillLiveTestButton = card.querySelector(
    "[data-class-skill-live-test]",
  );
  classSkillLiveTestButton?.addEventListener("click", async () => {
    const characterName = card.dataset.character;
    const character = state.characters.get(characterName);
    if (!character) return;

    card.dataset.controlBusy = "true";
    updateControlButtons(card, character);
    feedback.textContent = "Autonomer Class-Skill-E2E-Test läuft …";

    try {
      const result = await sendClassSkillLiveTest(characterName);
      feedback.textContent = `Class Skill E2E: ${
        result?.outcome || "UNKNOWN"
      } · ${result?.reason || "ohne Reason"}`;
    } catch (error) {
      feedback.textContent = error.message;
      addEvent({
        timestamp: Date.now(),
        event: "CLASS_SKILL_LIVE_TEST_UI_ERROR",
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
  initializeCollapsible(
    card,
    ".character-header",
    collapseStorageKey("character", characterName),
  );
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
  const desiredState =
    character.desired_runtime_state ||
    (character.enabled ? "RUNNING" : "STOPPED");
  const desiredSource = character.desired_runtime_state_source || "UNKNOWN";
  card.querySelector(".character-desired-state").textContent =
    `${desiredState} · ${desiredSource}`;
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
  card.querySelector(".character-combat").textContent = formatCombat(
    character.combat_runtime,
  );
  card.querySelector(".character-combat-target").textContent =
    formatCombatTarget(character.combat_runtime);
  card.querySelector(".character-combat-cooldowns").textContent =
    formatCombatCooldowns(character.combat_runtime);
  card.querySelector(".character-class-skills").textContent = formatClassSkills(
    character.class_skill_runtime,
  );
  card.querySelector(".character-class-skill-action").textContent =
    formatClassSkillAction(character.class_skill_runtime);
  card.querySelector(".character-group-combat").textContent = formatGroupCombat(
    character.group_combat_runtime,
  );
  card.querySelector(".character-group-tether").textContent = formatGroupTether(
    character.group_combat_runtime,
  );
  card.querySelector(".character-farm-intelligence").textContent =
    formatFarmIntelligence(character.farm_intelligence_runtime);
  card.querySelector(".character-farm-why-monster").textContent =
    formatFarmWhyMonster(character.farm_intelligence_runtime);
  card.querySelector(".character-farm-why-spot").textContent =
    formatFarmWhySpot(character.farm_intelligence_runtime);
  card.querySelector(".character-movement").textContent = formatMovement(game);
  card.querySelector(".character-movement-owner").textContent =
    formatMovementOwner(game);
  card.querySelector(".character-movement-command").textContent =
    formatMovementCommand(game);
  card.querySelector(".character-movement-reason").textContent =
    formatMovementReason(game);
  card.querySelector(".character-safe-point").textContent =
    formatSafePoint(game);
  const stuckState = card.querySelector(".character-stuck-state");
  stuckState.textContent = formatMovementStuck(game);
  stuckState.classList.toggle(
    "movement-stuck-active",
    !!game?.movement_stuck?.stuck,
  );
  const movementLiveTest = card.querySelector(".character-movement-live-test");
  movementLiveTest.textContent = formatMovementLiveTest(
    character.movement_live_test,
  );
  movementLiveTest.className = `character-movement-live-test movement-live-test-${String(
    character.movement_live_test?.outcome ||
      character.movement_live_test?.status ||
      "idle",
  ).toLowerCase()}`;
  const combatLiveTest = card.querySelector(".character-combat-live-test");
  combatLiveTest.textContent = formatMovementLiveTest(
    character.combat_live_test,
  );
  combatLiveTest.className = `character-combat-live-test movement-live-test-${String(
    character.combat_live_test?.outcome ||
      character.combat_live_test?.status ||
      "idle",
  ).toLowerCase()}`;
  const classSkillLiveTest = card.querySelector(
    ".character-class-skill-live-test",
  );
  classSkillLiveTest.textContent = formatMovementLiveTest(
    character.class_skill_live_test,
  );
  classSkillLiveTest.className = `character-class-skill-live-test movement-live-test-${String(
    character.class_skill_live_test?.outcome ||
      character.class_skill_live_test?.status ||
      "idle",
  ).toLowerCase()}`;
  const groupLiveTest = card.querySelector(".character-group-live-test");
  groupLiveTest.textContent = formatMovementLiveTest(character.group_live_test);
  groupLiveTest.className = `character-group-live-test movement-live-test-${String(
    character.group_live_test?.outcome ||
      character.group_live_test?.status ||
      "idle",
  ).toLowerCase()}`;
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
  card.querySelector(".character-runtime-config-revision").textContent =
    character.runtime_config_revision ?? 0;
  card.querySelector(".character-applied-runtime-config-revision").textContent =
    character.applied_runtime_config_revision ?? "—";
  card.querySelector(".character-config-push-status").textContent =
    character.config_push_error
      ? `${character.config_push_status || "UNKNOWN"} · ${
          character.config_push_error
        }`
      : character.config_push_status || "UNKNOWN";
  const rotationText = character.rotation_source
    ? `Einwechseln für ${character.rotation_source}`
    : character.rotation_replacement
    ? `Auswechseln → ${character.rotation_replacement}`
    : "—";
  card.querySelector(".character-rotation").textContent = rotationText;
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

  const maps = movementMapApi.availableMaps(onlineCharacters());
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

async function ensureMovementMapScene(mapName) {
  if (!mapName || state.mapScenes.has(mapName)) {
    return state.mapScenes.get(mapName) || null;
  }
  if (state.mapSceneRequests.has(mapName)) {
    return state.mapSceneRequests.get(mapName);
  }

  const request = fetch(
    `/headless/api/maps/${encodeURIComponent(mapName)}/scene`,
    { cache: "no-store" },
  )
    .then(async (response) => {
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Map scene request failed: ${response.status}`);
      }
      const scene = await response.json();
      state.mapScenes.set(mapName, scene);
      return scene;
    })
    .catch(() => null)
    .finally(() => {
      state.mapSceneRequests.delete(mapName);
    });

  state.mapSceneRequests.set(mapName, request);
  return request;
}

function renderMovementMap() {
  if (!movementMapApi) return;

  synchronizeMovementMapOptions();
  const mapName = movementMapSelect.value;
  const mapScene = state.mapScenes.get(mapName) || null;
  if (mapName && !mapScene && !state.mapSceneRequests.has(mapName)) {
    void ensureMovementMapScene(mapName).then(() => {
      if (movementMapSelect.value === mapName) renderMovementMap();
    });
  }

  movementMapApi.renderMovementMap({
    svg: movementMapSvg,
    backgroundCanvas: movementMapBackground,
    legend: movementLegend,
    emptyState: movementMapEmpty,
    characters: onlineCharacters(),
    mapName,
    mapScene,
    trailMs: Number(movementTrailRange.value) || 120000,
    showTrail: showMovementTrail.checked,
    showPlan: showPlannedPath.checked,
    showFacing: showFacing.checked,
    showTarget: showTargetLine.checked,
    showMonsters: showNearbyMonsters.checked,
    showNpcs: showNearbyNpcs.checked,
  });
}

function renderInventoryEquipment() {
  if (!inventoryEquipmentApi) return;

  inventoryEquipmentApi.renderAccountInventory({
    container: accountInventoryGrid,
    characters: onlineCharacters(),
  });
}

function renderCharacters() {
  const characters = onlineCharacters().sort((a, b) =>
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

  activeCount.textContent = `${characters.length} / ${state.maxOnlineCharacters} online`;
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
  state.persistence = snapshot.persistence || {
    status: "UNKNOWN",
    database_path: null,
    schema_version: null,
    current_schema_version: null,
    flush_count: 0,
    closed: true,
    last_error: null,
  };
  state.fullAutonomy = snapshot.full_autonomy || {
    state: "EMPTY",
    readOnly: true,
    executionEnabled: false,
    desiredStateMutationDispatched: false,
    maxOnlineCharacters: state.maxOnlineCharacters,
    recommendations: [],
    summary: {
      selectedCharacters: 0,
      selectedMerchant: 0,
      selectedCombat: 0,
      manualStopProtected: 0,
    },
  };
  state.characters.clear();

  for (const character of snapshot.characters || []) {
    state.characters.set(character.name, character);
  }

  renderCharacters();
  renderRotationControls();
  renderMovementMap();
  renderInventoryEquipment();
  renderEmergencyStop();
  renderRevisionSummary();
  renderPersistenceSummary();
  renderFullAutonomySummary();
  if (configEditor.characterName) {
    renderConfigDialogMeta(configEditor.characterName);
  }
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

for (const select of [rotationStopCharacter, rotationStartCharacter]) {
  select.addEventListener("change", renderRotationControls);
}

rotateCharacters.addEventListener("click", async () => {
  const stopCharacter = rotationStopCharacter.value;
  const startCharacter = rotationStartCharacter.value;
  if (!stopCharacter || !startCharacter) return;

  rotateCharacters.disabled = true;
  try {
    await sendCharacterRotation(stopCharacter, startCharacter);
  } catch (error) {
    addEvent({
      timestamp: Date.now(),
      event: "ROTATION_ERROR",
      reason: error.message,
    });
    await loadInitialState().catch(() => {});
  } finally {
    renderRotationControls();
  }
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
  showNearbyMonsters,
  showNearbyNpcs,
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

configDialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveOpenCharacterConfig();
});
configDialogClose.addEventListener("click", closeConfigDialog);
configDialogCancel.addEventListener("click", closeConfigDialog);
configDialogReload.addEventListener("click", () => {
  if (!configEditor.characterName) return;
  void loadConfigEditor(configEditor.characterName).catch((error) => {
    configDialogFeedback.textContent = error.message;
  });
});

initializeDashboardCollapsibles();
setInterval(refreshHeartbeatAges, 1000);

loadInitialState()
  .then(connectEvents)
  .catch((error) => {
    connectionStatus.textContent = error.message;
    connectionStatus.className = "disconnected";
    connectEvents();
  });

renderEvents();

"use strict";

(function initHeadlessConfigForm(globalScope) {
  const SKILLS_BY_CLASS = Object.freeze({
    warrior: ["taunt", "hardshell", "warcry"],
    ranger: [
      "huntersmark",
      "supershot",
      "poisonarrow",
      "piercingshot",
      "track",
    ],
    mage: ["entangle", "light"],
    priest: ["curse", "darkblessing", "phaseout"],
    rogue: ["pcoat", "invis", "mentalburst", "quickpunch", "quickstab"],
    merchant: [
      "mcourage",
      "mfrenzy",
      "massproduction",
      "massproductionpp",
      "massexchange",
      "massexchangepp",
      "throw",
    ],
  });

  const CORE_SECTIONS = Object.freeze([
    {
      id: "combat",
      title: "Combat",
      description: "Targeting und Basis-Kampfverhalten.",
      fields: [
        {
          path: "combat.enabled",
          label: "Combat aktiv",
          type: "checkbox",
          default: false,
        },
        {
          path: "combat.autoTarget",
          label: "Auto Target",
          type: "checkbox",
          default: true,
        },
        {
          path: "combat.avoidKillSteal",
          label: "Kill-Steal vermeiden",
          type: "checkbox",
          default: true,
        },
        {
          path: "combat.targetMaxDistance",
          label: "Max. Target-Distanz",
          type: "number",
          min: 0,
          step: 10,
          default: 800,
        },
      ],
    },
    {
      id: "resources",
      title: "Potions & Safety",
      description: "HP/MP-Schwellen, Retreat und Respawn.",
      fields: [
        {
          path: "potionUsage.enabled",
          label: "Potion-Nutzung aktiv",
          type: "checkbox",
          default: false,
        },
        {
          path: "potionUsage.hpBelowPercent",
          label: "HP-Potion unter %",
          type: "number",
          min: 0,
          max: 100,
          step: 1,
          default: 50,
        },
        {
          path: "potionUsage.mpBelowPercent",
          label: "MP-Potion unter %",
          type: "number",
          min: 0,
          max: 100,
          step: 1,
          default: 40,
        },
        {
          path: "potionUsage.criticalHpPercent",
          label: "Kritische HP %",
          type: "number",
          min: 0,
          max: 100,
          step: 1,
          default: 30,
        },
        {
          path: "safety.autoRetreat",
          label: "Auto Retreat",
          type: "checkbox",
          default: false,
        },
        {
          path: "safety.retreatHpPercent",
          label: "Retreat unter %",
          type: "number",
          min: 0,
          max: 100,
          step: 1,
          default: 35,
        },
        {
          path: "safety.autoRespawn",
          label: "Auto Respawn",
          type: "checkbox",
          default: false,
        },
        {
          path: "safety.respawnRetryMs",
          label: "Respawn Retry ms",
          type: "number",
          min: 1000,
          step: 250,
          default: 3000,
        },
      ],
    },
    {
      id: "farming",
      title: "Farm Intelligence",
      description:
        "Monster-/Spot-Bewertung nach XP, Gold, Drops, Zielen, Risiko, Travel, Respawn und beobachteter Performance.",
      fields: [
        {
          path: "farming.enabled",
          label: "Farm Intelligence aktiv",
          type: "checkbox",
          default: false,
        },
        {
          path: "farming.goalMonster",
          label: "Farmziel Monster",
          type: "text",
          default: "",
          placeholder: "z. B. goo",
        },
        {
          path: "farming.preferredMonsters",
          label: "Bevorzugte Monster",
          type: "list",
          default: [],
          placeholder: "goo, bee",
        },
        {
          path: "farming.forbiddenMonsters",
          label: "Verbotene Monster",
          type: "list",
          default: [],
          placeholder: "boss, dangerousmob",
        },
        {
          path: "farming.goalItems",
          label: "Ziel-Drops",
          type: "list",
          default: [],
          placeholder: "item1, item2",
        },
        {
          path: "farming.weights.xp",
          label: "Gewicht XP/h",
          type: "number",
          min: 0,
          step: 0.1,
          default: 1,
        },
        {
          path: "farming.weights.gold",
          label: "Gewicht Gold/h",
          type: "number",
          min: 0,
          step: 0.1,
          default: 1,
        },
        {
          path: "farming.weights.drops",
          label: "Gewicht Drops",
          type: "number",
          min: 0,
          step: 0.1,
          default: 0.8,
        },
        {
          path: "farming.weights.goal",
          label: "Gewicht Goal Utility",
          type: "number",
          min: 0,
          step: 0.1,
          default: 1.2,
        },
        {
          path: "farming.weights.danger",
          label: "Gewicht Gefahr",
          type: "number",
          min: 0,
          step: 0.1,
          default: 1.2,
        },
        {
          path: "farming.weights.travel",
          label: "Gewicht Travel Cost",
          type: "number",
          min: 0,
          step: 0.1,
          default: 0.6,
        },
        {
          path: "farming.weights.respawn",
          label: "Gewicht Respawn",
          type: "number",
          min: 0,
          step: 0.1,
          default: 0.6,
        },
        {
          path: "farming.weights.partyDps",
          label: "Gewicht Party DPS",
          type: "number",
          min: 0,
          step: 0.1,
          default: 0.8,
        },
        {
          path: "farming.weights.tankSafety",
          label: "Gewicht Tank Safety",
          type: "number",
          min: 0,
          step: 0.1,
          default: 1,
        },
        {
          path: "farming.weights.observed",
          label: "Gewicht beobachtete Performance",
          type: "number",
          min: 0,
          step: 0.1,
          default: 1.4,
        },
        {
          path: "farming.observationSampleMs",
          label: "Performance Sample ms",
          type: "number",
          min: 1000,
          step: 1000,
          default: 5000,
        },
        {
          path: "farming.observationWindowMs",
          label: "Performance Fenster ms",
          type: "number",
          min: 5000,
          step: 5000,
          default: 60000,
        },
      ],
    },
    {
      id: "party",
      title: "Party & Group Combat",
      description: "Leader/Follower, Tether, Healing, Support und AoE.",
      fields: [
        {
          path: "groupCombat.enabled",
          label: "Group Combat aktiv",
          type: "checkbox",
          default: false,
        },
        {
          path: "groupCombat.role",
          label: "Rolle",
          type: "select",
          options: [
            ["", "Automatisch"],
            ["leader", "Leader"],
            ["follower", "Follower"],
          ],
          default: "",
        },
        {
          path: "groupCombat.leader",
          label: "Leader",
          type: "character",
          default: "",
        },
        {
          path: "groupCombat.members",
          label: "Mitglieder",
          type: "list",
          default: [],
          placeholder: "CharA, CharB, CharC",
        },
        {
          path: "groupCombat.focus",
          label: "Group Focus",
          type: "checkbox",
          default: true,
        },
        {
          path: "groupCombat.party.enabled",
          label: "Party Formation",
          type: "checkbox",
          default: true,
        },
        {
          path: "groupCombat.party.reconcileMs",
          label: "Party Reconcile ms",
          type: "number",
          min: 500,
          step: 250,
          default: 2500,
        },
        {
          path: "groupCombat.party.retryMs",
          label: "Party Retry ms",
          type: "number",
          min: 500,
          step: 250,
          default: 1500,
        },
        {
          path: "groupCombat.healing.enabled",
          label: "Party Healing",
          type: "checkbox",
          default: false,
        },
        {
          path: "groupCombat.healing.belowPercent",
          label: "Heal unter %",
          type: "number",
          min: 0,
          max: 100,
          step: 1,
          default: 70,
        },
        {
          path: "groupCombat.healing.partyHealMinTargets",
          label: "Party Heal ab Targets",
          type: "number",
          min: 2,
          step: 1,
          default: 2,
        },
        {
          path: "groupCombat.support.enabled",
          label: "Support aktiv",
          type: "checkbox",
          default: false,
        },
        {
          path: "groupCombat.support.absorbAggroCount",
          label: "Absorb ab Aggro",
          type: "number",
          min: 1,
          step: 1,
          default: 2,
        },
        {
          path: "groupCombat.aoe.enabled",
          label: "AoE aktiv",
          type: "checkbox",
          default: false,
        },
        {
          path: "groupCombat.aoe.minTargets",
          label: "AoE ab Targets",
          type: "number",
          min: 2,
          step: 1,
          default: 3,
        },
        {
          path: "groupCombat.tether.enabled",
          label: "Regroup/Tether aktiv",
          type: "checkbox",
          default: true,
        },
        {
          path: "groupCombat.tether.soft",
          label: "Soft Tether",
          type: "number",
          min: 0,
          step: 10,
          default: 180,
        },
        {
          path: "groupCombat.tether.hard",
          label: "Hard Tether",
          type: "number",
          min: 0,
          step: 10,
          default: 420,
        },
        {
          path: "groupCombat.warriorAnchor.enabled",
          label: "Warrior Anchor",
          type: "checkbox",
          default: true,
        },
        {
          path: "groupCombat.rangerKiting.enabled",
          label: "Ranger Kiting",
          type: "checkbox",
          default: false,
        },
        {
          path: "groupCombat.rangerKiting.minDistance",
          label: "Kite Min-Distanz",
          type: "number",
          min: 0,
          step: 5,
          default: 90,
        },
        {
          path: "groupCombat.rangerKiting.step",
          label: "Kite Schritt",
          type: "number",
          min: 10,
          step: 5,
          default: 80,
        },
      ],
    },
  ]);

  const JSON_SECTIONS = Object.freeze([
    {
      id: "supply",
      title: "Supply",
      path: "supply",
      description:
        "JSON-Unterbaum für Supply-/Versorgungsregeln. Wird revisionssicher gespeichert.",
    },
    {
      id: "inventory",
      title: "Inventory",
      path: "inventory",
      description: "JSON-Unterbaum für Inventory- und Disposition-Regeln.",
    },
    {
      id: "gear",
      title: "Gear",
      path: "gear",
      description: "JSON-Unterbaum für Gear-, Upgrade- und Reservation-Regeln.",
    },
  ]);

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function getPath(source, path) {
    return path
      .split(".")
      .reduce(
        (current, key) =>
          current && typeof current === "object" ? current[key] : undefined,
        source,
      );
  }

  function setPath(target, path, value) {
    const keys = path.split(".");
    let current = target;
    for (let index = 0; index < keys.length - 1; index += 1) {
      const key = keys[index];
      if (!isObject(current[key])) current[key] = {};
      current = current[key];
    }
    current[keys.at(-1)] = value;
    return target;
  }

  function deletePath(target, path) {
    const keys = path.split(".");
    const parents = [];
    let current = target;
    for (let index = 0; index < keys.length - 1; index += 1) {
      if (!isObject(current?.[keys[index]])) return target;
      parents.push([current, keys[index]]);
      current = current[keys[index]];
    }
    delete current[keys.at(-1)];

    for (let index = parents.length - 1; index >= 0; index -= 1) {
      const [parent, key] = parents[index];
      if (isObject(parent[key]) && Object.keys(parent[key]).length === 0) {
        delete parent[key];
      } else {
        break;
      }
    }
    return target;
  }

  function skillSection(ctype) {
    const skills = SKILLS_BY_CLASS[ctype] || [];
    return {
      id: "class-skills",
      title: ctype + " Skills",
      description:
        "Skills sind pro Character getrennt aktivierbar und priorisierbar.",
      fields: [
        {
          path: "classSkills." + ctype + ".enabled",
          label: "Class Skills aktiv",
          type: "checkbox",
          default: false,
        },
        ...skills.flatMap((skill, index) => [
          {
            path: "classSkills." + ctype + ".skills." + skill + ".enabled",
            label: skill,
            type: "checkbox",
            default: false,
          },
          {
            path: "classSkills." + ctype + ".skills." + skill + ".priority",
            label: skill + " Priorität",
            type: "number",
            step: 1,
            default: skills.length - index,
          },
        ]),
      ],
    };
  }

  function schemaForClass(ctype) {
    const normalized = String(ctype || "").toLowerCase();
    const sections = [...CORE_SECTIONS];
    if (SKILLS_BY_CLASS[normalized]) sections.push(skillSection(normalized));
    sections.push(...JSON_SECTIONS);
    if (normalized === "merchant") {
      sections.push({
        id: "merchant",
        title: "Merchant",
        path: "merchant",
        description:
          "Merchant-spezifische Konfiguration für spätere Logistics/Economy-Module.",
        json: true,
      });
    }
    return sections;
  }

  function fieldValue(config, field) {
    const value = getPath(config, field.path);
    return value === undefined ? field.default : value;
  }

  function createField(doc, config, field, characterNames) {
    const label = doc.createElement("label");
    label.className = "config-field";
    const text = doc.createElement("span");
    text.textContent = field.label;

    let input;
    if (field.type === "select" || field.type === "character") {
      input = doc.createElement("select");
      const options =
        field.type === "character"
          ? [
              ["", "Nicht gesetzt"],
              ...characterNames.map((name) => [name, name]),
            ]
          : field.options || [];
      const current = String(fieldValue(config, field) ?? "");
      if (
        field.type === "character" &&
        current &&
        !options.some(([value]) => value === current)
      ) {
        options.push([
          current,
          current + " (nicht im aktuellen Account-Status)",
        ]);
      }
      for (const [value, caption] of options) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = caption;
        input.append(option);
      }
      input.value = current;
    } else {
      input = doc.createElement("input");
      if (field.type === "checkbox") {
        input.type = "checkbox";
        input.checked = fieldValue(config, field) === true;
      } else if (field.type === "number") {
        input.type = "number";
        const value = fieldValue(config, field);
        input.value =
          value === undefined || value === null ? "" : String(value);
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        if (field.step !== undefined) input.step = String(field.step);
      } else if (field.type === "list") {
        input.type = "text";
        const value = fieldValue(config, field);
        input.value = Array.isArray(value) ? value.join(", ") : "";
        input.placeholder = field.placeholder || "";
      } else {
        input.type = "text";
        input.value = String(fieldValue(config, field) ?? "");
      }
    }

    input.dataset.configPath = field.path;
    input.dataset.configKind = field.type;
    label.append(text, input);
    return label;
  }

  function createJsonSection(doc, section, config) {
    const details = doc.createElement("details");
    details.className = "config-section";
    const summary = doc.createElement("summary");
    summary.textContent = section.title;
    const description = doc.createElement("p");
    description.className = "config-section-description";
    description.textContent = section.description || "";
    const textarea = doc.createElement("textarea");
    textarea.className = "config-json-editor";
    textarea.dataset.configJsonPath = section.path;
    textarea.spellcheck = false;
    textarea.value = JSON.stringify(
      getPath(config, section.path) || {},
      null,
      2,
    );
    details.append(summary, description, textarea);
    return details;
  }

  function renderConfigForm({
    container,
    config = {},
    ctype = null,
    characterNames = [],
  }) {
    if (!container) throw new Error("Config form container is required");
    const doc = container.ownerDocument || document;
    const base = cloneJson(config);
    container.replaceChildren();
    container.__headlessConfigBase = base;

    for (const section of schemaForClass(ctype)) {
      if (section.json || section.path) {
        container.append(createJsonSection(doc, section, base));
        continue;
      }

      const details = doc.createElement("details");
      details.className = "config-section";
      details.open = ["combat", "resources", "party", "class-skills"].includes(
        section.id,
      );
      const summary = doc.createElement("summary");
      summary.textContent = section.title;
      const description = doc.createElement("p");
      description.className = "config-section-description";
      description.textContent = section.description || "";
      const grid = doc.createElement("div");
      grid.className = "config-field-grid";

      for (const field of section.fields || []) {
        grid.append(
          createField(doc, base, field, [...new Set(characterNames)].sort()),
        );
      }

      details.append(summary, description, grid);
      container.append(details);
    }

    return base;
  }

  function parseJsonObject(value, label) {
    let parsed;
    try {
      parsed = JSON.parse(value || "{}");
    } catch (error) {
      throw new Error(label + ": ungültiges JSON (" + error.message + ")");
    }
    if (!isObject(parsed)) {
      throw new Error(label + ": es wird ein JSON-Objekt erwartet");
    }
    return parsed;
  }

  function collectConfig({ container, baseConfig } = {}) {
    if (!container) throw new Error("Config form container is required");
    const config = cloneJson(
      baseConfig || container.__headlessConfigBase || {},
    );

    for (const input of container.querySelectorAll("[data-config-path]")) {
      const path = input.dataset.configPath;
      const kind = input.dataset.configKind;

      if (kind === "checkbox") {
        setPath(config, path, input.checked === true);
      } else if (kind === "number") {
        if (input.value === "") {
          deletePath(config, path);
        } else {
          const value = Number(input.value);
          if (!Number.isFinite(value))
            throw new Error(path + ": Zahl ungültig");
          setPath(config, path, value);
        }
      } else if (kind === "list") {
        setPath(config, path, [
          ...new Set(
            String(input.value || "")
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
          ),
        ]);
      } else {
        const value = String(input.value || "").trim();
        if (value) setPath(config, path, value);
        else deletePath(config, path);
      }
    }

    for (const textarea of container.querySelectorAll(
      "[data-config-json-path]",
    )) {
      const path = textarea.dataset.configJsonPath;
      setPath(config, path, parseJsonObject(textarea.value, path));
    }

    return config;
  }

  const api = {
    SKILLS_BY_CLASS,
    collectConfig,
    deletePath,
    getPath,
    renderConfigForm,
    schemaForClass,
    setPath,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.HeadlessConfigForm = api;
})(typeof window !== "undefined" ? window : globalThis);

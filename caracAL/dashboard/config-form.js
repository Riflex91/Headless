"use strict";

(function initConfigForm(globalScope) {
  const CLASS_SKILLS = {
    warrior: ["taunt", "hardshell", "warcry"],
    ranger: ["huntersmark", "supershot", "poisonarrow", "piercingshot", "track"],
    priest: ["curse", "darkblessing", "phaseout"],
    mage: ["entangle", "light"],
    rogue: ["pcoat", "invis", "mentalburst", "quickpunch", "quickstab"],
  };

  const COMMON_SECTIONS = [
    {
      id: "combat",
      label: "Combat",
      fields: [
        { path: "combat.enabled", label: "Combat aktiv", type: "boolean" },
        { path: "combat.autoTarget", label: "Auto-Target", type: "boolean" },
        {
          path: "combat.avoidKillSteal",
          label: "Kill-Steal vermeiden",
          type: "boolean",
        },
        {
          path: "combat.targetMaxDistance",
          label: "Max. Target-Distanz",
          type: "number",
          min: 0,
          step: 10,
        },
        { path: "combat.retreat", label: "Auto-Retreat", type: "boolean" },
        {
          path: "combat.retreatHpPercent",
          label: "Retreat unter HP %",
          type: "number",
          min: 0,
          max: 100,
          step: 1,
        },
      ],
    },
    {
      id: "farming",
      label: "Farming",
      fields: [
        { path: "farming.enabled", label: "Farming aktiv", type: "boolean" },
        {
          path: "farming.monsterTypes",
          label: "Monster-Typen",
          type: "csv",
          placeholder: "goo, bee, crab",
        },
        { path: "farming.map", label: "Bevorzugte Map", type: "text" },
        {
          path: "farming.maxDistance",
          label: "Max. Farm-Distanz",
          type: "number",
          min: 0,
          step: 10,
        },
      ],
    },
    {
      id: "potions-supply",
      label: "Potions & Supply",
      fields: [
        {
          path: "potionUsage.enabled",
          label: "Potion-Nutzung aktiv",
          type: "boolean",
        },
        {
          path: "potionUsage.hpBelowPercent",
          label: "HP-Potion unter %",
          type: "number",
          min: 0,
          max: 100,
        },
        {
          path: "potionUsage.mpBelowPercent",
          label: "MP-Potion unter %",
          type: "number",
          min: 0,
          max: 100,
        },
        {
          path: "potionUsage.criticalHpPercent",
          label: "Kritische HP %",
          type: "number",
          min: 0,
          max: 100,
        },
        { path: "supply.enabled", label: "Supply aktiv", type: "boolean" },
        {
          path: "supply.hpPotionTarget",
          label: "HP-Potion Zielbestand",
          type: "number",
          min: 0,
          step: 1,
        },
        {
          path: "supply.mpPotionTarget",
          label: "MP-Potion Zielbestand",
          type: "number",
          min: 0,
          step: 1,
        },
      ],
    },
    {
      id: "party",
      label: "Party",
      fields: [
        {
          path: "groupCombat.enabled",
          label: "Group Combat aktiv",
          type: "boolean",
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
        },
        { path: "groupCombat.leader", label: "Leader", type: "text" },
        {
          path: "groupCombat.members",
          label: "Party-Mitglieder",
          type: "csv",
          placeholder: "Name1, Name2",
        },
        {
          path: "groupCombat.party.enabled",
          label: "Party-Formation aktiv",
          type: "boolean",
        },
        {
          path: "groupCombat.focus",
          label: "Group-Focus aktiv",
          type: "boolean",
        },
        {
          path: "groupCombat.healing.enabled",
          label: "Group-Healing aktiv",
          type: "boolean",
        },
        {
          path: "groupCombat.healing.belowPercent",
          label: "Heilen unter HP %",
          type: "number",
          min: 0,
          max: 100,
        },
        {
          path: "groupCombat.support.enabled",
          label: "Support aktiv",
          type: "boolean",
        },
        {
          path: "groupCombat.aoe.enabled",
          label: "Group-AoE aktiv",
          type: "boolean",
        },
        {
          path: "groupCombat.aoe.minTargets",
          label: "AoE ab Targets",
          type: "number",
          min: 2,
          step: 1,
        },
        {
          path: "groupCombat.tether.enabled",
          label: "Tether/Regroup aktiv",
          type: "boolean",
        },
        {
          path: "groupCombat.tether.soft",
          label: "Soft-Tether",
          type: "number",
          min: 0,
          step: 10,
        },
        {
          path: "groupCombat.tether.hard",
          label: "Hard-Tether",
          type: "number",
          min: 0,
          step: 10,
        },
        {
          path: "groupCombat.warriorAnchor.enabled",
          label: "Warrior Anchor",
          type: "boolean",
        },
        {
          path: "groupCombat.rangerKiting.enabled",
          label: "Ranger Kiting",
          type: "boolean",
        },
      ],
    },
    {
      id: "inventory-gear",
      label: "Inventory & Gear",
      fields: [
        {
          path: "inventory.enabled",
          label: "Inventory-Automation",
          type: "boolean",
        },
        {
          path: "inventory.minFreeSlots",
          label: "Min. freie Slots",
          type: "number",
          min: 0,
          step: 1,
        },
        {
          path: "inventory.keepItems",
          label: "Items behalten",
          type: "csv",
          placeholder: "hpot1, mpot1",
        },
        { path: "gear.enabled", label: "Gear-Automation", type: "boolean" },
        { path: "gear.autoEquip", label: "Auto-Equip", type: "boolean" },
        { path: "gear.profile", label: "Gear-Profil", type: "text" },
      ],
    },
    {
      id: "safety",
      label: "Safety",
      fields: [
        {
          path: "safety.autoRetreat",
          label: "Auto-Retreat",
          type: "boolean",
        },
        {
          path: "safety.retreatHpPercent",
          label: "Retreat unter HP %",
          type: "number",
          min: 0,
          max: 100,
        },
        {
          path: "safety.criticalHpPercent",
          label: "Kritische HP %",
          type: "number",
          min: 0,
          max: 100,
        },
        {
          path: "safety.autoRespawn",
          label: "Auto-Respawn",
          type: "boolean",
        },
        {
          path: "safety.respawnRetryMs",
          label: "Respawn Retry ms",
          type: "number",
          min: 1000,
          step: 100,
        },
      ],
    },
  ];

  const MERCHANT_SECTIONS = [
    {
      id: "merchant-core",
      label: "Merchant",
      fields: [
        { path: "merchant.enabled", label: "Merchant aktiv", type: "boolean" },
        {
          path: "merchant.autoStand",
          label: "Merchant Stand automatisch",
          type: "boolean",
        },
        { path: "merchant.homeMap", label: "Merchant Home-Map", type: "text" },
      ],
    },
    {
      id: "merchant-supply",
      label: "Merchant Supply",
      fields: [
        {
          path: "merchant.supply.enabled",
          label: "Supply-Service aktiv",
          type: "boolean",
        },
        {
          path: "merchant.supply.hpPotionTarget",
          label: "HP-Potion Zielbestand",
          type: "number",
          min: 0,
        },
        {
          path: "merchant.supply.mpPotionTarget",
          label: "MP-Potion Zielbestand",
          type: "number",
          min: 0,
        },
      ],
    },
    {
      id: "merchant-bank-exchange",
      label: "Bank & Exchange",
      fields: [
        {
          path: "merchant.bank.enabled",
          label: "Bank-Automation",
          type: "boolean",
        },
        {
          path: "merchant.exchange.enabled",
          label: "Exchange-Automation",
          type: "boolean",
        },
        {
          path: "merchant.exchange.auto",
          label: "Exchange automatisch",
          type: "boolean",
        },
      ],
    },
    {
      id: "merchant-production",
      label: "Production",
      fields: [
        {
          path: "merchant.production.enabled",
          label: "Production aktiv",
          type: "boolean",
        },
        {
          path: "merchant.production.upgrade",
          label: "Upgrade aktiv",
          type: "boolean",
        },
        {
          path: "merchant.production.compound",
          label: "Compound aktiv",
          type: "boolean",
        },
        {
          path: "merchant.production.craft",
          label: "Craft aktiv",
          type: "boolean",
        },
      ],
    },
  ];

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function pathParts(path) {
    return String(path).split(".").filter(Boolean);
  }

  function getPath(source, path) {
    let current = source;
    for (const key of pathParts(path)) {
      if (!current || typeof current !== "object") return undefined;
      current = current[key];
    }
    return current;
  }

  function setPath(target, path, value) {
    const parts = pathParts(path);
    if (!parts.length) return target;
    let current = target;
    for (const key of parts.slice(0, -1)) {
      if (
        !current[key] ||
        typeof current[key] !== "object" ||
        Array.isArray(current[key])
      ) {
        current[key] = {};
      }
      current = current[key];
    }
    current[parts.at(-1)] = value;
    return target;
  }

  function deletePath(target, path) {
    const parts = pathParts(path);
    if (!parts.length) return target;
    let current = target;
    for (const key of parts.slice(0, -1)) {
      if (!current?.[key] || typeof current[key] !== "object") return target;
      current = current[key];
    }
    delete current[parts.at(-1)];
    return target;
  }

  function classSkillSection(ctype) {
    const skills = CLASS_SKILLS[ctype] || [];
    if (!skills.length) return null;
    return {
      id: "class-skills",
      label: "Class Skills",
      fields: [
        {
          path: "classSkills." + ctype + ".enabled",
          label: ctype + " Skills aktiv",
          type: "boolean",
        },
        ...skills.flatMap((skill) => [
          {
            path: "classSkills." + ctype + ".skills." + skill + ".enabled",
            label: skill + " aktiv",
            type: "boolean",
            group: skill,
          },
          {
            path: "classSkills." + ctype + ".skills." + skill + ".priority",
            label: skill + " Priorität",
            type: "number",
            step: 1,
            group: skill,
          },
        ]),
      ],
    };
  }

  function schemaForCharacter(character = {}) {
    const ctype = String(character.ctype || "").toLowerCase();
    const sections = COMMON_SECTIONS.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({ ...field })),
    }));
    const skills = classSkillSection(ctype);
    if (skills) sections.push(skills);
    if (ctype === "merchant") {
      sections.push(
        ...MERCHANT_SECTIONS.map((section) => ({
          ...section,
          fields: section.fields.map((field) => ({ ...field })),
        })),
      );
    }
    sections.push({
      id: "raw-json",
      label: "JSON",
      fields: [],
      advanced: true,
    });
    return sections;
  }

  function fieldValue(config, field) {
    const value = getPath(config, field.path);
    if (field.type === "csv") {
      return Array.isArray(value) ? value.join(", ") : value || "";
    }
    return value;
  }

  function normalizeInputValue(field, input) {
    if (field.type === "boolean") return input.checked === true;
    if (field.type === "number") {
      if (input.value === "") return undefined;
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        throw new Error(field.label + " muss eine Zahl sein");
      }
      if (Number.isFinite(field.min) && value < field.min) {
        throw new Error(field.label + " muss mindestens " + field.min + " sein");
      }
      if (Number.isFinite(field.max) && value > field.max) {
        throw new Error(field.label + " darf höchstens " + field.max + " sein");
      }
      return value;
    }
    if (field.type === "csv") {
      return String(input.value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    const value = String(input.value || "").trim();
    return value || undefined;
  }

  function createInput(doc, field, config, onValue) {
    const wrap = doc.createElement("label");
    wrap.className = "config-field";
    if (field.group) wrap.dataset.configGroup = field.group;

    const title = doc.createElement("span");
    title.className = "config-field-label";
    title.textContent = field.label;
    wrap.append(title);

    let input;
    if (field.type === "select") {
      input = doc.createElement("select");
      for (const [value, label] of field.options || []) {
        const option = doc.createElement("option");
        option.value = value;
        option.textContent = label;
        input.append(option);
      }
    } else {
      input = doc.createElement("input");
      input.type = field.type === "boolean" ? "checkbox" : field.type;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (Number.isFinite(field.min)) input.min = String(field.min);
      if (Number.isFinite(field.max)) input.max = String(field.max);
      if (Number.isFinite(field.step)) input.step = String(field.step);
    }

    input.dataset.configPath = field.path;
    const value = fieldValue(config, field);
    if (field.type === "boolean") {
      input.checked = value === true;
    } else if (value !== undefined && value !== null) {
      input.value = String(value);
    }

    input.addEventListener("change", () => onValue(field, input));
    if (!["boolean", "select"].includes(field.type)) {
      input.addEventListener("input", () => onValue(field, input));
    }

    wrap.append(input);
    return wrap;
  }

  function createEditor({ container, character = {}, config = {} }) {
    if (!container) throw new Error("Config editor requires a container");
    const doc = container.ownerDocument || document;
    let state = deepClone(config);
    let activeSection = null;

    const render = () => {
      container.replaceChildren();
      const schema = schemaForCharacter(character);
      const tabs = doc.createElement("div");
      tabs.className = "config-tabs";
      tabs.setAttribute("role", "tablist");
      const panels = doc.createElement("div");
      panels.className = "config-panels";

      const setActive = (id) => {
        activeSection = id;
        for (const button of tabs.querySelectorAll("[data-config-tab]")) {
          const selected = button.dataset.configTab === id;
          button.classList.toggle("active", selected);
          button.setAttribute("aria-selected", String(selected));
        }
        for (const panel of panels.querySelectorAll("[data-config-panel]")) {
          panel.hidden = panel.dataset.configPanel !== id;
        }
      };

      const updateField = (field, input) => {
        const value = normalizeInputValue(field, input);
        if (value === undefined) deletePath(state, field.path);
        else setPath(state, field.path, value);
        const raw = panels.querySelector(".config-json-editor");
        if (raw) raw.value = JSON.stringify(state, null, 2);
      };

      for (const section of schema) {
        const tab = doc.createElement("button");
        tab.type = "button";
        tab.className = "config-tab";
        tab.dataset.configTab = section.id;
        tab.setAttribute("role", "tab");
        tab.textContent = section.label;
        tab.addEventListener("click", () => setActive(section.id));
        tabs.append(tab);

        const panel = doc.createElement("section");
        panel.className = "config-panel";
        panel.dataset.configPanel = section.id;
        panel.setAttribute("role", "tabpanel");

        if (section.advanced) {
          const hint = doc.createElement("p");
          hint.className = "config-hint";
          hint.textContent =
            "Erweiterter JSON-Modus. Unbekannte Schlüssel bleiben beim strukturierten Bearbeiten erhalten.";
          const textarea = doc.createElement("textarea");
          textarea.className = "config-json-editor";
          textarea.spellcheck = false;
          textarea.value = JSON.stringify(state, null, 2);
          const apply = doc.createElement("button");
          apply.type = "button";
          apply.className = "secondary";
          apply.textContent = "JSON übernehmen";
          const feedback = doc.createElement("span");
          feedback.className = "config-json-feedback";
          apply.addEventListener("click", () => {
            try {
              const parsed = JSON.parse(textarea.value);
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Config muss ein JSON-Objekt sein");
              }
              state = deepClone(parsed);
              feedback.textContent = "JSON übernommen ✓";
              render();
            } catch (error) {
              feedback.textContent = error.message;
            }
          });
          panel.append(hint, textarea, apply, feedback);
        } else {
          const grid = doc.createElement("div");
          grid.className = "config-field-grid";
          for (const field of section.fields) {
            grid.append(createInput(doc, field, state, updateField));
          }
          panel.append(grid);
        }
        panels.append(panel);
      }

      container.append(tabs, panels);
      const defaultSection =
        schema.some((section) => section.id === activeSection)
          ? activeSection
          : schema[0]?.id;
      if (defaultSection) setActive(defaultSection);
    };

    render();

    return {
      getConfig() {
        return deepClone(state);
      },
      setConfig(nextConfig) {
        state = deepClone(nextConfig);
        render();
      },
      schema() {
        return schemaForCharacter(character);
      },
      destroy() {
        container.replaceChildren();
      },
    };
  }

  const api = {
    CLASS_SKILLS,
    createEditor,
    deepClone,
    deletePath,
    getPath,
    schemaForCharacter,
    setPath,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.HeadlessConfigForm = api;
  }
})(typeof window !== "undefined" ? window : globalThis);

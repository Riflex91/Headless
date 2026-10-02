"use strict";

(function initInventoryEquipment(globalScope) {
  const EQUIPMENT_ORDER = [
    "helmet",
    "earring1",
    "earring2",
    "amulet",
    "cape",
    "chest",
    "mainhand",
    "offhand",
    "ring1",
    "ring2",
    "belt",
    "orb",
    "pants",
    "gloves",
    "shoes",
    "elixir",
  ];

  const previousSignatures = new Map();

  function assetUrl(icon) {
    if (!icon?.file) return null;
    return `/headless/api/assets/adventure-land?path=${encodeURIComponent(
      icon.file,
    )}`;
  }

  function itemSignature(item) {
    if (!item) return "empty";
    return JSON.stringify([
      item.name || null,
      item.level ?? null,
      item.q ?? null,
      !!item.locked,
      item.p ?? null,
      item.stat_type ?? null,
      item.expires ?? null,
    ]);
  }

  function itemTitle(item, intelligence = null) {
    if (!item) return "Leer";

    const parts = [item.display_name || item.name || "Unbekannt"];
    if (Number.isFinite(item.level)) parts.push(`+${item.level}`);
    if (Number.isFinite(item.q) && item.q > 1) parts.push(`x${item.q}`);
    if (item.locked) parts.push("LOCKED");
    if (item.stat_type) parts.push(item.stat_type);
    if (intelligence?.disposition) {
      parts.push(`Disposition ${intelligence.disposition}`);
    }
    if (
      Array.isArray(intelligence?.protections) &&
      intelligence.protections.length
    ) {
      parts.push(`Protected ${intelligence.protections.join(", ")}`);
    }
    if (intelligence?.why) parts.push(intelligence.why);
    return parts.join(" · ");
  }

  function orderedEquipmentSlots(slots = {}) {
    const extra = Object.keys(slots)
      .filter((slot) => !EQUIPMENT_ORDER.includes(slot))
      .sort();
    return [...EQUIPMENT_ORDER, ...extra];
  }

  function spriteStyle(icon, displaySize = 40) {
    const url = assetUrl(icon);
    if (!url) return null;

    const size = Number(icon.size) || 20;
    const columns = Number(icon.columns);
    const rows = Number(icon.rows);
    const scale = displaySize / size;

    const style = {
      backgroundImage: `url("${url}")`,
      backgroundPosition: `-${(Number(icon.x) || 0) * size * scale}px -${
        (Number(icon.y) || 0) * size * scale
      }px`,
      width: `${displaySize}px`,
      height: `${displaySize}px`,
    };

    if (Number.isFinite(columns) && Number.isFinite(rows)) {
      style.backgroundSize = `${columns * size * scale}px ${
        rows * size * scale
      }px`;
    }

    return style;
  }

  function applyStyle(element, style) {
    if (!style) return;
    for (const [key, value] of Object.entries(style)) {
      element.style[key] = value;
    }
  }

  function createItemSlot({
    characterName,
    location,
    slotName,
    item,
    slotLabel,
    intelligence = null,
    displaySize = 40,
  }) {
    const slot = document.createElement("div");
    slot.className = "live-item-slot";
    slot.title = itemTitle(item, intelligence);
    if (intelligence?.disposition) {
      slot.dataset.disposition = intelligence.disposition;
    }

    const key = `${characterName}:${location}:${slotName}`;
    const signature = itemSignature(item);
    const previous = previousSignatures.get(key);
    if (previous !== undefined && previous !== signature) {
      slot.classList.add("item-changed");
    }
    previousSignatures.set(key, signature);

    const sprite = document.createElement("div");
    sprite.className = "live-item-sprite";
    applyStyle(sprite, spriteStyle(item?.icon, displaySize));

    if (!item?.icon) {
      sprite.classList.add("item-icon-fallback");
      sprite.textContent = item?.name
        ? item.name.slice(0, 3).toUpperCase()
        : "";
    }

    const index = document.createElement("span");
    index.className = "item-slot-label";
    index.textContent = String(slotLabel);

    slot.append(sprite, index);

    if (item) {
      const name = document.createElement("span");
      name.className = "item-short-name";
      name.textContent = item.name || "?";
      slot.append(name);

      if (Number.isFinite(item.q) && item.q > 1) {
        const quantity = document.createElement("span");
        quantity.className = "item-quantity";
        quantity.textContent = String(item.q);
        slot.append(quantity);
      }

      if (Number.isFinite(item.level)) {
        const level = document.createElement("span");
        level.className = "item-level";
        level.textContent = `+${item.level}`;
        slot.append(level);
      }

      if (item.locked) {
        const locked = document.createElement("span");
        locked.className = "item-locked";
        locked.textContent = "🔒";
        locked.setAttribute("aria-label", "Locked");
        slot.append(locked);
      }

      if (intelligence?.disposition) {
        const disposition = document.createElement("span");
        disposition.className = "item-disposition-badge";
        disposition.textContent = intelligence.disposition;
        slot.append(disposition);
      }

      if (
        Array.isArray(intelligence?.protections) &&
        intelligence.protections.length > 0
      ) {
        const protection = document.createElement("span");
        protection.className = "item-protection-badge";
        protection.textContent = "🛡";
        protection.title = intelligence.protections.join(", ");
        protection.setAttribute(
          "aria-label",
          `Protected: ${intelligence.protections.join(", ")}`,
        );
        slot.append(protection);
      }
    } else {
      slot.classList.add("item-empty");
    }

    return slot;
  }

  function createEquipment(character) {
    const game = character.game || {};
    const slots = game.slots || {};
    const section = document.createElement("section");
    section.className = "equipment-section";

    const heading = document.createElement("h4");
    heading.textContent = "Ausrüstung";
    section.append(heading);

    const grid = document.createElement("div");
    grid.className = "equipment-grid";

    for (const slotName of orderedEquipmentSlots(slots)) {
      const wrap = document.createElement("div");
      wrap.className = "equipment-slot-wrap";

      const label = document.createElement("span");
      label.className = "equipment-slot-name";
      label.textContent = slotName;

      wrap.append(
        label,
        createItemSlot({
          characterName: character.name,
          location: "equipment",
          slotName,
          item: slots[slotName],
          slotLabel: slotName,
        }),
      );
      grid.append(wrap);
    }

    if (grid.childElementCount === 0) {
      const empty = document.createElement("p");
      empty.className = "inventory-empty";
      empty.textContent = "Keine Ausrüstungsdaten.";
      section.append(empty);
    } else {
      section.append(grid);
    }

    return section;
  }

  function createInventory(character) {
    const game = character.game || {};
    const items = Array.isArray(game.items) ? game.items : [];
    const intelligenceEntries = Array.isArray(
      character.inventory_intelligence_runtime?.entries,
    )
      ? character.inventory_intelligence_runtime.entries
      : [];
    const intelligenceBySlot = new Map(
      intelligenceEntries
        .filter((entry) => Number.isInteger(entry?.slot))
        .map((entry) => [entry.slot, entry]),
    );
    const section = document.createElement("section");
    section.className = "inventory-section";

    const heading = document.createElement("div");
    heading.className = "inventory-section-heading";
    const title = document.createElement("h4");
    title.textContent = "Inventar";
    const count = document.createElement("span");
    const size = Number.isFinite(game.isize) ? game.isize : items.length;
    const free = Number.isFinite(game.esize)
      ? game.esize
      : items.filter((item) => !item).length;
    count.textContent = `${Math.max(0, size - free)}/${size} · ${free} frei`;
    heading.append(title, count);
    section.append(heading);

    const grid = document.createElement("div");
    grid.className = "inventory-slot-grid";

    const slotCount = Math.max(size, items.length);
    for (let index = 0; index < slotCount; index += 1) {
      grid.append(
        createItemSlot({
          characterName: character.name,
          location: "inventory",
          slotName: index,
          item: items[index] || null,
          slotLabel: index,
          intelligence: intelligenceBySlot.get(index) || null,
        }),
      );
    }

    section.append(grid);
    return section;
  }

  function createCharacterInventoryCard(character) {
    const card = document.createElement("article");
    card.className = "inventory-character-card";
    card.dataset.inventoryCharacter = character.name;

    const header = document.createElement("header");
    header.className = "inventory-character-header";

    const title = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = character.name;
    const meta = document.createElement("p");
    meta.textContent = [character.game?.ctype, character.game?.map]
      .filter(Boolean)
      .join(" · ");
    title.append(name, meta);

    const status = document.createElement("span");
    status.className = "inventory-live-badge";
    status.textContent = character.lifecycle_state || "ONLINE";

    header.append(title, status);
    card.append(header, createEquipment(character), createInventory(character));
    return card;
  }

  function renderAccountInventory({ container, characters }) {
    if (!container) return;

    const visible = (characters || [])
      .filter((character) => character.connected && character.game)
      .sort((a, b) => a.name.localeCompare(b.name));

    container.replaceChildren();

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "inventory-empty account-inventory-empty";
      empty.textContent = "Noch keine Live-Inventardaten aktiver Characters.";
      container.append(empty);
      return;
    }

    for (const character of visible) {
      container.append(createCharacterInventoryCard(character));
    }
  }

  const api = {
    EQUIPMENT_ORDER,
    assetUrl,
    itemSignature,
    itemTitle,
    orderedEquipmentSlots,
    renderAccountInventory,
    spriteStyle,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.HeadlessInventoryEquipment = api;
  }
})(typeof window !== "undefined" ? window : globalThis);

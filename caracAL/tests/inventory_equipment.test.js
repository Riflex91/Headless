"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const {
  EQUIPMENT_ORDER,
  assetUrl,
  itemSignature,
  orderedEquipmentSlots,
  renderAccountInventory,
  spriteStyle,
} = require("../dashboard/inventory-equipment");

test("item sprite URL uses the local Adventure Land cache endpoint", () => {
  assert.equal(
    assetUrl({ file: "/images/tiles/items/pack_20vt8.png" }),
    "/headless/api/assets/adventure-land?path=%2Fimages%2Ftiles%2Fitems%2Fpack_20vt8.png",
  );
  assert.equal(assetUrl(null), null);
});

test("sprite style scales the original Adventure Land sprite sheet", () => {
  const style = spriteStyle(
    {
      file: "/images/tiles/items/pack_20vt8.png",
      x: 2,
      y: 3,
      size: 20,
      rows: 64,
      columns: 16,
    },
    40,
  );

  assert.equal(style.width, "40px");
  assert.equal(style.height, "40px");
  assert.equal(style.backgroundPosition, "-80px -120px");
  assert.equal(style.backgroundSize, "640px 2560px");
});

test("equipment order keeps all canonical slots and appends unknown slots", () => {
  const result = orderedEquipmentSlots({
    mainhand: { name: "bow" },
    customslot: { name: "x" },
  });

  assert.deepEqual(result.slice(0, EQUIPMENT_ORDER.length), EQUIPMENT_ORDER);
  assert.equal(result.at(-1), "customslot");
});

test("item signature changes when stack or upgrade level changes", () => {
  const base = itemSignature({ name: "bow", level: 7, q: 1 });
  assert.notEqual(base, itemSignature({ name: "bow", level: 8, q: 1 }));
  assert.notEqual(base, itemSignature({ name: "bow", level: 7, q: 2 }));
});

test("account inventory renders all connected live characters together", () => {
  const dom = new JSDOM("<div id='root'></div>");
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    const root = document.querySelector("#root");
    const item = {
      name: "hpot1",
      display_name: "HP Potion",
      q: 123,
      icon: {
        file: "/images/tiles/items/pack_20vt8.png",
        x: 2,
        y: 3,
        size: 20,
        rows: 64,
        columns: 16,
      },
    };

    renderAccountInventory({
      container: root,
      characters: [
        {
          name: "My_Ranger1",
          connected: true,
          lifecycle_state: "ONLINE",
          game: {
            ctype: "ranger",
            map: "main",
            isize: 2,
            esize: 1,
            items: [item, null],
            slots: { mainhand: { ...item, name: "bow", q: 1, level: 8 } },
          },
          inventory_intelligence_runtime: {
            state: "READY",
            entries: [
              {
                slot: 0,
                disposition: "CONSUMABLE",
                protections: ["VALUABLE"],
                why: "CONSUMABLE via Adventure Land item metadata · protected: VALUABLE",
              },
            ],
          },
        },
        {
          name: "My_Merchant",
          connected: true,
          lifecycle_state: "PAUSED",
          game: {
            ctype: "merchant",
            map: "main",
            isize: 1,
            esize: 1,
            items: [null],
            slots: {},
          },
        },
        {
          name: "Offline",
          connected: false,
          game: { items: [], slots: {} },
        },
      ],
    });

    assert.equal(root.querySelectorAll(".inventory-character-card").length, 2);
    assert.match(root.textContent, /My_Ranger1/);
    assert.match(root.textContent, /My_Merchant/);
    assert.doesNotMatch(root.textContent, /Offline/);
    assert.equal(
      root.querySelectorAll(".inventory-slot-grid .live-item-slot").length,
      3,
    );
    assert.equal(
      root.querySelectorAll(".equipment-grid .live-item-slot").length,
      EQUIPMENT_ORDER.length * 2,
    );
    assert.match(root.innerHTML, /pack_20vt8\.png/);
    assert.match(root.textContent, /123/);
    assert.match(root.textContent, /\+8/);
    assert.match(root.textContent, /CONSUMABLE/);
    assert.equal(root.querySelectorAll(".item-disposition-badge").length, 1);
    assert.equal(root.querySelectorAll(".item-protection-badge").length, 1);
    assert.match(
      root.querySelector('[data-disposition="CONSUMABLE"]').title,
      /VALUABLE/,
    );
  } finally {
    global.document = previousDocument;
    dom.window.close();
  }
});

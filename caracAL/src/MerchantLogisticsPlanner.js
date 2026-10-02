"use strict";

const CLAIM_TYPES = Object.freeze([
  "MLUCK",
  "POTION_DELIVERY",
  "ITEM_DELIVERY",
  "GOLD_PICKUP",
  "INVENTORY_PRESSURE",
  "GEAR_DELIVERY",
]);

const DEFAULT_PRIORITY = Object.freeze({
  MLUCK: 40,
  POTION_DELIVERY: 90,
  ITEM_DELIVERY: 70,
  GOLD_PICKUP: 50,
  INVENTORY_PRESSURE: 95,
  GEAR_DELIVERY: 80,
});

const DEFAULT_PRESSURE_DISPOSITIONS = Object.freeze([
  "BANK",
  "SELL",
  "EXCHANGE",
  "CRAFT",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function characterType(block) {
  return String(
    block?.account_character_type || block?.live_state?.ctype || "",
  ).toLowerCase();
}

function isMerchant(block) {
  return characterType(block) === "merchant";
}

function isLive(block) {
  return !!block?.live_state && block?.connected === true;
}

function inventoryItems(block) {
  return Array.isArray(block?.live_state?.items) ? block.live_state.items : [];
}

function equipmentItems(block) {
  return Object.values(object(block?.live_state?.slots)).filter(Boolean);
}

function itemName(item) {
  return stringValue(object(item).name);
}

function itemQuantity(item) {
  const current = object(item);
  const quantity = finite(current.q, null);
  return quantity !== null && quantity > 0 ? quantity : 1;
}

function totalInventoryItem(block, name) {
  return inventoryItems(block).reduce(
    (sum, item) => sum + (itemName(item) === name ? itemQuantity(item) : 0),
    0,
  );
}

function ownsItem(block, name) {
  if (totalInventoryItem(block, name) > 0) return true;
  return equipmentItems(block).some((item) => itemName(item) === name);
}

function targetQuantities(value) {
  const result = [];
  for (const [name, raw] of Object.entries(object(value))) {
    const rawObject = object(raw);
    const quantity = positiveInt(
      typeof raw === "object" ? rawObject.target ?? rawObject.quantity : raw,
      null,
    );
    if (!name.trim() || quantity === null || quantity <= 0) continue;
    result.push({
      name: name.trim(),
      target: quantity,
      priority:
        finite(typeof raw === "object" ? rawObject.priority : null, null) ??
        null,
    });
  }
  return result;
}

function desiredGear(value) {
  if (Array.isArray(value)) {
    return stringList(value).map((name) => ({ name, priority: null }));
  }

  const config = object(value);
  const list = stringList(config.desiredItems || config.items);
  return list.map((name) => ({
    name,
    priority: finite(config.priority, null),
  }));
}

function claimId(parts) {
  return parts.map((part) => String(part ?? "")).join(":");
}

function priorityFor(type, override) {
  const parsed = finite(override, null);
  return parsed === null ? DEFAULT_PRIORITY[type] : parsed;
}

function freeInventorySlots(block) {
  const size = positiveInt(
    block?.live_state?.isize,
    inventoryItems(block).length,
  );
  const occupied = inventoryItems(block).filter(Boolean).length;
  return Math.max(0, size - occupied);
}

function inventoryPressureCandidates(block, config) {
  const intelligence = block?.inventory_intelligence_runtime;
  const entries = Array.isArray(intelligence?.entries)
    ? intelligence.entries
    : [];
  const configured = stringList(config.pickupDispositions);
  const allowed = new Set(
    configured.length ? configured : DEFAULT_PRESSURE_DISPOSITIONS,
  );

  return entries.filter(
    (entry) =>
      Number.isInteger(entry?.slot) &&
      entry?.protected !== true &&
      allowed.has(String(entry?.disposition || "").toUpperCase()) &&
      stringValue(entry?.name),
  );
}

function normalizedLogistics(block) {
  const config = object(block?.runtime_config);
  const logistics = object(config.logistics);
  return {
    enabled: logistics.enabled === true,
    merchant: stringValue(logistics.merchant),
    mluck: object(logistics.mluck),
    potions: object(logistics.potions),
    items: object(logistics.items),
    gold: object(logistics.gold),
    inventoryPressure: object(logistics.inventoryPressure),
    gear: logistics.gear,
  };
}

function merchantLogisticsEnabled(block) {
  const config = object(block?.runtime_config);
  const merchant = object(config.merchant);
  const logistics = object(merchant.logistics);
  return logistics.enabled !== false;
}

class MerchantLogisticsPlanner {
  constructor({
    now = () => Date.now(),
    leaseMs = 60000,
    pingPongCooldownMs = 120000,
    completionCooldownMs = 30000,
  } = {}) {
    this.now = now;
    this.leaseMs = Math.max(1000, finite(leaseMs, 60000));
    this.pingPongCooldownMs = Math.max(
      1000,
      finite(pingPongCooldownMs, 120000),
    );
    this.completionCooldownMs = Math.max(
      1000,
      finite(completionCooldownMs, 30000),
    );
    this.assignments = new Map();
    this.transferHistory = [];
    this.completedClaims = new Map();
    this.outcomeHolds = new Map();
    this.lastBoard = this.emptyBoard();
  }

  emptyBoard() {
    return {
      generatedAt: this.now(),
      merchantIndependent: true,
      merchants: [],
      claims: [],
      suppressed: [],
      summary: {
        total: 0,
        ready: 0,
        waitingMerchant: 0,
        suppressed: 0,
        byType: Object.fromEntries(CLAIM_TYPES.map((type) => [type, 0])),
      },
    };
  }

  recordTransfer({ itemName: name, from, to, at = this.now() } = {}) {
    const item = stringValue(name);
    const source = stringValue(from);
    const target = stringValue(to);
    if (!item || !source || !target || source === target) return false;

    this.transferHistory.push({
      itemName: item,
      from: source,
      to: target,
      at: finite(at, this.now()),
    });
    this.prune();
    return true;
  }

  recordClaimOutcome(claim, result = {}, at = this.now()) {
    const id = stringValue(claim?.id);
    if (!id) return false;

    const outcome = stringValue(result?.outcome);
    const timestamp = finite(at, this.now());
    if (outcome === "CONFIRMED") {
      this.outcomeHolds.delete(id);
      if (
        result?.itemName &&
        result?.source &&
        result?.target &&
        Number(result?.executedQuantity) > 0
      ) {
        this.recordTransfer({
          itemName: result.itemName,
          from: result.source,
          to: result.target,
          at: timestamp,
        });
      }
      if (result?.fulfilled === true) {
        this.recordClaimCompleted(id, timestamp);
      } else {
        this.outcomeHolds.set(id, {
          outcome: "CONFIRMED_PARTIAL",
          reason: "WAIT_FOR_STATE_RECONCILIATION",
          at: timestamp,
          retryAt: timestamp + Math.min(5000, this.completionCooldownMs),
        });
      }
      return true;
    }

    if (outcome === "UNKNOWN" || outcome === "DISPATCHED") {
      this.outcomeHolds.set(id, {
        outcome,
        reason: stringValue(result?.reason) || "OUTCOME_UNCERTAIN",
        at: timestamp,
        retryAt: null,
      });
      return true;
    }

    if (outcome === "BLOCKED" || outcome === "REJECTED") {
      this.outcomeHolds.set(id, {
        outcome,
        reason: stringValue(result?.reason) || outcome,
        at: timestamp,
        retryAt: timestamp + this.completionCooldownMs,
      });
      return true;
    }

    return false;
  }

  clearClaimHold(claimOrId) {
    const id =
      typeof claimOrId === "string" ? claimOrId : stringValue(claimOrId?.id);
    return id ? this.outcomeHolds.delete(id) : false;
  }

  recordClaimCompleted(claimOrId, at = this.now()) {
    const id =
      typeof claimOrId === "string" ? claimOrId : stringValue(claimOrId?.id);
    if (!id) return false;
    this.completedClaims.set(id, finite(at, this.now()));
    this.prune();
    return true;
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.lastBoard));
  }

  plan(characterManage = {}) {
    this.prune();
    const now = this.now();
    const merchants = Object.entries(characterManage)
      .filter(([, block]) => isMerchant(block))
      .map(([name, block]) => ({
        name,
        live: isLive(block),
        enabled: merchantLogisticsEnabled(block),
        map: block?.live_state?.map || null,
        x: finite(block?.live_state?.x, null),
        y: finite(block?.live_state?.y, null),
      }))
      .filter((merchant) => merchant.enabled)
      .sort((a, b) => a.name.localeCompare(b.name));

    const candidateClaims = [];

    for (const [farmerName, block] of Object.entries(characterManage)) {
      if (isMerchant(block) || !isLive(block)) continue;
      const logistics = normalizedLogistics(block);
      if (!logistics.enabled) continue;

      const merchant = this.assignMerchant(
        farmerName,
        logistics.merchant,
        merchants,
      );

      if (logistics.mluck.enabled === true) {
        candidateClaims.push(
          this.claim({
            type: "MLUCK",
            farmer: farmerName,
            merchant,
            priority: priorityFor("MLUCK", logistics.mluck.priority),
            reason: "MLUCK_REQUESTED",
            direction: merchant ? merchant.name + "->" + farmerName : null,
          }),
        );
      }

      for (const target of targetQuantities(logistics.potions)) {
        const current = totalInventoryItem(block, target.name);
        if (current >= target.target) continue;
        candidateClaims.push(
          this.claim({
            type: "POTION_DELIVERY",
            farmer: farmerName,
            merchant,
            itemName: target.name,
            quantity: target.target - current,
            priority: priorityFor("POTION_DELIVERY", target.priority),
            reason: "POTION_BELOW_TARGET",
            direction: merchant ? merchant.name + "->" + farmerName : null,
          }),
        );
      }

      for (const target of targetQuantities(logistics.items)) {
        const current = totalInventoryItem(block, target.name);
        if (current >= target.target) continue;
        candidateClaims.push(
          this.claim({
            type: "ITEM_DELIVERY",
            farmer: farmerName,
            merchant,
            itemName: target.name,
            quantity: target.target - current,
            priority: priorityFor("ITEM_DELIVERY", target.priority),
            reason: "ITEM_BELOW_TARGET",
            direction: merchant ? merchant.name + "->" + farmerName : null,
          }),
        );
      }

      const farmerGold = finite(block?.live_state?.gold, 0);
      const keepGold = Math.max(0, finite(logistics.gold.keep, 0));
      const pickupAbove = Math.max(
        keepGold,
        finite(logistics.gold.pickupAbove, keepGold),
      );
      const minTransfer = Math.max(1, finite(logistics.gold.minTransfer, 1));
      if (logistics.gold.enabled === true && farmerGold > pickupAbove) {
        const amount = Math.floor(farmerGold - keepGold);
        if (amount >= minTransfer) {
          candidateClaims.push(
            this.claim({
              type: "GOLD_PICKUP",
              farmer: farmerName,
              merchant,
              amount,
              priority: priorityFor("GOLD_PICKUP", logistics.gold.priority),
              reason: "GOLD_ABOVE_RESERVE",
              direction: merchant ? farmerName + "->" + merchant.name : null,
              metadata: {
                keepGold,
                pickupAbove,
              },
            }),
          );
        }
      }

      if (logistics.inventoryPressure.enabled === true) {
        const threshold = positiveInt(
          logistics.inventoryPressure.freeSlotsAtOrBelow,
          2,
        );
        const freeSlots = freeInventorySlots(block);
        if (freeSlots <= threshold) {
          const maxClaims = Math.max(
            1,
            positiveInt(logistics.inventoryPressure.maxClaims, 3),
          );
          const candidates = inventoryPressureCandidates(
            block,
            logistics.inventoryPressure,
          ).slice(0, maxClaims);
          for (const entry of candidates) {
            candidateClaims.push(
              this.claim({
                type: "INVENTORY_PRESSURE",
                farmer: farmerName,
                merchant,
                itemName: entry.name,
                inventorySlot: entry.slot,
                quantity: positiveInt(entry.quantity, 1),
                priority: priorityFor(
                  "INVENTORY_PRESSURE",
                  logistics.inventoryPressure.priority,
                ),
                reason: "FARMER_INVENTORY_PRESSURE",
                direction: merchant ? farmerName + "->" + merchant.name : null,
                metadata: {
                  freeSlots,
                  threshold,
                  disposition: entry.disposition || null,
                },
              }),
            );
          }
        }
      }

      for (const target of desiredGear(logistics.gear)) {
        if (ownsItem(block, target.name)) continue;
        candidateClaims.push(
          this.claim({
            type: "GEAR_DELIVERY",
            farmer: farmerName,
            merchant,
            itemName: target.name,
            quantity: 1,
            priority: priorityFor("GEAR_DELIVERY", target.priority),
            reason: "DESIRED_GEAR_MISSING",
            direction: merchant ? merchant.name + "->" + farmerName : null,
          }),
        );
      }
    }

    const claims = [];
    const suppressed = [];
    for (const claim of candidateClaims) {
      const hold = this.outcomeHolds.get(claim.id);
      if (hold) {
        if (hold.retryAt === null || now < hold.retryAt) {
          suppressed.push({
            ...claim,
            status: "SUPPRESSED",
            suppressionReason:
              hold.outcome === "UNKNOWN" || hold.outcome === "DISPATCHED"
                ? "OUTCOME_UNCERTAIN"
                : "EXECUTION_BACKOFF",
            suppressionEvidence: hold,
          });
          continue;
        }
        this.outcomeHolds.delete(claim.id);
      }

      const completedAt = this.completedClaims.get(claim.id);
      if (
        Number.isFinite(completedAt) &&
        now - completedAt < this.completionCooldownMs
      ) {
        suppressed.push({
          ...claim,
          status: "SUPPRESSED",
          suppressionReason: "RECENTLY_COMPLETED",
        });
        continue;
      }

      const pingPong = this.pingPongSuppression(claim);
      if (pingPong) {
        suppressed.push({
          ...claim,
          status: "SUPPRESSED",
          suppressionReason: "ANTI_PINGPONG",
          suppressionEvidence: pingPong,
        });
        continue;
      }

      claims.push({
        ...claim,
        status: claim.merchant?.live ? "READY" : "WAITING_MERCHANT",
      });
    }

    claims.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.farmer.localeCompare(b.farmer) ||
        a.id.localeCompare(b.id),
    );

    const byType = Object.fromEntries(CLAIM_TYPES.map((type) => [type, 0]));
    for (const claim of claims) byType[claim.type] += 1;

    this.lastBoard = {
      generatedAt: now,
      merchantIndependent: true,
      merchants,
      claims,
      suppressed,
      summary: {
        total: claims.length,
        ready: claims.filter((claim) => claim.status === "READY").length,
        waitingMerchant: claims.filter(
          (claim) => claim.status === "WAITING_MERCHANT",
        ).length,
        suppressed: suppressed.length,
        byType,
      },
    };
    return this.snapshot();
  }

  assignMerchant(farmer, explicitMerchant, merchants) {
    if (explicitMerchant) {
      const explicit = merchants.find(
        (merchant) => merchant.name === explicitMerchant,
      );
      if (explicit) return explicit;
      return {
        name: explicitMerchant,
        live: false,
        enabled: true,
        map: null,
        x: null,
        y: null,
      };
    }

    const fingerprint = "farmer:" + farmer;
    const leased = this.assignments.get(fingerprint);
    if (leased && leased.expiresAt > this.now()) {
      const existing = merchants.find(
        (merchant) => merchant.name === leased.merchant,
      );
      if (existing) return existing;
    }

    const selected = merchants[0] || null;
    if (selected) {
      this.assignments.set(fingerprint, {
        merchant: selected.name,
        expiresAt: this.now() + this.leaseMs,
      });
    }
    return selected;
  }

  claim({
    type,
    farmer,
    merchant,
    itemName: name = null,
    quantity = null,
    amount = null,
    inventorySlot = null,
    priority,
    reason,
    direction,
    metadata = {},
  }) {
    const merchantName = merchant?.name || "unassigned";
    const id = claimId([
      type,
      farmer,
      merchantName,
      name || "",
      inventorySlot ?? "",
    ]);
    return {
      id,
      type,
      farmer,
      merchant: merchant
        ? {
            name: merchant.name,
            live: merchant.live,
          }
        : null,
      itemName: name,
      quantity,
      amount,
      inventorySlot,
      priority,
      reason,
      direction,
      metadata,
    };
  }

  pingPongSuppression(claim) {
    if (!claim.itemName || !claim.direction) return null;
    const [from, to] = claim.direction.split("->");
    const now = this.now();

    return (
      this.transferHistory
        .slice()
        .reverse()
        .find(
          (entry) =>
            entry.itemName === claim.itemName &&
            entry.from === to &&
            entry.to === from &&
            now - entry.at < this.pingPongCooldownMs,
        ) || null
    );
  }

  prune() {
    const now = this.now();
    this.transferHistory = this.transferHistory.filter(
      (entry) => now - entry.at < this.pingPongCooldownMs,
    );
    for (const [id, at] of this.completedClaims) {
      if (now - at >= this.completionCooldownMs) {
        this.completedClaims.delete(id);
      }
    }
    for (const [id, hold] of this.outcomeHolds) {
      if (hold.retryAt !== null && hold.retryAt <= now) {
        this.outcomeHolds.delete(id);
      }
    }
    for (const [key, lease] of this.assignments) {
      if (lease.expiresAt <= now) this.assignments.delete(key);
    }
  }
}

module.exports = {
  CLAIM_TYPES,
  MerchantLogisticsPlanner,
};

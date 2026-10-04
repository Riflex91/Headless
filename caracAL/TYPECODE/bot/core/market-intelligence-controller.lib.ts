import type { MarketListingSnapshot } from "./game-adapter.lib";

const MODULE = "MarketIntelligenceController";
const MEDIUM_CONFIDENCE_MIN_SAMPLES = 3;
const HIGH_CONFIDENCE_MIN_SAMPLES = 10;
const MEDIUM_CONFIDENCE_MAX_AGE_MS = 60 * 60 * 1000;
const HIGH_CONFIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

export type MarketIntelligenceSource =
  | "LIVE_VISIBLE"
  | "PONTY"
  | "LOCAL_HISTORY";

export type MarketIntelligenceConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface MarketIntelligenceObservationInput {
  itemName?: unknown;
  item_name?: unknown;
  item?: unknown;
  level?: unknown;
  price?: unknown;
  quantity?: unknown;
  server?: unknown;
  seller?: unknown;
  observedAt?: unknown;
  observed_at?: unknown;
  timestamp?: unknown;
  metadata?: unknown;
}

export interface MarketIntelligenceObservation {
  itemName: string;
  level: number | null;
  price: number;
  quantity: number;
  server: string | null;
  seller: string | null;
  timestamp: number;
  source: MarketIntelligenceSource;
  metadata: Record<string, unknown>;
}

export interface MarketIntelligenceAggregate {
  itemName: string;
  level: number | null;
  server: string | null;
  medianPrice: number;
  priceBand: {
    min: number;
    max: number;
  };
  volatility: number;
  samples: number;
  ageMs: number;
  confidence: MarketIntelligenceConfidence;
  sources: MarketIntelligenceSource[];
}

export interface MarketIntelligenceStatus {
  timestamp: number;
  state: "READY" | "EMPTY";
  reason: "MARKET_INTELLIGENCE_READY" | "MARKET_INTELLIGENCE_NO_SAMPLES";
  observations: MarketIntelligenceObservation[];
  aggregates: MarketIntelligenceAggregate[];
  summary: {
    observations: number;
    aggregates: number;
    liveVisible: number;
    ponty: number;
    localHistory: number;
  };
  policy: {
    readOnly: true;
    liveVisibleSellOnly: true;
    giveawaysExcluded: true;
    priceBand: "OBSERVED_MIN_MAX";
    volatility: "RELATIVE_RANGE_OVER_MEDIAN";
    confidence: {
      low: string;
      medium: {
        minSamples: number;
        maxAgeMs: number;
      };
      high: {
        minSamples: number;
        maxAgeMs: number;
      };
    };
  };
}

export interface MarketIntelligenceEvent {
  type: "MARKET_INTELLIGENCE_STATUS";
  reason: MarketIntelligenceStatus["reason"];
  status: MarketIntelligenceStatus;
}

interface MarketIntelligenceGame {
  market(): MarketListingSnapshot[];
}

export interface MarketIntelligenceControllerOptions {
  now?: () => number;
  server?: () => string | null;
  ponty?: () => MarketIntelligenceObservationInput[];
  localHistory?: () => MarketIntelligenceObservationInput[];
  onEvent?: (event: MarketIntelligenceEvent) => void;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizedQuantity(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function aggregateKey(
  itemName: string,
  level: number | null,
  server: string | null,
): string {
  return JSON.stringify([itemName, level, server]);
}

function confidence(samples: number, ageMs: number): MarketIntelligenceConfidence {
  if (
    samples >= HIGH_CONFIDENCE_MIN_SAMPLES &&
    ageMs <= HIGH_CONFIDENCE_MAX_AGE_MS
  ) {
    return "HIGH";
  }
  if (
    samples >= MEDIUM_CONFIDENCE_MIN_SAMPLES &&
    ageMs <= MEDIUM_CONFIDENCE_MAX_AGE_MS
  ) {
    return "MEDIUM";
  }
  return "LOW";
}

function normalizeHistoricalObservation(
  input: MarketIntelligenceObservationInput,
  source: Exclude<MarketIntelligenceSource, "LIVE_VISIBLE">,
  now: number,
): MarketIntelligenceObservation | null {
  const raw = record(input);
  const itemName = text(raw.itemName ?? raw.item_name ?? raw.item);
  const price = positiveNumber(raw.price);

  if (!itemName || price === null) return null;

  return {
    itemName,
    level: nonNegativeInteger(raw.level),
    price,
    quantity: normalizedQuantity(raw.quantity),
    server: text(raw.server),
    seller: text(raw.seller),
    timestamp: timestamp(
      raw.observedAt ?? raw.observed_at ?? raw.timestamp,
      now,
    ),
    source,
    metadata: record(raw.metadata),
  };
}

function normalizeLiveObservation(
  listing: MarketListingSnapshot,
  server: string | null,
  now: number,
): MarketIntelligenceObservation | null {
  if (listing.side !== "SELL") return null;
  if (
    listing.item.giveaway !== null &&
    Number(listing.item.giveaway) > 0
  ) {
    return null;
  }

  const itemName = text(listing.item.name);
  const price = positiveNumber(listing.item.price);
  if (!itemName || price === null) return null;

  return {
    itemName,
    level: nonNegativeInteger(listing.item.level),
    price,
    quantity: normalizedQuantity(listing.item.quantity),
    server,
    seller: listing.merchantName,
    timestamp: now,
    source: "LIVE_VISIBLE",
    metadata: {
      merchantId: listing.merchantId,
      slot: listing.slot,
      map: listing.map,
      x: listing.x,
      y: listing.y,
      rid: listing.item.rid,
    },
  };
}

function aggregateObservations(
  observations: MarketIntelligenceObservation[],
  now: number,
): MarketIntelligenceAggregate[] {
  const groups = new Map<string, MarketIntelligenceObservation[]>();

  for (const observation of observations) {
    const key = aggregateKey(
      observation.itemName,
      observation.level,
      observation.server,
    );
    const group = groups.get(key) || [];
    group.push(observation);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const prices = group.map((observation) => observation.price);
      const medianPrice = median(prices);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const newestTimestamp = Math.max(
        ...group.map((observation) => observation.timestamp),
      );
      const ageMs = Math.max(0, now - newestTimestamp);

      return {
        itemName: group[0].itemName,
        level: group[0].level,
        server: group[0].server,
        medianPrice,
        priceBand: {
          min,
          max,
        },
        volatility:
          medianPrice > 0 ? (max - min) / medianPrice : 0,
        samples: group.length,
        ageMs,
        confidence: confidence(group.length, ageMs),
        sources: [...new Set(group.map((observation) => observation.source))].sort(),
      };
    })
    .sort(
      (left, right) =>
        left.itemName.localeCompare(right.itemName) ||
        (left.level ?? -1) - (right.level ?? -1) ||
        String(left.server || "").localeCompare(String(right.server || "")),
    );
}

export class MarketIntelligenceController {
  private readonly now: () => number;
  private readonly server: () => string | null;
  private readonly ponty: () => MarketIntelligenceObservationInput[];
  private readonly localHistory: () => MarketIntelligenceObservationInput[];
  private readonly onEvent?: (event: MarketIntelligenceEvent) => void;
  private lastStatus: MarketIntelligenceStatus | null = null;

  constructor(
    private readonly game: MarketIntelligenceGame,
    options: MarketIntelligenceControllerOptions = {},
  ) {
    this.now = options.now || (() => Date.now());
    this.server = options.server || (() => null);
    this.ponty = options.ponty || (() => []);
    this.localHistory = options.localHistory || (() => []);
    this.onEvent = options.onEvent;
  }

  status(): MarketIntelligenceStatus {
    return this.lastStatus || this.buildStatus();
  }

  tick(): MarketIntelligenceStatus {
    const status = this.buildStatus();
    this.lastStatus = status;
    this.onEvent?.({
      type: "MARKET_INTELLIGENCE_STATUS",
      reason: status.reason,
      status,
    });
    return status;
  }

  private buildStatus(): MarketIntelligenceStatus {
    const now = this.now();
    const server = this.server();
    const liveVisible = this.game
      .market()
      .map((listing) => normalizeLiveObservation(listing, server, now))
      .filter(
        (
          observation,
        ): observation is MarketIntelligenceObservation =>
          observation !== null,
      );
    const ponty = this.ponty()
      .map((observation) =>
        normalizeHistoricalObservation(observation, "PONTY", now),
      )
      .filter(
        (
          observation,
        ): observation is MarketIntelligenceObservation =>
          observation !== null,
      );
    const localHistory = this.localHistory()
      .map((observation) =>
        normalizeHistoricalObservation(observation, "LOCAL_HISTORY", now),
      )
      .filter(
        (
          observation,
        ): observation is MarketIntelligenceObservation =>
          observation !== null,
      );

    const observations = [...liveVisible, ...ponty, ...localHistory].sort(
      (left, right) =>
        right.timestamp - left.timestamp ||
        left.itemName.localeCompare(right.itemName) ||
        (left.level ?? -1) - (right.level ?? -1),
    );
    const aggregates = aggregateObservations(observations, now);
    const state = observations.length > 0 ? "READY" : "EMPTY";
    const reason =
      state === "READY"
        ? "MARKET_INTELLIGENCE_READY"
        : "MARKET_INTELLIGENCE_NO_SAMPLES";

    return {
      timestamp: now,
      state,
      reason,
      observations,
      aggregates,
      summary: {
        observations: observations.length,
        aggregates: aggregates.length,
        liveVisible: liveVisible.length,
        ponty: ponty.length,
        localHistory: localHistory.length,
      },
      policy: {
        readOnly: true,
        liveVisibleSellOnly: true,
        giveawaysExcluded: true,
        priceBand: "OBSERVED_MIN_MAX",
        volatility: "RELATIVE_RANGE_OVER_MEDIAN",
        confidence: {
          low: "fallback when MEDIUM/HIGH thresholds are not met",
          medium: {
            minSamples: MEDIUM_CONFIDENCE_MIN_SAMPLES,
            maxAgeMs: MEDIUM_CONFIDENCE_MAX_AGE_MS,
          },
          high: {
            minSamples: HIGH_CONFIDENCE_MIN_SAMPLES,
            maxAgeMs: HIGH_CONFIDENCE_MAX_AGE_MS,
          },
        },
      },
    };
  }
}

export const MARKET_INTELLIGENCE_MODULE = MODULE;

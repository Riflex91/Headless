import type {
  PontyListingSnapshot,
} from "./game-adapter.lib";
import type {
  MarketIntelligenceObservationInput,
} from "./market-intelligence-controller.lib";

export interface PontyMarketReadSource {
  ponty(): PontyListingSnapshot[];
}

export interface PontyMarketSourceOptions {
  server?: () => string | null;
  now?: () => number;
}

function normalizedServer(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function readPontyMarketObservations(
  game: PontyMarketReadSource,
  options: PontyMarketSourceOptions = {},
): MarketIntelligenceObservationInput[] {
  const server = normalizedServer(options.server?.());
  const observedAt = options.now?.() ?? Date.now();

  return game.ponty().map((listing) => ({
    itemName: listing.item.name,
    level: listing.item.level,
    price: listing.unitPrice,
    quantity: listing.item.quantity,
    server,
    seller: "Ponty",
    observedAt,
    metadata: {
      rid: listing.item.rid,
      totalPrice: listing.totalPrice,
      cashMultiplier: listing.cashMultiplier,
      priceBasis: "PONTY_UNIT_PRICE",
    },
  }));
}

export class PontyMarketSnapshotTracker {
  private signature: string | null = null;
  private observedAt: number | null = null;

  observations(
    game: PontyMarketReadSource,
    options: PontyMarketSourceOptions = {},
  ): MarketIntelligenceObservationInput[] {
    const listings = game.ponty();
    if (listings.length === 0) {
      this.signature = null;
      this.observedAt = null;
      return [];
    }

    const signature = JSON.stringify(listings);
    if (signature !== this.signature || this.observedAt === null) {
      this.signature = signature;
      this.observedAt = options.now?.() ?? Date.now();
    }

    const observedAt = this.observedAt;
    return readPontyMarketObservations(
      {
        ponty: () => listings,
      },
      {
        ...options,
        now: () => observedAt,
      },
    ).map((observation) => ({
      ...observation,
      metadata: {
        ...(observation.metadata || {}),
        freshnessBasis: "FIRST_OBSERVED_RUNTIME_SNAPSHOT",
      },
    }));
  }
}

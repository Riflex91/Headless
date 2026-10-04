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

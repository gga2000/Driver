import { DriverError, PriceRequest, type DeliveryPoint, type OrderType, type PriceRequestInput, type Quote, type Vertical } from '@driver/contracts';

/** The quote engine orders prices with (bound to `PricingService.quote`). */
export interface QuotePort {
  quote(req: PriceRequest): Quote;
}

export interface FeeContext {
  cityId: string;
  type: OrderType;
  rideVertical?: 'taxi' | 'tuktuk' | undefined;
  /** Merchant orders: the merchant's place; rides, errands, parcels: where the customer said. */
  pickup: DeliveryPoint | null;
  dropoff: DeliveryPoint | null;
  options?: { doorPickup?: boolean | undefined; streetHandover?: boolean | undefined } | undefined;
  at: Date;
}

/** What the server charges for moving the order, locked at placement. */
export interface ServerFees {
  quoteId: string;
  vertical: Vertical;
  /** Deliveries: every shown component but the service fee (base by zone pair, door/street, night…). */
  deliveryFeeIqd: number;
  serviceFeeIqd: number;
  /** Rides: the quote's rounded, bounded total. 0 for deliveries. */
  fareIqd: number;
  /** HUNT-02: a delivery priced «بالشارع» (the quote carries the street-pickup discount). False for rides. */
  streetHandover: boolean;
}

/** The pricing vertical an order is quoted under. */
export function verticalOf(type: OrderType, rideVertical?: 'taxi' | 'tuktuk'): Vertical {
  switch (type) {
    case 'food':
      return 'food';
    case 'grocery_catalog':
      return 'grocery';
    case 'errand':
      return 'errand';
    case 'parcel':
      return 'parcel';
    case 'ride':
      return rideVertical ?? 'taxi';
    default:
      throw new DriverError('order_type_not_supported');
  }
}

/**
 * M2 review follow-up: fees are computed here from a server quote (`PricingService` for the order's
 * vertical, pickup/drop-off zones and options), never taken from the client. Both zones are needed:
 * a delivery without a drop-off place, or a merchant without a place on file, cannot be priced
 * (`quote_location_required`).
 */
export function serverFees(pricing: QuotePort, ctx: FeeContext): ServerFees {
  const vertical = verticalOf(ctx.type, ctx.rideVertical);
  if (!ctx.pickup?.zoneKey || !ctx.dropoff?.zoneKey) throw new DriverError('quote_location_required');
  const req: PriceRequestInput = {
    cityId: ctx.cityId,
    vertical,
    stops: [
      { zoneId: ctx.pickup.zoneKey, type: 'pickup', ...(ctx.pickup.pin ? { pin: ctx.pickup.pin } : {}) },
      { zoneId: ctx.dropoff.zoneKey, type: 'dropoff', ...(ctx.dropoff.pin ? { pin: ctx.dropoff.pin } : {}) },
    ],
    options: { doorPickup: ctx.options?.doorPickup ?? false, streetHandover: ctx.options?.streetHandover ?? false },
    at: ctx.at,
  };
  let quote: Quote;
  try {
    quote = pricing.quote(PriceRequest.parse(req));
  } catch (err) {
    if (err instanceof Error && err.name === 'PricingError') throw new DriverError('order_type_not_supported', { cause: err });
    throw err;
  }
  if (ctx.type === 'ride') return { quoteId: quote.id, vertical, deliveryFeeIqd: 0, serviceFeeIqd: 0, fareIqd: quote.total, streetHandover: false };
  const serviceFeeIqd = quote.components.filter((c) => c.key === 'service_fee').reduce((a, c) => a + c.amount, 0);
  const deliveryFeeIqd = quote.components.filter((c) => c.key !== 'service_fee' && c.key !== 'promo').reduce((a, c) => a + c.amount, 0);
  const streetHandover = quote.components.some((c) => c.key === 'street_pickup');
  return { quoteId: quote.id, vertical, deliveryFeeIqd: Math.max(0, deliveryFeeIqd), serviceFeeIqd: Math.max(0, serviceFeeIqd), fareIqd: 0, streetHandover };
}

/** A value the client sent must equal the server's; absent means "whatever the server says". */
export function assertExpected(sent: number | undefined, server: number): void {
  if (sent !== undefined && sent !== server) throw new DriverError('price_changed');
}

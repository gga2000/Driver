import {
  CUSTOMER_ZONE_MIN_ORDERS,
  DriverError,
  feeBandsOf,
  type DeliveryAreaZone,
  type DeliveryPoint,
  type DeliveryZoneService,
  type MerchantCustomerZones,
  type MerchantDeliveryArea,
  type ZonePlacementView,
} from '@driver/contracts';
import { serverFees } from '../orders/index.js';

/**
 * The restaurant's delivery map (maps program r5) and where its customers are (r6), free of Nest and
 * I/O so the money and privacy rules are unit-tested: fees come only from the checkout quote, small
 * zones are never named.
 */

/** The quote engine checkout locks fees with (`PricingService`). */
export type AreaPricing = Parameters<typeof serverFees>[0];

/**
 * The delivery fee a customer in `dropoffZone` pays for this kitchen's food at `at`: the very call
 * `orders.place` makes (`serverFees`, food, door delivery), so the map can never show a price checkout
 * would not charge. Null when the pricing engine cannot price the pair (checkout refuses it too);
 * anything else is a real fault and is thrown.
 */
export function foodDeliveryFee(pricing: AreaPricing, cityId: string, kitchenZone: string, dropoffZone: string, at: Date): number | null {
  try {
    return serverFees(pricing, { cityId, type: 'food', pickup: { zoneKey: kitchenZone }, dropoff: { zoneKey: dropoffZone }, at }).deliveryFeeIqd;
  } catch (err) {
    if (err instanceof DriverError && err.code === 'order_type_not_supported') return null;
    throw err;
  }
}

export interface DeliveryAreaFacts {
  merchantOrgId: string;
  cityId: string;
  /** The store's place on file (zone and pin), or null when it has none yet. */
  kitchen: DeliveryPoint | null;
  /** The city's live zones (the list every app map draws). */
  zones: readonly ZonePlacementView[];
  /** Server fee from the kitchen to a zone (`foodDeliveryFee`), null when not priced. */
  feeOf(zoneKey: string): number | null;
  /** Zones a Console switch closes to food from this store. */
  paused: ReadonlySet<string>;
  at: Date;
}

/**
 * «منطقة التوصيل»: every zone with its outline, the server's fee from this kitchen and its band (index
 * into the distinct fees, cheapest first). A store without a place on file gets the outlines with
 * nothing priced; a paused zone keeps its fee (it is what customers pay once it reopens) but says so.
 */
export function composeDeliveryArea(f: DeliveryAreaFacts): MerchantDeliveryArea {
  const kitchenZone = f.kitchen ? f.zones.find((z) => z.key === f.kitchen?.zoneKey) : undefined;
  const priced = f.zones.map((z) => ({ zone: z, fee: f.kitchen ? f.feeOf(z.key) : null }));
  const bands = feeBandsOf(priced.map((p) => p.fee));
  const bandOf = new Map(bands.map((b, i) => [b.feeIqd, i]));
  const zones: DeliveryAreaZone[] = priced.map(({ zone, fee }) => {
    const service: DeliveryZoneService = fee === null ? 'no_price' : f.paused.has(zone.key) ? 'paused' : 'open';
    return {
      key: zone.key,
      name_ar: zone.name_ar,
      name_en: zone.name_en,
      tier: zone.tier,
      placement: zone.placement,
      ring: zone.ring,
      centre: zone.centre,
      feeIqd: fee,
      band: fee === null ? null : (bandOf.get(fee) ?? null),
      service,
      kitchen: zone.key === f.kitchen?.zoneKey,
    };
  });
  return {
    merchantOrgId: f.merchantOrgId,
    cityId: f.cityId,
    kitchen: f.kitchen
      ? { zoneKey: f.kitchen.zoneKey, name_ar: kitchenZone?.name_ar ?? f.kitchen.zoneKey, name_en: kitchenZone?.name_en ?? f.kitchen.zoneKey, pin: f.kitchen.pin ?? null }
      : null,
    zones,
    bands,
    pricedAt: f.at,
  };
}

export interface CustomerZoneFacts {
  merchantOrgId: string;
  from: Date;
  to: Date;
  days: number;
  /** Delivered orders per drop-off zone (null = no zone on file). */
  counts: ReadonlyArray<{ zoneKey: string | null; orders: number }>;
  /** The city's live zones, for names. */
  zones: readonly ZonePlacementView[];
  minOrders?: number;
}

/**
 * «منين زبائنك» (maps spec D7, k-anonymous): a zone is named only with at least `minOrders` delivered
 * orders; the rest — small zones, orders without a zone, zones no longer on the map — are one
 * «مناطق ثانية» count, so no single customer's area can be singled out. Most orders first.
 */
export function composeCustomerZones(f: CustomerZoneFacts): MerchantCustomerZones {
  const min = f.minOrders ?? CUSTOMER_ZONE_MIN_ORDERS;
  const byKey = new Map(f.zones.map((z) => [z.key, z]));
  const named: MerchantCustomerZones['zones'] = [];
  let other = 0;
  let total = 0;
  for (const c of f.counts) {
    total += c.orders;
    const zone = c.zoneKey !== null ? byKey.get(c.zoneKey) : undefined;
    if (zone && c.orders >= min) named.push({ key: zone.key, name_ar: zone.name_ar, name_en: zone.name_en, orders: c.orders });
    else other += c.orders;
  }
  named.sort((a, b) => b.orders - a.orders || a.name_ar.localeCompare(b.name_ar, 'ar'));
  return { merchantOrgId: f.merchantOrgId, from: f.from, to: f.to, days: f.days, minOrders: min, zones: named, otherOrders: other, totalOrders: total };
}

import { z } from 'zod';
import { CityId, Currency, Iqd, LatLng, Vertical } from './common.js';

/** The named components every quote is built from (spec §7). */
export const ComponentKey = z.enum([
  'base',
  'distance',
  'time',
  'zone_adjust',
  'front_seat',
  'door_pickup',
  'street_pickup',
  'wait',
  'night',
  'weather',
  'peak',
  'pickup_compensation',
  'service_fee',
  'small_order',
  'promo',
  'cancellation',
  'points_redeemed',
]);
export type ComponentKey = z.infer<typeof ComponentKey>;

/** Who gets what share of this component. */
export const DriverShareRule = z.enum(['driver_full', 'driver_commissioned', 'platform_only']);
export type DriverShareRule = z.infer<typeof DriverShareRule>;

export const Visibility = z.enum(['shown', 'shadow']);
export type Visibility = z.infer<typeof Visibility>;

export const PriceStop = z.object({
  /** Zone the stop falls into (resolved by the places module before pricing). */
  zoneId: z.string().min(1),
  pin: LatLng.optional(),
  type: z.enum(['pickup', 'dropoff', 'wait']).default('dropoff'),
});
export type PriceStop = z.infer<typeof PriceStop>;

export const PriceOptions = z.object({
  frontSeat: z.boolean().default(false),
  /** Rides: door = driver comes to the door (+fee); otherwise the rider meets at the street. */
  doorPickup: z.boolean().default(false),
  /** Deliveries: customer opts into a street-point handover (−250) instead of the door. */
  streetHandover: z.boolean().default(false),
  /** Minutes of requested wait at a stop; priced by waitPerMinute. */
  waitMinutes: z.number().int().min(0).default(0),
  /** Promo value in IQD, applied as a negative component. */
  promoIqd: Iqd.min(0).default(0),
});
export type PriceOptions = z.infer<typeof PriceOptions>;

export const PriceRequest = z.object({
  cityId: CityId,
  vertical: Vertical,
  stops: z.array(PriceStop).min(2),
  options: PriceOptions.default({}),
  /** Time of the trip; drives night/peak rules. ISO string on the wire. */
  at: z.coerce.date().default(() => new Date()),
  /** Measured or estimated — shadow components use these. */
  distanceKm: z.number().min(0).optional(),
  durationMin: z.number().min(0).optional(),
});
export type PriceRequest = z.infer<typeof PriceRequest>;
/** Wire shape before defaults are applied; what clients send. */
export type PriceRequestInput = z.input<typeof PriceRequest>;

export const QuoteComponent = z.object({
  key: ComponentKey,
  label_ar: z.string(),
  label_en: z.string(),
  amount: Iqd,
  driverShareRule: DriverShareRule,
  visibility: Visibility,
  /** Leg index for per-leg components on multi-stop trips; absent for trip-level ones. */
  leg: z.number().int().min(0).optional(),
});
export type QuoteComponent = z.infer<typeof QuoteComponent>;

export const Quote = z.object({
  id: z.string(),
  cityId: CityId,
  vertical: Vertical,
  currency: Currency,
  /** Shown components only. */
  components: z.array(QuoteComponent),
  /** Computed but hidden until config enables them. */
  shadowComponents: z.array(QuoteComponent),
  /** Sum of shown components before rounding and bounds. */
  subtotal: Iqd,
  /** What the customer pays. Rounded and bounded. */
  total: Iqd,
  /** What the total would have been with shadow components enabled — for calibration. */
  shadowTotal: Iqd,
  rounding: z.object({ step: Iqd, applied: Iqd }),
  bounds: z.object({ floor: Iqd.optional(), ceiling: Iqd.optional(), clamped: z.boolean() }),
  lockedAt: z.coerce.date().optional(),
  acceptedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
});
export type Quote = z.infer<typeof Quote>;

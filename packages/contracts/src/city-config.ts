import { z } from 'zod';
import { CityId, Iqd, Vertical } from './common.js';
import { ComponentKey, DriverShareRule, Visibility } from './pricing.js';

export const DispatchPolicyKind = z.enum(['smart_broadcast', 'auto_assign', 'scheduled', 'pre_assigned']);
export type DispatchPolicyKind = z.infer<typeof DispatchPolicyKind>;

export const BroadcastWave = z.object({
  /** Number of drivers in this wave; 'all' means everyone remaining. */
  size: z.union([z.number().int().positive(), z.literal('all')]),
  seconds: z.number().int().positive(),
});
export type BroadcastWave = z.infer<typeof BroadcastWave>;

export const DispatchConfig = z.object({
  policy: DispatchPolicyKind,
  waves: z.array(BroadcastWave).optional(),
  /** auto_assign: how many orders can share one courier in one zone. */
  maxBatch: z.number().int().min(1).default(1),
  /** Seconds a driver has to accept/decline before timeout. */
  acceptTimeoutSec: z.number().int().positive().default(15),
  /** 'suggest only': route every decision to the console. */
  suggestOnly: z.boolean().default(false),
});
export type DispatchConfig = z.infer<typeof DispatchConfig>;

/** A zone-to-zone fare row. Symmetric unless an explicit reverse row exists. */
export const ZoneFare = z.object({
  from: z.string(),
  to: z.string(),
  fare: Iqd.min(0),
});
export type ZoneFare = z.infer<typeof ZoneFare>;

/** Rule for one component within a vertical. */
export const ComponentRule = z.object({
  key: ComponentKey,
  label_ar: z.string(),
  label_en: z.string(),
  driverShareRule: DriverShareRule,
  visibility: Visibility,
  /** Fixed amount (e.g. front_seat +2000) when the component is a flat fee. */
  amount: Iqd.optional(),
  /** Per-unit rate for metered components (distance: per km; time/wait: per minute). */
  perUnit: Iqd.optional(),
  /** Hour window [start, end) in local time for time-gated rules like night. */
  hours: z.tuple([z.number().int().min(0).max(24), z.number().int().min(0).max(24)]).optional(),
});
export type ComponentRule = z.infer<typeof ComponentRule>;

export const VerticalPricing = z.object({
  vertical: Vertical,
  zoneFares: z.array(ZoneFare),
  /** Fallback when no zone pair matches. */
  defaultFare: Iqd.min(0),
  components: z.array(ComponentRule),
  floor: Iqd.min(0).optional(),
  ceiling: Iqd.min(0).optional(),
});
export type VerticalPricing = z.infer<typeof VerticalPricing>;

export const CityPricingConfig = z.object({
  cityId: CityId,
  name_ar: z.string(),
  name_en: z.string(),
  /** IANA zone used for hour-gated components. */
  timezone: z.string(),
  /** Round totals to nearest step (default 250 IQD). */
  roundingStep: Iqd.positive().default(250),
  zones: z.array(z.object({ id: z.string(), name_ar: z.string(), name_en: z.string() })),
  verticals: z.array(VerticalPricing),
  dispatch: z.record(Vertical, DispatchConfig),
  /** Driver may hold this much collected cash before offers stop. */
  driverCreditCapIqd: Iqd.min(0),
});
export type CityPricingConfig = z.infer<typeof CityPricingConfig>;

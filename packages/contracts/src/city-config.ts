import { z } from 'zod';
import { CityId, Iqd, Vertical } from './common.js';
import { ComponentKey, DriverShareRule, Visibility } from './pricing.js';

export const DispatchPolicyKind = z.enum(['smart_broadcast', 'auto_assign', 'scheduled', 'pre_assigned']);
export type DispatchPolicyKind = z.infer<typeof DispatchPolicyKind>;

export const BroadcastWave = z.object({
  /** Number of drivers in this wave; 'all' means everyone remaining. */
  size: z.union([z.number().int().positive(), z.literal('all')]),
  /** Search radius for this wave; absent = whole city. */
  radiusKm: z.number().positive().optional(),
  seconds: z.number().int().positive(),
});
export type BroadcastWave = z.infer<typeof BroadcastWave>;

/** Dispatch & pricing detail spec §3 timing, all per city/vertical and all config. */
export const DispatchConfig = z.object({
  policy: DispatchPolicyKind,
  waves: z.array(BroadcastWave).optional(),
  /** auto_assign: how many orders can share one courier (max 2 per bike, 3 per tuktuk). */
  maxBatch: z.number().int().min(1).default(1),
  /** Seconds a driver has to accept/decline before timeout. */
  acceptTimeoutSec: z.number().int().positive().default(15),
  /** 'suggest only': route every decision to the console. */
  suggestOnly: z.boolean().default(false),
  /** smart_broadcast: no acceptance after this → red card + re-broadcast with compensation. */
  rebroadcastAfterSec: z.number().int().positive().default(60),
  /** Pickup compensation on re-broadcast (edge-case §6: only drivers outside waves 1–2). */
  rebroadcastCompensationIqd: Iqd.min(0).default(500),
  /** Customer may cancel free or schedule after this many seconds of searching. */
  customerFreeCancelAfterSec: z.number().int().positive().default(180),
  /** auto_assign: passes before the dispatcher card. */
  passes: z.number().int().min(1).default(3),
  /** auto_assign: courier timed to arrive this many minutes before `ready`. */
  arriveBeforeReadyMin: z.number().int().min(0).default(2),
  /** Batching: second pickup may add at most this many minutes. */
  batchMaxDetourMin: z.number().int().min(0).default(4),
  /** Batching: hot items never wait more than this from `ready`. */
  batchMaxHotWaitMin: z.number().int().min(0).default(10),
  /** scheduled: minimum seats (incl. walk-ups) by T−30 or cancelled_low_fill. */
  minSeatsByTMinus30: z.number().int().min(0).default(3),
  /** pre_assigned (khat): substitute auction waves × size × minutes. */
  substituteWaves: z.number().int().min(1).default(2),
  substituteWaveSize: z.number().int().min(1).default(3),
  substituteWaveMin: z.number().int().min(1).default(5),
  /** Ranking weights (sum 100): distance, tier/score, load, vehicle fit. */
  rankWeights: z
    .object({
      distance: z.number().int().min(0).default(40),
      tier: z.number().int().min(0).default(30),
      load: z.number().int().min(0).default(20),
      vehicleFit: z.number().int().min(0).default(10),
    })
    .default({}),
  /** Offers count as "seen" only after this long in the foreground (edge-case §6). */
  offerSeenAfterSec: z.number().int().min(0).default(3),
});
export type DispatchConfig = z.infer<typeof DispatchConfig>;

/** Zone tiers from the Aziziyah seed: distance bands from the centre. */
export const ZoneTier = z.enum(['centre', 'near', 'mid', 'far', 'edge']);
export type ZoneTier = z.infer<typeof ZoneTier>;

export const ZoneConfig = z.object({
  id: z.string(),
  name_ar: z.string(),
  name_en: z.string(),
  tier: ZoneTier,
  /** External id from the courier-company location list (seed file), for import mapping. */
  extId: z.string().optional(),
});
export type ZoneConfig = z.infer<typeof ZoneConfig>;

/** A zone-to-zone fare row. Symmetric unless an explicit reverse row exists. */
export const ZoneFare = z.object({
  from: z.string(),
  to: z.string(),
  fare: Iqd.min(0),
});
export type ZoneFare = z.infer<typeof ZoneFare>;

/**
 * A tier-pair fare row, resolved when no exact zone pair matches (dispatch & pricing spec §1).
 * Symmetric. `'any'` matches every tier, so `{from: 'any', to: 'far'}` is "anything ↔ far".
 */
export const TierFare = z.object({
  from: z.union([ZoneTier, z.literal('any')]),
  to: z.union([ZoneTier, z.literal('any')]),
  fare: Iqd.min(0),
});
export type TierFare = z.infer<typeof TierFare>;

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
  /** Exact zone pairs; consulted first. */
  zoneFares: z.array(ZoneFare),
  /** Tier pairs; consulted when no zone pair matches. */
  tierFares: z.array(TierFare).optional(),
  /** Fallback when neither matches. */
  defaultFare: Iqd.min(0),
  components: z.array(ComponentRule),
  floor: Iqd.min(0).optional(),
  ceiling: Iqd.min(0).optional(),
});
export type VerticalPricing = z.infer<typeof VerticalPricing>;

/** Money & ops §4: cash a driver may hold before offers stop, by trust tier. */
export const CreditCaps = z.object({
  bronze: Iqd.min(0),
  silver: Iqd.min(0),
  gold: Iqd.min(0),
});
export type CreditCaps = z.infer<typeof CreditCaps>;

export const CityPricingConfig = z.object({
  cityId: CityId,
  name_ar: z.string(),
  name_en: z.string(),
  /** IANA zone used for hour-gated components. */
  timezone: z.string(),
  /** Round totals to nearest step (default 250 IQD). */
  roundingStep: Iqd.positive().default(250),
  zones: z.array(ZoneConfig),
  verticals: z.array(VerticalPricing),
  dispatch: z.record(Vertical, DispatchConfig),
  creditCapsIqd: CreditCaps,
});
export type CityPricingConfig = z.infer<typeof CityPricingConfig>;

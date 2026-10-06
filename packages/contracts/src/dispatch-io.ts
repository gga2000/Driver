import { z } from 'zod';
import { CityId, Iqd, LatLng, Vertical } from './common.js';
import { DispatchPolicyKind } from './city-config.js';
import type { Actor } from './identity-io.js';
import type { PartnerDemandMap } from './partner-io.js';


/** Where a dispatch request stands; the Console board groups cards by this. */
export const DispatchStatus = z.enum([
  /** auto_assign: waiting for `readyAt − (ETA + 2 min)`; scheduled: waiting for T−30. */
  'scheduled',
  'searching',
  /** smart_broadcast after 60 s without acceptance: red card, re-broadcast with compensation. */
  'rebroadcast',
  /** Suggest-only: nothing went to drivers; the dispatcher decides ("بانتظار قرار الموزّع"). */
  'awaiting_dispatcher',
  /** Passes/waves exhausted or the free-cancel window reached. */
  'needs_dispatcher',
  'assigned',
  'cancelled',
]);
export type DispatchStatus = z.infer<typeof DispatchStatus>;

export const DispatchOfferState = z.enum(['sent', 'seen', 'accepted', 'declined', 'timed_out', 'withdrawn']);
export type DispatchOfferState = z.infer<typeof DispatchOfferState>;

export const BoardOffer = z.object({
  offerId: z.string(),
  driverId: z.string(),
  wave: z.number().int(),
  pass: z.number().int(),
  state: DispatchOfferState,
  compensationIqd: Iqd,
  expiresInSec: z.number().int(),
});
export type BoardOffer = z.infer<typeof BoardOffer>;

export const BoardCard = z.object({
  tripId: z.string(),
  vertical: Vertical,
  zoneId: z.string(),
  policy: DispatchPolicyKind,
  status: DispatchStatus,
  /** Arabic label for the card's state, e.g. "بانتظار قرار الموزّع". */
  status_ar: z.string(),
  /** 1-based wave (smart_broadcast / substitute auction) or pass (auto_assign); 0 before the first. */
  wave: z.number().int(),
  pass: z.number().int(),
  elapsedSec: z.number().int(),
  /** Seconds until the next timer fires (wave end, pass timeout, rebroadcast, T−30); null when none. */
  countdownSec: z.number().int().nullable(),
  /** Red card: no acceptance after `rebroadcastAfterSec`. */
  red: z.boolean(),
  /** "+500 تعويض" when the re-broadcast pays pickup compensation; null otherwise. */
  compensationLabel_ar: z.string().nullable(),
  customerMayCancelFree: z.boolean(),
  assignedDriverId: z.string().nullable(),
  /** Suggest-only: ranked driver ids the dispatcher can pick from. */
  suggestion: z.array(z.string()),
  offers: z.array(BoardOffer),
});
export type BoardCard = z.infer<typeof BoardCard>;

export const BoardPolicy = z.object({
  vertical: Vertical,
  policy: DispatchPolicyKind,
  suggestOnly: z.boolean(),
  /** True when a runtime override (setPolicy) is in force over the city config. */
  overridden: z.boolean(),
});
export type BoardPolicy = z.infer<typeof BoardPolicy>;

export const DispatchBoard = z.object({
  cityId: CityId,
  at: z.coerce.date(),
  policies: z.array(BoardPolicy),
  cards: z.array(BoardCard),
});
export type DispatchBoard = z.infer<typeof DispatchBoard>;

export const DispatchBoardInput = z.object({ cityId: CityId });

export const SetPolicyInput = z
  .object({
    cityId: CityId,
    vertical: Vertical,
    policy: DispatchPolicyKind.optional(),
    suggestOnly: z.boolean().optional(),
    /** Drop the runtime override and fall back to the city config. */
    clear: z.boolean().optional(),
  })
  .refine((v) => v.clear || v.policy !== undefined || v.suggestOnly !== undefined, { message: 'nothing to set' });
export type SetPolicyInput = z.infer<typeof SetPolicyInput>;

export const OverrideInput = z.object({
  tripId: z.string(),
  driverId: z.string(),
  /** Required when `force` is set (review J116: forced assigns carry a reason). */
  reason: z.string().max(500).optional(),
  /** Assign despite a failed validation (offline / over cap / vehicle fit). The driver still accepts or declines. */
  force: z.boolean().optional(),
});
export type OverrideInput = z.infer<typeof OverrideInput>;

export const OverrideOutput = z.object({ offerId: z.string(), warnings: z.array(z.string()) });
export type OverrideOutput = z.infer<typeof OverrideOutput>;

export const RespondInput = z.object({ offerId: z.string(), accept: z.boolean() });
export type RespondInput = z.infer<typeof RespondInput>;

export const RespondOutput = z.object({
  outcome: z.enum(['assigned', 'declined']),
  tripId: z.string(),
  compensationIqd: Iqd,
});
export type RespondOutput = z.infer<typeof RespondOutput>;

/** Driver app reports foreground time on an offer; it counts as seen only from 3 s (edge-case §6). */
export const OfferSeenInput = z.object({ offerId: z.string(), foregroundMs: z.number().int().min(0) });
export const OfferSeenOutput = z.object({ seen: z.boolean() });

/** What the dispatch module exposes to the transport. Implemented by apps/api, consumed by the router. */
/**
 * Free vehicles around a customer about to book (maps program SP5c, c10). Positions are blurred so
 * no driver can be followed: each moves 50–100 m in a direction fixed per driver for 10 minutes, and
 * nothing names him (no id, no plate). Refreshed by the app every 10 s.
 */
export const NEARBY_RULES = {
  radiusM: 3_000,
  max: 8,
  jitterMinM: 50,
  jitterMaxM: 100,
  /** The blur's direction and size stay the same this long: no jumping between refreshes, no averaging it away. */
  jitterBucketMin: 10,
  refreshMs: 10_000,
} as const;

export const NearbyVehiclesInput = z.object({
  cityId: CityId.default('aziziyah'),
  /** Where the customer will be picked up. */
  pin: LatLng,
  vertical: z.enum(['taxi', 'tuktuk']),
});
export type NearbyVehiclesInput = z.infer<typeof NearbyVehiclesInput>;

export const NearbyVehicles = z.object({
  /** Nearest first, at most `NEARBY_RULES.max`; blurred positions. */
  vehicles: z.array(
    z.object({
      lat: z.number(),
      lng: z.number(),
      /** Degrees clockwise from north, from his own last movement; null when he has not moved. */
      heading: z.number().nullable(),
    }),
  ),
  /** The nearest free one to the pickup on the one ETA (real position, rounded minutes); null when none. */
  nearestMinutes: z.number().int().min(1).nullable(),
  at: z.coerce.date(),
});
export type NearbyVehicles = z.infer<typeof NearbyVehicles>;

/**
 * "Send drivers here" (maps program o5): a dispatcher nudges the free drivers around a busy zone with
 * a push. Never more than once per zone per `cooldownMin`, never more than `maxDrivers` at a time.
 */
export const NUDGE_RULES = {
  cooldownMin: 10,
  /** Free drivers within this distance of the zone (and not already in it) are nudged. */
  radiusKm: 4,
  maxDrivers: 15,
} as const;

export const ZoneDemandInput = z.object({ cityId: CityId });
export const NudgeZoneInput = z.object({ cityId: CityId, zoneId: z.string().min(1) });
export type NudgeZoneInput = z.infer<typeof NudgeZoneInput>;
export const NudgeZoneResult = z.object({
  /** Drivers the push went to. */
  sent: z.number().int().min(0),
  /** The next nudge for this zone is allowed from here. */
  nextAt: z.coerce.date(),
});
export type NudgeZoneResult = z.infer<typeof NudgeZoneResult>;

export interface DispatchPort {
  board(cityId: string): Promise<DispatchBoard>;
  override(actor: Actor, input: OverrideInput): Promise<OverrideOutput>;
  setPolicy(actor: Actor, input: SetPolicyInput): Promise<BoardPolicy>;
  respond(actor: Actor, input: RespondInput): Promise<RespondOutput>;
  offerSeen(actor: Actor, input: z.infer<typeof OfferSeenInput>): Promise<z.infer<typeof OfferSeenOutput>>;
  /** Signed-in customers: free vehicles of one kind near a pickup, blurred (`NEARBY_RULES`). */
  nearby(actor: Actor, input: NearbyVehiclesInput): Promise<NearbyVehicles>;
  /** Console: the city's busy zones (waiting now, usual this hour, drivers there; maps program o5). */
  zoneDemand(cityId: string): Promise<PartnerDemandMap>;
  /** Console: push the free drivers around a busy zone (maps program o5). Throws `nudge_too_soon`. */
  nudgeZone(actor: Actor, input: NudgeZoneInput): Promise<NudgeZoneResult>;
}

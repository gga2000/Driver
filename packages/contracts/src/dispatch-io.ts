import { z } from 'zod';
import { CityId, Iqd, LatLng, Vertical } from './common.js';
import { DispatchPolicyKind } from './city-config.js';
import type { Actor } from './identity-io.js';
import type { PartnerDemandMap } from './partner-io.js';
import { ComplimentKey } from './order-compliment.js';
import { VehicleClass } from './trip.js';
import { VehicleColour, VehicleFeature } from './vehicle-features.js';


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
  /** A rider's «نبّهه» (ride n4): at most this many nudges per offered driver per ride. */
  perDriver: 1,
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

// ───────────────────────── the rider's side of the search (ride step 3) ─────────────────────────

/**
 * n3: how one driver's offer of the rider's ride stands. `expired` covers an offer that ran out or was
 * withdrawn when the wave moved on; an accepted offer ends the search, so it never shows here.
 */
export const RideOfferState = z.enum(['sent', 'seen', 'declined', 'expired']);
export type RideOfferState = z.infer<typeof RideOfferState>;

/**
 * n3: a driver who was sent the rider's ride, as the rider sees him while it searches: first name and
 * approved photo (logged vault reads, like the courier card), his public rating, his car and the
 * features ops confirmed, and his minutes to the pickup on the one ETA. Never a position, a phone or
 * a last name.
 */
export const RideOfferCard = z.object({
  offerId: z.string(),
  firstName: z.string().nullable(),
  /** His approved main photo, signed and short-lived; null → the app draws his initial. */
  photoUrl: z.string().nullable(),
  /** Joy l2's public rating (newest 50, shown from 5); null below that. */
  rating: z.number().nullable(),
  ratingCount: z.number().int().min(0),
  /** His completed trips, every vertical. */
  tripCount: z.number().int().min(0),
  vehicleClass: VehicleClass,
  /** "Toyota Corolla"; null when the registry has none. */
  vehicleModel: z.string().nullable(),
  vehicleColour: VehicleColour.nullable(),
  /** Confirmed at the car check only, display order (`sortFeatures`). */
  features: z.array(VehicleFeature),
  /** Minutes to the pickup while the offer is open (rounded up, at least 1); null once it is not. */
  minutesAway: z.number().int().min(1).nullable(),
  state: RideOfferState,
  /** When the rider nudged him («نبّهه»); null = not yet. */
  nudgedAt: z.coerce.date().nullable(),
  /** One of the rider's favourite drivers. */
  favourite: z.boolean(),
});
export type RideOfferCard = z.infer<typeof RideOfferCard>;

export const MyRideOffersInput = z.object({ orderId: z.string().min(1) });
export type MyRideOffersInput = z.infer<typeof MyRideOffersInput>;

/** Nearest first (open offers by minutes, then the rest); empty before the first wave. */
export const MyRideOffers = z.object({ offers: z.array(RideOfferCard), at: z.coerce.date() });
export type MyRideOffers = z.infer<typeof MyRideOffers>;

/** n4 «نبّهه»: a soft «راكب ينتظرك» to one driver whose offer of this ride is still open. */
export const NudgeOfferInput = z.object({ orderId: z.string().min(1), offerId: z.string().min(1) });
export type NudgeOfferInput = z.infer<typeof NudgeOfferInput>;
export const NudgeOfferResult = z.object({ nudgedAt: z.coerce.date() });
export type NudgeOfferResult = z.infer<typeof NudgeOfferResult>;

/** n5: what the driver profile shows, and when. */
export const DRIVER_PROFILE_RULES = {
  /** The on-time share needs this many completed trips first. */
  onTimeMinTrips: 20,
  /** Most-said compliments shown. */
  compliments: 4,
} as const;

/**
 * n5: a driver's profile on tap — a driver offered the rider's searching ride, or the driver assigned
 * to it. The plate only for the assigned driver; never a phone, a position or a last name.
 */
export const DriverProfile = z.object({
  firstName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  rating: z.number().nullable(),
  ratingCount: z.number().int().min(0),
  tripCount: z.number().int().min(0),
  /** Share of his timed stops reached on time (0–100); null under `DRIVER_PROFILE_RULES.onTimeMinTrips` trips. */
  onTimePct: z.number().int().min(0).max(100).nullable(),
  /** When he became a driver here (his oldest live courier / driver role); null when none is on file. */
  memberSince: z.coerce.date().nullable(),
  vehicleClass: VehicleClass,
  vehicleModel: z.string().nullable(),
  vehicleColour: VehicleColour.nullable(),
  /** Only when he is the driver assigned to this order. */
  plate: z.string().nullable(),
  features: z.array(VehicleFeature),
  /** What riders said, most said first (top `DRIVER_PROFILE_RULES.compliments`). */
  compliments: z.array(z.object({ key: ComplimentKey, count: z.number().int().positive() })),
});
export type DriverProfile = z.infer<typeof DriverProfile>;

/** `offerId`: a driver offered this ride while it searches; absent: the driver assigned to it. */
export const DriverProfileInput = z.object({ orderId: z.string().min(1), offerId: z.string().min(1).optional() });
export type DriverProfileInput = z.infer<typeof DriverProfileInput>;

/**
 * s6 «عوائل»: the first wave of a ride placed with `familyPreferred` goes only to drivers whose car has
 * the confirmed `family` tag, who have driven here at least `minDriverDays` and whose public rating is
 * at least `minRating`; from the second wave (or when none is free) it goes to everyone as usual.
 */
export const FAMILY_PREFERENCE_RULES = { minDriverDays: 90, minRating: 4.7 } as const;

/**
 * x1 cold car in summer: on a hot (cold) day a taxi ride's first `onlyWaves` waves go only to cars whose
 * AC (heating) ops confirmed and whose driver did not say «لا» this shift (`PartnerClimateCheck`); an
 * empty wave opens the next at once. From the next wave everyone may get it (those cars still first,
 * n6), so nobody is left without a ride. Tuktuks have neither and are unaffected; the price never moves.
 */
export const CLIMATE_DISPATCH_RULES = { onlyWaves: 2 } as const;

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

import { z } from 'zod';
import type { Actor } from './identity-io.js';
import type { OrderRoute } from './tracking.js';
import { VehicleClass } from './trip.js';

/**
 * Share-trip links (scoring & safety §5 "plate + photo + share-trip before every ride"; customer
 * app spec §2 and §4; edge-case review C-126). A rider shares a signed link to a ride (taxi /
 * tuktuk) or a الرجعة seat; a customer shares a delivery (food, shop, errand, parcel) with the family
 * at home (maps program SP3c). Whoever opens it — no sign-in — sees coarse data only: the driver's
 * first name and approved main photo (Ali, 2026-10-06), the vehicle and plate, the car's live position inside the sharing window, where a
 * city ride is heading (a pin and the road to it, never an address in words: maps program c9, Ali's
 * call) and the ETA. Never a phone, a full name or the rider's name. The page updates live
 * (`live.share`). The link expires 30 minutes after the trip completes (24 h after creation at the
 * latest) and the rider can revoke it at any time.
 */

export const ShareSubject = z.enum(['ride', 'intercity', 'delivery']);
export type ShareSubject = z.infer<typeof ShareSubject>;

/** A link lives at most this long after the ride is done… */
export const SHARE_AFTER_COMPLETE_MIN = 30;
/** …and never longer than this after it was made. */
export const SHARE_MAX_HOURS = 24;

/** The live share stream (`live.share`, maps program SP5c). */
export const SHARE_LIVE_RULES = {
  /**
   * A city ride is re-read whenever its live channel moves (≤ every 2 s) and at least this often:
   * the ETA ages, and a revoke or the expiry ends the stream.
   */
  refreshMs: 15_000,
  /** Intercity positions are not on the live bus: re-read this often, like the page's old poll. */
  intercityMs: 5_000,
} as const;

export const CreateShareLinkInput = z
  .object({
    /** A ride (taxi / tuktuk) or delivery order of the caller (orderer or household participant). */
    orderId: z.string().min(1).optional(),
    /** A الرجعة booking of the caller. */
    bookingId: z.string().min(1).optional(),
  })
  .refine((v) => (v.orderId ? 1 : 0) + (v.bookingId ? 1 : 0) === 1, { message: 'exactly one of orderId, bookingId' });
export type CreateShareLinkInput = z.infer<typeof CreateShareLinkInput>;

export const ShareLink = z.object({
  token: z.string(),
  /** Path of the public page (`/share/<token>`); the app joins it to the share origin. */
  path: z.string(),
  subject: ShareSubject,
  createdAt: z.coerce.date(),
  /** Known once the trip is done (completion + 30 min); the 24-hour cap until then. */
  expiresAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
  /** How many times the page was opened (the rider sees when a link went further than meant). */
  views: z.number().int().min(0),
});
export type ShareLink = z.infer<typeof ShareLink>;

export const RevokeShareLinkInput = z.object({ token: z.string().min(1).max(200) });
export type RevokeShareLinkInput = z.infer<typeof RevokeShareLinkInput>;

export const SharedTripInput = z.object({
  token: z.string().min(1).max(200),
  /**
   * A refresh by a viewer already counted: the rider's view count is page opens, not refreshes. The
   * page's first read leaves it out; its later reads and the live stream set it.
   */
  again: z.boolean().optional(),
});
export type SharedTripInput = z.infer<typeof SharedTripInput>;

/**
 * `waiting`: booked, the car is not moving yet (intercity before boarding; a delivery being prepared
 * with no courier yet) · `to_pickup`: the driver is on his way to the rider (a delivery: the courier
 * is on his way to collect it) · `on_trip`: the rider is in the car (a delivery: on its way to the
 * door) · `arrived`: done, the link still opens until it expires · `ended`: cancelled, expired or
 * revoked (nothing else is sent).
 */
export const SharedTripStatus = z.enum(['waiting', 'to_pickup', 'on_trip', 'arrived', 'ended']);
export type SharedTripStatus = z.infer<typeof SharedTripStatus>;

export const SharedTrip = z.object({
  status: SharedTripStatus,
  subject: ShareSubject,
  /** Why it ended (`expired`, `revoked`, `cancelled`); null otherwise. */
  endedReason: z.enum(['expired', 'revoked', 'cancelled']).nullable(),
  driverFirstName: z.string().nullable(),
  /** His approved main photo (Ali, 2026-10-06): a short-lived signed URL; null = the page draws his initial. */
  driverPhotoUrl: z.string().nullable(),
  vehicleClass: VehicleClass.nullable(),
  /** "Toyota Corolla · أبيض"; null when unknown. */
  vehicleLabel: z.string().nullable(),
  plate: z.string().nullable(),
  /** Inside the sharing window only; null before the first fix. Bearing and speed as the car reported them. */
  position: z
    .object({
      lat: z.number(),
      lng: z.number(),
      at: z.coerce.date(),
      ageSec: z.number().int().min(0),
      bearing: z.number().nullable(),
      speedKmh: z.number().nullable(),
    })
    .nullable(),
  /**
   * City rides inside the sharing window: where the car is heading now — the rider's pickup until
   * they are in, then the destination (a delivery: the store until collected, then the door). A pin
   * for the map, never an address. Null for intercity.
   */
  target: z.object({ lat: z.number(), lng: z.number(), kind: z.enum(['pickup', 'dropoff']) }).nullable(),
  /**
   * Arrival at the destination (ride on trip; intercity after departing; a delivery: at the door, the
   * same one ETA the customer sees); null when not known.
   */
  eta: z.coerce.date().nullable(),
  /** Intercity: the two cities (the page says "العزيزية ← بغداد"); null for city rides (they show `target`). */
  route: z.object({ fromCityId: z.string(), toCityId: z.string() }).nullable(),
  /** A delivery: the store it comes from ("من مطعم خالد", a business name, public); null otherwise. */
  storeName: z.string().nullable(),
  /**
   * When the trip arrived (joy l8): set while `arrived` and also on a link that expired after a safe
   * arrival, so the family's last view is «المشوار خلص بالسلامة الساعة 6:12» rather than «انتهت». Null
   * otherwise (and on a revoked or cancelled link).
   */
  arrivedAt: z.coerce.date().nullable().default(null),
  expiresAt: z.coerce.date().nullable(),
  serverNow: z.coerce.date(),
});
export type SharedTrip = z.infer<typeof SharedTrip>;

/** Implemented by the API's `tracking` module (`ShareLinksService`). */
export interface TrackingSharePort {
  createShareLink(actor: Actor, input: CreateShareLinkInput): Promise<ShareLink>;
  revokeShareLink(actor: Actor, input: RevokeShareLinkInput): Promise<ShareLink>;
  /** Public: the token is the only credential. */
  shared(input: SharedTripInput): Promise<SharedTrip>;
  /** Public: the road from the car to `target` (null polyline without a road router, a car or a target). */
  sharedRoute(input: SharedTripInput): Promise<OrderRoute>;
  /**
   * Public: the live channels whose events mean the shared trip may have changed (a city ride: its
   * order's channel; intercity: none, it is re-read on a timer). Throws `share_link_invalid`.
   */
  liveChannels(input: SharedTripInput): Promise<string[]>;
}

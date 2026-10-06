import { z } from 'zod';

/** Verticals are configuration: every job is a Trip with ordered Stops. */
export const Vertical = z.enum(['food', 'grocery', 'errand', 'parcel', 'taxi', 'tuktuk', 'intercity', 'khat']);
export type Vertical = z.infer<typeof Vertical>;

export const Currency = z.literal('IQD');
export type Currency = z.infer<typeof Currency>;

/** Integer IQD amounts only. Never floats, never editable. */
export const Iqd = z.number().int();
export type Iqd = z.infer<typeof Iqd>;

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLng>;

/**
 * Where a stop is: the zone key fares and dispatch use, and the pin when the app knows it. `placeId`:
 * the customer's saved place it was picked from (maps program SP3d) — the server keeps it only when
 * the orderer may use that place, and the courier then sees its door photos and note during the job.
 */
export const DeliveryPoint = z.object({
  zoneKey: z.string().min(1),
  pin: LatLng.optional(),
  placeId: z.string().min(1).max(64).optional(),
  /**
   * Set by the server only (a client's value is dropped): the saved place's door as couriers' arrivals
   * learned it (maps program a3). The courier navigates and arrives there; `pin` stays the customer's.
   */
  door: LatLng.optional(),
});
export type DeliveryPoint = z.infer<typeof DeliveryPoint>;

export const CityId = z.string().min(1);
export type CityId = z.infer<typeof CityId>;

/** Error envelope every API error follows: stable code, Iraqi-Arabic message, retry hint. */
export const ApiError = z.object({
  code: z.string(),
  message_ar: z.string(),
  message_en: z.string(),
  retry: z.enum(['never', 'now', 'later']),
});
export type ApiError = z.infer<typeof ApiError>;

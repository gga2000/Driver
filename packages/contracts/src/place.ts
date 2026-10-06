import { z } from 'zod';
import { LatLng } from './common.js';

export const PlacePhoto = z.object({
  id: z.string(),
  url: z.string().url(),
  caption: z.string().optional(),
});
export type PlacePhoto = z.infer<typeof PlacePhoto>;

/** A saved or learned location. Landmarks are shared city knowledge. */
export const Place = z.object({
  id: z.string(),
  cityId: z.string(),
  pin: LatLng,
  name: z.string(),
  note: z.string().optional(),
  photos: z.array(PlacePhoto).default([]),
  /** 0–1: how confident we are the pin matches the real door. */
  confidence: z.number().min(0).max(1).default(0.5),
  ownerId: z.string().optional(),
  sharedWith: z.array(z.string()).default([]),
  landmark: z.boolean().default(false),
});
export type Place = z.infer<typeof Place>;

/**
 * Self-fixing door points (maps program a3). Each delivered drop-off at a saved place leaves the
 * courier's arrival fix; once enough of them agree, their median is the door — used for the courier's
 * navigation and arrival geofence. The customer's own pin is never moved.
 */
export const DOOR_RULES = {
  /** An arrival fix less accurate than this teaches nothing. */
  maxAccuracyM: 30,
  /** Fixes within this distance of their median are the same door. */
  clusterM: 60,
  /** Agreeing fixes needed before the door counts as known ("الباب مأكّد"). */
  minSamples: 3,
  /** …from at least this many couriers: one courier's habit (or a spoofed accuracy) never sets a door alone. */
  minCouriers: 2,
  /** Only the latest fixes count (a family that moves door, a new gate). */
  keep: 10,
  /** Fixes this far from the customer's pin belong to another place (the pin was moved since). */
  maxFromPinM: 150,
} as const;

export const DoorSample = z.object({
  /** The drop-off it came from (a redelivered event adds nothing). */
  stopId: z.string(),
  /** Who tapped "وصلت" (an opaque person id): the door needs `minCouriers` different ones. */
  courierId: z.string(),
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().min(0),
  at: z.coerce.date(),
});
export type DoorSample = z.infer<typeof DoorSample>;

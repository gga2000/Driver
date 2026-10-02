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

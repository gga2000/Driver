import { z } from 'zod';

/** Verticals are configuration: every job is a Trip with ordered Stops. */
export const Vertical = z.enum(['food', 'grocery', 'taxi', 'tuktuk', 'intercity', 'khat']);
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

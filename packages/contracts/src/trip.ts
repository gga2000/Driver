import { z } from 'zod';
import { CityId, LatLng, Vertical } from './common.js';
import { Quote } from './pricing.js';

export const TripState = z.enum([
  'draft',
  'quoted',
  'requested',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'disputed',
]);
export type TripState = z.infer<typeof TripState>;

export const ACTIVE_TRIP_STATES: readonly TripState[] = [
  'quoted',
  'requested',
  'assigned',
  'en_route',
  'arrived',
  'in_progress',
];

export const StopType = z.enum(['pickup', 'dropoff', 'wait']);
export type StopType = z.infer<typeof StopType>;

export const Stop = z.object({
  id: z.string(),
  tripId: z.string(),
  order: z.number().int().min(0),
  placeId: z.string(),
  zoneId: z.string(),
  pin: LatLng,
  type: StopType,
  windowStart: z.coerce.date().optional(),
  windowEnd: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
});
export type Stop = z.infer<typeof Stop>;

export const Trip = z.object({
  id: z.string(),
  cityId: CityId,
  vertical: Vertical,
  state: TripState,
  customerId: z.string(),
  courierId: z.string().optional(),
  vehicleId: z.string().optional(),
  stops: z.array(Stop),
  quote: Quote.optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Trip = z.infer<typeof Trip>;

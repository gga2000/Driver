import { z } from 'zod';
import { LatLng } from './common.js';

/** Anything that happened. Actor actions always carry time and, when known, location. */
export const Event = z.object({
  id: z.string(),
  actorId: z.string(),
  type: z.string().min(1),
  occurredAt: z.coerce.date(),
  recordedAt: z.coerce.date(),
  location: LatLng.optional(),
  tripId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
});
export type Event = z.infer<typeof Event>;

import { z } from 'zod';
import { LatLng } from './common.js';

/**
 * Anything that happened. Actor actions always carry time and, when known, location.
 *
 * `occurredAt` is the device's wall time, `recordedAt` the server's receipt time (evidence events
 * are bound to it), `deviceUptimeMs` the device's monotonic clock for ordering offline replays
 * (edge-case §10). The stored-only fields say what the events module decided on receipt: `flagged`
 * for device skew, `quarantined` (`late_replay`) for offline replays received after the order left
 * the trip — kept for support, never settled.
 */
export const Event = z.object({
  id: z.string(),
  actorId: z.string(),
  type: z.string().min(1),
  occurredAt: z.coerce.date(),
  recordedAt: z.coerce.date(),
  location: LatLng.optional(),
  tripId: z.string().optional(),
  orderId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
  deviceUptimeMs: z.number().int().nonnegative().optional(),
  aggregate: z.string().optional(),
  aggregateId: z.string().optional(),
  skewMs: z.number().int().optional(),
  flagged: z.boolean().optional(),
  flagReason: z.string().optional(),
  quarantined: z.boolean().optional(),
  quarantineReason: z.string().optional(),
});
export type Event = z.infer<typeof Event>;

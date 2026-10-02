import { z } from 'zod';
import { CityId } from './common.js';

export const DependencyStatus = z.enum(['ok', 'unavailable']);
export type DependencyStatus = z.infer<typeof DependencyStatus>;

/** `ok` is about the API process itself; db/redis report their own reachability. */
export const HealthPing = z.object({
  ok: z.literal(true),
  service: z.literal('driver-api'),
  version: z.string(),
  now: z.coerce.date(),
  db: DependencyStatus,
  redis: DependencyStatus,
});
export type HealthPing = z.infer<typeof HealthPing>;

export const CityConfigInput = z.object({ cityId: CityId });

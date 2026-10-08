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

/**
 * `health.live`: the process is up and its database answers. Fly's checks and the deploy swap watch
 * it; when the database is unreachable it fails with 503 instead of answering. Redis, SMS and push
 * are never part of it: losing one of them must not take machines out of rotation.
 */
export const HealthLive = z.object({
  ok: z.literal(true),
  service: z.literal('driver-api'),
  version: z.string(),
  now: z.coerce.date(),
});
export type HealthLive = z.infer<typeof HealthLive>;

/**
 * `health.ready`: every dependency, for alerts and the Console. Always answers 200 while the process
 * is up; `ok` is false when any dependency is unavailable. Never used by Fly (docs/deploy/runbook.md).
 */
export const HealthReady = z.object({
  ok: z.boolean(),
  service: z.literal('driver-api'),
  version: z.string(),
  now: z.coerce.date(),
  db: DependencyStatus,
  redis: DependencyStatus,
});
export type HealthReady = z.infer<typeof HealthReady>;

export const CityConfigInput = z.object({ cityId: CityId });

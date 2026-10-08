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
 * it; when the database has been unreachable for `LIVE_DB_GRACE_MS` it fails with 503 instead of answering. Redis, SMS and push
 * are never part of it: losing one of them must not take machines out of rotation.
 */
export const HealthLive = z.object({
  ok: z.literal(true),
  service: z.literal('driver-api'),
  version: z.string(),
  now: z.coerce.date(),
});
export type HealthLive = z.infer<typeof HealthLive>;

/** `health.live` fails only after the database has been unreachable this long without a break. */
export const LIVE_DB_GRACE_MS = 30_000;

/**
 * Remembers since when the database has been failing, so `health.live` rides out a blip (a pooler
 * restart, a failover of a few seconds): every machine sees the same blip at the same moment, and
 * failing at once would pull them all from rotation together.
 */
export function liveDbGate(graceMs = LIVE_DB_GRACE_MS) {
  let downSince: number | null = null;
  return {
    /** True while the machine should still count as alive. */
    alive(db: DependencyStatus, now: Date): boolean {
      if (db === 'ok') {
        downSince = null;
        return true;
      }
      downSince ??= now.getTime();
      return now.getTime() - downSince < graceMs;
    },
  };
}

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

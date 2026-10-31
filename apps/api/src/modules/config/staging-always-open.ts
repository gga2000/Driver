import { deployEnvironmentFromEnv } from './boot-check.js';

/**
 * Ali, 2026-10-31: on the test version every restaurant is open at any hour, so testing never waits
 * on opening hours or the Friday-prayer pause. Only on a host that says `DEPLOY_ENVIRONMENT=staging`
 * (production and local always keep the hours); `STAGING_KEEP_HOURS=1` there brings the hours back.
 * A shop closed by hand, on holiday, with its tablet offline or stopped by a kill switch stays closed.
 */
export function hoursIgnored(env: NodeJS.ProcessEnv = process.env): boolean {
  return deployEnvironmentFromEnv(env) === 'staging' && env['STAGING_KEEP_HOURS']?.trim() !== '1';
}

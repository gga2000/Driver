import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { APP_HEADER, DriverError, minAppVersionsFromEnv, parseAppHeader, updateRequired, type AppBuild, type DriverApp } from '@driver/contracts';
import { gateProcedures } from '@driver/contracts/router';
import { busyRefusal } from './busy-cap.js';

const builds = new AsyncLocalStorage<AppBuild | null>();

/** The calling app's build (`x-driver-app`) for the request being served, null when it sent none. */
export function currentAppBuild(): AppBuild | null {
  return builds.getStore() ?? null;
}

/**
 * CORE-05: builds older than `MIN_APP_VERSIONS` get `update_required` on every call, and the apps
 * show «أكو نسخة جديدة لازم تحدّثها حتى تكمّل» with the store button. `health.*` always answers, so the
 * app can still tell "update needed" from "no network". Calls without `x-driver-app` (web, Console,
 * builds from before the header) are never refused. Unset `MIN_APP_VERSIONS`: nobody is refused.
 *
 * Returns the Express middleware that carries the header into the request; registers the gate.
 */
export function createAppGate(minimums: Partial<Record<DriverApp, string>> = minAppVersionsFromEnv(process.env['MIN_APP_VERSIONS'])) {
  gateProcedures(({ path }) => {
    if (path.startsWith('health.')) return null;
    // x3: a call that arrived while this machine was full is turned away first (shared/busy-cap.ts).
    const busy = busyRefusal(path);
    if (busy) return busy;
    return updateRequired(currentAppBuild(), minimums) ? new DriverError('update_required') : null;
  });
  return function appGate(req: Request, _res: Response, next: NextFunction): void {
    builds.run(parseAppHeader(req.headers[APP_HEADER]), next);
  };
}

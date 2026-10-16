/**
 * CORE-05: which app and build is calling, so the server can turn away builds older than the minimum
 * it still serves («أكو نسخة جديدة لازم تحدّثها حتى تكمّل», error `update_required`).
 *
 * Each app sends `x-driver-app: <app>/<version>` on every call, e.g. `customer/1.0.3` (the native
 * build's store version, `expo-application` nativeApplicationVersion). A call without it (the web apps,
 * the Console, builds made before this existed) is never turned away.
 */
export const APP_HEADER = 'x-driver-app';

export const DRIVER_APPS = ['customer', 'partner', 'merchant'] as const;
export type DriverApp = (typeof DRIVER_APPS)[number];

export interface AppBuild {
  app: DriverApp;
  version: string;
}

const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/** The header value an app sends: `customer/1.0.3`. */
export function appHeader(app: DriverApp, version: string): string {
  return `${app}/${version}`;
}

/** Reads `x-driver-app`; null when absent or not a known app with a plain dotted version. */
export function parseAppHeader(value: string | string[] | undefined): AppBuild | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim();
  if (!raw || raw.length > 40) return null;
  const [app, version] = raw.split('/');
  if (!app || !version || !(DRIVER_APPS as readonly string[]).includes(app) || !VERSION.test(version)) return null;
  return { app: app as DriverApp, version };
}

/** Compares dotted versions numerically (`1.10.0` > `1.9.3`); a missing part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when `build` is older than its app's minimum in `minimums` (no minimum for the app: never). */
export function updateRequired(build: AppBuild | null, minimums: Readonly<Partial<Record<DriverApp, string>>>): boolean {
  if (!build) return false;
  const min = minimums[build.app];
  return min !== undefined && compareVersions(build.version, min) < 0;
}

/**
 * `MIN_APP_VERSIONS="customer:1.0.3,partner:1.0.0"`: the oldest build each app may still use. Throws
 * on a malformed entry, so a typo stops boot instead of silently turning everyone away (or nobody).
 */
export function minAppVersionsFromEnv(raw: string | undefined): Partial<Record<DriverApp, string>> {
  const out: Partial<Record<DriverApp, string>> = {};
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [app, version] = part.split(':').map((s) => s.trim());
    if (!app || !version || !(DRIVER_APPS as readonly string[]).includes(app) || !VERSION.test(version)) {
      throw new Error(`MIN_APP_VERSIONS: "${part}" is not <app>:<version> with app one of ${DRIVER_APPS.join(', ')}`);
    }
    out[app as DriverApp] = version;
  }
  return out;
}

/** For the apps: true when an error from the API means "this build must be updated". */
export function isUpdateRequiredError(err: unknown): boolean {
  const data = (err as { data?: { code?: unknown } } | null)?.data;
  return data?.code === 'update_required';
}

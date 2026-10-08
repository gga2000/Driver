/**
 * The website's version and offline worker (speed idea w6, docs/deploy/vercel.md "Offline and new
 * versions"). scripts/web-offline.mjs names each deployed version in the page
 * (<meta name="driver-build">) and in /version.json; this keeps an open tab from living on an old one:
 *  - it registers /sw.js (the app opens with no network and shows its «النت مقطوع» strip);
 *  - when the tab comes back to the front (and every 15 minutes while it is there) it reads
 *    /version.json; once a newer version is out, the next move to another screen loads that screen
 *    fresh on the new version (the cart and the sign-in are kept on the phone, nothing is lost);
 *  - a screen's code that fails to download (its version was replaced, or the network dropped) reloads
 *    the page once, at once or when the network is back, instead of leaving «صار خلل» for good.
 * The phone apps update through the stores and «حدّث التطبيق» (src/lib/app-update.ts); see
 * web-build.native.ts. Nothing here runs without the meta tag (a local dev server).
 */

const CHECK_EVERY_MS = 15 * 60_000;
/** One automatic reload per this long, so a broken deploy can't make the page reload in a loop. */
const RELOAD_GAP_MS = 60_000;
const RELOADED_AT = 'driver-build-reloaded-at';

/** A screen's code failed to download (expo's lazy loader: `AsyncRequireError`, "Loading module … failed"). */
export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  return (
    name === 'AsyncRequireError' ||
    (typeof message === 'string' && /^Loading module .+ failed/.test(message))
  );
}

/** True when /version.json names another version than the page's. */
export function isNewer(pageBuild: string, body: unknown): boolean {
  const build = body && typeof body === 'object' ? (body as { build?: unknown }).build : undefined;
  return typeof build === 'string' && /^[0-9a-f]{12}$/.test(build) && build !== pageBuild;
}

/** True when no automatic reload happened in the last minute (read from the tab's session storage). */
export function mayReload(lastAt: string | null, now: number): boolean {
  const at = Number(lastAt);
  return !lastAt || !Number.isFinite(at) || now - at > RELOAD_GAP_MS || at > now;
}

let started = false;

/** Called once at import by the root layout, like `startCrashReports`. */
export function startWebBuild(): void {
  if (started || typeof document === 'undefined' || typeof window === 'undefined') return;
  started = true;
  const build = document.querySelector<HTMLMetaElement>('meta[name="driver-build"]')?.content;
  if (!build) return;

  if (document.querySelector('meta[name="driver-offline"]') && 'serviceWorker' in navigator) {
    const register = () =>
      void navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .catch(() => undefined);
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  let newer = false;
  const reload = () => {
    let last: string | null = null;
    try {
      last = sessionStorage.getItem(RELOADED_AT);
      if (!mayReload(last, Date.now())) return;
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    } catch {
      // No session storage (private mode on some phones): reload anyway, the version check stops a loop.
    }
    window.location.reload();
  };
  const check = async () => {
    if (newer || !navigator.onLine) return;
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (res.ok && isNewer(build, await res.json())) newer = true;
    } catch {
      // Offline or the site is away: check again next time.
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void check();
  }, CHECK_EVERY_MS);

  // The router has already put the new address in place: reloading opens that screen on the new version.
  const push = history.pushState.bind(history);
  history.pushState = (...args: Parameters<History['pushState']>) => {
    push(...args);
    if (newer) reload();
  };
  window.addEventListener('popstate', () => {
    if (newer) reload();
  });

  // A screen's code that didn't download: its version was replaced, or the network dropped on the way.
  // Online, reload now (the address is already the screen's); offline, as soon as the network is back.
  const recover = (err: unknown) => {
    if (!isChunkLoadError(err)) return;
    if (navigator.onLine) reload();
    else window.addEventListener('online', reload, { once: true });
  };
  window.addEventListener('unhandledrejection', (e) => recover(e.reason));
  window.addEventListener('error', (e) => recover(e.error));
}

/** The same recovery for an error the root «صار خلل» boundary caught (it never reaches `window`). */
export function noteScreenError(err: unknown): void {
  if (typeof window === 'undefined' || !isChunkLoadError(err)) return;
  window.dispatchEvent(new ErrorEvent('error', { error: err }));
}

import { DEV_TOOLS } from '@/lib/env';

let disarmed = false;

/** The crash screen's retry disarms the probe, so the screens come back. */
export function disarmDevCrash(): void {
  disarmed = true;
}

/**
 * Screenshot hook for the crash screen: with dev tools on, a web URL with `?crash=1` throws a render
 * error until «جرّب مرة ثانية» is pressed (React retries a render once by itself, so it keeps
 * throwing until then). Renders nothing otherwise.
 */
export function DevCrashProbe() {
  if (!DEV_TOOLS || disarmed || typeof window === 'undefined' || !window.location?.search) return null;
  if (new URLSearchParams(window.location.search).get('crash') !== '1') return null;
  throw new Error('Demo crash (?crash=1)');
}

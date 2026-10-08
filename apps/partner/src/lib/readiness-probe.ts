/**
 * What the readiness row (audit S-8) can learn on the web: location permission (Permissions API),
 * the battery where the browser has the Battery API (Chrome/Android; elsewhere the chip is hidden),
 * and when the tab comes back. Native: `readiness-probe.native.ts`. Never prompts by itself — only
 * `askGps()` (the fix button) does.
 */
import type { BatteryState, GpsState, PushState } from '@/features/work/readiness';
import { currentFix } from './location';

type Nav = Navigator & {
  getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(t: string, cb: () => void): void; removeEventListener(t: string, cb: () => void): void }>;
};

function nav(): Nav | null {
  return typeof navigator === 'undefined' ? null : (navigator as Nav);
}

export async function gpsState(): Promise<GpsState> {
  const n = nav();
  if (!n?.geolocation) return 'off';
  if (!n.permissions?.query) return 'ask';
  try {
    const p = await n.permissions.query({ name: 'geolocation' as PermissionName });
    return p.state === 'granted' ? 'on' : p.state === 'denied' ? 'off' : 'ask';
  } catch {
    return 'ask';
  }
}

/** The fix: the browser's own location prompt (through a real fix request), then the state again. */
export async function askGps(): Promise<GpsState> {
  await currentFix(6000);
  return gpsState();
}

/**
 * Battery level and charging, now and on change. Resolves to null when the browser can't say (the
 * chip is hidden rather than guessed); the returned function stops listening.
 */
export async function watchBattery(cb: (b: BatteryState) => void): Promise<(() => void) | null> {
  const n = nav();
  if (!n?.getBattery) return null;
  try {
    const b = await n.getBattery();
    const emit = () => cb({ level: b.level, charging: b.charging });
    emit();
    b.addEventListener('levelchange', emit);
    b.addEventListener('chargingchange', emit);
    return () => {
      b.removeEventListener('levelchange', emit);
      b.removeEventListener('chargingchange', emit);
    };
  } catch {
    return null;
  }
}

/** No push on the web: the sound in the open tab is all there is. */
export async function pushState(): Promise<PushState> {
  return 'n/a';
}

/** The browser has no settings screen to open; the sheet's text says what to do. */
export async function openSettings(): Promise<void> {
  return undefined;
}

/** Re-check when the tab is shown again (he may have changed a setting meanwhile). */
export function onForeground(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const h = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', h);
  return () => document.removeEventListener('visibilitychange', h);
}

/** The web can't tell whether the phone saves battery on the app. */
export async function batterySaverOn(): Promise<boolean> {
  return false;
}

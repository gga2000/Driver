import { useSyncExternalStore } from 'react';
import { Linking, Platform } from 'react-native';
import { storage } from '@/lib/storage';

/**
 * Navigation hand-off (maps program d3): the driver picks Google Maps or Waze once and every "الخريطة"
 * opens it — the installed app when there is one, its web page otherwise. Our own turn-by-turn is a
 * later decision (D8: hand off).
 */
export type NavApp = 'google' | 'waze';
export const NAV_APPS: readonly NavApp[] = ['google', 'waze'];
export const NAV_APP_KEY = 'driver.partner.nav_app';

interface Pin {
  lat: number;
  lng: number;
}

/** The app link (null where the platform has none) and the web fallback for driving to `pin`. */
export function navLinks(app: NavApp, pin: Pin, os: string): { native: string | null; web: string } {
  const ll = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`;
  if (app === 'waze') return { native: os === 'web' ? null : `waze://?ll=${ll}&navigate=yes`, web: `https://waze.com/ul?ll=${ll}&navigate=yes` };
  const web = `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
  if (os === 'android') return { native: `google.navigation:q=${ll}&mode=d`, web };
  if (os === 'ios') return { native: `comgooglemaps://?daddr=${ll}&directionsmode=driving`, web };
  return { native: null, web };
}

// ───────────────────────── the remembered choice ─────────────────────────

let current: NavApp | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

function parse(v: string | null): NavApp | null {
  return v === 'google' || v === 'waze' ? v : null;
}

void storage
  .getItem(NAV_APP_KEY)
  .then((v) => {
    current = parse(v);
  })
  .catch(() => undefined)
  .finally(() => {
    loaded = true;
    emit();
  });

export async function setNavApp(app: NavApp): Promise<void> {
  current = app;
  emit();
  await storage.setItem(NAV_APP_KEY, app).catch(() => undefined);
}

/** The driver's choice; null until he has made one (the first tap asks). */
export function useNavApp(): { app: NavApp | null; loaded: boolean } {
  const app = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => current,
    () => current,
  );
  return { app, loaded };
}

/** Opens `pin` in his navigation app: the app itself when installed, its web page otherwise. */
export async function openNav(app: NavApp, pin: Pin): Promise<void> {
  const { native, web } = navLinks(app, pin, Platform.OS);
  if (native && (await Linking.canOpenURL(native).catch(() => false))) {
    await Linking.openURL(native);
    return;
  }
  await Linking.openURL(web);
}

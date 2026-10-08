import { DEV_TOOLS } from './env';
import { storage as appStorage, type KeyValueStorage } from './storage';

/**
 * Screen switches for the after-order redesign (Ali, 2026-10-07: build now, switch on for customers
 * after launch, staff first). Each redesigned screen ships beside the one it replaces and shows only
 * while its switch is on, so a bad night goes back without an app update.
 *
 * Who decides (docs/api/screen-switches.md):
 * - The studio and screenshot builds: the build. `EXPO_PUBLIC_UI_SWITCHES` lists the names that are on
 *   (`basket_v2,checkout_v2`, `all`, or `none`); with nothing listed, a dev build shows the new screens.
 * - A store build: the server (`system.screens`, set from the Console's التحكم). It is read when the app
 *   starts and again after sign-in (staff see screens switched on for staff). Anything unread (offline,
 *   an error, an old server) is the old screen; the answer saved at the previous start stands in until
 *   the new one arrives, and with none saved every switch is off.
 *
 * Each switch is fixed the first time a screen reads it, until the next cold start: a customer half-way
 * through checkout never has the screen swapped under them. A newer answer only reaches switches no
 * screen has read yet (and every switch at the next start).
 */
export type UiSwitch = 'basket_v2' | 'checkout_v2' | 'track_v2' | 'orders_v2';
export type ScreensAnswer = Record<UiSwitch, boolean>;

const NAMES: readonly UiSwitch[] = ['basket_v2', 'checkout_v2', 'track_v2', 'orders_v2'];

/** The server's last answer, kept for the next start. */
export const SCREENS_KEY = 'driver.customer.screens';

function buildList(env: string | undefined): string[] {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when the build itself decides the switches (the studio, screenshots, or a build that lists them). */
export function buildDecides(env: string | undefined = process.env.EXPO_PUBLIC_UI_SWITCHES, devBuild: boolean = DEV_TOOLS): boolean {
  return devBuild || buildList(env).length > 0;
}

/** The build's own answer for one switch (see `buildDecides`). */
export function uiSwitchOn(name: UiSwitch, env: string | undefined = process.env.EXPO_PUBLIC_UI_SWITCHES, devBuild: boolean = DEV_TOOLS): boolean {
  const list = buildList(env);
  if (list.length === 0) return devBuild;
  if (list.includes('none')) return false;
  return list.includes('all') || list.includes(name);
}

/** A saved or received answer, only when it is well formed: anything else counts as unread. */
export function parseScreens(value: unknown): ScreensAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const out = {} as ScreensAnswer;
  for (const n of NAMES) {
    if (typeof v[n] !== 'boolean') return null;
    out[n] = v[n];
  }
  return out;
}

export function createScreenSwitches(opts: { storage: KeyValueStorage; fromBuild: boolean; buildOn: (name: UiSwitch) => boolean }) {
  /** The best answer known now: the server's from this start, else the one saved at the last start. */
  let known: ScreensAnswer | null = null;
  let fresh = false;
  const fixed = new Map<UiSwitch, boolean>();
  let loading: Promise<void> | null = null;

  return {
    /** What a screen sees: fixed at its first read until the next cold start. */
    read(name: UiSwitch): boolean {
      let on = fixed.get(name);
      if (on === undefined) {
        on = opts.fromBuild ? opts.buildOn(name) : (known?.[name] ?? false);
        fixed.set(name, on);
      }
      return on;
    },
    /** Reads the answer saved at the previous start (a broken or missing one leaves every switch off). */
    loadSaved(): Promise<void> {
      if (opts.fromBuild) return Promise.resolve();
      loading ??= (async () => {
        const raw = await opts.storage.getItem(SCREENS_KEY).catch(() => null);
        let saved: ScreensAnswer | null = null;
        try {
          saved = raw ? parseScreens(JSON.parse(raw)) : null;
        } catch {
          saved = null;
        }
        // The server answered first: its answer wins.
        if (saved && !fresh) known = saved;
      })();
      return loading;
    },
    /** The server's answer (`system.screens`): used for switches not read yet, and saved for the next start. */
    async apply(answer: unknown): Promise<void> {
      if (opts.fromBuild) return;
      const a = parseScreens(answer);
      if (!a) return;
      known = a;
      fresh = true;
      await opts.storage.setItem(SCREENS_KEY, JSON.stringify(a)).catch(() => undefined);
    },
  };
}

export const screenSwitches = createScreenSwitches({ storage: appStorage, fromBuild: buildDecides(), buildOn: (n) => uiSwitchOn(n) });

/** The switch as read once per app start: it never flips under an open screen. */
export function useUiSwitch(name: UiSwitch): boolean {
  return screenSwitches.read(name);
}

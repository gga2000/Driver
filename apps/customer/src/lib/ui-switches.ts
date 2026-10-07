import { DEV_TOOLS } from './env';

/**
 * Screen switches for the after-order redesign (Ali, 2026-10-07: build now, switch on for customers
 * after launch, staff first). Each redesigned screen ships beside the one it replaces and shows only
 * while its switch is on, so a bad night goes back without an app update.
 *
 * Today the switch comes from the build: `EXPO_PUBLIC_UI_SWITCHES` lists the names that are on
 * (`basket_v2,checkout_v2`, `all`, or `none`). With nothing set, the studio and screenshot builds show
 * the new screens and a store build keeps the old ones. The remote feed (audit REL-16, W6) will set
 * these per account later; until then nothing a customer installs changes.
 */
export type UiSwitch = 'basket_v2' | 'checkout_v2' | 'track_v2' | 'orders_v2';

export function uiSwitchOn(name: UiSwitch, env: string | undefined = process.env.EXPO_PUBLIC_UI_SWITCHES, devBuild: boolean = DEV_TOOLS): boolean {
  const list = (env ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return devBuild;
  if (list.includes('none')) return false;
  return list.includes('all') || list.includes(name);
}

/** The switch as read once per app start: it never flips under an open screen. */
const cache = new Map<UiSwitch, boolean>();
export function useUiSwitch(name: UiSwitch): boolean {
  let on = cache.get(name);
  if (on === undefined) {
    on = uiSwitchOn(name);
    cache.set(name, on);
  }
  return on;
}

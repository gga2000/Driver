import { drinksOnly, FOOD_DOORS, type FoodDoor, type MerchantSetupView, type SetupStep } from '@driver/contracts';
import { libraryMatches, type LibraryDishLike } from '../menu/library';

/**
 * «جهّز محلك» in the Merchant app: the pure parts (tested). Where each step opens, how the shop's kind
 * changes the words, the greeting, the menu score, and the shutter's drag.
 */

/** Where a step opens. «فلوسك» sits on the counter list with the other one-tap checks. */
export const STEP_HREF: Readonly<Record<SetupStep, '/setup/kind' | '/setup/menu' | '/setup/photos' | '/setup/hours' | '/setup/counter' | '/pickup-spot'>> = {
  kind: '/setup/kind',
  menu: '/setup/menu',
  photos: '/setup/photos',
  hours: '/setup/hours',
  money: '/setup/counter',
  pickup: '/pickup-spot',
  counter: '/setup/counter',
};

/** k2: a café or juice shop reads «محلك» and «مشروب»; anything with food keeps «مطعمك» and «أكلة». */
export type SetupVoice = 'food' | 'drinks';

export function voiceOf(doors: readonly FoodDoor[]): SetupVoice {
  return drinksOnly(doors) ? 'drinks' : 'food';
}

/** His doors as the screens show them: what he confirmed, else what field ops picked. */
export function doorsOf(view: Pick<MerchantSetupView, 'kinds'>): FoodDoor[] {
  return view.kinds.confirmed ?? view.kinds.suggested;
}

/** Tapping a door: on or off, kept in the doors' own order. */
export function toggleDoor(doors: readonly FoodDoor[], door: FoodDoor): FoodDoor[] {
  const on = doors.includes(door);
  return FOOD_DOORS.filter((d) => (d === door ? !on : doors.includes(d)));
}

/**
 * f4: how we greet him. «أبو حسن» / «أم علي» stay whole; otherwise his first name. Null (no name on
 * file) greets without one.
 */
export function greetingName(name: string | null | undefined): string | null {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length >= 2 && /^(ابو|أبو|ام|أم)$/.test(words[0]!)) return `${words[0]} ${words[1]}`;
  return words[0]!;
}

/** First visit of this app session lands on setup (owner of a shop not live yet), once; «بعدين» is always allowed. */
export function shouldLand(input: { owner: boolean; setup: { live: boolean } | null | undefined; landed: boolean }): boolean {
  return input.owner && !!input.setup && !input.setup.live && !input.landed;
}

/** The step list's minutes: whole minutes rounded up, never 0 for a step not done. */
export function stepMinutes(seconds: number): number {
  return seconds <= 0 ? 0 : Math.max(1, Math.ceil(seconds / 60));
}

/** s-p2: «22 من 26 بصور» on the menu tab. A library photo counts (Ali, 2026-10-08). */
export function menuScore(items: readonly { photoUrl: string | null; available?: boolean }[]): { total: number; withPhoto: number; missing: number } {
  const total = items.length;
  const withPhoto = items.filter((i) => !!i.photoUrl).length;
  return { total, withPhoto, missing: total - withPhoto };
}

/** m3: the library dish closest to a read dish (its name, then its section); null when nothing fits. */
export function bestLibraryDish<D extends LibraryDishLike>(library: readonly D[], name: string, section: string | null | undefined): D | null {
  return libraryMatches(library, name, section ?? null)[0] ?? null;
}

/** l1: how far the shutter is up, 0–1, from the finger's travel (up is negative) and the doorway's height. */
export function shutterFraction(dy: number, height: number): number {
  if (height <= 0) return 0;
  return Math.min(1, Math.max(0, -dy / height));
}

/** Let go past this, or flick up from half way, and the shutter goes all the way. */
export const SHUTTER_OPEN_AT = 0.6;

export function shutterOpens(fraction: number, velocityY: number): boolean {
  return fraction >= SHUTTER_OPEN_AT || (fraction >= 0.35 && velocityY < -600);
}

/** The prayer window of a Friday, from the hours screen's pauses (the city's, e.g. 11:45–13:15). */
export function fridayPrayer(pauses: readonly { dow: number; start: string; end: string }[]): { start: string; end: string } | null {
  const p = pauses.find((x) => x.dow === 5);
  return p ? { start: p.start, end: p.end } : null;
}

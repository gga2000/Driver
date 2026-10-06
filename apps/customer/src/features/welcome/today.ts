import type { CatalogToday } from '@driver/contracts';
import type { IconName } from '@driver/ui';
import type { TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/** The six hot spots on the map of home (audit d-6), in the order the loop visits them. */
export type SpotKey = 'food' | 'tuktuk' | 'seat' | 'taxi' | 'home' | 'soon';

export interface Spot {
  key: SpotKey;
  icon: IconName;
  /** Centre of the spot on the illustration, as a fraction of its width / height (viewBox 360 × 280). */
  x: number;
  y: number;
}

export const MAP_W = 360;
export const MAP_H = 280;

/** Where each spot sits on `WelcomeMap`'s drawing: the old market, the bridge, a garage on the Baghdad road… */
export const SPOTS: readonly Spot[] = [
  { key: 'food', icon: 'food', x: 236 / MAP_W, y: 150 / MAP_H },
  { key: 'tuktuk', icon: 'tuktuk-fringe', x: 128 / MAP_W, y: 132 / MAP_H },
  { key: 'seat', icon: 'rajaa', x: 300 / MAP_W, y: 52 / MAP_H },
  { key: 'taxi', icon: 'taxi', x: 300 / MAP_W, y: 196 / MAP_H },
  { key: 'home', icon: 'home', x: 196 / MAP_W, y: 236 / MAP_H },
  { key: 'soon', icon: 'parcel', x: 52 / MAP_W, y: 222 / MAP_H },
];

/** One orchestrated loop: each spot holds the light for an equal share of it. */
export const LOOP_MS = 6000;
export const SPOT_MS = LOOP_MS / SPOTS.length;

/** The spot lit `elapsedMs` into the loop. */
export function activeSpot(elapsedMs: number): number {
  const n = SPOTS.length;
  return ((Math.floor(Math.max(0, elapsedMs) / SPOT_MS) % n) + n) % n;
}

/**
 * The caption under the map for a spot. Prices and the garage come from `catalog.today` (the server's
 * fares and seed data); without them the caption says the same thing without a number.
 */
export function spotCaption(key: SpotKey, today: CatalogToday | undefined, t: TFn): string {
  switch (key) {
    case 'food':
      return t('welcome_map.food');
    case 'tuktuk':
      return today?.tuktukFromIqd ? t('welcome_map.tuktuk', { amount: amountParam(today.tuktukFromIqd) }) : t('welcome_map.tuktuk_plain');
    case 'seat':
      return today?.baghdadGarage ? t('welcome_map.seat', { garage: today.baghdadGarage.name_ar }) : t('welcome_map.seat_plain');
    case 'taxi':
      return t('welcome_map.taxi');
    case 'home':
      return t('welcome_map.home');
    case 'soon':
      return t('welcome_map.soon');
  }
}

/** Iraqi count + noun agreement: 1 واحد, 2 dual, 3–10 plural, 11+ singular (voice guide §5). */
export function countPhrase(n: number, noun: 'restaurants' | 'cars', t: TFn): string {
  if (n === 1) return t(`welcome_map.${noun}_one`);
  if (n === 2) return t(`welcome_map.${noun}_two`);
  if (n <= 10) return t(`welcome_map.${noun}_few`, { count: n });
  return t(`welcome_map.${noun}_many`, { count: n });
}

/** "اليوم: 4 مطاعم مفتوحة · 6 سيارات للرجعة" — only what is true right now; nothing when nothing is. */
export function todayLine(today: CatalogToday | undefined, t: TFn): string | null {
  if (!today) return null;
  const parts: string[] = [];
  if (today.openRestaurants > 0) parts.push(countPhrase(today.openRestaurants, 'restaurants', t));
  if (today.rajaaCarsToday > 0) parts.push(countPhrase(today.rajaaCarsToday, 'cars', t));
  return parts.length > 0 ? t('welcome_map.today', { parts: parts.join(' · ') }) : null;
}

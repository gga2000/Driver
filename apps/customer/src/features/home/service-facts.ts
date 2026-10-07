import type { MessageKey } from '@driver/i18n';

/**
 * The live fact under each home service tile (Date & Saffron, Ali 2026-10-06): only what the server
 * knows right now — never an invented price or a made-up wait. `null` while the first read is still
 * coming (the tile shows a shimmer line); a tile whose service needs the internet says so offline.
 */
export interface Fact {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** Food: how many kitchens are open now; when none is, when the first one opens. */
export function foodFact(input: { loading: boolean; openCount: number; firstOpensAt: string | null }): Fact | null {
  if (input.loading) return null;
  if (input.openCount > 0) return { key: 'home.food_open', params: { n: input.openCount } };
  return input.firstOpensAt ? { key: 'home.food_opens', params: { time: input.firstOpensAt } } : { key: 'home.food_closed' };
}

export type RideKind = 'taxi' | 'tuktuk';

/**
 * Taxi and tuktuk: the nearest free one's minutes to the deliver-to place (`dispatch.nearby`). None
 * free, a guest, or no place yet: what the vehicle is for, as on the choose screen.
 */
export function rideFact(kind: RideKind, input: { online: boolean; signedIn: boolean; loading: boolean; nearestMinutes: number | null }): Fact | null {
  if (!input.online) return { key: 'home.needs_net' };
  if (input.signedIn && input.loading) return null;
  if (input.signedIn && input.nearestMinutes) return { key: kind === 'taxi' ? 'home.taxi_near' : 'home.tuktuk_near', params: { minutes: input.nearestMinutes } };
  return { key: kind === 'taxi' ? 'ride.vehicle_taxi_hint' : 'ride.vehicle_tuktuk_hint' };
}

/** Baghdad and Kut trips (leaving Aziziyah): the next car's time on the board, or none; guests see what it is. */
export function tripsFact(input: { online: boolean; signedIn: boolean; loading: boolean; error: boolean; nextAt: string | null }): Fact | null {
  if (!input.online) return { key: 'home.needs_net' };
  if (!input.signedIn || input.error) return { key: 'home.trips_guest' };
  if (input.loading) return null;
  return input.nextAt ? { key: 'home.trips_next', params: { time: input.nextAt } } : { key: 'home.trips_none' };
}

/** الرجعة (back to Aziziyah), the small tile: the next car back, else where it goes. */
export function backFact(input: { online: boolean; signedIn: boolean; loading: boolean; error: boolean; nextAt: string | null }): Fact | null {
  if (!input.online) return { key: 'home.needs_net' };
  if (input.signedIn && !input.error && input.loading) return null;
  return input.signedIn && !input.error && input.nextAt ? { key: 'home.back_next', params: { time: input.nextAt } } : { key: 'home.back_sub' };
}

/** «سوق، خطوط وطرود»: the coming-soon names as one phrase (two or three of them; more are joined in pairs). */
export function soonNames(names: readonly string[], t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return t('home.soon_names_2', { a: names[0]!, b: names[1]! });
  const head = names.slice(0, -2).join('، ');
  return t('home.soon_names_3', { a: head, b: names[names.length - 2]!, c: names[names.length - 1]! });
}

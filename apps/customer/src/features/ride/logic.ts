import {
  AZIZIYAH_ZONES,
  haversineM,
  travelMinutes,
  type CityPricingConfig,
  type DeliveryPoint,
  type DispatchConfig,
  type LandmarkView,
  type LatLng,
  type PaymentMethod,
  type PlaceOrderInput,
  type PriceRequestInput,
  type Quote,
  type QuoteComponent,
  type ZoneTier,
} from '@driver/contracts';

/**
 * City taxi / tuktuk booking as plain data (customer spec §5, dispatch & pricing spec §1–§4): where
 * the rider is going (search over saved places, recent trips, landmarks and the 34 zones), the
 * quote request `orders.place` re-prices with, the ride options the choose screen shows and the
 * exact `orders.place` payload. Pure, so the Node tests cover it (no React Native here).
 */

export type RideVertical = 'taxi' | 'tuktuk';
export const RIDE_VERTICALS: readonly RideVertical[] = ['taxi', 'tuktuk'];
export const CITY_ID = 'aziziyah';

export function isRideVertical(v: unknown): v is RideVertical {
  return v === 'taxi' || v === 'tuktuk';
}

// ───────────────────────── places ("وين رايح؟") ─────────────────────────

export type SpotKind = 'saved' | 'recent' | 'landmark' | 'zone' | 'pin';

/** A place a ride can start or end at: always a zone (pricing) and a pin (the driver's target). */
export interface Spot {
  id: string;
  kind: SpotKind;
  title: string;
  /** Secondary line: the zone, "كراج", "وسط المنطقة". */
  subtitle?: string;
  zoneId: string;
  pin: LatLng;
  /** Saved places: home / work / family / other (icon). */
  savedLabel?: 'home' | 'work' | 'family' | 'other';
  /** Landmarks: garage / meeting point / verified landmark (icon, label). */
  landmarkKind?: LandmarkView['kind'];
  /** Search-only extra names ("الجامع الكبير" for "باب الجامع الكبير"). */
  aliases?: readonly string[];
}

export function spotPoint(s: Pick<Spot, 'zoneId' | 'pin'>): DeliveryPoint {
  return { zoneKey: s.zoneId, pin: s.pin };
}

const EASTERN = /[٠-٩]/g;
const PERSIAN = /[۰-۹]/g;

/** Western digits for display (voice guide §5): seed names carry "شارع ٣٠". */
export function westernDigits(s: string): string {
  return s.replace(EASTERN, (d) => String(d.charCodeAt(0) - 0x0660)).replace(PERSIAN, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Search normal form: what people type in chat matches what the seed spells. Tashkeel and tatweel
 * go, alef/yaa/taa-marbuta/hamza seats fold, Iraqi letters fold to their base (گ→ك, چ→ج, ڤ→ف), digits
 * become Western, and a leading "ال" drops from every word ("الهاشمي" = "هاشمي").
 */
export function normalizeArabic(s: string): string {
  return westernDigits(s)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/ڤ/g, 'ف')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
    .join(' ');
}

/**
 * How well `query` names one of `names`: 3 exact, 2 every word starts a word, 1 every word is
 * inside, 0 no match. Every query word has to match (narrowing, like a contacts search).
 */
export function matchScore(query: string, names: readonly string[]): number {
  const q = normalizeArabic(query);
  if (!q) return 0;
  const words = q.split(' ');
  let best = 0;
  for (const name of names) {
    const n = normalizeArabic(name);
    if (!n) continue;
    if (n === q) return 3;
    const nameWords = n.split(' ');
    if (words.every((w) => nameWords.some((nw) => nw.startsWith(w)))) best = Math.max(best, 2);
    else if (words.every((w) => n.includes(w))) best = Math.max(best, 1);
  }
  return best;
}

export interface SpotSources {
  saved: readonly Spot[];
  recent: readonly Spot[];
  landmarks: readonly Spot[];
  zones: readonly Spot[];
}

const KIND_RANK: Record<SpotKind, number> = { saved: 0, recent: 1, landmark: 2, zone: 3, pin: 4 };

/** Search results over every source, best match first (saved before recent before landmarks before zones on ties). */
export function searchSpots(query: string, sources: SpotSources, limit = 12): Spot[] {
  if (!normalizeArabic(query)) return [];
  const all = [...sources.saved, ...sources.recent, ...sources.landmarks, ...sources.zones];
  const scored: Array<{ s: Spot; score: number; i: number }> = [];
  all.forEach((s, i) => {
    const score = matchScore(query, [s.title, ...(s.aliases ?? [])]);
    if (score > 0) scored.push({ s, score, i });
  });
  scored.sort((a, b) => b.score - a.score || KIND_RANK[a.s.kind] - KIND_RANK[b.s.kind] || a.i - b.i);
  const out: Spot[] = [];
  for (const { s } of scored) {
    if (out.some((o) => sameSpot(o, s))) continue;
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Within this distance in the same zone, two spots are the same place (dedupe, recent list). */
export const SAME_SPOT_M = 60;

export function sameSpot(a: Pick<Spot, 'zoneId' | 'pin'>, b: Pick<Spot, 'zoneId' | 'pin'>): boolean {
  return a.zoneId === b.zoneId && haversineM(a.pin, b.pin) <= SAME_SPOT_M;
}

/** The zone a seed id names, or null (unknown zone ids never price). */
export function zoneOf(zoneId: string) {
  return AZIZIYAH_ZONES.find((z) => z.id === zoneId) ?? null;
}

export function zoneTier(zoneId: string): ZoneTier | null {
  return zoneOf(zoneId)?.tier ?? null;
}

export function zoneTitle(zoneId: string, locale: 'ar-IQ' | 'en' = 'ar-IQ'): string {
  const z = zoneOf(zoneId);
  if (!z) return zoneId;
  return locale === 'en' ? z.name_en : westernDigits(z.name_ar);
}

/** The 34 zones as destinations, at their centroid (the rider can move the pin afterwards). */
export function zoneSpots(locale: 'ar-IQ' | 'en', centreHint: string): Spot[] {
  return AZIZIYAH_ZONES.map((z) => ({
    id: `zone:${z.id}`,
    kind: 'zone' as const,
    title: zoneTitle(z.id, locale),
    subtitle: centreHint,
    zoneId: z.id,
    pin: { lat: z.lat, lng: z.lng },
    aliases: [z.name_ar, z.name_en, z.group],
  }));
}

export function landmarkSpot(l: LandmarkView, locale: 'ar-IQ' | 'en', kindLabel: string): Spot {
  return {
    id: `landmark:${l.id}`,
    kind: 'landmark',
    title: locale === 'en' ? l.name_en : westernDigits(l.name_ar),
    subtitle: `${kindLabel} · ${zoneTitle(l.zoneId, locale)}`,
    zoneId: l.zoneId,
    pin: l.pin,
    landmarkKind: l.kind,
    aliases: [l.name_ar, l.name_en, ...l.aliases_ar],
  };
}

/** Most recent first, the same place once, at most `max`. */
export function pushRecent(list: readonly Spot[], spot: Spot, max = 6): Spot[] {
  const entry: Spot = { ...spot, id: `recent:${spot.zoneId}:${spot.pin.lat.toFixed(5)},${spot.pin.lng.toFixed(5)}`, kind: 'recent', savedLabel: spot.savedLabel };
  return [entry, ...list.filter((s) => !sameSpot(s, spot))].slice(0, max);
}

/** Closer than this, a ride makes no sense ("same place"); the rider changes the destination. */
export const MIN_RIDE_M = 150;

export function tooClose(a: Pick<Spot, 'pin'>, b: Pick<Spot, 'pin'>): boolean {
  return haversineM(a.pin, b.pin) < MIN_RIDE_M;
}

// ───────────────────────── quotes ─────────────────────────

/**
 * The quote `orders.place` re-prices a ride with (orders `serverFees`): pickup → drop-off zones with
 * pins, door pickup or the street, at the minute. Same request ⇒ same total, so the fare shown is
 * the fare charged (a minute boundary crossing night/peak is the `price_changed` case).
 */
export function rideQuoteRequest(input: { vertical: RideVertical; pickup: DeliveryPoint; dropoff: DeliveryPoint; doorPickup: boolean; at: Date; cityId?: string }): PriceRequestInput {
  const stop = (p: DeliveryPoint, type: 'pickup' | 'dropoff') => ({ zoneId: p.zoneKey, type, ...(p.pin ? { pin: p.pin } : {}) });
  return {
    cityId: input.cityId ?? CITY_ID,
    vertical: input.vertical,
    stops: [stop(input.pickup, 'pickup'), stop(input.dropoff, 'dropoff')],
    options: { doorPickup: input.doorPickup, streetHandover: false },
    at: input.at,
  };
}

/** The quote time, to the minute, so a query key is stable between renders. */
export function quoteMinute(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  return d;
}

/** What door pickup adds over meeting at the street (both quotes at the same minute). */
export function doorExtra(door: Pick<Quote, 'total'> | undefined, street: Pick<Quote, 'total'> | undefined): number | null {
  if (!door || !street) return null;
  return Math.max(0, door.total - street.total);
}

export interface Surcharge {
  key: 'night' | 'peak' | 'weather';
  amount: number;
}

/** Time/weather surcharges in a quote (night first): the choose screen names them up front. */
export function surchargesOf(q: Pick<Quote, 'components'> | undefined): Surcharge[] {
  if (!q) return [];
  const out: Surcharge[] = [];
  for (const key of ['night', 'peak', 'weather'] as const) {
    const amount = q.components.filter((c) => c.key === key).reduce((a, c) => a + c.amount, 0);
    if (amount > 0) out.push({ key, amount });
  }
  return out;
}

/** A component rule's hour window `[from, to)` from the city config (night 23–5), for the reason line. */
export function ruleHours(city: Pick<CityPricingConfig, 'verticals'> | undefined, vertical: RideVertical, key: QuoteComponent['key']): [number, number] | null {
  const rule = city?.verticals.find((v) => v.vertical === vertical)?.components.find((c) => c.key === key);
  return rule?.hours ? [rule.hours[0], rule.hours[1]] : null;
}

/** "11 بالليل" style hour for reason lines: 12-hour clock, no minutes. */
export function hour12(h: number): string {
  const x = ((h % 24) + 24) % 24;
  const v = x % 12 === 0 ? 12 : x % 12;
  return String(v);
}

/** The lines the breakdown shows: every non-zero shown component (a free street pickup says nothing). */
export function fareLines(q: Pick<Quote, 'components'>): QuoteComponent[] {
  return q.components.filter((c) => c.amount !== 0 || c.key === 'base');
}

// ───────────────────────── options on the choose screen ─────────────────────────

export interface TuktukAvailability {
  ok: boolean;
  /** The edge zone that makes a tuktuk unlikely (pickup's first). */
  edgeZoneId: string | null;
}

/**
 * Edge zones are opt-in for tuktuk drivers (edge-case decisions: "edge zones opt-in for tuktuks";
 * dispatch never offers an edge trip to a tuktuk that did not opt in), so a tuktuk to or from one is
 * off by default with the reason; the rider may still try (`allowEdge`).
 */
export function tuktukAvailability(pickupZoneId: string, dropoffZoneId: string, allowEdge = false): TuktukAvailability {
  const edge = [pickupZoneId, dropoffZoneId].find((z) => zoneTier(z) === 'edge') ?? null;
  return { ok: edge === null || allowEdge, edgeZoneId: edge };
}

/** The ride itself in town traffic (car for taxis): minutes and the arrival clock. */
export function rideEstimate(pickup: LatLng, dropoff: LatLng, vertical: RideVertical, now: Date): { minutes: number; arriveAt: Date } {
  const minutes = travelMinutes(pickup, dropoff, vertical === 'taxi' ? 'car' : 'tuktuk');
  return { minutes, arriveAt: new Date(now.getTime() + minutes * 60_000) };
}

export function walletCovers(balanceIqd: number | null | undefined, fareIqd: number | null | undefined): boolean {
  return balanceIqd != null && fareIqd != null && balanceIqd >= fareIqd;
}

// ───────────────────────── placing ─────────────────────────

export interface RidePlaceArgs {
  vertical: RideVertical;
  pickup: Pick<Spot, 'zoneId' | 'pin'>;
  dropoff: Pick<Spot, 'zoneId' | 'pin'>;
  doorPickup: boolean;
  /** The quote's total the rider saw: the server refuses with `price_changed` if it differs. */
  fareIqd: number;
  quoteId?: string;
  paymentMethod: Extract<PaymentMethod, 'cash' | 'wallet'>;
  note?: string;
  cityId?: string;
  /** The request attempt's idempotency key (`features/food/place-attempt.ts`): re-sent on a retry. */
  clientRequestId?: string;
}

/** The exact `orders.place` payload for a ride (what scripts/e2e/three-apps.mjs sends, plus options). */
export function buildRidePlaceInput(a: RidePlaceArgs): PlaceOrderInput {
  const note = a.note?.trim();
  return {
    cityId: a.cityId ?? CITY_ID,
    type: 'ride',
    rideVertical: a.vertical,
    fareIqd: a.fareIqd,
    ...(a.quoteId ? { quoteId: a.quoteId } : {}),
    options: { doorPickup: a.doorPickup },
    paymentMethod: a.paymentMethod,
    pickup: spotPoint(a.pickup),
    dropoff: spotPoint(a.dropoff),
    ...(note ? { note: note.slice(0, 500) } : {}),
    ...(a.clientRequestId ? { clientRequestId: a.clientRequestId } : {}),
  };
}

export type RideProblem = 'price_changed' | 'cash_cap' | 'location' | 'wallet' | 'other';

/** How the choose screen answers a refused `orders.place`. */
export function rideProblem(code: string | null | undefined): RideProblem {
  switch (code) {
    case 'price_changed':
      return 'price_changed';
    case 'new_customer_cash_cap':
      return 'cash_cap';
    case 'quote_location_required':
    case 'outside_zone':
      return 'location';
    case 'wallet_insufficient':
      return 'wallet';
    default:
      return 'other';
  }
}

// ───────────────────────── searching ─────────────────────────

export type SearchStage = 'nearest' | 'wider' | 'everyone';

/**
 * Honest matching copy (customer spec §5, "matching shows waves honestly"): which broadcast wave the
 * request is in, from the city's dispatch config (taxi/tuktuk smart broadcast: nearest 3 for 15 s,
 * next 5 for 15 s, then the whole city).
 */
export function searchStage(elapsedSec: number, dispatch: Pick<DispatchConfig, 'waves'> | undefined): SearchStage {
  const waves = dispatch?.waves ?? [
    { size: 3, seconds: 15 },
    { size: 5, seconds: 15 },
    { size: 'all', seconds: 30 },
  ];
  let t = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i]!;
    if (w.size === 'all') return 'everyone';
    t += w.seconds;
    if (elapsedSec < t) return i === 0 ? 'nearest' : 'wider';
  }
  return 'everyone';
}

/** `75` → `1:15` (search counter). */
export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

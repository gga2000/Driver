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

export type SpotKind = 'saved' | 'recent' | 'landmark' | 'shop' | 'zone' | 'pin';

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
  /** A meeting point's photo (ride idea p3), so rider and driver stand at the same door. */
  photoUrl?: string | null;
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
  /** Restaurants and shops as destinations (ride idea w7): «خالد» finds مطعم خالد. */
  shops?: readonly Spot[];
  zones: readonly Spot[];
}

const KIND_RANK: Record<SpotKind, number> = { saved: 0, recent: 1, landmark: 2, shop: 3, zone: 4, pin: 5 };

/** Search results over every source, best match first (saved before recent before landmarks before zones on ties). */
export function searchSpots(query: string, sources: SpotSources, limit = 12): Spot[] {
  if (!normalizeArabic(query)) return [];
  const all = [...sources.saved, ...sources.recent, ...sources.landmarks, ...(sources.shops ?? []), ...sources.zones];
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
    photoUrl: l.photoUrl,
  };
}

/** A restaurant or shop as a ride destination (ride idea w7): its pickup point, the zone under it. */
export function shopSpot(m: { id: string; name: string; pickup: DeliveryPoint | null }, locale: 'ar-IQ' | 'en', kindLabel: string): Spot | null {
  if (!m.pickup?.pin || !zoneOf(m.pickup.zoneKey)) return null;
  return {
    id: `shop:${m.id}`,
    kind: 'shop',
    title: westernDigits(m.name),
    subtitle: `${kindLabel} · ${zoneTitle(m.pickup.zoneKey, locale)}`,
    zoneId: m.pickup.zoneKey,
    pin: m.pickup.pin,
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
  /** Joy J7d: a ride booked for later (20 min – 7 days ahead), priced at that time. */
  scheduledFor?: Date | null;
  /** Joy l9: one of the rider's favourites, asked first (booked rides only). */
  favouriteId?: string | null;
  /** Ride idea s6: family drivers first. */
  familyPreferred?: boolean;
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
    ...(a.scheduledFor ? { scheduledFor: a.scheduledFor } : {}),
    ...(a.scheduledFor && a.favouriteId ? { favouriteId: a.favouriteId } : {}),
    ...(a.familyPreferred ? { familyPreferred: true } : {}),
  };
}

export type RideProblem = 'price_changed' | 'cash_cap' | 'location' | 'wallet' | 'schedule' | 'other';

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
    case 'ride_schedule_invalid':
      return 'schedule';
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

/** Which of the three visible search stages ("1 من 3"), so the wait has a finish line (L-03). */
export function searchStageIndex(stage: SearchStage): 1 | 2 | 3 {
  return stage === 'nearest' ? 1 : stage === 'wider' ? 2 : 3;
}

/**
 * The "try the other vehicle" card (J-D7): from the city's free-cancel time (180 s, the moment dispatch
 * stops the search and frees the cancel) until the customer chooses to keep searching.
 */
export function switchOfferDue(elapsedSec: number, afterSec: number, keptSearching: boolean): boolean {
  return !keptSearching && elapsedSec >= afterSec;
}

/** Where the ride goes is a flag; the house only when it is the saved home (L-15, C-34). */
export function destinationPinKind(spot: Pick<Spot, 'savedLabel'> | null | undefined): 'home' | 'destination' {
  return spot?.savedLabel === 'home' ? 'home' : 'destination';
}

/** `75` → `1:15` (search counter). */
export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ───────────────────────── step 2: picks, ride back, the wait ─────────────────────────

/**
 * Ride idea w2: three places the rider is likely going now, by hour and habit — work on a weekday
 * morning, home from the afternoon on, then the latest trips — never where he already is.
 */
export function smartPicks(input: { hour: number; saved: readonly Spot[]; recent: readonly Spot[]; pickup: Pick<Spot, 'pin'> | null; max?: number }): Spot[] {
  const { hour, saved, recent, pickup } = input;
  const home = saved.find((s) => s.savedLabel === 'home');
  const work = saved.find((s) => s.savedLabel === 'work');
  const morning = hour >= 5 && hour < 12;
  const ordered = [...(morning ? [work, home] : [home, work]), ...recent, ...saved];
  const out: Spot[] = [];
  for (const s of ordered) {
    if (!s || (pickup && tooClose(pickup, s)) || out.some((o) => sameSpot(o, s))) continue;
    out.push(s);
    if (out.length >= (input.max ?? 3)) break;
  }
  return out;
}

/** How long after a ride the «ترجع من نفس المكان؟» card waits, and when it stops asking. */
export const RIDE_BACK_AFTER_MIN = 20;
export const RIDE_BACK_UNTIL_H = 10;

/**
 * Ride idea a4: later the same day, the way back from the last ride's destination to home. Only when
 * that ride did not end at home, started at least 20 minutes ago and no more than 10 hours ago, on
 * the same calendar day.
 */
export function rideBackOffer(input: { lastAt: number | null; lastToHome: boolean; lastPlace: Spot | null; home: Spot | null; now: number }): { from: Spot; to: Spot } | null {
  const { lastAt, lastPlace, home, now } = input;
  if (lastAt === null || !lastPlace || !home || input.lastToHome) return null;
  const age = now - lastAt;
  if (age < RIDE_BACK_AFTER_MIN * 60_000 || age > RIDE_BACK_UNTIL_H * 3_600_000) return null;
  if (new Date(lastAt).toDateString() !== new Date(now).toDateString()) return null;
  if (tooClose(lastPlace, home)) return null;
  return { from: lastPlace, to: home };
}

/**
 * The free minute after a driver accepts (pricing/cancellation.ts `rideFreeAfterAcceptSec`, 60 s): the
 * seconds left of it, or null once it is over (ride idea m4). The server decides the fee either way.
 */
export const RIDE_FREE_AFTER_ACCEPT_SEC = 60;
export function freeCancelLeftSec(acceptedAt: Date | null, now: number): number | null {
  if (!acceptedAt) return null;
  const left = RIDE_FREE_AFTER_ACCEPT_SEC - Math.floor((now - acceptedAt.getTime()) / 1000);
  return left > 0 && left <= RIDE_FREE_AFTER_ACCEPT_SEC ? left : null;
}

/**
 * Ride idea m2: the three-part search bar — which part, how full it is, and how many drivers have
 * been asked (3, then 8, then everyone). The last part runs to the free-cancel time (180 s), where
 * the «جرّب التكتك» offer takes over, so the bar has an honest end.
 */
export function searchProgress(elapsedSec: number, dispatch: Pick<DispatchConfig, 'waves'> | undefined, endSec = 180): { part: 1 | 2 | 3; fill: number; asked: number | 'all' } {
  const waves = dispatch?.waves ?? [
    { size: 3, seconds: 15 },
    { size: 5, seconds: 15 },
    { size: 'all', seconds: 30 },
  ];
  let start = 0;
  let asked = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i]!;
    const part = Math.min(3, i + 1) as 1 | 2 | 3;
    if (w.size === 'all' || i >= 2) {
      const span = Math.max(1, endSec - start);
      return { part: 3, fill: Math.min(1, Math.max(0, (elapsedSec - start) / span)), asked: 'all' };
    }
    asked += w.size;
    if (elapsedSec < start + w.seconds) return { part, fill: Math.max(0, (elapsedSec - start) / w.seconds), asked };
    start += w.seconds;
  }
  return { part: 3, fill: 1, asked: 'all' };
}

/** Ride idea p4: one-tap notes for the driver, added to what the rider already wrote. */
export function addNoteChip(note: string, chip: string, max = 200): string {
  const parts = note.split('،').map((p) => p.trim()).filter(Boolean);
  if (parts.includes(chip)) return note;
  return [...parts, chip].join('، ').slice(0, max);
}

/** Ride idea d3: «السايق قريب، اطلع هسة» once his ETA to the pickup is this close. */
export const RIDE_NEAR_SEC = 60;

/** He is still coming to the pickup and the one ETA says a minute or less (ride idea d3). */
export function rideNearDue(i: { comingToPickup: boolean; eta: Date | null; now: number }): boolean {
  return i.comingToPickup && i.eta !== null && i.eta.getTime() - i.now <= RIDE_NEAR_SEC * 1000;
}

/**
 * Ride idea t1: how far along the ride is, by time — from when the rider got in (`startedAt`) to the
 * one ETA at the drop-off — and the whole minutes left. `floor` is the last fraction shown, so the
 * line never slides back when the ETA grows a little. Null until the ride has started and has an ETA
 * for the ride itself.
 */
export function tripProgress(i: { startedAt: Date | null; eta: Date | null; now: number; floor?: number }): { fraction: number; leftMin: number } | null {
  if (!i.startedAt || !i.eta) return null;
  const total = i.eta.getTime() - i.startedAt.getTime();
  // An ETA from before he picked the rider up (the pickup leg's, not yet refreshed) says nothing yet.
  if (total <= 0) return null;
  const left = Math.max(0, i.eta.getTime() - i.now);
  const raw = (i.now - i.startedAt.getTime()) / total;
  // Never quite full until he ends the ride: the last sliver belongs to «وصلنا».
  const fraction = Math.min(0.97, Math.max(i.floor ?? 0, raw, 0));
  return { fraction, leftMin: Math.max(1, Math.ceil(left / 60_000)) };
}

/**
 * Ride idea d5: how far from the rider's pickup pin he has stopped, in steps a person can picture
 * (5 m under 50, then 10 m); `0` when he is on the pin (15 m or less); null without both points or
 * when he is far enough that "where he stands" means nothing (over 400 m: a bad fix).
 */
export function standsAwayM(driver: LatLng | null, pickup: LatLng | null): number | null {
  if (!driver || !pickup) return null;
  const d = haversineM(driver, pickup);
  if (d > 400) return null;
  if (d <= 15) return 0;
  return d < 50 ? Math.round(d / 5) * 5 : Math.round(d / 10) * 10;
}

/** Ride idea n5: how long he has driven here, in the unit a person says («من 8 أشهر», «من سنتين»). */
export function memberSpan(since: Date | null, now: number): { unit: 'new' | 'months' | 'years'; n: number } | null {
  if (!since) return null;
  const months = Math.floor((now - since.getTime()) / (30.44 * 86_400_000));
  if (months < 1) return { unit: 'new', n: 0 };
  if (months < 12) return { unit: 'months', n: months };
  return { unit: 'years', n: Math.floor(months / 12) };
}

/** Ride idea g4: the honest timing tip shows when a time surcharge ends within this many minutes. */
export const SURCHARGE_TIP_MIN = 30;

/**
 * Ride idea g4: minutes until a time surcharge's window `[from, to)` (Baghdad hours) ends, when that is
 * `SURCHARGE_TIP_MIN` or less — «وقت الذروة يخلص بعد 15 دقيقة» — so a rider who can wait pays less.
 * Null outside the window or when the end is further off. Information only: the price is the server's.
 */
export function surchargeEndsInMin(hours: [number, number] | null, now: Date): number | null {
  if (!hours) return null;
  const local = new Date(now.getTime() + 3 * 3_600_000);
  const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  const from = hours[0] * 60;
  const to = hours[1] * 60;
  const inside = from <= to ? mins >= from && mins < to : mins >= from || mins < to;
  if (!inside) return null;
  const left = (to - mins + 1440) % 1440;
  return left > 0 && left <= SURCHARGE_TIP_MIN ? left : null;
}

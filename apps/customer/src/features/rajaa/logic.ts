/**
 * الرجعة — pure logic for the intercity screens (customer spec §2, edge-case decisions §8–§9).
 * No React Native imports: runs in plain Node tests. Types come from `@driver/contracts` (type-only).
 *
 * Times: the backend's rules run on Baghdad wall time (UTC+3 all year), so window builders take a
 * `utcOffsetMin` (default 180) instead of trusting the device's time zone.
 */
import { formatClock, hourWindow, type Locale, type MessageKey, type Params } from '@driver/i18n';
import type {
  BoardSeat,
  BookingState,
  BookingView,
  DemandBucket,
  DepartureCard,
  IntercityDirection,
  IntercityRow,
  IntercitySeatId,
  IntercitySeatLayout,
  TravellingAs,
} from '@driver/contracts';

export const IRAQ_UTC_OFFSET_MIN = 180;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Rules the screens state to the rider; the server enforces the same figures (intercity.config). */
export const RAJAA_RULES = {
  holdMin: 10,
  boardingWindowMin: 30,
  cashGraceMin: 3,
  /** Late meter (AZIZIYAH_MONEY_RULES.lateMeter): prepaid grace, block, cap. */
  prepaidGraceMin: 5,
  meterBlockMin: 10,
  meterCapMin: 20,
  riderLateToDriverPerBlockIqd: 1000,
  riderLateToEachRiderPerBlockIqd: 500,
  driverLateToEachRiderPerBlockIqd: 1000,
  depositRate: 0.2,
  depositMinIqd: 5000,
  /** Board refresh while the screen is open. */
  pollMs: 5000,
} as const;

// ───────────────────────── corridors, direction ─────────────────────────

export const HOME_CITY = 'aziziyah';
export const PRIMARY_CORRIDOR = 'aziziyah_baghdad';
export const DEFAULT_DIRECTION: IntercityDirection = 'to_aziziyah';

/** Board order of garages on each side (spec §2: النهضة in Baghdad; البوابة ١، البوابة ٢، السوق in Aziziyah). */
export const GARAGE_ORDER = ['mp_garage_nahdha', 'mp_garage_bab1', 'mp_garage_bab2', 'mp_garage_souq', 'mp_garage_kut'] as const;

export interface LatLngLike {
  lat: number;
  lng: number;
}

export interface GarageLike extends LatLngLike {
  id: string;
  cityId: string;
  nameAr: string;
}

/** The two cities of a run: `to_aziziyah` leaves the far city; `from_aziziyah` leaves Aziziyah. */
export function endpoints(corridorCityId: string, direction: IntercityDirection): { from: string; to: string } {
  return direction === 'to_aziziyah' ? { from: corridorCityId, to: HOME_CITY } : { from: HOME_CITY, to: corridorCityId };
}

export function flip(direction: IntercityDirection): IntercityDirection {
  return direction === 'to_aziziyah' ? 'from_aziziyah' : 'to_aziziyah';
}

/** Great-circle distance in metres. */
export function haversineM(a: LatLngLike, b: LatLngLike): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Auto-suggest the direction from the last known position: near a Baghdad (or Kut) garage → the way
 * back to Aziziyah; near an Aziziyah garage → away from it. Null when unknown or far from every garage
 * (the screen then keeps the default, بغداد ← العزيزية).
 */
export function suggestDirection(
  at: LatLngLike | null,
  garages: readonly GarageLike[],
  maxKm = 40,
): { direction: IntercityDirection; cityId: string } | null {
  if (!at || garages.length === 0) return null;
  let best: { g: GarageLike; d: number } | null = null;
  for (const g of garages) {
    const d = haversineM(at, g);
    if (!best || d < best.d) best = { g, d };
  }
  if (!best || best.d > maxKm * 1000) return null;
  return { direction: best.g.cityId === HOME_CITY ? 'from_aziziyah' : 'to_aziziyah', cityId: best.g.cityId };
}

// ───────────────────────── board ─────────────────────────

const BOOKABLE: ReadonlySet<DepartureCard['state']> = new Set(['scheduled', 'boarding']);

export interface GarageGroup<G extends GarageLike = GarageLike> {
  garage: G;
  departures: DepartureCard[];
}

function garageRank(id: string): number {
  const i = (GARAGE_ORDER as readonly string[]).indexOf(id);
  return i === -1 ? GARAGE_ORDER.length : i;
}

/** Earliest first; at the same time the fuller car first (it leaves sooner "when full"). */
export function compareDepartures(a: DepartureCard, b: DepartureCard): number {
  return a.departAt.getTime() - b.departAt.getTime() || b.fill.filled - a.fill.filled || a.id.localeCompare(b.id);
}

/**
 * Departures grouped under the garages of the side they leave from, in board order. Every garage of
 * that side gets a group (an empty one says "no car from here right now"); runs past their hard
 * latest time or no longer bookable are dropped.
 */
export function groupBoard<G extends GarageLike>(
  departures: readonly DepartureCard[],
  garages: readonly G[],
  originCityId: string,
  now: Date,
): GarageGroup<G>[] {
  const side = garages.filter((g) => g.cityId === originCityId).sort((a, b) => garageRank(a.id) - garageRank(b.id) || a.nameAr.localeCompare(b.nameAr));
  const live = departures.filter((d) => BOOKABLE.has(d.state) && d.latestDepartureAt.getTime() > now.getTime());
  return side.map((garage) => ({ garage, departures: live.filter((d) => d.garageId === garage.id).sort(compareDepartures) }));
}

/** Home card summary: bookable cars with a free seat and the earliest of them. */
export function boardSummary(departures: readonly DepartureCard[], now: Date): { count: number; next: DepartureCard | null } {
  const open = departures
    .filter((d) => BOOKABLE.has(d.state) && d.latestDepartureAt.getTime() > now.getTime() && d.fill.free > 0)
    .sort(compareDepartures);
  return { count: open.length, next: open[0] ?? null };
}

export type FillTone = 'open' | 'filling' | 'last' | 'full';

/** Fill badge: "باقي 3 مقاعد" → "باقي مقعد واحد" → "كاملة". */
export function fillTone(fill: Pick<DepartureCard['fill'], 'free' | 'seatsTotal'>): FillTone {
  if (fill.free <= 0) return 'full';
  if (fill.free === 1) return 'last';
  return fill.free <= fill.seatsTotal / 2 ? 'filling' : 'open';
}

/** Whole minutes until `at` (0 when past). */
export function minutesUntil(at: Date, now: Date): number {
  return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / MIN));
}

/** Boarding opens (boarding pass, live car) at T−30. */
export function boardingOpensAt(departAt: Date): Date {
  return new Date(departAt.getTime() - RAJAA_RULES.boardingWindowMin * MIN);
}

export function isBoardingOpen(departAt: Date, now: Date): boolean {
  return now.getTime() >= boardingOpensAt(departAt).getTime();
}

// ───────────────────────── seats ─────────────────────────

/** Passenger rows per layout (same physical map as the backend and @driver/ui's SeatMap). */
export const ROW_SEATS: Record<IntercitySeatLayout, Partial<Record<IntercityRow, IntercitySeatId[]>>> = {
  4: { back: ['back_left', 'back_middle', 'back_right'] },
  6: { middle: ['middle_left', 'middle_right'], rear: ['rear_left', 'rear_middle', 'rear_right'] },
  7: { middle: ['middle_left', 'middle_middle', 'middle_right'], rear: ['rear_left', 'rear_middle', 'rear_right'] },
};

/** SeatMap's seat shape (kept structural so this file stays free of React Native). */
export interface SeatMapSeat {
  id: IntercitySeatId;
  state: BoardSeat['state'];
  premium?: number;
  blocked?: boolean;
}

export function toSeatMap(seats: readonly BoardSeat[]): SeatMapSeat[] {
  return seats.map((s) => ({
    id: s.id,
    state: s.state,
    ...(s.premiumIqd > 0 ? { premium: s.premiumIqd } : {}),
    ...(s.state === 'free' && s.blocked ? { blocked: true } : {}),
  }));
}

export function blockedReason(seats: readonly BoardSeat[], id: IntercitySeatId): BoardSeat['blocked'] {
  return seats.find((s) => s.id === id)?.blocked ?? null;
}

/** How many seats one booking may pick: a family the whole car, others up to four. */
export function maxSeatsFor(travellingAs: TravellingAs, layout: IntercitySeatLayout): number {
  return travellingAs === 'aila' ? layout : Math.min(4, layout);
}

export interface RowOption {
  row: IntercityRow;
  seatIds: IntercitySeatId[];
  available: boolean;
}

/** "Book the row": a row is offered when every seat in it is free (the whole row is one group, so adjacency can't bite inside it). */
export function rowOptions(layout: IntercitySeatLayout, seats: readonly BoardSeat[], familyOnly: boolean, travellingAs: TravellingAs): RowOption[] {
  const byId = new Map(seats.map((s) => [s.id, s]));
  const allowed = !familyOnly || travellingAs === 'aila';
  return (Object.entries(ROW_SEATS[layout]) as [IntercityRow, IntercitySeatId[]][]).map(([row, seatIds]) => ({
    row,
    seatIds,
    available: allowed && seatIds.every((id) => byId.get(id)?.state === 'free'),
  }));
}

/** "Book the car": nobody else on it yet. */
export function carAvailable(seats: readonly BoardSeat[], familyOnly: boolean, travellingAs: TravellingAs): boolean {
  return (!familyOnly || travellingAs === 'aila') && seats.length > 0 && seats.every((s) => s.state === 'free');
}

/** Drop picks that stopped being selectable after a board refresh or a travelling-as change. */
export function pruneSelection(selection: readonly IntercitySeatId[], seats: readonly BoardSeat[]): IntercitySeatId[] {
  const byId = new Map(seats.map((s) => [s.id, s]));
  return selection.filter((id) => {
    const s = byId.get(id);
    return !!s && s.state === 'free' && !s.blocked;
  });
}

export interface SeatQuote {
  seats: number;
  seatPriceIqd: number;
  baseIqd: number;
  frontIqd: number;
  pickupIqd: number;
  totalIqd: number;
}

/** What the hold will cost: seats × price, + front premium if the front is in it, + pickup fee. */
export function quoteSelection(seatIds: readonly IntercitySeatId[], dep: Pick<DepartureCard, 'seatPriceIqd' | 'frontPremiumIqd'>, pickupFeeIqd = 0): SeatQuote {
  const seats = seatIds.length;
  const baseIqd = seats * dep.seatPriceIqd;
  const frontIqd = seatIds.includes('front') ? dep.frontPremiumIqd : 0;
  const pickupIqd = seats > 0 ? pickupFeeIqd : 0;
  return { seats, seatPriceIqd: dep.seatPriceIqd, baseIqd, frontIqd, pickupIqd, totalIqd: baseIqd + frontIqd + pickupIqd };
}

/**
 * On-the-way boarding points worth offering for this direction: in road order from the origin
 * garage, without points at the destination's doorstep (boarding 5 km before arriving is no pickup).
 */
export function pickupPointsInOrder<M extends LatLngLike>(points: readonly M[], origin: LatLngLike, destination: readonly LatLngLike[], minFromDestinationKm = 8): M[] {
  const nearDest = (p: LatLngLike) => Math.min(...destination.map((d) => haversineM(p, d)));
  return points
    .filter((p) => destination.length === 0 || nearDest(p) > minFromDestinationKm * 1000)
    .sort((a, b) => haversineM(origin, a) - haversineM(origin, b));
}

/**
 * Door pickup fee as the server prices it (intercity.config door rules, placeholders): 1,000 base +
 * 500 per started km beyond 2 km of the garage, rounded up to 500. Null beyond 10 km (not offered).
 */
export function doorFeeEstimate(home: LatLngLike, garage: LatLngLike): number | null {
  const km = haversineM(home, garage) / 1000;
  if (km > 10) return null;
  const fee = 1000 + Math.max(0, Math.ceil(km - 2)) * 500;
  return Math.ceil(fee / 500) * 500;
}

// ───────────────────────── bookings ─────────────────────────

export const LIVE_BOOKING: readonly BookingState[] = ['held', 'booked', 'checked_in'];

export function isLiveBooking(b: Pick<BookingView, 'state' | 'heldUntil'>, now: Date): boolean {
  if (b.state === 'held') return !!b.heldUntil && b.heldUntil.getTime() > now.getTime();
  return b.state === 'booked' || b.state === 'checked_in';
}

/** The booking the board pins on top: a live hold first, else the next booked trip. */
export function activeBooking(bookings: readonly BookingView[], now: Date): BookingView | null {
  const live = bookings.filter((b) => isLiveBooking(b, now) && b.departure.latestDepartureAt.getTime() > now.getTime());
  const held = live.filter((b) => b.state === 'held').sort((a, b) => a.heldUntil!.getTime() - b.heldUntil!.getTime());
  if (held[0]) return held[0];
  return live.sort((a, b) => a.departure.departAt.getTime() - b.departure.departAt.getTime())[0] ?? null;
}

/** Where a booking opens: the hold/pay step while held, the boarding pass once it's yours. */
export function bookingHref(b: Pick<BookingView, 'id' | 'state'>): string {
  return b.state === 'held' ? `/rajaa/booking/${b.id}` : `/rajaa/pass/${b.id}`;
}

export type CancelRule =
  | { kind: 'hold'; canCancel: true }
  | { kind: 'cash'; canCancel: true }
  | { kind: 'prepaid'; canCancel: boolean; until: Date }
  | { kind: 'none'; canCancel: false };

/**
 * Mirrors the server's rider cancel (departures.service `cancel`): a hold any time; a cash
 * reservation (and a moved / forfeit-hold seat) any time before departure; a prepaid seat until
 * boarding opens at T−30. A checked-in rider can't cancel.
 */
export function cancelRule(b: Pick<BookingView, 'state' | 'prepaid' | 'origin'> & { departure: Pick<BookingView['departure'], 'departAt' | 'state'> }, now: Date): CancelRule {
  const open = b.departure.state === 'scheduled' || b.departure.state === 'boarding';
  if (b.state === 'held' && open) return { kind: 'hold', canCancel: true };
  if (b.state !== 'booked' || !open) return { kind: 'none', canCancel: false };
  if (!b.prepaid || b.origin === 'moved' || b.origin === 'forfeit_hold') return { kind: 'cash', canCancel: true };
  const until = boardingOpensAt(b.departure.departAt);
  return { kind: 'prepaid', canCancel: now.getTime() < until.getTime(), until };
}

// ───────────────────────── countdown ─────────────────────────

/** `m:ss`, rounding partial seconds up (the voice guide's `{minutes}:{seconds}`). */
export function clockCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface HoldCountdown {
  remainingMs: number;
  label: string;
  /** 0 → just held, 1 → lapsed. */
  elapsedFraction: number;
  expired: boolean;
  /** Last minute: the ring turns danger. */
  urgent: boolean;
}

/** The 10-minute free hold, counted down against the server's `heldUntil`. */
export function holdCountdown(heldUntil: Date, now: Date, holdMin: number = RAJAA_RULES.holdMin): HoldCountdown {
  const total = holdMin * MIN;
  const remainingMs = Math.max(0, Math.min(total, heldUntil.getTime() - now.getTime()));
  return {
    remainingMs,
    label: clockCountdown(remainingMs),
    elapsedFraction: total > 0 ? 1 - remainingMs / total : 1,
    expired: remainingMs <= 0,
    urgent: remainingMs > 0 && remainingMs <= MIN,
  };
}

// ───────────────────────── demand windows ─────────────────────────

export type WindowId = 'now' | 'hour' | 'afternoon' | 'tonight';

export interface DemandWindow {
  id: WindowId;
  start: Date;
  end: Date;
  /** False once the window is over (chip disabled). */
  available: boolean;
}

/** Midnight (local wall time) of the day `now` falls on, as a UTC instant. */
function localMidnight(now: Date, utcOffsetMin: number): number {
  const local = now.getTime() + utcOffsetMin * MIN;
  return local - (((local % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR)) - utcOffsetMin * MIN;
}

/**
 * The demand sheet's window chips: هسة (next 30 min) / خلال ساعة (next hour) / 4–6 (today 16:00–18:00)
 * / الليلة (today 18:00–24:00). A window already under way starts now; one that is over is unavailable.
 * All windows satisfy the server's rules (ends in the future, ≤ 12 h long).
 */
export function demandWindows(now: Date, utcOffsetMin: number = IRAQ_UTC_OFFSET_MIN): DemandWindow[] {
  const t = now.getTime();
  const day = localMidnight(now, utcOffsetMin);
  const fixed = (id: WindowId, fromH: number, toH: number): DemandWindow => {
    const start = day + fromH * HOUR;
    const end = day + toH * HOUR;
    return { id, start: new Date(Math.max(start, t)), end: new Date(end), available: end - t > 5 * MIN };
  };
  return [
    { id: 'now', start: new Date(t), end: new Date(ceilTo(t + 30 * MIN, 5 * MIN)), available: true },
    { id: 'hour', start: new Date(t), end: new Date(ceilTo(t + HOUR, 5 * MIN)), available: true },
    fixed('afternoon', 16, 18),
    fixed('tonight', 18, 24),
  ];
}

function ceilTo(ms: number, step: number): number {
  return Math.ceil(ms / step) * step;
}

/** Window ends shown on 5-minute marks (a window opened "now" reads from the mark before it). */
export function labelWindow(start: Date, end: Date): { start: Date; end: Date } {
  const step = 5 * MIN;
  return { start: new Date(Math.floor(start.getTime() / step) * step), end: new Date(ceilTo(end.getTime(), step)) };
}

/**
 * "بين 4 و 6 العصر", "بين 8 و 10 بالليل" (R-06: never a bare 8 that could be morning or night). A
 * window that starts "now" reads from the 5-minute mark before it: "بين 6:30 و 7:35 المسا".
 */
export function windowLabel(t: (key: MessageKey, params?: Params) => string, start: Date, end: Date, locale: Locale = 'ar-IQ'): string {
  const shown = labelWindow(start, end);
  return t('rajaa.window_between', hourWindow(shown.start, shown.end, { locale, offsetMin: IRAQ_UTC_OFFSET_MIN }));
}

/** "7:05 م": the city's one clock with the part of day (packages/i18n `formatClock`). */
export function clockLabel(at: Date, utcOffsetMin: number = IRAQ_UTC_OFFSET_MIN): string {
  return formatClock(at, { offsetMin: utcOffsetMin });
}

/**
 * People still waiting in a bucket. `posts` counts open and claimed posts alike, so when some were
 * claimed the open share is estimated from the seats (open seats / all seats).
 */
export function openPosts(b: Pick<DemandBucket, 'posts' | 'postedSeats' | 'claimedSeats'>): number {
  if (b.postedSeats <= 0) return 0;
  if (b.claimedSeats <= 0) return b.posts;
  return Math.max(1, Math.round((b.posts * b.postedSeats) / (b.postedSeats + b.claimedSeats)));
}

function overlaps(a: { windowStart: Date; windowEnd: Date }, b: { windowStart: Date; windowEnd: Date }): boolean {
  return a.windowStart.getTime() < b.windowEnd.getTime() && b.windowStart.getTime() < a.windowEnd.getTime();
}

export interface DemandSummary {
  posts: number;
  seats: number;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * The board banner ("7 ناس يريدون يرجعون بين 4 و 6"): open posts summed per window across garages,
 * the busiest upcoming window wins; ties go to the earlier window.
 */
export function demandBanner(buckets: readonly DemandBucket[], now: Date): DemandSummary | null {
  const byWindow = new Map<string, DemandSummary>();
  for (const b of buckets) {
    if (b.windowEnd.getTime() <= now.getTime() || b.postedSeats <= 0) continue;
    const key = `${b.windowStart.getTime()}|${b.windowEnd.getTime()}`;
    const cur = byWindow.get(key) ?? { posts: 0, seats: 0, windowStart: b.windowStart, windowEnd: b.windowEnd };
    cur.posts += openPosts(b);
    cur.seats += b.postedSeats;
    byWindow.set(key, cur);
  }
  let best: DemandSummary | null = null;
  for (const w of byWindow.values()) {
    if (w.posts <= 0) continue;
    if (!best || w.posts > best.posts || (w.posts === best.posts && w.windowStart.getTime() < best.windowStart.getTime())) best = w;
  }
  return best;
}

/** "N ناس ينتظرون وياك": other open posts whose window overlaps mine (my own post is in the buckets). */
export function waitingWithMe(mine: { windowStart: Date; windowEnd: Date }, buckets: readonly DemandBucket[]): number {
  let posts = 0;
  for (const b of buckets) if (overlaps(mine, b)) posts += openPosts(b);
  return Math.max(0, posts - 1);
}

// ───────────────────────── request board ─────────────────────────

/** Request-board deposit (review C-50): 20 % of the picked price rounded up to 500, at least 5,000, never above the price. */
export function depositFor(priceIqd: number): number {
  const pct = Math.ceil((priceIqd * RAJAA_RULES.depositRate) / 500) * 500;
  return Math.min(priceIqd, Math.max(RAJAA_RULES.depositMinIqd, pct));
}

export type RequestDay = 'today' | 'tomorrow';
export const REQUEST_HOURS = [8, 12, 16, 20] as const;

/** The request's `when` from a day chip and an hour chip, on Baghdad wall time. */
export function requestWhen(day: RequestDay, hour: number, now: Date, utcOffsetMin: number = IRAQ_UTC_OFFSET_MIN): Date {
  return new Date(localMidnight(now, utcOffsetMin) + (day === 'tomorrow' ? 24 * HOUR : 0) + hour * HOUR);
}

/** An hour chip is offered for today only while it's still ahead. */
export function requestHourAvailable(day: RequestDay, hour: number, now: Date, utcOffsetMin: number = IRAQ_UTC_OFFSET_MIN): boolean {
  return day === 'tomorrow' || requestWhen(day, hour, now, utcOffsetMin).getTime() > now.getTime();
}

/**
 * A garage or meeting-point name as customers see it (audit C-16): the network config marks places
 * field ops have not verified yet with "(مسودة)" for Ali and ops; customers never see the word. The
 * screens say "مكان تقريبي لحد ما نثبّته" from the `draft` flag instead.
 */
export function publicPlaceName(nameAr: string): string {
  return nameAr.replace(/\s*\(\s*مسودة\s*\)\s*/g, ' ').trim();
}

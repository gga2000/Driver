/**
 * الرجعة — driver side, pure rules behind the garage board, the announce form and the departure
 * screen (partner spec "intercity", customer spec §2, edge-case decisions §8–§9). Plain Node: no
 * React Native here (unit-tested). The server decides every rule; these helpers only arrange what it
 * says (seat → rider, pickup order, what still blocks "انطلقنا", meter money) for the screen.
 *
 * Times: the backend runs on Baghdad wall time (UTC+3 all year), so clock labels take the offset
 * instead of trusting the device's time zone.
 */
import { formatClock } from '@driver/i18n';
import {
  AZIZIYAH_MONEY_RULES,
  type DemandBucket,
  type DepartureRiderName,
  type DriverBookingRow,
  type DriverDepartureView,
  type IntercityDirection,
  type IntercitySeatId,
  type IntercitySeatLayout,
  type IntercityVehicleKind,
  type TravellingAs,
} from '@driver/contracts';

export const IRAQ_UTC_OFFSET_MIN = 180;
const MIN = 60_000;

export const HOME_CITY = 'aziziyah';

/** The two corridors the switch offers, primary first. */
export const CORRIDOR_SWITCH = [
  { id: 'aziziyah_baghdad', cityId: 'baghdad' },
  { id: 'aziziyah_kut', cityId: 'kut' },
] as const;
export type CorridorId = (typeof CORRIDOR_SWITCH)[number]['id'];

export function corridorCity(corridorId: string): string {
  return CORRIDOR_SWITCH.find((c) => c.id === corridorId)?.cityId ?? 'baghdad';
}

/** The city a run in `direction` leaves from. */
export function originCity(corridorCityId: string, direction: IntercityDirection): string {
  return direction === 'from_aziziyah' ? HOME_CITY : corridorCityId;
}

export function destinationCity(corridorCityId: string, direction: IntercityDirection): string {
  return direction === 'from_aziziyah' ? corridorCityId : HOME_CITY;
}

/** Board order of garages (customer app: النهضة; البوابة ١، البوابة ٢، السوق; Kut). */
export const GARAGE_ORDER = ['mp_garage_bab1', 'mp_garage_bab2', 'mp_garage_souq', 'mp_garage_nahdha', 'mp_garage_kut'] as const;

export function garagesFor<G extends { id: string; cityId: string }>(garages: readonly G[], cityId: string): G[] {
  const rank = (id: string) => {
    const i = (GARAGE_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? GARAGE_ORDER.length : i;
  };
  return garages.filter((g) => g.cityId === cityId).sort((a, b) => rank(a.id) - rank(b.id));
}

// ───────────────────────── time ─────────────────────────

function local(at: Date, offsetMin = IRAQ_UTC_OFFSET_MIN): Date {
  return new Date(at.getTime() + offsetMin * MIN);
}

/** "7:30 م": the city's one clock with the part of day (packages/i18n `formatClock`). */
export function clockLabel(at: Date, offsetMin = IRAQ_UTC_OFFSET_MIN): string {
  return formatClock(at, { offsetMin });
}

/** "7:30" without ص/م, for labels that say the part of day in words ("7:30 الصبح"). */
export function clockBare(at: Date, offsetMin = IRAQ_UTC_OFFSET_MIN): string {
  return formatClock(at, { offsetMin, period: false });
}

/** Part of the day the time falls in, so "7:30" never reads as morning or evening by guesswork. */
export type DayPeriod = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
export function dayPeriod(at: Date, offsetMin = IRAQ_UTC_OFFSET_MIN): DayPeriod {
  const h = local(at, offsetMin).getUTCHours();
  if (h < 5) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 15) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 20) return 'evening';
  return 'night';
}

/** "7:00–8:00 م" (the window the demand board counts); the start says its own ص/م when it differs. */
export function windowLabel(start: Date, end: Date, offsetMin = IRAQ_UTC_OFFSET_MIN): string {
  const samePeriod = local(start, offsetMin).getUTCHours() < 12 === local(end, offsetMin).getUTCHours() < 12;
  return `${samePeriod ? clockBare(start, offsetMin) : clockLabel(start, offsetMin)}–${clockLabel(end, offsetMin)}`;
}

/** Whole minutes from `now` to `at` (negative when past). */
export function minutesUntil(at: Date, now: Date): number {
  const ms = at.getTime() - now.getTime();
  return ms >= 0 ? Math.ceil(ms / MIN) : -Math.ceil(-ms / MIN);
}

/** Same Baghdad calendar day? */
export function sameLocalDay(a: Date, b: Date, offsetMin = IRAQ_UTC_OFFSET_MIN): boolean {
  return local(a, offsetMin).toISOString().slice(0, 10) === local(b, offsetMin).toISOString().slice(0, 10);
}

/** "Today" / "tomorrow" / later relative to `now` (for times on the board and the announce form). */
export function dayOffset(at: Date, now: Date, offsetMin = IRAQ_UTC_OFFSET_MIN): number {
  const d = (x: Date) => Math.floor(local(x, offsetMin).getTime() / 86_400_000);
  return d(at) - d(now);
}

// ───────────────────────── announce ─────────────────────────

/** Rules the announce form states; the server enforces the same (intercity.config). */
export const ANNOUNCE_RULES = {
  stepMin: 15,
  /** departAt may be at most 5 min in the past and 48 h ahead. */
  minAheadMin: 5,
  maxAheadHours: 48,
  /** "يطلع الساعة X أو من يكمل": the hard latest departure, at most 120 min after. */
  latestOptionsMin: [15, 30, 60, 90, 120] as const,
  defaultLatestMin: 30,
  /** Low-fill rule at T−30 (the form warns about it). */
  minSeatsAtTMinus30: 3,
  boardingWindowMin: 30,
} as const;

/** The next quarter hour at least `leadMin` from now. */
export function nextSlot(now: Date, leadMin = 30, stepMin: number = ANNOUNCE_RULES.stepMin): Date {
  const step = stepMin * MIN;
  return new Date(Math.ceil((now.getTime() + leadMin * MIN) / step) * step);
}

/** Clamp a chosen departure time into what the server accepts, on the quarter hour. */
export function clampDepart(at: Date, now: Date): Date {
  const min = nextSlot(now, ANNOUNCE_RULES.minAheadMin);
  const max = new Date(now.getTime() + ANNOUNCE_RULES.maxAheadHours * 3600_000);
  const t = Math.min(Math.max(at.getTime(), min.getTime()), max.getTime());
  return new Date(t);
}

/**
 * The default departure time on the announce form: the start of the busiest open demand window in
 * the next 12 h on this side (that is where riders wait), else the next quarter hour 45 min out.
 */
export function suggestedDepart(buckets: readonly DemandBucket[], now: Date): Date {
  const open = buckets
    .filter((b) => b.windowEnd.getTime() > now.getTime() && b.windowStart.getTime() < now.getTime() + 12 * 3600_000)
    .map((b) => ({ b, waiting: openSeats(b) }))
    .filter((x) => x.waiting > 0)
    .sort((a, z) => z.waiting - a.waiting || a.b.windowStart.getTime() - z.b.windowStart.getTime());
  const best = open[0]?.b;
  if (best) return clampDepart(new Date(Math.max(best.windowStart.getTime(), now.getTime())), now);
  return nextSlot(now, 45);
}

/** Seats still asked for in a window (posted minus already claimed into holds). */
export function openSeats(b: Pick<DemandBucket, 'postedSeats' | 'claimedSeats'>): number {
  return Math.max(0, b.postedSeats - b.claimedSeats);
}

export interface VehicleOption {
  kind: IntercityVehicleKind;
  layout: IntercitySeatLayout;
  /** Van 11 is in the spec (decisions §9) but not in the seat-map contract yet. */
  available: boolean;
  key: 'saloon' | 'suv' | 'van7' | 'van11';
  seats: number;
}

export const VEHICLE_OPTIONS: readonly VehicleOption[] = [
  { key: 'saloon', kind: 'saloon', layout: 4, seats: 4, available: true },
  { key: 'suv', kind: 'suv', layout: 6, seats: 6, available: true },
  { key: 'van7', kind: 'van', layout: 7, seats: 7, available: true },
  { key: 'van11', kind: 'van', layout: 7, seats: 11, available: false },
];

/** What the driver keeps of a seat after the platform take (money spec: seat 10 %, front premium 25 %). */
export const SEAT_TAKE = {
  seat: AZIZIYAH_MONEY_RULES.take.intercity_seat.rate,
  frontPremium: AZIZIYAH_MONEY_RULES.take.front_seat_premium.rate,
} as const;

/** A full car's gross and what the driver keeps (every seat sold, front at its premium). */
export function fullCarEarnings(layout: IntercitySeatLayout, seatPriceIqd: number, frontPremiumIqd: number): { grossIqd: number; netIqd: number } {
  const seats = layout;
  const gross = seats * seatPriceIqd + frontPremiumIqd;
  const net = Math.round(seats * seatPriceIqd * (1 - SEAT_TAKE.seat) + frontPremiumIqd * (1 - SEAT_TAKE.frontPremium));
  return { grossIqd: gross, netIqd: net };
}

// ───────────────────────── my departures ─────────────────────────

const LIVE_STATES: ReadonlySet<DriverDepartureView['state']> = new Set(['scheduled', 'boarding', 'departed']);

/** Live runs first by time; then today's finished/cancelled ones, newest first. */
export function splitDepartures(deps: readonly DriverDepartureView[], now: Date): { live: DriverDepartureView[]; past: DriverDepartureView[] } {
  const live = deps.filter((d) => LIVE_STATES.has(d.state)).sort((a, b) => a.departAt.getTime() - b.departAt.getTime());
  // Runs that actually ran or were cancelled; a run closed without ever leaving is not news.
  const past = deps
    .filter((d) => !LIVE_STATES.has(d.state) && (d.departedAt !== null || d.state.startsWith('cancelled')) && now.getTime() - d.departAt.getTime() < 24 * 3600_000)
    .sort((a, b) => b.departAt.getTime() - a.departAt.getTime());
  return { live, past };
}

/** Riders who still need the driver: door pickups waiting for his answer. */
export function pendingPickups(dep: Pick<DriverDepartureView, 'bookings'>): DriverBookingRow[] {
  return dep.bookings.filter((b) => b.state === 'booked' && b.pickup.kind === 'door' && b.pickup.status === 'pending');
}

// ───────────────────────── the seat map ─────────────────────────

export type SeatOccupant =
  | { kind: 'free'; seatId: IntercitySeatId; premiumIqd: number }
  | { kind: 'walkup'; seatId: IntercitySeatId; travellingAs: TravellingAs | null }
  | { kind: 'rider'; seatId: IntercitySeatId; booking: DriverBookingRow; firstName: string | null; status: RiderStatus };

/** What a booked seat shows the driver at a glance. */
export type RiderStatus = 'held' | 'checked_in' | 'at_garage' | 'late' | 'waiting' | 'pickup_pending' | 'no_show' | 'completed';

export function riderStatus(b: DriverBookingRow): RiderStatus {
  if (b.state === 'held') return 'held';
  if (b.state === 'checked_in') return 'checked_in';
  if (b.state === 'completed') return 'completed';
  if (b.state === 'no_show') return 'no_show';
  if (b.pickup.kind === 'door' && b.pickup.status === 'pending') return 'pickup_pending';
  if (b.atGarage) return 'at_garage';
  if (b.meterMinutes !== null && b.meterMinutes > 0) return 'late';
  return 'waiting';
}

/**
 * Seats already boarded: a booking can hold two or three seats (مريم and her sister), so "صعدوا" counts
 * seats, the same unit as "6 من 7 مقاعد" and the green seats on the map — not bookings.
 */
export function boardedSeats(bookings: readonly Pick<DriverBookingRow, 'state' | 'seatIds'>[]): number {
  return bookings.reduce((n, b) => (b.state === 'checked_in' ? n + b.seatIds.length : n), 0);
}

/** Seat → who sits there (booked riders by first name, walk-ups, free seats with their premium). */
export function seatOccupants(dep: Pick<DriverDepartureView, 'seats' | 'bookings' | 'walkUps'>, names: readonly DepartureRiderName[] = []): Map<IntercitySeatId, SeatOccupant> {
  const nameOf = new Map(names.map((n) => [n.bookingId, n.firstName]));
  const out = new Map<IntercitySeatId, SeatOccupant>();
  for (const s of dep.seats) out.set(s.id, { kind: 'free', seatId: s.id, premiumIqd: s.premiumIqd });
  for (const w of dep.walkUps) out.set(w.seatId, { kind: 'walkup', seatId: w.seatId, travellingAs: w.travellingAs });
  for (const b of dep.bookings) {
    if (b.state === 'no_show') continue;
    for (const seatId of b.seatIds) out.set(seatId, { kind: 'rider', seatId, booking: b, firstName: nameOf.get(b.bookingId) ?? null, status: riderStatus(b) });
  }
  return out;
}

/** Riders in the order the driver deals with them: on board, then the late, waiting, held; no-shows last. */
export function manifestOrder(bookings: readonly DriverBookingRow[]): DriverBookingRow[] {
  const rank: Record<RiderStatus, number> = { late: 0, pickup_pending: 1, at_garage: 2, waiting: 3, held: 4, checked_in: 5, completed: 6, no_show: 7 };
  return [...bookings].sort((a, b) => rank[riderStatus(a)] - rank[riderStatus(b)] || a.seatIds[0]!.localeCompare(b.seatIds[0]!));
}

// ───────────────────────── pickups ─────────────────────────

export interface LatLngLike {
  lat: number;
  lng: number;
}

export function haversineM(a: LatLngLike, b: LatLngLike): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PickupStop {
  key: string;
  kind: 'garage' | 'door' | 'meeting_point';
  at: LatLngLike;
  /** Meeting point name; null for doors (the screen names the rider) and the garage. */
  nameAr: string | null;
  note: string | null;
  bookings: DriverBookingRow[];
  /** Straight-line km from the previous stop. */
  legKm: number;
}

/**
 * The pickup run (review C-37): the garage first, then the accepted door pickups nearest-first
 * (they are in the departure town), then the on-the-way meeting points by distance from the garage.
 * Pending door pickups are left out until the driver accepts them; resolved riders drop off.
 */
export function pickupRoute(garage: LatLngLike, bookings: readonly DriverBookingRow[]): PickupStop[] {
  const live = bookings.filter((b) => b.state === 'booked' || b.state === 'checked_in' || b.state === 'held');
  const stops: PickupStop[] = [{ key: 'garage', kind: 'garage', at: garage, nameAr: null, note: null, bookings: live.filter((b) => b.pickup.kind === 'garage'), legKm: 0 }];
  const doors = live.filter((b) => b.pickup.kind === 'door' && b.pickup.status === 'accepted');
  let from: LatLngLike = garage;
  const left = [...doors];
  while (left.length > 0) {
    left.sort((a, b) => haversineM(from, a.pickup) - haversineM(from, b.pickup));
    const next = left.shift()!;
    stops.push({ key: `door:${next.bookingId}`, kind: 'door', at: next.pickup, nameAr: null, note: next.pickup.note, bookings: [next], legKm: haversineM(from, next.pickup) / 1000 });
    from = next.pickup;
  }
  const points = new Map<string, DriverBookingRow[]>();
  for (const b of live) {
    if (b.pickup.kind !== 'meeting_point') continue;
    const key = b.pickup.meetingPointId ?? `${b.pickup.lat},${b.pickup.lng}`;
    points.set(key, [...(points.get(key) ?? []), b]);
  }
  const ordered = [...points.entries()].sort((a, b) => haversineM(garage, a[1][0]!.pickup) - haversineM(garage, b[1][0]!.pickup));
  for (const [key, rows] of ordered) {
    const p = rows[0]!.pickup;
    stops.push({ key: `mp:${key}`, kind: 'meeting_point', at: p, nameAr: p.nameAr, note: null, bookings: rows, legKm: haversineM(from, p) / 1000 });
    from = p;
  }
  return stops;
}

/** True when the run has anything beyond the garage itself. */
export function hasPickupRun(stops: readonly PickupStop[]): boolean {
  return stops.some((s) => s.kind !== 'garage');
}

export function mapsUrl(at: LatLngLike): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${at.lat},${at.lng}`;
}

// ───────────────────────── leaving: "انطلقنا" ─────────────────────────

export interface DepartReadiness {
  canDepart: boolean;
  notCheckedIn: number;
  pickupPending: number;
  /** Before the announced time only a full car may leave. */
  tooEarly: boolean;
}

export function departReadiness(dep: Pick<DriverDepartureView, 'state' | 'departBlockers'>): DepartReadiness {
  const open = dep.state === 'scheduled' || dep.state === 'boarding';
  const notCheckedIn = dep.departBlockers.filter((b) => b.reason === 'not_checked_in').length;
  const pickupPending = dep.departBlockers.filter((b) => b.reason === 'pickup_pending').length;
  const tooEarly = dep.departBlockers.some((b) => b.reason === 'too_early_not_full');
  return { canDepart: open && dep.departBlockers.length === 0, notCheckedIn, pickupPending, tooEarly };
}

// ───────────────────────── garage mode (partner S-5) ─────────────────────────

/** What the "انطلقنا" slide names when it is locked: the first thing still in the way. */
export type DepartBlockerNote = { kind: 'riders'; n: number } | { kind: 'pickup' } | { kind: 'early' } | null;

export function departBlockerNote(r: DepartReadiness): DepartBlockerNote {
  if (r.canDepart) return null;
  if (r.notCheckedIn > 0) return { kind: 'riders', n: r.notCheckedIn };
  if (r.pickupPending > 0) return { kind: 'pickup' };
  if (r.tooEarly) return { kind: 'early' };
  return null;
}

/**
 * The cash a walk-up pays for this seat: the run's seat price plus the seat's premium, both as the
 * server quoted them on the departure (never a price made up on the phone).
 */
export function walkUpCash(dep: Pick<DriverDepartureView, 'seatPriceIqd' | 'seats'>, seatId: IntercitySeatId): number {
  return dep.seatPriceIqd + (dep.seats.find((s) => s.id === seatId)?.premiumIqd ?? 0);
}

/** Seat cell size for the full-screen map: three columns across the phone, 84–124 px wide. */
export function garageCell(screenWidth: number, opts: { gutter?: number; padX?: number; gap?: number } = {}): { w: number; h: number } {
  const { gutter = 16, padX = 14, gap = 8 } = opts;
  const usable = Math.min(screenWidth, 520) - gutter * 2 - padX * 2 - gap * 2;
  const w = Math.max(84, Math.min(124, Math.floor(usable / 3)));
  return { w, h: Math.round(w * 0.96) };
}

/** Seat states drawn on the map, in legend order (only those present are listed). */
export const LEGEND_ORDER = ['checked_in', 'at_garage', 'waiting', 'late', 'held', 'pickup_pending', 'walkup', 'free'] as const;
export type LegendState = (typeof LEGEND_ORDER)[number];

export function legendStates(occupants: Map<IntercitySeatId, SeatOccupant>): LegendState[] {
  const present = new Set<LegendState>();
  for (const o of occupants.values()) {
    if (o.kind === 'free') present.add('free');
    else if (o.kind === 'walkup') present.add('walkup');
    else if (o.status === 'completed') present.add('checked_in');
    else if (o.status !== 'no_show') present.add(o.status);
  }
  return LEGEND_ORDER.filter((s) => present.has(s));
}

// ───────────────────────── late meter ─────────────────────────

/** Late-meter money as the ledger posts it: blocks after the grace, up to the cap (money spec §3). */
export function meterMoney(minutes: number | null, rules = AZIZIYAH_MONEY_RULES.lateMeter): { blocks: number; toDriverIqd: number; graceLeftMin: number; atCap: boolean } {
  if (minutes === null) return { blocks: 0, toDriverIqd: 0, graceLeftMin: rules.graceMin, atCap: false };
  const late = Math.min(minutes, rules.capMin);
  const blocks = late <= rules.graceMin ? 0 : Math.ceil((late - rules.graceMin) / rules.blockMin);
  return { blocks, toDriverIqd: blocks * rules.riderLateToDriverPerBlockIqd, graceLeftMin: Math.max(0, rules.graceMin - minutes), atCap: minutes >= rules.capMin };
}

export const METER_RULES = AZIZIYAH_MONEY_RULES.lateMeter;

// ───────────────────────── PIN pad ─────────────────────────

/** Digits typed on the PIN pad (4 max); `back` deletes. */
export function pinPress(pin: string, key: string): string {
  if (key === 'back') return pin.slice(0, -1);
  if (!/^\d$/.test(key) || pin.length >= 4) return pin;
  return pin + key;
}

// ───────────────────────── request board ─────────────────────────

/** Offers go in steps of 1,000 (review C-50); a stranded rider's post caps the price at her seat price. */
export const OFFER_STEP_IQD = 1_000;

export function clampOffer(price: number, cap: number | null): number {
  const stepped = Math.max(OFFER_STEP_IQD, Math.round(price / OFFER_STEP_IQD) * OFFER_STEP_IQD);
  return cap !== null ? Math.min(stepped, Math.floor(cap / OFFER_STEP_IQD) * OFFER_STEP_IQD) : stepped;
}

/**
 * A starting offer: the cap for stranded riders; the middle of the usual range when real trips gave
 * one (p2, so offers start fair); else a round figure by seats (private car higher).
 */
export function suggestedOffer(post: { priceCapIqd: number | null; seats: number; privateCar: boolean; usualRange?: { lowIqd: number; highIqd: number } | null }): number {
  if (post.priceCapIqd !== null) return clampOffer(post.priceCapIqd, post.priceCapIqd);
  if (post.usualRange) return clampOffer((post.usualRange.lowIqd + post.usualRange.highIqd) / 2, null);
  const base = post.privateCar ? 35_000 : 10_000 * post.seats;
  return clampOffer(base, null);
}

/** w1: the extra-hour price steps like the offer (1,000s); 0 means extra hours are free. */
export const EXTRA_HOUR_MAX_IQD = 50_000;

export function stepExtraHour(current: number | null, delta: 1 | -1): number {
  if (current === null) return delta > 0 ? OFFER_STEP_IQD : 0;
  return Math.max(0, Math.min(EXTRA_HOUR_MAX_IQD, current + delta * OFFER_STEP_IQD));
}

/** Wallet deposit the rider pays on picking an offer (20 % rounded up to 500, min 5,000), as the server does. */
export function depositFor(priceIqd: number): number {
  return Math.min(priceIqd, Math.max(5_000, Math.ceil((priceIqd * 0.2) / 500) * 500));
}

/** What the driver keeps of a private request-board ride (8 % take). */
export function privateRideNet(priceIqd: number): number {
  return Math.round(priceIqd * (1 - AZIZIYAH_MONEY_RULES.take.intercity_private.rate));
}

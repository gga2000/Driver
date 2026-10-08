import { z } from 'zod';
import { DeliveryPoint, Iqd, LatLng, Vertical } from './common.js';
import type { Usual } from './habits-io.js';
import type { Actor } from './identity-io.js';
import { LatePromiseBasis } from './ledger-rules.js';
import { Order } from './order.js';
import { StopState, StopType, TripState, UnreachableStatus, VehicleClass, type TripState as TripStateT } from './trip.js';
import { VehicleColour, VehicleFeature } from './vehicle-features.js';

/** How an ETA was worked out: on real roads (OSRM) or by the straight-line estimate (`travelMinutes`). */
export const EtaBasis = z.enum(['road', 'estimated']);
export type EtaBasis = z.infer<typeof EtaBasis>;

/**
 * Customer-side reads of the live order/ride screen (customer app spec §4). Narrow on purpose: the
 * customer sees their own order, the courier's first name, vehicle and plate, and the courier's
 * position only while the courier is working the job (accept → complete). Nothing else about the
 * courier (phone, full name, other jobs) ever leaves the API.
 */

// ───────────────────────── courier card ─────────────────────────

export const CourierCard = z.object({
  /** First name only (vault read, logged with purpose `courier_card`). Null when none is on file. */
  firstName: z.string().nullable(),
  vehicleClass: VehicleClass.nullable(),
  /** Registered plate of the vehicle he is driving, when the fleet registry has it. */
  plate: z.string().nullable(),
  /** "Toyota Corolla · أبيض" (model + the colour's Arabic name); null when the model is unknown. Kept for older screens. */
  vehicleLabel: z.string().nullable(),
  /** "Toyota Corolla" as the fleet registry has it; null when unknown (ride step 3, d1). */
  vehicleModel: z.string().nullable().default(null),
  /** Body colour, drawn as a real paint dot beside the model (`VEHICLE_COLOUR_HEX`); null when unknown. */
  vehicleColour: VehicleColour.nullable().default(null),
  /** What the car offers, ops-confirmed at the car check only, loud ones first (`sortFeatures`; n1, n2). */
  features: z.array(VehicleFeature).default([]),
  /** His completed trips on every vertical (the card's "1,240 مشوار"). */
  tripCount: z.number().int().min(0).default(0),
  /** His average from customers' courier ratings (newest 50), one decimal; null until he has 5 (`RATING_RULES`). */
  rating: z.number().min(1).max(5).nullable(),
  ratingCount: z.number().int().min(0),
  /** When he last verified himself today (Baghdad day); null = not verified today or unknown. */
  verifiedTodayAt: z.coerce.date().nullable(),
  /** His approved main photo (Ali, 2026-10-06): a short-lived signed URL, absolute or relative to the API origin. */
  photoUrl: z.string().nullable(),
});
export type CourierCard = z.infer<typeof CourierCard>;

/**
 * The courier/driver rating customers see on his card (joy l2, the driver reveal): the delivery scores
 * customers gave him, newest `COURIER_RATING_WINDOW` (the scorecard's window), and only from
 * `COURIER_RATING_MIN_COUNT` of them — one early score is noise, not a reputation.
 */
export const COURIER_RATING_WINDOW = 50;
export const COURIER_RATING_MIN_COUNT = 5;

/** `{ rating, count }` to one decimal, or null below the minimum. Pure; the API feeds it. */
export function publicCourierRating(scores: ReadonlyArray<{ score: number; at: Date }>): { rating: number; count: number } | null {
  const recent = [...scores]
    .filter((s) => s.score >= 1 && s.score <= 5)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, COURIER_RATING_WINDOW);
  if (recent.length < COURIER_RATING_MIN_COUNT) return null;
  const avg = recent.reduce((sum, s) => sum + s.score, 0) / recent.length;
  return { rating: Math.round(avg * 10) / 10, count: recent.length };
}

// ───────────────────────── the tracking view ─────────────────────────

export const TrackStop = z.object({
  id: z.string(),
  seq: z.number().int(),
  type: StopType,
  state: StopState,
  /** True for stops of this order (a batched courier's other drops are hidden; only their count shows). */
  mine: z.boolean(),
  /** Pin of this order's stops only; null for other customers' stops. */
  target: LatLng.nullable(),
  /** My drop-off: the server's first "almost there" fix; a ride's pickup: when the driver was a minute away (d3). Null otherwise. */
  courierNearAt: z.coerce.date().nullable().default(null),
  arrivedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
});
export type TrackStop = z.infer<typeof TrackStop>;

export const TrackTrip = z.object({
  id: z.string(),
  state: TripState,
  acceptedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  stops: z.array(TrackStop),
  /** Other customers' drop-offs before mine (honest batched ETA, dispatch spec §3). */
  dropsBeforeMine: z.number().int().min(0),
  unreachable: UnreachableStatus.nullable(),
  /** The trip's vertical (rides: taxi or tuktuk before a driver accepts). */
  vertical: Vertical.optional(),
  /**
   * s1 «رمز المشوار»: a night ride's 4 digits the rider tells the driver before getting in, until the
   * ride has started. Only on the orderer's and the rider's own screen; null otherwise.
   */
  startCode: z.string().nullable().optional(),
});
export type TrackTrip = z.infer<typeof TrackTrip>;

export const TrackItem = z.object({
  lineId: z.string(),
  name: z.string(),
  qty: z.number().int(),
  /** Line total (unit + modifiers) × qty. */
  totalIqd: z.number().int(),
  participantId: z.string().nullable(),
  note: z.string().nullable(),
});
export type TrackItem = z.infer<typeof TrackItem>;

/**
 * The honest-delay promise on one delivery (audit d-5, `MoneyRules.latePromise`, two steps): past the
 * promised time + `apologyAfterMin` we say sorry once with the new time (`apology`, null until sent);
 * past `deadlineAt` (the promised time + `afterMin`) `creditIqd` comes back as wallet credit, once.
 * `credit` is the credit the ledger posted (null until then): the app's toast and the receipt line
 * read it.
 */
export const LatePromise = z.object({
  afterMin: z.number().int().positive(),
  /** What comes back: the delivery fee this order pays, or the fixed amount when delivery is free. */
  creditIqd: Iqd.positive(),
  /** `delivery_fee`: "أجرة التوصيل ترجعلك"; `flat`: a free-delivery order's fixed credit. */
  basis: LatePromiseBasis,
  deadlineAt: z.coerce.date(),
  credit: z.object({ amountIqd: Iqd.positive(), at: z.coerce.date() }).nullable(),
  /** Minutes past the promised time when the one apology goes out. */
  apologyAfterMin: z.number().int().positive(),
  /** The apology we sent (push + SMS twin): when, and the new time it gave. Null until sent. */
  apology: z.object({ at: z.coerce.date(), etaAt: z.coerce.date() }).nullable(),
});
export type LatePromise = z.infer<typeof LatePromise>;

export const OrderTracking = z.object({
  order: Order,
  items: z.array(TrackItem),
  merchant: z.object({ id: z.string(), name: z.string(), pin: LatLng.nullable() }).nullable(),
  /** Where the order goes (the customer's own place). */
  dropoff: DeliveryPoint.nullable(),
  trip: TrackTrip.nullable(),
  courier: CourierCard.nullable(),
  /** The order lost its courier (driver cancelled / dispatcher moved it) and is being offered again. */
  reassigning: z.boolean(),
  /**
   * The arrival time the customer was promised: kitchen ready time (or now + prep) plus the
   * kitchen → door ride. Fixed once the kitchen accepts; the client compares its live ETA to it.
   */
  promisedAt: z.coerce.date().nullable(),
  /** Points this order earned the customer (posted when it closes); null until then. */
  pointsEarned: z.number().int().min(0).nullable(),
  /** Deliveries with a promised time and a delivery fee: the late-delivery promise and its credit. */
  latePromise: LatePromise.nullable().optional(),
  /** Server time of the read, so the client can correct its clock for countdowns. */
  serverNow: z.coerce.date(),
});
export type OrderTracking = z.infer<typeof OrderTracking>;

// ───────────────────────── order history (طلباتي) ─────────────────────────

/** One dish on a history row: the name as the menu has it (or the line's free text) and how many. */
export const OrderHistoryItem = z.object({
  /** The order line it comes from (reorder matches it back to `order.lines`). */
  lineId: z.string(),
  catalogItemId: z.string().nullable(),
  name: z.string(),
  qty: z.number().int().min(1),
});
export type OrderHistoryItem = z.infer<typeof OrderHistoryItem>;

/**
 * `orders.history` row (audit C-15): the customer's own order with what the list needs to be
 * recognisable at a glance — the restaurant's name and the dishes — without one read per order.
 */
export const OrderHistoryRow = z.object({
  order: Order,
  /** Restaurant / shop name; null for rides, الرجعة seats and orders without a merchant. */
  merchantName: z.string().nullable(),
  /** The live lines (removed ones left out), in order, names resolved. */
  items: z.array(OrderHistoryItem),
  /** Rides, errands, parcels: the zone the trip went to (`aziziyah-zones` key); null otherwise. */
  dropoffZoneKey: z.string().nullable(),
  /** Rides: taxi or tuktuk, from the ride's trip, so the row wears that service's colour (o8); null otherwise. */
  rideVertical: z.enum(['taxi', 'tuktuk']).nullable().optional(),
});
export type OrderHistoryRow = z.infer<typeof OrderHistoryRow>;

/**
 * «أول مرة» (joy g8): the person's very first delivered food order and first finished tuktuk ride,
 * decided by the server from all their orders (not the history page), so the moment can belong to one
 * order only, once in a lifetime. Null until it happens.
 */
export const OrderFirsts = z.object({
  foodOrderId: z.string().nullable(),
  tuktukOrderId: z.string().nullable(),
  /** Ride idea g2: the first taxi or tuktuk ride booked at night, which gets the «وصلت بالسلامة» sticker. */
  nightRideOrderId: z.string().nullable(),
  /** Ride idea g2: the latest finished ride whose count is in `RIDE_STICKER_MILESTONES` (10th, 25th…). */
  rideMilestone: z.object({ orderId: z.string(), count: z.number().int().positive() }).nullable(),
});
export type OrderFirsts = z.infer<typeof OrderFirsts>;

/** Which finished city rides (taxi and tuktuk together) earn a sticker on their arrival screen (ride idea g2). */
export const RIDE_STICKER_MILESTONES = [10, 25, 50, 100] as const;

/** How many orders `orders.history` returns (newest first). */
export const ORDER_HISTORY_LIMIT = 50;

export const CourierPosition = z.object({
  tripId: z.string(),
  pin: LatLng,
  /** Degrees clockwise from north, 0–360; null when the device did not report one. */
  bearing: z.number().min(0).max(360).nullable(),
  speedKmh: z.number().min(0).nullable(),
  /** Device time of the fix. */
  at: z.coerce.date(),
  /** Seconds between the fix and the server's read: the app shows "آخر موقع قبل…" past ~30 s. */
  ageSec: z.number().int().min(0),
  /** When the courier reaches this customer's next step, from the server's ETA service (one ETA everywhere). */
  etaAt: z.coerce.date().nullable().default(null),
  /** `road`: routed on real streets; `estimated`: the straight-line fallback. */
  etaBasis: EtaBasis.nullable().default(null),
});
export type CourierPosition = z.infer<typeof CourierPosition>;

/** The courier's position is visible to the customer only while he works the job. */
export const POSITION_VISIBLE_TRIP_STATES: readonly TripStateT[] = ['accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff'];

export function positionVisible(tripState: TripStateT): boolean {
  return POSITION_VISIBLE_TRIP_STATES.includes(tripState);
}

// ───────────────────────── shared travel estimate ─────────────────────────

/** Town speeds (simulator and dispatch ETA): bike 25, tuktuk 30, car 35 km/h; road ≈ 1.4 × straight line. */
export const TOWN_SPEED_KMH: Readonly<Record<VehicleClass, number>> = { bike: 25, tuktuk: 30, car: 35, suv: 35, van: 30, intercity: 80 };
export const ROAD_FACTOR = 1.4;

/**
 * Routed durations come from OSRM's car profile; other vehicles take this multiple of it in town
 * (drafts until trails calibrate them: tuktuks are slower on main roads, vans slower in alleys).
 */
export const ROUTE_VEHICLE_FACTOR: Readonly<Record<VehicleClass, number>> = { bike: 1, tuktuk: 1.15, car: 1, suv: 1, van: 1.1, intercity: 1 };

/**
 * The one ETA learns from finished legs (maps program f7, spec §5.4): every leg's minutes are the
 * router's estimate × a correction factor kept per zone pair, local-time bucket, vehicle and routing
 * basis — an EWMA of actual ÷ predicted over completed legs. Until OSRM is deployed the router is the
 * straight-line estimate, so this factor is what makes ETAs honest in Aziziyah's streets.
 */
export const ETA_LEARNING_RULES = {
  /**
   * EWMA weight of the newest leg. 0.2 ≈ the last ~10 legs carry the estimate (0.8^10 ≈ 0.11): fast
   * enough to follow a new checkpoint or a closed bridge within a day, slow enough that one courier
   * who took a detour does not swing everyone's ETA.
   */
  alpha: 0.2,
  /** The applied factor never makes a leg faster than 0.7 × or slower than 1.6 × the router (spec §5.4). */
  minFactor: 0.7,
  maxFactor: 1.6,
  /**
   * Baghdad local start hours of the time buckets (each runs to the next start; the last to midnight).
   * Six traffic regimes rather than 24 hours: Aziziyah has a few hundred legs a day, and a 24-way split
   * of every zone pair would never reach `minSamples`. 00–06 empty streets · 06–11 work and the school
   * run · 11–14 lunch and school out · 14–17 the afternoon lull · 17–21 market and the dinner peak ·
   * 21–24 late dinner.
   */
  hourBuckets: [0, 6, 11, 14, 17, 21] as readonly number[],
  /**
   * Legs a cell needs before its factor is used; a younger cell defers to the next level (zone pair in
   * this bucket → zone pair all day → the city in this bucket → the city all day → 1.0). Five legs make
   * one courier's bad day at most a fifth of the start.
   */
  minSamples: 5,
  /**
   * Legs whose actual ÷ predicted falls outside [0.3, 4] are not traffic: a GPS gap, a tap forgotten
   * until the next stop, a courier who stopped for lunch, or a straight line through a river.
   */
  minRatio: 0.3,
  maxRatio: 4,
  /** Legs predicted under 2 minutes are skipped: tap timing, not the street, decides their ratio. */
  minPredictedMin: 2,
  /**
   * The first leg (acceptance → first stop) starts from the courier's first trail point on the trip;
   * a point later than this after the acceptance is not where he accepted, so that leg is skipped.
   */
  firstFixMaxDelayMs: 120_000,
  /**
   * Stop taps are timed on receipt. One whose device time is further than this from its receipt was
   * queued offline (or the phone's clock is off): its time is the network's, not the street's, and the
   * leg it ends or starts is skipped.
   */
  maxTapDelayMs: 60_000,
  /** How long an API instance reuses a city's cells before reading them again (learning on this instance clears it at once). */
  cacheMs: 60_000,
} as const;

/**
 * Verticals whose legs teach the ETA: on-demand trips that drive straight to the next stop. الرجعة
 * (intercity) and خطوط (khat) runs wait at stops by timetable and leave the zones.
 */
export const ETA_LEARNING_VERTICALS: readonly Vertical[] = ['food', 'grocery', 'errand', 'parcel', 'taxi', 'tuktuk'];

/** A batched courier's other drop before mine costs about this much (dispatch spec §3: ≤ 4 min). */
export const MIN_PER_EARLIER_DROP = 4;

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes to ride from a to b in town (road factor applied), at least one. */
export function travelMinutes(a: LatLng, b: LatLng, vehicle: VehicleClass = 'bike'): number {
  const km = (haversineM(a, b) * ROAD_FACTOR) / 1000;
  return Math.max(1, Math.round((km / TOWN_SPEED_KMH[vehicle]) * 60));
}

// ───────────────────────── port ─────────────────────────

/** What the API supplies for the customer's live screen (implemented by `modules/tracking`). */
/**
 * The road the courier still drives for this customer (maps program SP5a): from his position (or the
 * kitchen before anyone has the order) through this order's remaining stops. `polyline6` is null when
 * no road router is configured or there is nothing to draw — the app then draws straight lines.
 */
export const OrderRoute = z.object({
  polyline6: z.string().nullable(),
  basis: EtaBasis,
  /** The point the route starts from (his fix when it was computed). */
  from: LatLng.nullable(),
  computedAt: z.coerce.date(),
});
export type OrderRoute = z.infer<typeof OrderRoute>;

export interface TrackingPort {
  /** Console: live orders of the city whose predicted arrival is past the promise (maps program o4), latest first. */
  atRisk(cityId: string): Promise<Array<{ orderId: string; predictedAt: Date; promisedAt: Date; lateByMin: number }>>;
  /** The orderer or a participant only. */
  track(actor: Actor, input: { orderId: string }): Promise<OrderTracking>;
  /** The orderer or a participant only; null outside accept → complete or before the first fix. */
  courierPosition(actor: Actor, input: { orderId: string }): Promise<CourierPosition | null>;
  /** The actor's own orders, newest first (at most `ORDER_HISTORY_LIMIT`), with names for the list. */
  history(actor: Actor): Promise<OrderHistoryRow[]>;
  /** Joy g8: which of the actor's orders were their first delivered meal and first tuktuk ride. */
  firsts(actor: Actor): Promise<OrderFirsts>;
  /** Joy s3: the actor's usual orders (same kitchen and dishes, same weekday/time band), with why. */
  usuals(actor: Actor): Promise<Usual[]>;
  /** The orderer or a participant only: the road still ahead for this order. */
  route(actor: Actor, input: { orderId: string }): Promise<OrderRoute>;
}

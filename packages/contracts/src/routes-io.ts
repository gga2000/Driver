import { z } from 'zod';
import { CityId, Iqd, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import type { CallSession } from './chat-io.js';
import type { SafetyCallSession } from './safety-io.js';
import type { OverdueDeparture, OverdueDeparturesInput, StaffDepartureDriver, StaffDepartureDriversInput, StaffDepartureInput, StaffDepartureResult } from './departure-staff-io.js';
import { modelFitsLayout, VehicleModelKey } from './vehicle-models.js';

/**
 * الرجعة — the intercity system (customer spec §2, domain §2 Departure/Seat, edge-case decisions
 * §8–§9, edge-case review C). IO of the `routes` router: garages and corridors, the live departure
 * board, seat holds and bookings, PIN check-in, the demand board ("أريد أرجع") and the request board
 * (other destinations / private cars). The API implements `RoutesPort` in `modules/routes`.
 *
 * Seat ids and layouts are the ones `@driver/ui`'s SeatMap draws (4 saloon, 6 SUV, 7 van), so a
 * board seat drops straight into the component.
 */

// ───────────────────────── vocabulary ─────────────────────────

/** Physical seat ids (top-down, front at the top); double as `seat.*` i18n keys. */
export const IntercitySeatId = z.enum([
  'front',
  'back_left',
  'back_middle',
  'back_right',
  'middle_left',
  'middle_middle',
  'middle_right',
  'rear_left',
  'rear_middle',
  'rear_right',
]);
export type IntercitySeatId = z.infer<typeof IntercitySeatId>;

/** Seat map per vehicle (decisions §9): saloon 4, SUV 6, van 7. */
export const IntercitySeatLayout = z.union([z.literal(4), z.literal(6), z.literal(7)]);
export type IntercitySeatLayout = z.infer<typeof IntercitySeatLayout>;

export const IntercityVehicleKind = z.enum(['saloon', 'suv', 'van']);
export type IntercityVehicleKind = z.infer<typeof IntercityVehicleKind>;

/** A row a rider may book whole ("book the row"). */
export const IntercityRow = z.enum(['back', 'middle', 'rear']);
export type IntercityRow = z.infer<typeof IntercityRow>;

/** Travelling-as declaration at booking (decisions §9): رجال / نساء / عائلة. */
export const TravellingAs = z.enum(['rijal', 'nisa', 'aila']);
export type TravellingAs = z.infer<typeof TravellingAs>;

/** Relative to Aziziyah: الرجعة is `to_aziziyah`; the reverse leaves from the three Aziziyah garages. */
export const IntercityDirection = z.enum(['to_aziziyah', 'from_aziziyah']);
export type IntercityDirection = z.infer<typeof IntercityDirection>;

/** Domain §2: `scheduled → boarding (T−30) → departed → arrived → closed`; exits cancelled_by_driver, cancelled_low_fill. */
export const IntercityDepartureState = z.enum([
  'scheduled',
  'boarding',
  'departed',
  'arrived',
  'closed',
  'cancelled_by_driver',
  'cancelled_low_fill',
]);
export type IntercityDepartureState = z.infer<typeof IntercityDepartureState>;

/**
 * A rider's booking of one or more seats on a departure (domain §2 Seat): `held (10 min, unpaid) →
 * booked → checked_in → completed`; exits `cancelled_by_rider`, `no_show`, `moved` (to another
 * departure), `expired` (hold lapsed) and `cancelled` (departure cancelled with no car to move to).
 */
export const BookingState = z.enum([
  'held',
  'booked',
  'checked_in',
  'completed',
  'cancelled_by_rider',
  'no_show',
  'moved',
  'expired',
  'cancelled',
]);
export type BookingState = z.infer<typeof BookingState>;

/** How a booking was created. */
export const BookingOrigin = z.enum(['rider', 'demand_claim', 'moved', 'forfeit_hold']);
export type BookingOrigin = z.infer<typeof BookingOrigin>;

export const SeatPayment = z.enum(['wallet', 'cash']);
export type SeatPayment = z.infer<typeof SeatPayment>;

/**
 * Launch prepay rails (review C-35), stated on the boarding pass: paid from the wallet (ZainCash
 * top-ups land there), trusted rider (three completed seats: a cash seat with prepaid rights), or a
 * plain cash reservation (3-minute grace, no meter, rights lost after two no-shows).
 */
export const PrepayRail = z.enum(['wallet', 'trusted_cash', 'cash_reservation']);
export type PrepayRail = z.infer<typeof PrepayRail>;

/** What the board shows on a seat (the SeatMap's states). */
export const BoardSeatState = z.enum(['free', 'held', 'taken', 'walkup']);
export type BoardSeatState = z.infer<typeof BoardSeatState>;

// ───────────────────────── network: garages, corridors, meeting points ─────────────────────────

export const GarageView = z.object({
  id: z.string(),
  cityId: CityId,
  nameAr: z.string(),
  nameEn: z.string(),
  lat: z.number(),
  lng: z.number(),
  /** Late meter and "أني بالكراج" geofence (decisions §8: 150 m). */
  geofenceM: z.number().int(),
  /** Pin or name not yet verified on the ground. */
  draft: z.boolean(),
});
export type GarageView = z.infer<typeof GarageView>;

export const MeetingPointView = z.object({
  id: z.string(),
  corridorId: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  lat: z.number(),
  lng: z.number(),
  /** On-the-way pickup fee (+1,000–2,000). */
  feeIqd: Iqd,
  photoUrl: z.string().nullable(),
  draft: z.boolean(),
});
export type MeetingPointView = z.infer<typeof MeetingPointView>;

/** A police checkpoint on the road (idea r1: on the trip's road line); its geofence stays on the server. */
export const CheckpointView = z.object({
  id: z.string(),
  nameAr: z.string(),
  lat: z.number(),
  lng: z.number(),
  draft: z.boolean(),
});
export type CheckpointView = z.infer<typeof CheckpointView>;

export const CorridorView = z.object({
  id: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  primary: z.boolean(),
  /** The far end; the near end is always Aziziyah. */
  cityId: CityId,
  seatPriceIqd: Iqd,
  frontPremiumIqd: Iqd,
  travelMin: z.number().int(),
  /** True while the fare is a placeholder awaiting Ali's real fares. */
  placeholderPrice: z.boolean(),
  meetingPoints: z.array(MeetingPointView),
  /** Checkpoints on the road, in no particular order (the app orders them by the direction). */
  checkpoints: z.array(CheckpointView).default([]),
});
export type CorridorView = z.infer<typeof CorridorView>;

export const IntercityNetwork = z.object({
  garages: z.array(GarageView),
  corridors: z.array(CorridorView),
});
export type IntercityNetwork = z.infer<typeof IntercityNetwork>;

// ───────────────────────── pickups ─────────────────────────

/** Where the rider boards: the garage, an on-the-way meeting point, or the door (driver accepts). */
export const PickupChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('garage') }),
  z.object({ kind: z.literal('meeting_point'), meetingPointId: z.string().min(1) }),
  z.object({
    kind: z.literal('door'),
    lat: LatLng.shape.lat,
    lng: LatLng.shape.lng,
    note: z.string().max(200).optional(),
  }),
]);
export type PickupChoice = z.infer<typeof PickupChoice>;

export const PickupStatus = z.enum(['accepted', 'pending', 'declined']);
export type PickupStatus = z.infer<typeof PickupStatus>;

export const PickupView = z.object({
  kind: z.enum(['garage', 'meeting_point', 'door']),
  meetingPointId: z.string().nullable(),
  nameAr: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  note: z.string().nullable(),
  feeIqd: Iqd,
  /** Door pickups wait for the driver; garage and meeting points are accepted. */
  status: PickupStatus,
  /** Door pickups: the driver's detour (both ways) the driver sees before accepting. */
  detourMin: z.number().int().nullable(),
});
export type PickupView = z.infer<typeof PickupView>;

// ───────────────────────── the board ─────────────────────────

export const BoardSeat = z.object({
  id: IntercitySeatId,
  state: BoardSeatState,
  /** Front seat +2,000 (only where a front seat exists). */
  premiumIqd: Iqd,
  /** Viewer-specific: why this free seat can't be sold to the viewer (null = selectable). */
  blocked: z.enum(['adjacency', 'family_only']).nullable(),
});
export type BoardSeat = z.infer<typeof BoardSeat>;

export const DepartureFill = z.object({
  seatsTotal: z.number().int(),
  booked: z.number().int(),
  held: z.number().int(),
  walkUps: z.number().int(),
  /** Walk-ups count toward fill only after the driver's per-run selfie (review C-33). */
  walkUpsCounted: z.number().int(),
  /** Booked + counted walk-ups: what the T−30 low-fill rule reads. */
  filled: z.number().int(),
  free: z.number().int(),
});
export type DepartureFill = z.infer<typeof DepartureFill>;

export const IntercityVehicle = z.object({
  kind: IntercityVehicleKind,
  layout: IntercitySeatLayout,
  plate: z.string(),
  /** The listed model (`vehicle-models.ts`); null on runs announced before the list existed. */
  modelKey: VehicleModelKey.nullable().default(null),
  /** Free text: the model when `modelKey` is `other` (or a pre-list run). */
  model: z.string().nullable(),
  color: z.string().nullable(),
  /** The driver's word for this run (idea x15): nobody smokes in the car → «ما يدخن». */
  noSmoking: z.boolean().default(false),
  /** The driver's word for this run: the boot takes big suitcases → «جناط كبيرة». */
  bigBags: z.boolean().default(false),
  /** The driver's word for this run (idea b7): the AC works (cool in summer, warm in winter) → «مكيّفة». */
  ac: z.boolean().default(false),
});
export type IntercityVehicle = z.infer<typeof IntercityVehicle>;

export const DepartureCard = z.object({
  id: z.string(),
  corridorId: z.string(),
  direction: IntercityDirection,
  garageId: z.string(),
  fromCityId: CityId,
  toCityId: CityId,
  driverId: z.string(),
  vehicle: IntercityVehicle,
  /** "يطلع الساعة X أو من يكمل": announced time, the late-meter reference (decisions §8). */
  departAt: z.coerce.date(),
  /** Hard latest departure (review C-31). */
  latestDepartureAt: z.coerce.date(),
  state: IntercityDepartureState,
  familyOnly: z.boolean(),
  seatPriceIqd: Iqd,
  frontPremiumIqd: Iqd,
  seats: z.array(BoardSeat),
  fill: DepartureFill,
  frontSeat: z.enum(['free', 'held', 'taken', 'walkup', 'none']),
  /** Door pickups still available on this run (max 2, ≤ 15 min total detour). */
  doorPickupsLeft: z.number().int(),
  meetingPoints: z.array(MeetingPointView),
});
export type DepartureCard = z.infer<typeof DepartureCard>;

export const BoardInput = z
  .object({
    garageId: z.string().min(1).optional(),
    corridorId: z.string().min(1).optional(),
    direction: IntercityDirection.optional(),
    /** Window (default: now → +12 h). */
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Lets the board mark seats the viewer can't take (adjacency, family-only). */
    travellingAs: TravellingAs.optional(),
  })
  .refine((b) => Boolean(b.garageId) || (Boolean(b.corridorId) && Boolean(b.direction)), {
    message: 'garageId, or corridorId with direction',
  });
export type BoardInput = z.infer<typeof BoardInput>;

export const DemandBucket = z.object({
  /** Null: "any garage in the city". */
  garageId: z.string().nullable(),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  /** Seats asked for in open posts. */
  postedSeats: z.number().int(),
  /** Seats claimed (converted into holds/bookings) — drivers see claimed vs posted (review C-34). */
  claimedSeats: z.number().int(),
  posts: z.number().int(),
});
export type DemandBucket = z.infer<typeof DemandBucket>;

export const IntercityBoard = z.object({
  garage: GarageView.nullable(),
  departures: z.array(DepartureCard),
  demand: z.array(DemandBucket),
});
export type IntercityBoard = z.infer<typeof IntercityBoard>;

// ───────────────────────── bookings ─────────────────────────

export const SeatSelection = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seats'), seatIds: z.array(IntercitySeatId).min(1).max(7) }),
  /** "Book the row". */
  z.object({ kind: z.literal('row'), row: IntercityRow }),
  /** "Book the car". */
  z.object({ kind: z.literal('car') }),
]);
export type SeatSelection = z.infer<typeof SeatSelection>;

export const HoldSeatInput = z.object({
  departureId: z.string().min(1),
  selection: SeatSelection,
  travellingAs: TravellingAs,
  pickup: PickupChoice.default({ kind: 'garage' }),
  /** Large bags declared at booking (review C-43). */
  largeBags: z.boolean().default(false),
});
export type HoldSeatInput = z.input<typeof HoldSeatInput>;

export const BookSeatInput = z.object({ bookingId: z.string().min(1), payment: SeatPayment });
export type BookSeatInput = z.infer<typeof BookSeatInput>;

export const BookingIdInput = z.object({ bookingId: z.string().min(1) });
export type BookingIdInput = z.infer<typeof BookingIdInput>;

export const DepartureSummary = z.object({
  id: z.string(),
  corridorId: z.string(),
  /** The corridor's far city (Baghdad, Kut), so a ticket names its road even when the network read fails. */
  cityId: CityId.optional(),
  direction: IntercityDirection,
  garageId: z.string(),
  departAt: z.coerce.date(),
  latestDepartureAt: z.coerce.date(),
  state: IntercityDepartureState,
  /** When the car actually left (the pass on the road says «طلعت 7:24»); null before. */
  departedAt: z.coerce.date().nullable().default(null),
  vehicle: IntercityVehicle,
  driverId: z.string(),
});
export type DepartureSummary = z.infer<typeof DepartureSummary>;

/**
 * «شلون كانت الرجعة؟» (joy r2, audit R-04): the rider's chips under the stars after a completed trip —
 * the good ones (on time, calm driving, clean car, respectful) and, at 3★ or less, what went wrong
 * (late, fast driving, jumped the queue).
 */
export const RajaaRatingTag = z.enum(['on_time', 'calm_driving', 'clean_car', 'respectful', 'late', 'fast_driving', 'queue_jump']);
export type RajaaRatingTag = z.infer<typeof RajaaRatingTag>;
export const RAJAA_GOOD_TAGS: readonly RajaaRatingTag[] = ['on_time', 'calm_driving', 'clean_car', 'respectful'];
export const RAJAA_LOW_TAGS: readonly RajaaRatingTag[] = ['late', 'fast_driving', 'queue_jump'];
/** Stars at or under this ask what went wrong. */
export const RAJAA_LOW_STARS = 3;

/**
 * «كلمة عن السفرة» (idea x14, Ali 2026-10-07): one optional line under the stars. Other riders read it on
 * the driver's profile without the writer's name, newest first; ops can hide one (`routes.hideReview`).
 */
export const RAJAA_REVIEW_MAX = 140;

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Why a review line can't be posted as written, or null. Reviews are public, so they must not carry a
 * way to reach someone off the app: a phone number (7+ digits, Western or Arabic-Indic, spaces and
 * dashes between them ignored), a link, or an @handle. Checked on the server and, for an inline hint,
 * in the app.
 */
export function reviewTextProblem(text: string): 'contact' | null {
  const western = text.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) & 0xf));
  if (/\d(?:[\s\-.\u200f\u200e]*\d){6,}/.test(western)) return 'contact';
  if (/(?:https?:\/\/|www\.)|\b[a-z0-9-]+\.(?:com|net|org|iq|me|ly|link)\b/i.test(western)) return 'contact';
  if (/(?:^|\s)@[a-z0-9_.]{3,}/i.test(western)) return 'contact';
  return null;
}

export const BookingRating = z.object({
  stars: z.number().int().min(1).max(5),
  tags: z.array(RajaaRatingTag),
  /** The rider's one line, as he wrote it; null when he wrote none. */
  comment: z.string().nullable().default(null),
  at: z.coerce.date(),
});
export type BookingRating = z.infer<typeof BookingRating>;

/** Once, on the rider's own completed booking. An empty line is no line. */
export const RateBookingInput = z.object({
  bookingId: z.string().min(1),
  stars: z.number().int().min(1).max(5),
  tags: z.array(RajaaRatingTag).max(7).default([]),
  comment: z
    .string()
    .trim()
    .max(RAJAA_REVIEW_MAX)
    .optional()
    .transform((c) => (c ? c : undefined)),
});
export type RateBookingInput = z.input<typeof RateBookingInput>;

export const BookingView = z.object({
  id: z.string(),
  departureId: z.string(),
  riderId: z.string(),
  state: BookingState,
  origin: BookingOrigin,
  seatIds: z.array(IntercitySeatId),
  travellingAs: TravellingAs,
  /** Per seat, after any move (a moved rider never pays more). */
  seatPriceIqd: Iqd,
  frontPremiumIqd: Iqd,
  pickupFeeIqd: Iqd,
  totalIqd: Iqd,
  payment: SeatPayment.nullable(),
  prepaid: z.boolean(),
  prepayRail: PrepayRail.nullable(),
  heldUntil: z.coerce.date().nullable(),
  /** The rider's boarding PIN; shown to the rider only. */
  pin: z.string().nullable(),
  pickup: PickupView,
  largeBags: z.boolean(),
  movedToBookingId: z.string().nullable(),
  movedFromBookingId: z.string().nullable(),
  checkedInAt: z.coerce.date().nullable(),
  lateMinutes: z.number().int().nullable(),
  departure: DepartureSummary,
  createdAt: z.coerce.date(),
  /** r2: when the trip completed (the car arrived); null before. */
  completedAt: z.coerce.date().nullable().default(null),
  /** r2: the rider's rating, once given. */
  rating: BookingRating.nullable().default(null),
  /** r2: points this trip earned (ledger), once posted; null before or when none. */
  pointsEarned: z.number().int().nullable().default(null),
});
export type BookingView = z.infer<typeof BookingView>;

export const LiveCar = z.object({ lat: z.number(), lng: z.number(), at: z.coerce.date() });
export type LiveCar = z.infer<typeof LiveCar>;

/** Boarding pass (customer spec §2): PIN, seat, live car, wait-for-me, share. Opens at T−30. */
export const BoardingPass = z.object({
  bookingId: z.string(),
  departureId: z.string(),
  pin: z.string(),
  seatIds: z.array(IntercitySeatId),
  garage: GarageView,
  departAt: z.coerce.date(),
  latestDepartureAt: z.coerce.date(),
  /** T−30 reached: the car's position is shared from here until arrival (review C-45). */
  boardingOpen: z.boolean(),
  prepayRail: PrepayRail,
  /** The car only, never the stop list; null outside the sharing window or before the first fix. */
  car: LiveCar.nullable(),
  /** The rider's own stop only. */
  myStop: PickupView,
  vehicle: IntercityVehicle,
  driverId: z.string(),
  /** Path the app turns into a share-trip link. */
  sharePath: z.string(),
  /** "لا تنسى البطاقة" (review C-44). */
  idReminder: z.literal(true),
  /** Late meter: when the grace ends for this rider (null when no meter applies). */
  graceEndsAt: z.coerce.date().nullable(),
  /** Minutes on the rider's meter right now (null when it is not running). */
  meterMinutes: z.number().int().nullable(),
});
export type BoardingPass = z.infer<typeof BoardingPass>;

/** Rider's "أني بالكراج" / "I'm at the point" ping. */
export const ImHereInput = z.object({
  bookingId: z.string().min(1),
  lat: LatLng.shape.lat,
  lng: LatLng.shape.lng,
});
export type ImHereInput = z.infer<typeof ImHereInput>;
export const ImHereOutput = z.object({
  /** Inside the garage geofence: blocks a no-show from here on (review C-32). */
  atGarage: z.boolean(),
  /** Distance from the chosen meeting point / door (m); null for garage pickups. */
  distanceM: z.number().int().nullable(),
  /** > 300 m from the chosen meeting point (review C-36): rider and driver are warned. */
  warning: z.enum(['meeting_point_mismatch']).nullable(),
});
export type ImHereOutput = z.infer<typeof ImHereOutput>;

// ───────────────────────── demand board ─────────────────────────

export const DemandPickup = z.discriminatedUnion('kind', [
  /** A garage, or any garage in the departure city when `garageId` is absent. */
  z.object({ kind: z.literal('garage'), garageId: z.string().min(1).optional() }),
  z.object({ kind: z.literal('meeting_point'), meetingPointId: z.string().min(1) }),
  z.object({
    kind: z.literal('door'),
    lat: LatLng.shape.lat,
    lng: LatLng.shape.lng,
    note: z.string().max(200).optional(),
  }),
]);
export type DemandPickup = z.infer<typeof DemandPickup>;

export const PostDemandInput = z
  .object({
    corridorId: z.string().min(1),
    direction: IntercityDirection,
    windowStart: z.coerce.date(),
    windowEnd: z.coerce.date(),
    seats: z.number().int().min(1).max(4),
    travellingAs: TravellingAs,
    pickup: DemandPickup.default({ kind: 'garage' }),
  })
  .refine((d) => d.windowEnd.getTime() > d.windowStart.getTime(), {
    message: 'windowEnd after windowStart',
    path: ['windowEnd'],
  });
export type PostDemandInput = z.input<typeof PostDemandInput>;

export const DemandPostState = z.enum(['open', 'claimed', 'expired', 'cancelled', 'lapsed']);
export type DemandPostState = z.infer<typeof DemandPostState>;

export const DemandPostView = z.object({
  id: z.string(),
  riderId: z.string(),
  corridorId: z.string(),
  direction: IntercityDirection,
  garageId: z.string().nullable(),
  pickupKind: z.enum(['garage', 'meeting_point', 'door']),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  seats: z.number().int(),
  travellingAs: TravellingAs,
  state: DemandPostState,
  /** The hold a driver's announcement converted this post into. */
  bookingId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type DemandPostView = z.infer<typeof DemandPostView>;

export const DemandPostIdInput = z.object({ postId: z.string().min(1) });
export type DemandPostIdInput = z.infer<typeof DemandPostIdInput>;

export const DemandBoardInput = z.object({
  corridorId: z.string().min(1),
  direction: IntercityDirection,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type DemandBoardInput = z.infer<typeof DemandBoardInput>;

// ───────────────────────── request board ─────────────────────────

/** y2: the places most private trips from Aziziyah go to, picked with one tap (the app's chips). */
export const RequestPlaceId = z.enum(['baghdad_airport', 'karbala', 'najaf', 'kut', 'medical_city']);
export type RequestPlaceId = z.infer<typeof RequestPlaceId>;

export const RequestPlace = z.object({
  label: z.string().min(1).max(120),
  lat: LatLng.shape.lat.optional(),
  lng: LatLng.shape.lng.optional(),
  garageId: z.string().min(1).optional(),
  /** Set when the place came from a chip: the usual price range (p1) is kept per known place. */
  placeId: RequestPlaceId.optional(),
});
export type RequestPlace = z.infer<typeof RequestPlace>;

/**
 * What kind of trip a private-car request is (idea y1, Ali 2026-10-07): one way; there and back the
 * same day with the driver waiting some hours; or there one day and back on another (within a week).
 */
export const RequestTripKind = z.enum(['one_way', 'wait_return', 'two_days']);
export type RequestTripKind = z.infer<typeof RequestTripKind>;

/** Hours a driver may be asked to wait on a same-day return. */
export const REQUEST_WAIT_HOURS_MAX = 12;
/** A two-day trip comes back within this many days. */
export const REQUEST_RETURN_DAYS_MAX = 7;

/** The request's details the drivers price on (y1): trip kind, big bags, the car wanted. */
export const RequestDetails = z.object({
  trip: RequestTripKind.default('one_way'),
  /** `wait_return`: how long the driver waits before the way back. */
  waitHours: z.number().int().min(1).max(REQUEST_WAIT_HOURS_MAX).nullable().default(null),
  /** `two_days`: when to come back. */
  returnAt: z.coerce.date().nullable().default(null),
  /** Suitcases that need the boot. */
  bigBags: z.number().int().min(0).max(7).default(0),
  /** The car wanted; null = any. */
  carKind: IntercityVehicleKind.nullable().default(null),
  /** The rider wants the AC working. */
  ac: z.boolean().default(false),
});
export type RequestDetails = z.infer<typeof RequestDetails>;
export const DEFAULT_REQUEST_DETAILS: RequestDetails = { trip: 'one_way', waitHours: null, returnAt: null, bigBags: 0, carKind: null, ac: false };

/** Why a request's details don't hold together (checked on the server and, for the form, the app). */
export function requestDetailsProblem(d: RequestDetails, when: Date): 'wait_hours_needed' | 'return_needed' | 'return_too_early' | 'return_too_late' | null {
  if (d.trip === 'wait_return' && d.waitHours === null) return 'wait_hours_needed';
  if (d.trip !== 'two_days') return null;
  if (!d.returnAt) return 'return_needed';
  if (d.returnAt.getTime() <= when.getTime() + 3_600_000) return 'return_too_early';
  if (d.returnAt.getTime() > when.getTime() + REQUEST_RETURN_DAYS_MAX * 86_400_000) return 'return_too_late';
  return null;
}

export const PostRequestInput = z
  .object({
    from: RequestPlace,
    to: RequestPlace,
    when: z.coerce.date(),
    seats: z.number().int().min(1).max(7),
    /** Whole car for the rider (8 % take) vs seats to another destination. */
    privateCar: z.boolean().default(true),
    travellingAs: TravellingAs,
    note: z.string().max(300).optional(),
    details: RequestDetails.default(DEFAULT_REQUEST_DETAILS),
  })
  .superRefine((v, ctx) => {
    const problem = requestDetailsProblem(v.details, v.when);
    if (problem) ctx.addIssue({ code: 'custom', path: ['details'], message: problem });
  });
export type PostRequestInput = z.input<typeof PostRequestInput>;

export const RequestState = z.enum([
  'open',
  'matched',
  'driver_arrived',
  'completed',
  'cancelled',
  'expired',
  'rider_no_show',
  'driver_no_show',
]);
export type RequestState = z.infer<typeof RequestState>;

/**
 * Who offers on a request, as the rider sees him (R-01, C-19): first name only (identity vault,
 * purpose `intercity_driver_card`), whether he did a run's selfie check-in today, his car as on his
 * latest departure, and his approved main photo (Ali, 2026-10-06; null → the app draws his initial).
 * Null on a driver's own view of the board.
 */
export const RequestOfferDriver = z.object({
  firstName: z.string().nullable(),
  verifiedTodayAt: z.coerce.date().nullable(),
  /** Short-lived signed URL (absolute, or relative to the API origin); only an approved photo. */
  photoUrl: z.string().nullable(),
  vehicle: IntercityVehicle.nullable(),
  /** His record on الرجعة runs (y5: rating, trips, on-time); null on a driver's own view. */
  stats: z.lazy(() => RajaaDriverStats).nullable().default(null),
  /** Private trips (request board) he completed (y5). */
  privateTrips: z.number().int().nonnegative().default(0),
});
export type RequestOfferDriver = z.infer<typeof RequestOfferDriver>;

/**
 * w1 (Ali 2026-10-07): on a «يستناك وترجع» trip each driver says in his offer how many hours of
 * waiting his price includes and what each extra hour costs; no app-wide number. Shown on his card.
 */
export const OfferWaitTerms = z.object({
  includedHours: z.number().int().min(0).max(REQUEST_WAIT_HOURS_MAX),
  /** 0 = extra hours free; otherwise in multiples of 1,000 like the offer. */
  extraHourIqd: Iqd.min(0).max(50_000),
});
export type OfferWaitTerms = z.infer<typeof OfferWaitTerms>;

/** Trip kinds whose offers must carry waiting terms. */
export function offerNeedsWaitTerms(d: RequestDetails): boolean {
  return d.trip === 'wait_return';
}

/**
 * p1–p3 (Ali 2026-10-07): «عادةً بين … و …» from real finished private trips only, to the same known
 * place with the same trip kind, at least 5 in the last 90 days; never a made-up number. The middle
 * of what people paid (20th to 80th percentile), rounded to 1,000.
 */
export const UsualRange = z.object({
  lowIqd: Iqd,
  highIqd: Iqd,
  /** How many finished trips it comes from. */
  trips: z.number().int().positive(),
});
export type UsualRange = z.infer<typeof UsualRange>;

export const USUAL_RANGE_MIN_TRIPS = 5;
export const USUAL_RANGE_DAYS = 90;
/** p3: an offer more than a quarter above the top of the range gets a soft «أغلى من المعتاد». */
export const PRICIER_THAN_USUAL = 1.25;

export function pricierThanUsual(priceIqd: number, range: UsualRange | null | undefined): boolean {
  return range != null && priceIqd > range.highIqd * PRICIER_THAN_USUAL;
}

/** The range from finished trips' prices (null below the minimum count). */
export function usualRangeOf(prices: readonly number[]): UsualRange | null {
  if (prices.length < USUAL_RANGE_MIN_TRIPS) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  // Nearest-rank percentiles, so every bound is a price someone actually paid before rounding.
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
  const round = (v: number) => Math.max(1_000, Math.round(v / 1_000) * 1_000);
  return { lowIqd: round(at(0.2)), highIqd: round(at(0.8)), trips: sorted.length };
}

export const RequestOfferView = z.object({
  id: z.string(),
  driverId: z.string(),
  priceIqd: Iqd,
  /** w1: what his price includes on a «يستناك وترجع» trip; null on other trips. */
  wait: OfferWaitTerms.nullable().default(null),
  at: z.coerce.date(),
  state: z.enum(['open', 'picked', 'withdrawn', 'lost']),
  driver: RequestOfferDriver.nullable(),
});
export type RequestOfferView = z.infer<typeof RequestOfferView>;

export const RequestPostView = z.object({
  id: z.string(),
  riderId: z.string(),
  from: RequestPlace,
  to: RequestPlace,
  when: z.coerce.date(),
  seats: z.number().int(),
  privateCar: z.boolean(),
  travellingAs: TravellingAs,
  note: z.string().nullable(),
  details: RequestDetails.default(DEFAULT_REQUEST_DETAILS),
  /** p1/p2: what this trip usually costs, for the rider and the drivers offering; null when not known. */
  usualRange: UsualRange.nullable().default(null),
  /** «9 سواق شافوا طلبك» (y4): drivers who opened this request; only the rider sees it. */
  seenBy: z.number().int().nonnegative().default(0),
  state: RequestState,
  /** `stranded`: opened by the platform at the seat price for a forfeited or stranded rider (review C-40/46). */
  origin: z.enum(['rider', 'stranded']),
  /** Ceiling for stranded riders (the seat price they had). */
  priceCapIqd: Iqd.nullable(),
  offers: z.array(RequestOfferView),
  pickedOfferId: z.string().nullable(),
  /** 20 % of the picked price, min 5,000, held on the wallet (review C-50). */
  depositIqd: Iqd.nullable(),
  createdAt: z.coerce.date(),
});
export type RequestPostView = z.infer<typeof RequestPostView>;

export const RequestIdInput = z.object({ postId: z.string().min(1) });
export type RequestIdInput = z.infer<typeof RequestIdInput>;

export const RequestOfferInput = z.object({
  postId: z.string().min(1),
  /** Offers in multiples of 1,000 (review C-50). */
  priceIqd: Iqd.positive(),
  /** w1: required on a «يستناك وترجع» request, refused on others. */
  wait: OfferWaitTerms.optional(),
});
export type RequestOfferInput = z.infer<typeof RequestOfferInput>;

export const PickOfferInput = z.object({ postId: z.string().min(1), offerId: z.string().min(1) });
export type PickOfferInput = z.infer<typeof PickOfferInput>;

export const RequestListInput = z.object({ cityId: CityId.optional() }).default({});

/** p1: the usual range on the request form, before posting. */
export const UsualRangeInput = z.object({ placeId: RequestPlaceId, trip: RequestTripKind });
export type UsualRangeInput = z.infer<typeof UsualRangeInput>;
export type RequestListInput = z.input<typeof RequestListInput>;

export const RequestPositionInput = z.object({
  postId: z.string().min(1),
  lat: LatLng.shape.lat,
  lng: LatLng.shape.lng,
});
export type RequestPositionInput = z.infer<typeof RequestPositionInput>;

// ───────────────────────── driver side ─────────────────────────

export const AnnounceInput = z
  .object({
    garageId: z.string().min(1),
    corridorId: z.string().min(1),
    departAt: z.coerce.date(),
    latestDepartureAt: z.coerce.date(),
    vehicle: z.object({
      kind: IntercityVehicleKind,
      layout: IntercitySeatLayout,
      plate: z.string().min(2).max(20),
      modelKey: VehicleModelKey.optional(),
      model: z.string().max(60).optional(),
      color: z.string().max(30).optional(),
      noSmoking: z.boolean().optional(),
      ac: z.boolean().optional(),
      bigBags: z.boolean().optional(),
    }),
    familyOnly: z.boolean().default(false),
  })
  .refine((a) => a.latestDepartureAt.getTime() >= a.departAt.getTime(), {
    message: 'latestDepartureAt must not be before departAt',
    path: ['latestDepartureAt'],
  })
  .refine((a) => !a.vehicle.modelKey || modelFitsLayout(a.vehicle.modelKey, a.vehicle.layout), {
    message: 'this model cannot carry that seat layout',
    path: ['vehicle', 'modelKey'],
  })
  .refine((a) => a.vehicle.modelKey !== 'other' || !!a.vehicle.model?.trim(), {
    message: 'name the model when it is not on the list',
    path: ['vehicle', 'model'],
  });
export type AnnounceInput = z.input<typeof AnnounceInput>;

export const DepartureIdInput = z.object({ departureId: z.string().min(1) });
export type DepartureIdInput = z.infer<typeof DepartureIdInput>;

export const DriverPositionInput = z.object({
  departureId: z.string().min(1),
  lat: LatLng.shape.lat,
  lng: LatLng.shape.lng,
});
export type DriverPositionInput = z.infer<typeof DriverPositionInput>;

export const SelfieInput = z.object({
  departureId: z.string().min(1),
  selfieRef: z.string().min(1).max(300),
});
export type SelfieInput = z.infer<typeof SelfieInput>;

export const MarkWalkUpInput = z.object({
  departureId: z.string().min(1),
  seatId: IntercitySeatId,
  travellingAs: TravellingAs.optional(),
  /** Un-mark a walk-up (before departure). */
  remove: z.boolean().default(false),
});
export type MarkWalkUpInput = z.input<typeof MarkWalkUpInput>;

export const CheckInInput = z.object({
  departureId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/),
  /**
   * Garage mode (partner S-5): the PIN was typed on this rider's seat, so it must be this rider's
   * PIN (`pin_invalid` otherwise) — a PIN typed on the wrong seat never boards someone else.
   */
  bookingId: z.string().min(1).optional(),
});
export type CheckInInput = z.infer<typeof CheckInInput>;

/**
 * Seat PIN safeguards (Ali 2026-10-06: the PIN stays on the rider's lock screen, "but record which
 * user input which pin and if another user input the pin for other user"). Every PIN a driver types
 * at a departure is logged (`intercity_pin_attempts`, ids only, never the PIN), and ops get a row on
 * the Console safety strip when a PIN that belongs to one booking is typed on another rider's seat,
 * or when one seat sees `wrongOnSeatAlertAt` refused PINs.
 */
export const PIN_ATTEMPT_RULES = {
  /** The refused PIN on one seat (or on the plain PIN pad) of one departure that alerts ops, once. */
  wrongOnSeatAlertAt: 3,
  /** A PIN alert stays on the Console strip this long after it was raised (the log stays for good). */
  alertShowMin: 60,
} as const;

/**
 * What one typed PIN did: boarded its rider; matched no booking on the car; belonged to another
 * booking than the seat it was typed on (cross-use, refused); or belonged to a booking that cannot
 * board now (already on board, cancelled, still only held).
 */
export const PinAttemptResult = z.enum(['checked_in', 'wrong_pin', 'other_booking', 'not_boardable']);
export type PinAttemptResult = z.infer<typeof PinAttemptResult>;

/** Why an attempt alerted ops: a rider's PIN on another rider's seat, or the Nth refused PIN on one seat. */
export const PinAlertKind = z.enum(['cross_use', 'wrong_repeated']);
export type PinAlertKind = z.infer<typeof PinAlertKind>;

/** One logged PIN attempt as the Console shows it (seats, never the PIN or a rider's name). */
export const PinAttemptView = z.object({
  attemptId: z.string(),
  at: z.coerce.date(),
  /** Who typed it (the departure's driver). */
  driverId: z.string(),
  /** The seat's booking it was typed on (garage mode); null on the plain PIN pad. */
  targetBookingId: z.string().nullable(),
  targetSeatIds: z.array(IntercitySeatId),
  /** The booking on this car that the PIN belongs to, if any. */
  matchedBookingId: z.string().nullable(),
  matchedSeatIds: z.array(IntercitySeatId),
  result: PinAttemptResult,
  /** Set on the attempt that raised an ops alert. */
  alert: PinAlertKind.nullable(),
});
export type PinAttemptView = z.infer<typeof PinAttemptView>;

/**
 * A PIN alert on the Console safety strip (under the SOS banner, with the خطوط sweep rows): the
 * attempt that raised it, the car, the driver (name and masked number: a logged vault read for the
 * staff member asking) and the departure's whole PIN history, oldest first.
 */
export const PinAlertView = z.object({
  /** The attempt that raised it. */
  alertId: z.string(),
  kind: PinAlertKind,
  cityId: z.string(),
  departureId: z.string(),
  garageNameAr: z.string(),
  corridorNameAr: z.string(),
  departAt: z.coerce.date(),
  driver: z.object({
    personId: z.string(),
    /** "حيدر ك."; null when the vault has no name. */
    displayName: z.string().nullable(),
    phoneMasked: z.string().nullable(),
  }),
  targetBookingId: z.string().nullable(),
  targetSeatIds: z.array(IntercitySeatId),
  matchedBookingId: z.string().nullable(),
  matchedSeatIds: z.array(IntercitySeatId),
  /** Refused PINs on that seat (or the pad) in this departure when the alert was raised. */
  refusedOnSeat: z.number().int(),
  raisedAt: z.coerce.date(),
  attempts: z.array(PinAttemptView),
});
export type PinAlertView = z.infer<typeof PinAlertView>;

/** The city's PIN alerts of the last `PIN_ATTEMPT_RULES.alertShowMin`, newest first. */
export const PinAlertsInput = z.object({ cityId: z.string().min(1) });
export type PinAlertsInput = z.infer<typeof PinAlertsInput>;

/** The dispatcher's masked call to the driver from a PIN alert. */
export const PinAlertCallInput = z.object({ alertId: z.string().min(1).max(80) });
export type PinAlertCallInput = z.infer<typeof PinAlertCallInput>;

/** Any departure's PIN history (ops): the same rows the alert carries. */
export const PinAttemptsInput = z.object({ departureId: z.string().min(1) });
export type PinAttemptsInput = z.infer<typeof PinAttemptsInput>;

export const DepartureBookingInput = z.object({
  departureId: z.string().min(1),
  bookingId: z.string().min(1),
});
export type DepartureBookingInput = z.infer<typeof DepartureBookingInput>;

export const RespondPickupInput = z.object({
  departureId: z.string().min(1),
  bookingId: z.string().min(1),
  accept: z.boolean(),
});
export type RespondPickupInput = z.infer<typeof RespondPickupInput>;

export const CancelDepartureInput = z.object({
  departureId: z.string().min(1),
  reason: z.string().min(1).max(300),
});
export type CancelDepartureInput = z.infer<typeof CancelDepartureInput>;

export const DriverBookingRow = z.object({
  bookingId: z.string(),
  riderId: z.string(),
  seatIds: z.array(IntercitySeatId),
  state: BookingState,
  travellingAs: TravellingAs,
  payment: SeatPayment.nullable(),
  prepaid: z.boolean(),
  prepayRail: PrepayRail.nullable(),
  totalIqd: Iqd,
  /** Driver sees each stop (door address included); riders never see each other's. */
  pickup: PickupView,
  largeBags: z.boolean(),
  atGarage: z.boolean(),
  checkedInAt: z.coerce.date().nullable(),
  /** Minutes on this rider's late meter now (null: not running). */
  meterMinutes: z.number().int().nullable(),
  /** The driver may mark no-show / leave without this rider now. */
  canNoShow: z.boolean(),
  /** x3: our taxi bringing this rider is late; when it is due at the garage (null: none late). */
  taxiDueAt: z.coerce.date().nullable().default(null),
  /** x3: his seat is held for that taxi right now (RIDE_SEAT_HOLD on and before the hold ends). */
  seatHeld: z.boolean().default(false),
});
export type DriverBookingRow = z.infer<typeof DriverBookingRow>;

export const DriverDepartureView = DepartureCard.extend({
  bookings: z.array(DriverBookingRow),
  walkUps: z.array(z.object({ seatId: IntercitySeatId, travellingAs: TravellingAs.nullable() })),
  selfieAt: z.coerce.date().nullable(),
  driverCheckedInAt: z.coerce.date().nullable(),
  driverInsideGarage: z.boolean().nullable(),
  /** What still blocks `depart` (unresolved booked seats, too early while not full). */
  departBlockers: z.array(
    z.object({
      bookingId: z.string().nullable(),
      reason: z.enum(['not_checked_in', 'too_early_not_full', 'pickup_pending']),
    }),
  ),
  departedAt: z.coerce.date().nullable(),
  arrivedAt: z.coerce.date().nullable(),
  cancelReason: z.string().nullable(),
});
export type DriverDepartureView = z.infer<typeof DriverDepartureView>;

/**
 * `routes.driver.riders`: the riders on the driver's own departure by FIRST name only (partner app
 * seat map and manifest). Read from the identity vault for this driver, every read logged
 * (purpose `intercity_manifest`); the full name and the phone never leave identity.
 */
export const DepartureRiderName = z.object({
  bookingId: z.string(),
  riderId: z.string(),
  /** Null when the rider has not set a name yet. */
  firstName: z.string().nullable(),
});
export type DepartureRiderName = z.infer<typeof DepartureRiderName>;

/**
 * `routes.driverCards` (audit C-19): who drives a departure, as a rider sees him on the board, the
 * seat sheet and the boarding pass — first name only (identity vault, read logged with purpose
 * `intercity_driver_card`), whether he did this run's selfie check-in today, and his approved main
 * photo (Ali, 2026-10-06; null → the app draws his initial). Never a phone or full name.
 */
/**
 * The driver badges (idea x15, Ali 2026-10-07). Earned ones come and go with his record
 * (`RAJAA_REPUTATION_RULES`); `no_smoking` and `big_bags` are his own word for the run he announced.
 */
export const RajaaDriverBadge = z.enum(['top_driver', 'family_trusted', 'no_smoking', 'big_bags']);
export type RajaaDriverBadge = z.infer<typeof RajaaDriverBadge>;

/**
 * When a driver's record is shown and when he earns a badge. A number shows only once enough riders
 * stand behind it, so one early 1★ (or 5★) never defines a new driver. Not money rules.
 */
export const RAJAA_REPUTATION_RULES = {
  /** Ratings before the average, the quality bars and the two things riders say most show. */
  minRatings: 3,
  /** Finished runs (with a garage check-in) before the on-time share shows. */
  minRunsForOnTime: 3,
  /** Newest reviews the profile lists. */
  reviewsShown: 20,
  topDriver: { minRatings: 20, minAverage: 4.8, minOnTimeShare: 0.9 },
  /** Ratings from riders travelling as women or as a family. */
  familyTrusted: { minRatings: 8, minAverage: 4.8, noTag: 'fast_driving' as RajaaRatingTag },
} as const;

/**
 * A driver's record as riders see it (ideas x12, x16, x17), computed on the server from finished runs
 * and riders' ratings. Numbers below their minimum are null rather than misleading.
 */
export const RajaaDriverStats = z.object({
  /** Runs he finished (arrived) with riders. */
  trips: z.number().int().nonnegative(),
  /** Average stars, one decimal; null under `minRatings`. */
  ratingAvg: z.number().min(1).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  /**
   * Share of finished runs that were on time (0–1): his garage late meter stayed within its grace, the
   * same meter that pays waiting riders. Null under `minRunsForOnTime` judged runs.
   */
  onTimeShare: z.number().min(0).max(1).nullable(),
  /** The good chips riders tick most, most first (at most two); empty under `minRatings`. */
  topTags: z.array(RajaaRatingTag).max(2),
  badges: z.array(RajaaDriverBadge),
  /** «سافرت وياه قبل» (x17): finished trips the viewer took with him. */
  ridesWithYou: z.number().int().nonnegative(),
});
export type RajaaDriverStats = z.infer<typeof RajaaDriverStats>;

export const RajaaDriverCard = z.object({
  departureId: z.string(),
  driverId: z.string(),
  /** Null when the driver has not set a name yet. */
  firstName: z.string().nullable(),
  /** The run's selfie check-in, when it happened today (Baghdad day); null otherwise. */
  verifiedTodayAt: z.coerce.date().nullable(),
  /** Short-lived signed URL (absolute, or relative to the API origin); only an approved photo. */
  photoUrl: z.string().nullable(),
  stats: RajaaDriverStats,
});
export type RajaaDriverCard = z.infer<typeof RajaaDriverCard>;

/** One bar per good quality (x13): how many of his ratings ticked it, of `ratingCount`. */
export const RajaaQualityBar = z.object({
  tag: RajaaRatingTag,
  count: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
});
export type RajaaQualityBar = z.infer<typeof RajaaQualityBar>;

/**
 * A review as other riders see it: no name, no booking, and only the month, so a line can't be
 * traced back to the one rider who sat on a given day.
 */
export const RajaaPublicReview = z.object({
  stars: z.number().int().min(1).max(5),
  text: z.string(),
  /** First day of the month it was written (Baghdad). */
  month: z.coerce.date(),
});
export type RajaaPublicReview = z.infer<typeof RajaaPublicReview>;

/**
 * `routes.driverProfile` (x12–x17): the driver of a departure the rider can see (on the board, or one
 * he holds a seat on), opened from «ملفه». Asked by departure, never by driver id.
 */
export const RajaaDriverProfile = z.object({
  card: RajaaDriverCard,
  /** This run's car. */
  vehicle: IntercityVehicle,
  /** His first finished run on Driver; null before the first one. */
  firstTripAt: z.coerce.date().nullable(),
  /** In `RAJAA_GOOD_TAGS` order; empty under `minRatings`. */
  qualities: z.array(RajaaQualityBar),
  /** Visible reviews, newest first, at most `reviewsShown`. */
  reviews: z.array(RajaaPublicReview),
  /** All his visible reviews (the list may show fewer). */
  reviewCount: z.number().int().nonnegative(),
});
export type RajaaDriverProfile = z.infer<typeof RajaaDriverProfile>;

export const RajaaDriverProfileInput = z.object({ departureId: z.string().min(1) });
export type RajaaDriverProfileInput = z.infer<typeof RajaaDriverProfileInput>;

/** Who reads and hides riders' written reviews (Console «كلام الركاب»). */
export const REVIEW_MODERATION_ROLES = ['support', 'admin'] as const;

/** Why ops hid a review (Console). */
export const ReviewHideReason = z.enum(['rude', 'personal_info', 'not_about_trip', 'untrue']);
export type ReviewHideReason = z.infer<typeof ReviewHideReason>;

/** Console «كلام الركاب»: reviews with a line, newest first, with who wrote them and about whom (ids). */
export const ReviewsOpsInput = z.object({
  /** Only hidden ones, only shown ones, or both (default). */
  hidden: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  /** Paging: reviews written before this (the last row's `at`); tRPC's infinite-query cursor. */
  cursor: z.coerce.date().nullish(),
});
export type ReviewsOpsInput = z.input<typeof ReviewsOpsInput>;

export const ReviewOpsView = z.object({
  bookingId: z.string(),
  departureId: z.string(),
  driverId: z.string(),
  driverFirstName: z.string().nullable(),
  riderId: z.string(),
  stars: z.number().int().min(1).max(5),
  tags: z.array(RajaaRatingTag),
  text: z.string(),
  at: z.coerce.date(),
  corridorId: z.string(),
  direction: IntercityDirection,
  hiddenAt: z.coerce.date().nullable(),
  hiddenBy: z.string().nullable(),
  hiddenReason: ReviewHideReason.nullable(),
});
export type ReviewOpsView = z.infer<typeof ReviewOpsView>;

export const HideReviewInput = z.object({ bookingId: z.string().min(1), reason: ReviewHideReason });
export type HideReviewInput = z.infer<typeof HideReviewInput>;
export const UnhideReviewInput = z.object({ bookingId: z.string().min(1) });
export type UnhideReviewInput = z.infer<typeof UnhideReviewInput>;

export const DriverCardsInput = z.object({ departureIds: z.array(z.string().min(1)).min(1).max(30) });
export type DriverCardsInput = z.infer<typeof DriverCardsInput>;

/**
 * `routes.requestBoard.myRides`: request-board rides where the rider picked this driver's offer
 * (matched → driver_arrived → completed / rider_no_show), with the timing the driver's buttons need.
 */
export const DriverRequestRide = RequestPostView.extend({
  /** The picked offer (this driver's): what the rider pays, deposit included. */
  priceIqd: Iqd,
  driverArrivedAt: z.coerce.date().nullable(),
  /** From when "الراكب ما إجا" is allowed (arrival or trip time, the later, + the wait); null before arrival. */
  riderNoShowAt: z.coerce.date().nullable(),
  /** Cash the driver collects at the end (price minus the wallet deposit). */
  cashToCollectIqd: Iqd,
});
export type DriverRequestRide = z.infer<typeof DriverRequestRide>;

// ───────────────────────── ops (Console garage view) ─────────────────────────

export const GarageOpsInput = z.object({
  garageId: z.string().min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type GarageOpsInput = z.infer<typeof GarageOpsInput>;

export const GarageOpsView = z.object({
  garage: GarageView,
  departures: z.array(DriverDepartureView),
  demand: z.array(DemandBucket),
  openRequests: z.array(RequestPostView),
  /** Riders the platform could not move (dispatcher must call a driver against demand). */
  stranded: z.array(
    z.object({
      bookingId: z.string(),
      riderId: z.string(),
      departureId: z.string(),
      at: z.coerce.date(),
    }),
  ),
});
export type GarageOpsView = z.infer<typeof GarageOpsView>;

// ───────────────────────── port ─────────────────────────

/** What the `routes` router calls (`ctx.routes`); authorization by role happens in the router. */
export interface RoutesPort {
  network(): Promise<IntercityNetwork>;
  board(actor: Actor, input: BoardInput): Promise<IntercityBoard>;
  // customer
  holdSeat(actor: Actor, input: z.infer<typeof HoldSeatInput>): Promise<BookingView>;
  bookSeat(actor: Actor, input: BookSeatInput): Promise<BookingView>;
  cancelSeat(actor: Actor, input: BookingIdInput): Promise<BookingView>;
  myBookings(actor: Actor): Promise<BookingView[]>;
  /** r2: «شلون كانت الرجعة؟» once, on the rider's own completed booking. */
  rateBooking(actor: Actor, input: z.infer<typeof RateBookingInput>): Promise<BookingView>;
  boardingPass(actor: Actor, input: BookingIdInput): Promise<BoardingPass>;
  imHere(actor: Actor, input: ImHereInput): Promise<ImHereOutput>;
  postDemand(actor: Actor, input: z.infer<typeof PostDemandInput>): Promise<DemandPostView>;
  myDemand(actor: Actor): Promise<DemandPostView[]>;
  cancelDemand(actor: Actor, input: DemandPostIdInput): Promise<DemandPostView>;
  postRequest(actor: Actor, input: z.infer<typeof PostRequestInput>): Promise<RequestPostView>;
  myRequests(actor: Actor): Promise<RequestPostView[]>;
  usualRange(actor: Actor, input: UsualRangeInput): Promise<UsualRange | null>;
  pickOffer(actor: Actor, input: PickOfferInput): Promise<RequestPostView>;
  cancelRequest(actor: Actor, input: RequestIdInput): Promise<RequestPostView>;
  reportDriverNoShow(actor: Actor, input: RequestIdInput): Promise<RequestPostView>;
  // driver
  announce(actor: Actor, input: z.infer<typeof AnnounceInput>): Promise<DriverDepartureView>;
  myDepartures(actor: Actor): Promise<DriverDepartureView[]>;
  driverDeparture(actor: Actor, input: DepartureIdInput): Promise<DriverDepartureView>;
  demandBoard(actor: Actor, input: DemandBoardInput): Promise<DemandBucket[]>;
  selfie(actor: Actor, input: SelfieInput): Promise<DriverDepartureView>;
  driverPosition(actor: Actor, input: DriverPositionInput): Promise<DriverDepartureView>;
  markWalkUp(actor: Actor, input: z.infer<typeof MarkWalkUpInput>): Promise<DriverDepartureView>;
  checkIn(actor: Actor, input: CheckInInput): Promise<DriverDepartureView>;
  /** Masked call to a rider on his own live departure (garage mode: the late seat's "اتصل"). */
  callRider(actor: Actor, input: DepartureBookingInput): Promise<CallSession>;
  markNoShow(actor: Actor, input: DepartureBookingInput): Promise<DriverDepartureView>;
  respondPickup(actor: Actor, input: RespondPickupInput): Promise<DriverDepartureView>;
  depart(actor: Actor, input: DepartureIdInput): Promise<DriverDepartureView>;
  arrive(actor: Actor, input: DepartureIdInput): Promise<DriverDepartureView>;
  cancelDeparture(actor: Actor, input: CancelDepartureInput): Promise<DriverDepartureView>;
  driverRiders(actor: Actor, input: DepartureIdInput): Promise<DepartureRiderName[]>;
  /** Riders: the driver of each departure that is on the board or that they hold a seat on (others are left out). */
  driverCards(actor: Actor, input: DriverCardsInput): Promise<RajaaDriverCard[]>;
  /** Riders: the full profile of a departure's driver (same visibility as `driverCards`). */
  driverProfile(actor: Actor, input: RajaaDriverProfileInput): Promise<RajaaDriverProfile>;
  openRequests(actor: Actor, input: RequestListInput): Promise<RequestPostView[]>;
  requestSeen(actor: Actor, input: RequestIdInput): Promise<RequestPostView>;
  offerOnRequest(actor: Actor, input: RequestOfferInput): Promise<RequestPostView>;
  requestArrived(actor: Actor, input: RequestPositionInput): Promise<RequestPostView>;
  requestCompleted(actor: Actor, input: RequestIdInput): Promise<RequestPostView>;
  reportRiderNoShow(actor: Actor, input: RequestIdInput): Promise<RequestPostView>;
  myRequestRides(actor: Actor): Promise<DriverRequestRide[]>;
  // ops
  garageView(actor: Actor, input: GarageOpsInput): Promise<GarageOpsView>;
  /** Console safety strip: seat-PIN alerts (cross-use, repeated wrong PINs) with each car's PIN history. */
  pinAlerts(actor: Actor, input: PinAlertsInput): Promise<PinAlertView[]>;
  /** A departure's PIN history, oldest first. */
  pinAttempts(actor: Actor, input: PinAttemptsInput): Promise<PinAttemptView[]>;
  /** The strip's call button: a masked call from the staff member to the car's driver. */
  callPinAlertDriver(actor: Actor, input: PinAlertCallInput): Promise<SafetyCallSession>;
  /** Console «كلام الركاب»: written reviews, newest first. */
  reviews(actor: Actor, input: z.infer<typeof ReviewsOpsInput>): Promise<ReviewOpsView[]>;
  /** Hide a review from the driver's profile (kept, logged, reversible). */
  hideReview(actor: Actor, input: HideReviewInput): Promise<ReviewOpsView>;
  unhideReview(actor: Actor, input: UnhideReviewInput): Promise<ReviewOpsView>;
  /** W3 / NTF-14: staff cancel of a departure whose driver never came (riders moved, no fee). */
  opsCancelDeparture(actor: Actor, input: StaffDepartureInput): Promise<StaffDepartureResult>;
  /** W3 / NTF-14: staff «وصلت» for a departure whose driver forgot it (seats complete and settle). */
  opsArriveDeparture(actor: Actor, input: StaffDepartureInput): Promise<StaffDepartureResult>;
  /** W3 / NTF-10: close an arrived departure now instead of waiting for the scheduler. */
  opsCloseDeparture(actor: Actor, input: StaffDepartureInput): Promise<StaffDepartureResult>;
  /** W3 / NTF-14: departures past their latest time with no driver, or departed and never arrived. */
  overdueDepartures(actor: Actor, input: OverdueDeparturesInput): Promise<OverdueDeparture[]>;
  /** Console garage view: who drives each departure in any state (one logged staff vault read). */
  departureDrivers(actor: Actor, input: StaffDepartureDriversInput): Promise<StaffDepartureDriver[]>;
}

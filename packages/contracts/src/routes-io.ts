import { z } from 'zod';
import { CityId, Iqd, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import type { CallSession } from './chat-io.js';
import type { SafetyCallSession } from './safety-io.js';

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
  model: z.string().nullable(),
  color: z.string().nullable(),
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
  direction: IntercityDirection,
  garageId: z.string(),
  departAt: z.coerce.date(),
  latestDepartureAt: z.coerce.date(),
  state: IntercityDepartureState,
  vehicle: IntercityVehicle,
  driverId: z.string(),
});
export type DepartureSummary = z.infer<typeof DepartureSummary>;

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

export const RequestPlace = z.object({
  label: z.string().min(1).max(120),
  lat: LatLng.shape.lat.optional(),
  lng: LatLng.shape.lng.optional(),
  garageId: z.string().min(1).optional(),
});
export type RequestPlace = z.infer<typeof RequestPlace>;

export const PostRequestInput = z.object({
  from: RequestPlace,
  to: RequestPlace,
  when: z.coerce.date(),
  seats: z.number().int().min(1).max(7),
  /** Whole car for the rider (8 % take) vs seats to another destination. */
  privateCar: z.boolean().default(true),
  travellingAs: TravellingAs,
  note: z.string().max(300).optional(),
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
});
export type RequestOfferDriver = z.infer<typeof RequestOfferDriver>;

export const RequestOfferView = z.object({
  id: z.string(),
  driverId: z.string(),
  priceIqd: Iqd,
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
});
export type RequestOfferInput = z.infer<typeof RequestOfferInput>;

export const PickOfferInput = z.object({ postId: z.string().min(1), offerId: z.string().min(1) });
export type PickOfferInput = z.infer<typeof PickOfferInput>;

export const RequestListInput = z.object({ cityId: CityId.optional() }).default({});
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
      model: z.string().max(60).optional(),
      color: z.string().max(30).optional(),
    }),
    familyOnly: z.boolean().default(false),
  })
  .refine((a) => a.latestDepartureAt.getTime() >= a.departAt.getTime(), {
    message: 'latestDepartureAt must not be before departAt',
    path: ['latestDepartureAt'],
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
export const RajaaDriverCard = z.object({
  departureId: z.string(),
  driverId: z.string(),
  /** Null when the driver has not set a name yet. */
  firstName: z.string().nullable(),
  /** The run's selfie check-in, when it happened today (Baghdad day); null otherwise. */
  verifiedTodayAt: z.coerce.date().nullable(),
  /** Short-lived signed URL (absolute, or relative to the API origin); only an approved photo. */
  photoUrl: z.string().nullable(),
});
export type RajaaDriverCard = z.infer<typeof RajaaDriverCard>;

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
  boardingPass(actor: Actor, input: BookingIdInput): Promise<BoardingPass>;
  imHere(actor: Actor, input: ImHereInput): Promise<ImHereOutput>;
  postDemand(actor: Actor, input: z.infer<typeof PostDemandInput>): Promise<DemandPostView>;
  myDemand(actor: Actor): Promise<DemandPostView[]>;
  cancelDemand(actor: Actor, input: DemandPostIdInput): Promise<DemandPostView>;
  postRequest(actor: Actor, input: z.infer<typeof PostRequestInput>): Promise<RequestPostView>;
  myRequests(actor: Actor): Promise<RequestPostView[]>;
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
  openRequests(actor: Actor, input: RequestListInput): Promise<RequestPostView[]>;
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
}

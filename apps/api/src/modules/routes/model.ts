import type {
  BookingOrigin,
  BookingState,
  DemandPostState,
  IntercityDepartureState,
  IntercityDirection,
  IntercitySeatId,
  IntercitySeatLayout,
  IntercityVehicleKind,
  PickupStatus,
  PinAlertKind,
  PinAttemptResult,
  RajaaRatingTag,
  RequestState,
  ReviewHideReason,
  SeatPayment,
  RequestDetails,
  TravellingAs,
  VehicleModelKey,
} from '@driver/contracts';

/** The records the routes module stores (in memory, or Prisma: departures + seat_bookings + demand_posts + ride_requests). */

export interface Fix {
  lat: number;
  lng: number;
  at: Date;
}

export interface WalkUp {
  seatId: IntercitySeatId;
  travellingAs: TravellingAs | null;
  markedAt: Date;
}

export interface DepartureRecord {
  id: string;
  driverId: string;
  corridorId: string;
  direction: IntercityDirection;
  garageId: string;
  fromCityId: string;
  toCityId: string;
  /** Announced time: "leaves at X or when full"; the late-meter reference (decisions §8). */
  departAt: Date;
  /** Hard latest departure (review C-31). */
  latestDepartureAt: Date;
  announcedAt: Date;
  state: IntercityDepartureState;
  layout: IntercitySeatLayout;
  vehicle: {
    kind: IntercityVehicleKind;
    plate: string;
    /** Listed model (the rider's seat screen draws it); null on runs announced before the list. */
    modelKey: VehicleModelKey | null;
    model: string | null;
    color: string | null;
    /** The driver's word for this run (x15 «ما يدخن», «جناط كبيرة»); false on older runs. */
    noSmoking: boolean;
    bigBags: boolean;
    /** The driver's word for this run (b7 «مكيّفة»); false on older runs. */
    ac: boolean;
  };
  familyOnly: boolean;
  seatPriceIqd: number;
  frontPremiumIqd: number;
  walkUps: WalkUp[];
  selfieAt: Date | null;
  selfieRef: string | null;
  /** First fix inside the 150 m garage geofence (the meter's "driver checked in"). */
  driverCheckIn: Fix | null;
  /** First fix outside the geofence after checking in, before departing: the meter freezes there. */
  driverLeftGeofenceAt: Date | null;
  /** Bounded trail (checkpoint waiver) and the last fix (riders' live car). */
  trail: Fix[];
  lastPosition: Fix | null;
  boardingAt: Date | null;
  departedAt: Date | null;
  arrivedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  lowFillCheckedAt: Date | null;
  createdAt: Date;
}

export interface PickupRecord {
  kind: 'garage' | 'meeting_point' | 'door';
  meetingPointId: string | null;
  lat: number;
  lng: number;
  note: string | null;
  feeIqd: number;
  status: PickupStatus;
  detourMin: number | null;
}

export interface BookingRecord {
  id: string;
  departureId: string;
  riderId: string;
  seatIds: IntercitySeatId[];
  selection: 'seats' | 'row' | 'car';
  travellingAs: TravellingAs;
  state: BookingState;
  origin: BookingOrigin;
  /** Per seat; a moved rider never pays more than the original seat. */
  seatPriceIqd: number;
  frontPremiumIqd: number;
  pickupFeeIqd: number;
  payment: SeatPayment | null;
  prepaid: boolean;
  trusted: boolean;
  pin: string;
  pickup: PickupRecord;
  largeBags: boolean;
  heldUntil: Date | null;
  bookedAt: Date | null;
  atGarageAt: Date | null;
  checkedInAt: Date | null;
  noShowAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lateMinutes: number | null;
  /**
   * x3: when our own taxi (a ride booked to this seat's garage) is expected to bring the rider, while it
   * runs late for the car; set and cleared by the garage-taxi module. Holds the seat only while
   * `IntercityRules.seatHoldForLateTaxi` is on (`seatHoldUntil`). Absent/null = no late taxi.
   */
  taxiLateUntil?: Date | null;
  demandPostId: string | null;
  movedFromBookingId: string | null;
  movedToBookingId: string | null;
  createdAt: Date;
  /** r2: the rider's stars and chips after the trip; absent/null = not rated. */
  rating?: RatingRecord | null;
  /** x14: the rider's one line with the rating, and its moderation; absent/null = none written. */
  review?: ReviewRecord | null;
}

export interface RatingRecord {
  stars: number;
  tags: RajaaRatingTag[];
  at: Date;
}

/** A rider's written line about the trip (public on the driver's profile unless ops hid it). */
export interface ReviewRecord {
  text: string;
  at: Date;
  hiddenAt: Date | null;
  /** The staff member who hid it. */
  hiddenBy: string | null;
  hiddenReason: ReviewHideReason | null;
}

export interface DemandPostRecord {
  id: string;
  riderId: string;
  corridorId: string;
  direction: IntercityDirection;
  garageId: string | null;
  pickup:
    | { kind: 'garage'; garageId?: string | undefined }
    | { kind: 'meeting_point'; meetingPointId: string }
    | { kind: 'door'; lat: number; lng: number; note?: string | undefined };
  windowStart: Date;
  windowEnd: Date;
  seats: number;
  travellingAs: TravellingAs;
  state: DemandPostState;
  bookingId: string | null;
  escalatedAt: Date | null;
  createdAt: Date;
}

export interface RequestPlaceRecord {
  label: string;
  lat?: number | undefined;
  lng?: number | undefined;
  garageId?: string | undefined;
}

export interface RequestOfferRecord {
  id: string;
  driverId: string;
  priceIqd: number;
  at: Date;
  state: 'open' | 'picked' | 'withdrawn' | 'lost';
}

export interface RequestRecord {
  id: string;
  riderId: string;
  from: RequestPlaceRecord;
  to: RequestPlaceRecord;
  cityId: string | null;
  when: Date;
  seats: number;
  privateCar: boolean;
  travellingAs: TravellingAs;
  note: string | null;
  /** y1: trip kind, big bags, the car wanted (defaults for older rows and stranded posts). */
  details: RequestDetails;
  /** y4: drivers who opened the request (ids only; the rider sees the count). */
  seenDriverIds: string[];
  state: RequestState;
  origin: 'rider' | 'stranded';
  priceCapIqd: number | null;
  offers: RequestOfferRecord[];
  pickedOfferId: string | null;
  depositIqd: number | null;
  driverArrivedAt: Date | null;
  driverArrivedPin: { lat: number; lng: number } | null;
  closedAt: Date | null;
  createdAt: Date;
}

/**
 * One seat PIN a driver typed at a departure (`intercity_pin_attempts`, append-only; ids only, never
 * the PIN). Ali 2026-10-06: record who typed which rider's PIN, and on whose seat.
 */
export interface PinAttemptRecord {
  id: string;
  departureId: string;
  /** The ops desk that watches the car. */
  cityId: string;
  driverId: string;
  /** The seat's booking it was typed on (garage mode); null on the plain PIN pad. */
  targetBookingId: string | null;
  /** The booking on this car that the PIN belongs to, if any. */
  matchedBookingId: string | null;
  result: PinAttemptResult;
  /** Set on the attempt that raised an ops alert. */
  alert: PinAlertKind | null;
  /** Refused PINs on that seat (or the pad) in this departure, this one included (0 when it boarded). */
  refusedOnSeat: number;
  at: Date;
}

/** Booking states that occupy their seats. */
export const OCCUPYING: readonly BookingState[] = ['held', 'booked', 'checked_in', 'completed'];
/** Booking states that still hold the rider's money or reservation. */
export const LIVE: readonly BookingState[] = ['held', 'booked', 'checked_in'];
/** Departure states a rider can still book into. */
export const OPEN_DEPARTURE: readonly IntercityDepartureState[] = ['scheduled', 'boarding'];
/** Runs that reached the other end (the driver's record counts these). */
export const FINISHED_RUN: readonly IntercityDepartureState[] = ['arrived', 'closed'];

export function bookingTotal(
  b: Pick<BookingRecord, 'seatIds' | 'seatPriceIqd' | 'frontPremiumIqd' | 'pickupFeeIqd'>,
): number {
  return (
    b.seatIds.length * b.seatPriceIqd +
    (b.seatIds.includes('front') ? b.frontPremiumIqd : 0) +
    b.pickupFeeIqd
  );
}

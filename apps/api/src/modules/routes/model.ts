import type {
  AgreementKind,
  AgreementState,
  BookingOrigin,
  BookingState,
  DemandPostState,
  IntercityDepartureState,
  IntercityDirection,
  IntercitySeatId,
  IntercitySeatLayout,
  IntercityVehicleKind,
  OfferCashState,
  PickupStatus,
  PinAlertKind,
  PinAttemptResult,
  RajaaRatingTag,
  RequestPlaceId,
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
  kind: 'garage' | 'meeting_point' | 'door' | 'pin';
  meetingPointId: string | null;
  lat: number;
  lng: number;
  note: string | null;
  feeIqd: number;
  status: PickupStatus;
  detourMin: number | null;
  /** Step 4: the agreement a pin pickup's price comes from; absent/null otherwise. */
  agreementId?: string | null;
}

/** Step 4: a booking's agreed door drop (its price is the booking's `dropoffFeeIqd`). */
export interface DropoffRecord {
  agreementId: string;
  lat: number;
  lng: number;
  note: string | null;
}

/** Step 4: one agreed-price ask on a departure (docs/specs/2026-10-08-agreed-trip-prices.md). */
export interface AgreementRecord {
  id: string;
  departureId: string;
  riderId: string;
  driverId: string;
  kind: AgreementKind;
  lat: number;
  lng: number;
  note: string | null;
  state: AgreementState;
  amountIqd: number | null;
  askedAt: Date;
  proposedAt: Date | null;
  expiresAt: Date | null;
  decidedAt: Date | null;
  bookingId: string | null;
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
  /** Step 4: the agreed door drop's price; absent = 0. */
  dropoffFeeIqd?: number;
  /** Step 4: the agreed door drop; absent/null = the destination garage. */
  dropoff?: DropoffRecord | null;
  payment: SeatPayment | null;
  prepaid: boolean;
  trusted: boolean;
  pin: string;
  pickup: PickupRecord;
  largeBags: boolean;
  /** Step 5: small children riding free on a lap; absent = 0. */
  lapChildren?: number;
  /** Step 5: the return-trip discount (off the total); absent = 0. */
  returnDiscountIqd?: number;
  /** Step 5: the rider's booking the other way it is paired with; absent/null = none. */
  returnPairId?: string | null;
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
  placeId?: RequestPlaceId | undefined;
}

export interface RequestOfferRecord {
  id: string;
  driverId: string;
  priceIqd: number;
  /** w1: hours of waiting included and the extra-hour price (on «يستناك وترجع» trips only). */
  wait: { includedHours: number; extraHourIqd: number } | null;
  at: Date;
  state: 'open' | 'picked' | 'withdrawn' | 'lost';
  /** Step 4b a6 «احجز وادفع كاش»: the rider asked this driver, and his answer; null when never asked. */
  cash: OfferCashState | null;
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
  /** The deposit amount: held on the wallet, or on a cash reservation only owed on a no-show. */
  depositIqd: number | null;
  /** Step 4b a6: picked on the driver's «احجز وادفع كاش» yes, so nothing is held on the wallet. */
  cashReserved: boolean;
  driverArrivedAt: Date | null;
  driverArrivedPin: { lat: number; lng: number } | null;
  /** w2: the waiting clock on a «يستناك وترجع» trip, started and stopped by the driver. */
  waitStartedAt: Date | null;
  waitEndedAt: Date | null;
  /** k2 «جيب واحد»: the person fetched (a person id only; the name the poster gave is in the vault). */
  fetchPersonId: string | null;
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
  b: Pick<
    BookingRecord,
    'seatIds' | 'seatPriceIqd' | 'frontPremiumIqd' | 'pickupFeeIqd' | 'dropoffFeeIqd' | 'returnDiscountIqd'
  >,
): number {
  return (
    b.seatIds.length * b.seatPriceIqd +
    (b.seatIds.includes('front') ? b.frontPremiumIqd : 0) +
    b.pickupFeeIqd +
    (b.dropoffFeeIqd ?? 0) -
    (b.returnDiscountIqd ?? 0)
  );
}

/** Step 5: the return-trip discount on `seats` seats at `seatPriceIqd`: `percent` off, rounded down to 250. */
export function returnDiscount(seats: number, seatPriceIqd: number, percent: number): number {
  return Math.floor((seats * seatPriceIqd * percent) / 100 / 250) * 250;
}

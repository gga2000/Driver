import type {
  Actor,
  BookedRideState,
  BookingView,
  ComplimentKey,
  DeliveryPoint,
  DemandPostView,
  IntercityBoard,
  IntercitySeatId,
  LatLng,
  Order,
  PlaceOrderInput,
  RoutesPort,
  SavedPlaceView,
  TravellingAs,
  VehicleClass,
  VehicleColour,
  VehicleFeature,
} from '@driver/contracts';
import type { NewEvent, Aggregate } from '../events/index.js';

/** A ride the rider finished, with its driver (from the trip) and his stars. */
export interface FinishedRide {
  orderId: string;
  driverId: string;
  vertical: 'taxi' | 'tuktuk';
  /** The driver's stars from the rider's rating; null when not rated. */
  stars: number | null;
  finishedAt: Date;
}

/** The rider's ride in progress, for «عشاك يوصل وياك». */
export interface RideInProgress {
  orderId: string;
  vertical: 'taxi' | 'tuktuk';
  dropoff: DeliveryPoint;
  /** When the car reaches the drop-off (the one live ETA); null when it can't be read. */
  arriveAt: Date | null;
}

/** What ride habits read and do on rides and food (orders, trips, pricing, the ETA). */
export interface HabitsRidesPort {
  /** His finished rides placed since `from`, newest first. */
  finishedRides(personId: string, from: Date): Promise<FinishedRide[]>;
  /** One finished ride of his; null when it is not his, not a ride or not finished. */
  finishedRide(personId: string, orderId: string): Promise<FinishedRide | null>;
  /** The server's fare for a ride at `at` — what `orders.place` will charge. */
  fare(input: { cityId: string; vertical: 'taxi' | 'tuktuk'; pickup: DeliveryPoint; dropoff: DeliveryPoint; doorPickup: boolean; at: Date }): { fareIqd: number; quoteId: string };
  place(personId: string, input: PlaceOrderInput): Promise<Order>;
  order(orderId: string): Promise<Order | null>;
  /** His taxi / tuktuk ride in progress (matched, driver on the way or on the trip); null when none. */
  rideInProgress(personId: string): Promise<RideInProgress | null>;
  /** A kitchen's minutes before a delivery time (prep + busy now, and the scheduled lead), and its pin. */
  kitchen(merchantOrgId: string): Promise<{ prepMin: number; leadMin: number; pin: LatLng | null } | null>;
  /** His public rating from customers' delivery scores (joy l2); null below the minimum count. */
  driverRating(driverId: string): Promise<{ rating: number; count: number } | null>;
  /** Travel minutes between two points (the one ETA, learned corrections included). */
  minutes(from: LatLng, to: LatLng, vehicle: VehicleClass): Promise<number>;
  /** Step 4 (o4): which of these orders are rides he finished (completed or closed). */
  finishedOrderIds(orderIds: readonly string[]): Promise<Set<string>>;
  /**
   * Step 4 (o4): he has a ride in hand — one searching or under way, or one booked for within an hour
   * of `around` — so «نفس مشوار البارحة؟» stays quiet.
   */
  rideOn(personId: string, around: Date): Promise<boolean>;
  /**
   * Review #28: a ride booked for later as dispatch holds it — who confirmed it, until when drivers are
   * asked, when the search starts. Null when dispatch has no such booking. Absent in older fakes.
   */
  bookedRide?(orderId: string): Promise<BookedRidePlan | null>;
}

/** A booked ride's pre-assignment (review #28), from dispatch. */
export interface BookedRidePlan {
  state: BookedRideState;
  /** The confirmed driver (state `confirmed`). */
  driverId: string | null;
  /** Drivers are asked until then (state `looking`). */
  confirmBy: Date | null;
  searchAt: Date;
}

/** What ride habits read and do on الرجعة (the routes module). */
export interface HabitsRajaaPort {
  bookings(actor: Actor): Promise<BookingView[]>;
  board(actor: Actor, input: { corridorId: string; direction: 'to_aziziyah' | 'from_aziziyah'; from: Date; to: Date; travellingAs: TravellingAs }): Promise<IntercityBoard>;
  /** Holds the seat and books it with the rider's payment in one go (server price, wallet checks as always). */
  holdAndBook(actor: Actor, input: { departureId: string; seatId: IntercitySeatId; travellingAs: TravellingAs; payment: 'cash' | 'wallet' }): Promise<BookingView>;
  postDemand(actor: Actor, input: Parameters<RoutesPort['postDemand']>[1]): Promise<DemandPostView>;
  /** When the car left (null before departure). */
  departedAt(departureId: string): Promise<Date | null>;
  travelMin(corridorId: string): number | null;
  /** Where cars arrive in Aziziyah (its garages). */
  aziziyahGarages(): LatLng[];
  /** «الكوت ← العزيزية»: the corridor in the direction travelled, in Arabic. */
  routeAr(corridorId: string, direction: 'to_aziziyah' | 'from_aziziyah'): string;
}

/** People: first names and approved photos (logged vault reads), saved places. */
export interface HabitsPeoplePort {
  /** `purpose`: the vault-read purpose logged (a favourite's by default). */
  firstNames(ids: readonly string[], accessorId: string, purpose?: string): Promise<Record<string, string | null>>;
  photoUrls(ids: readonly string[], accessorId: string, purpose?: string): Promise<Record<string, string>>;
  places(personId: string): Promise<SavedPlaceView[]>;
}

export interface HabitsEventsPort {
  emit(event: NewEvent, aggregate: Aggregate): Promise<unknown>;
}

export const HABITS_RIDES = Symbol('HABITS_RIDES');
export const HABITS_RAJAA = Symbol('HABITS_RAJAA');
export const HABITS_PEOPLE = Symbol('HABITS_PEOPLE');
export const HABITS_EVENTS = Symbol('HABITS_EVENTS');

/** The vault-read purpose of a favourite's first name and photo. */
export const FAVOURITE_READ_PURPOSE = 'favourite_driver';

// ───────────────────────── ride step 3: the offered drivers, «نبّهه», the profile ─────────────────────────

/** One driver's offer of the ride, as dispatch keeps it (positions never leave dispatch). */
export interface SearchOffer {
  offerId: string;
  driverId: string;
  state: 'sent' | 'seen' | 'accepted' | 'declined' | 'timed_out' | 'withdrawn';
  sentAt: Date;
  expiresAt: Date;
  nudgedAt: Date | null;
}

/** A driver's car and record as the rider is told them (confirmed features only, never a plate here). */
export interface DriverFacts {
  vehicleClass: VehicleClass | null;
  model: string | null;
  colour: VehicleColour | null;
  features: VehicleFeature[];
  tripCount: number;
}

/**
 * What the offered-drivers list, «نبّهه» and the driver profile read (ride step 3): the order's parties,
 * the ride's live search in dispatch, the driver's car, record and minutes away, and his first name and
 * approved photo — logged vault reads with the courier card's purpose. Positions stay inside: only
 * minutes come out.
 */
export interface HabitsSearchPort {
  /** A ride order with the people who may follow it (the orderer and its rider participants); null when not a ride. */
  ride(orderId: string): Promise<{ orderId: string; ordererId: string; riderIds: string[] } | null>;
  /** The ride's search while it looks for a driver: the pickup and every offer; null once it has one. */
  search(orderId: string): Promise<{ tripId: string; vertical: 'taxi' | 'tuktuk'; pickup: LatLng; offers: SearchOffer[] } | null>;
  /** «نبّهه» through dispatch (once per driver per ride); returns when. */
  nudge(tripId: string, offerId: string, riderId: string): Promise<Date>;
  /** The driver's minutes to `to` from where he is now (the one ETA); null when he is offline. */
  minutesAway(driverId: string, to: LatLng): Promise<number | null>;
  facts(driverIds: readonly string[]): Promise<Map<string, DriverFacts>>;
  /** The driver carrying (or who carried) the order, with the plate of the car on that trip. */
  assigned(orderId: string): Promise<{ driverId: string; vertical: 'taxi' | 'tuktuk'; plate: string | null; vehicleClass: VehicleClass | null } | null>;
  /** First names and approved photo refs (vault reads logged with `purpose`, the reader as accessor). */
  cards(driverIds: readonly string[], readerId: string, purpose: string): Promise<Record<string, { firstName: string | null; photoRef: string | null }>>;
  /** A short-lived URL for a photo ref. */
  photoUrl(ref: string): string;
  /** n5: since when he drives here, his on-time share (null under 20 trips) and riders' compliments. */
  record(driverId: string): Promise<{ driverSince: Date | null; onTimePct: number | null; compliments: Array<{ key: ComplimentKey; count: number }> }>;
  /** s6: since when each drives here (role grants only). */
  driverSince(driverIds: readonly string[]): Promise<Record<string, Date | null>>;
}

export const HABITS_SEARCH = Symbol('HABITS_SEARCH');

/** The vault-read purpose of an offered or assigned driver's first name and photo (as on the courier card). */
export const DRIVER_CARD_PURPOSE = 'courier_card';
/** The vault-read purpose of the rider's «ما أريده مرة ثانية» list. */
export const AVOIDED_READ_PURPOSE = 'avoided_driver';
/** Review #28: the driver who confirmed a rider's booked ride, read for that rider. */
export const BOOKED_DRIVER_READ_PURPOSE = 'booked_ride_driver';

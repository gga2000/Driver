import type { Actor, BookingView, DeliveryPoint, DemandPostView, IntercityBoard, IntercitySeatId, LatLng, Order, PlaceOrderInput, RoutesPort, SavedPlaceView, TravellingAs, VehicleClass } from '@driver/contracts';
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
  /** Travel minutes between two points (the one ETA, learned corrections included). */
  minutes(from: LatLng, to: LatLng, vehicle: VehicleClass): Promise<number>;
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
  firstNames(ids: readonly string[], accessorId: string): Promise<Record<string, string | null>>;
  photoUrls(ids: readonly string[], accessorId: string): Promise<Record<string, string>>;
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

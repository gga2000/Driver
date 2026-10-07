import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { DRIVER_PROFILE_RULES, publicCourierRating, ROAD_FACTOR, TOWN_SPEED_KMH, type IntercityDirection, type LatLng, type Order, type Trip, type VehicleClass, type Vertical } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { DispatchModule, DispatchService } from '../dispatch/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrderComplimentsService, OrdersModule, OrdersService, serverFees } from '../orders/index.js';
import { BLOB_STORE, PlacesModule, SavedPlacesService } from '../places/index.js';
import type { BlobStore } from '../places/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { CORRIDORS, DeparturesService, GARAGES, RoutesModule, RoutesRpc } from '../routes/index.js';
import { EtaService, RoutingModule } from '../routing/index.js';
import { onTimePercent } from '../scoring/index.js';
import { COURIER_VEHICLES, TrackingModule, TrackingService, tripsOrdersRatings, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import {
  FAVOURITE_READ_PURPOSE,
  HABITS_EVENTS,
  HABITS_PEOPLE,
  HABITS_RAJAA,
  HABITS_RIDES,
  HABITS_SEARCH,
  type FinishedRide,
  type HabitsEventsPort,
  type HabitsPeoplePort,
  type HabitsRajaaPort,
  type HabitsRidesPort,
  type HabitsSearchPort,
} from './ports.js';
import { RegularTripJob } from './regular-trip.job.js';
import { InMemoryRideHabitsRepository, PrismaRideHabitsRepository, RIDE_HABITS_REPOSITORY, type RideHabitsRepository } from './ride-habits.repository.js';
import { RideHabitsService } from './ride-habits.service.js';
import { RiderDriversService } from './rider-drivers.service.js';

const FINISHED = new Set<Order['state']>(['completed', 'closed']);
const MIN = 60_000;
/** The profile's on-time share reads his newest completed trips of the last year, at most this many. */
const ON_TIME_TRIPS = 200;
const YEAR_MS = 365 * 24 * 60 * MIN;

const isRide = (v: Vertical): v is 'taxi' | 'tuktuk' => v === 'taxi' || v === 'tuktuk';

/** The vehicle a trip of this vertical is timed for when its car is not known (town speeds). */
function speedClass(v: Vertical): VehicleClass {
  if (v === 'taxi') return 'car';
  if (v === 'tuktuk') return 'tuktuk';
  return 'bike';
}

/** Minutes the offer promised to the pickup: his distance then, by road, at town speed (at least one). */
function offeredMinutes(distanceKm: number, vehicle: VehicleClass): number {
  return Math.max(1, Math.round(((distanceKm * ROAD_FACTOR) / TOWN_SPEED_KMH[vehicle]) * 60));
}

/** The ride's finished driver and stars, read from its trip (`courierOf`). */
async function finished(trips: TripsService, o: Order): Promise<FinishedRide | null> {
  if (o.type !== 'ride' || !FINISHED.has(o.state) || !o.deliveredAt) return null;
  const who = await trips.courierOf(o.id);
  if (!who || (who.vertical !== 'taxi' && who.vertical !== 'tuktuk')) return null;
  return { orderId: o.id, driverId: who.courierId, vertical: who.vertical, stars: o.rating?.delivery ?? null, finishedAt: o.deliveredAt };
}

function stopPin(trip: Trip, orderId: string, type: 'pickup' | 'dropoff'): LatLng | null {
  return trip.stops.find((s) => s.orderId === orderId && s.type === type)?.target ?? null;
}

function routeAr(corridorId: string, direction: IntercityDirection): string {
  const name = CORRIDORS.find((c) => c.id === corridorId)?.nameAr ?? corridorId;
  const [home, far] = name.split(' ⇄ ');
  return direction === 'to_aziziyah' ? `${far ?? name} ← ${home ?? name}` : `${home ?? name} ← ${far ?? name}`;
}

/**
 * Joy J7d: favourite drivers, regular trips and «عشاك يوصل وياك». Owns `favourite_drivers`,
 * `regular_trips` and `regular_trip_occurrences`; books through orders and routes only; binds the
 * orders module's favourite check (orders never imports this module).
 */
@Module({
  imports: [OrdersModule, TripsModule, TrackingModule, RoutesModule, IdentityModule, PlacesModule, PricingModule, RoutingModule, EventsModule, DispatchModule],
  providers: [
    {
      provide: RIDE_HABITS_REPOSITORY,
      useFactory: (prisma: PrismaService): RideHabitsRepository => (prisma.configured ? new PrismaRideHabitsRepository(prisma) : new InMemoryRideHabitsRepository()),
      inject: [PrismaService],
    },
    {
      provide: HABITS_RIDES,
      useFactory: (orders: OrdersService, trips: TripsService, pricing: PricingService, tracking: TrackingService, eta: EtaService, clock: Clock): HabitsRidesPort => {
        // Joy l2's public rating, the same scores the live driver card shows.
        const scores = tripsOrdersRatings(trips, orders, () => clock.now());
        return {
        finishedRides: async (personId, from) => {
          const out: FinishedRide[] = [];
          for (const o of await orders.listForPerson(personId)) {
            if (o.ordererId !== personId || o.placedAt < from) continue;
            const f = await finished(trips, o);
            if (f) out.push(f);
          }
          return out.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
        },
        finishedRide: async (personId, orderId) => {
          const o = await orders.get(orderId).catch(() => null);
          return o && o.ordererId === personId ? finished(trips, o) : null;
        },
        fare: (i) => {
          const fees = serverFees(pricing, { cityId: i.cityId, type: 'ride', rideVertical: i.vertical, pickup: i.pickup, dropoff: i.dropoff, options: { doorPickup: i.doorPickup }, at: i.at });
          return { fareIqd: fees.fareIqd, quoteId: fees.quoteId };
        },
        place: (personId, input) => orders.place(personId, input),
        order: (orderId) => orders.get(orderId).catch(() => null),
        rideInProgress: async (personId) => {
          const ride = (await orders.listForPerson(personId)).find((o) => o.ordererId === personId && o.type === 'ride' && o.state === 'matched');
          if (!ride) return null;
          const [agg, trip] = await Promise.all([orders.aggregate(ride.id), trips.activeForOrder(ride.id)]);
          const dropoff = agg.order.dropoff;
          if (!trip || !dropoff || (trip.vertical !== 'taxi' && trip.vertical !== 'tuktuk')) return null;
          const now = clock.now();
          const fix = await trips.lastPosition(trip.id);
          const onTrip = trip.state === 'in_transit' || trip.state === 'arrived_dropoff';
          const live = fix ? await tracking.liveEta(ride, trip, fix.pin, now) : null;
          let arriveAt: Date | null = onTrip ? (live?.at ?? null) : null;
          if (!onTrip) {
            const pickup = stopPin(trip, ride.id, 'pickup');
            const door = stopPin(trip, ride.id, 'dropoff') ?? dropoff.pin ?? null;
            if (pickup && door) arriveAt = new Date((live?.at ?? now).getTime() + (await eta.minutes(pickup, door, 'car')).minutes * MIN);
          }
          return { orderId: ride.id, vertical: trip.vertical, dropoff, arriveAt };
        },
        kitchen: (merchantOrgId) => orders.kitchenTiming(merchantOrgId),
        minutes: async (from, to, vehicle) => (await eta.minutes(from, to, vehicle)).minutes,
        driverRating: async (driverId) => publicCourierRating(await scores.courierScores(driverId)),
        };
      },
      inject: [OrdersService, TripsService, PricingService, TrackingService, EtaService, CLOCK],
    },
    {
      provide: HABITS_RAJAA,
      useFactory: (routes: RoutesRpc, departures: DeparturesService): HabitsRajaaPort => ({
        bookings: (actor) => routes.myBookings(actor),
        board: (actor, i) => routes.board(actor, { corridorId: i.corridorId, direction: i.direction, from: i.from, to: i.to, travellingAs: i.travellingAs }),
        holdAndBook: async (actor, i) => {
          const held = await routes.holdSeat(actor, { departureId: i.departureId, selection: { kind: 'seats', seatIds: [i.seatId] }, travellingAs: i.travellingAs, pickup: { kind: 'garage' }, largeBags: false });
          return routes.bookSeat(actor, { bookingId: held.id, payment: i.payment });
        },
        postDemand: (actor, input) => routes.postDemand(actor, input),
        departedAt: async (id) => (await departures.departure(id)).departedAt ?? null,
        travelMin: (corridorId) => CORRIDORS.find((c) => c.id === corridorId)?.travelMin ?? null,
        aziziyahGarages: () => GARAGES.filter((g) => g.cityId === 'aziziyah' && !g.draft).map((g) => ({ lat: g.lat, lng: g.lng })),
        routeAr,
      }),
      inject: [RoutesRpc, DeparturesService],
    },
    {
      provide: HABITS_PEOPLE,
      useFactory: (identity: IdentityService, blobs: BlobStore, places: SavedPlacesService): HabitsPeoplePort => ({
        firstNames: (ids, accessor) => identity.firstNamesFor(ids, accessor, FAVOURITE_READ_PURPOSE),
        photoUrls: async (ids, accessor) => {
          const refs = await identity.mainPhotoRefs(ids, accessor, FAVOURITE_READ_PURPOSE);
          return Object.fromEntries(Object.entries(refs).map(([id, ref]) => [id, blobs.readUrl(ref)]));
        },
        places: (personId) => places.mine(personId),
      }),
      inject: [IdentityService, BLOB_STORE, SavedPlacesService],
    },
    {
      // Ride step 3: the offered drivers, «نبّهه» and the driver profile. Positions stay in dispatch;
      // only minutes (the one ETA) come out. Names and photos: logged vault reads (`courier_card`).
      provide: HABITS_SEARCH,
      useFactory: (
        orders: OrdersService,
        trips: TripsService,
        dispatch: DispatchService,
        eta: EtaService,
        identity: IdentityService,
        blobs: BlobStore,
        vehicles: CourierVehicleDirectory,
        compliments: OrderComplimentsService,
        clock: Clock,
      ): HabitsSearchPort => ({
        ride: async (orderId) => {
          const agg = await orders.aggregate(orderId).catch(() => null);
          if (!agg || agg.order.type !== 'ride') return null;
          const riderIds = agg.participants.filter((p) => p.role === 'rider' && p.personId !== null).map((p) => p.personId!);
          return { orderId, ordererId: agg.order.ordererId, riderIds };
        },
        search: async (orderId) => {
          const trip = await trips.activeForOrder(orderId);
          if (!trip || !isRide(trip.vertical)) return null;
          const found = await dispatch.searchOf(trip.id);
          if (!found) return null;
          const offers = found.offers.map((o) => ({ offerId: o.id, driverId: o.driverId, state: o.state, sentAt: o.sentAt, expiresAt: o.expiresAt, nudgedAt: o.nudgedAt ?? null }));
          return { tripId: trip.id, vertical: trip.vertical, pickup: found.request.pickup, offers };
        },
        nudge: (tripId, offerId, riderId) => dispatch.nudgeOffer(tripId, offerId, riderId),
        minutesAway: async (driverId, to) => {
          const p = await dispatch.presence.get(driverId);
          return p ? Math.max(1, (await eta.minutes({ lat: p.lat, lng: p.lng }, to, p.vehicle)).minutes) : null;
        },
        facts: async (ids) => {
          const facts = await dispatch.vehicleFacts(ids);
          return new Map([...facts].map(([id, f]) => [id, { vehicleClass: f.vehicleClass, model: f.model, colour: f.colour, features: f.confirmedFeatures, tripCount: f.tripCount }]));
        },
        assigned: async (orderId) => {
          const carried = await trips.courierOf(orderId);
          if (!carried || !isRide(carried.vertical)) return null;
          const trip = await trips.get(carried.tripId);
          const car = await vehicles.forCourier(carried.courierId, trip.vehicleId ?? null);
          return { driverId: carried.courierId, vertical: carried.vertical, plate: car?.plate ?? null, vehicleClass: car?.vehicleClass ?? null };
        },
        cards: async (ids, readerId, purpose) => {
          const [names, photos] = await Promise.all([identity.firstNamesFor(ids, readerId, purpose), identity.mainPhotoRefs(ids, readerId, purpose)]);
          return Object.fromEntries(ids.map((id) => [id, { firstName: names[id] ?? null, photoRef: photos[id] ?? null }]));
        },
        photoUrl: (ref) => blobs.readUrl(ref),
        record: async (driverId) => {
          const [since, done, accepted, words] = await Promise.all([
            identity.driverSinceOf([driverId]),
            trips.completedForDriver(driverId, new Date(clock.now().getTime() - YEAR_MS)),
            dispatch.acceptedOffersOf(driverId, ON_TIME_TRIPS),
            compliments.courierView(driverId),
          ]);
          const offered = new Map(accepted.map((o) => [o.tripId, o.distanceKm]));
          const recent = done
            .filter((t) => t.state === 'completed')
            .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
            .slice(0, ON_TIME_TRIPS)
            .map((t) => {
              const km = offered.get(t.id);
              return { state: t.state, acceptedAt: t.acceptedAt, promisedPickupMin: km == null ? null : offeredMinutes(km, speedClass(t.vertical)), stops: t.stops };
            });
          return { driverSince: since[driverId] ?? null, onTimePct: onTimePercent(recent, DRIVER_PROFILE_RULES.onTimeMinTrips), compliments: words.counts };
        },
        driverSince: (ids) => identity.driverSinceOf(ids),
      }),
      inject: [OrdersService, TripsService, DispatchService, EtaService, IdentityService, BLOB_STORE, COURIER_VEHICLES, OrderComplimentsService, CLOCK],
    },
    { provide: HABITS_EVENTS, useFactory: (events: EventsService): HabitsEventsPort => ({ emit: (event, aggregate) => events.emit(undefined, event, aggregate) }), inject: [EventsService] },
    RideHabitsService,
    RiderDriversService,
    RegularTripJob,
  ],
  exports: [RideHabitsService, RegularTripJob],
})
export class RideHabitsModule implements OnModuleInit {
  constructor(
    private readonly orders: OrdersService,
    private readonly habits: RideHabitsService,
    private readonly riderDrivers: RiderDriversService,
    private readonly dispatch: DispatchService,
    @Inject(HABITS_RIDES) private readonly rides: HabitsRidesPort,
    @Inject(HABITS_SEARCH) private readonly search: HabitsSearchPort,
  ) {}

  /**
   * Orders asks this module who a booked ride's favourite is (joy l9); dispatch asks for a rider's
   * avoid list (s5), his favourites (s4) and the «عوائل» standing of drivers (s6) — ride step 3.
   */
  onModuleInit(): void {
    this.orders.bindFavourites({ driverFor: (personId, favouriteId) => this.habits.driverFor(personId, favouriteId) });
    this.dispatch.bindRiders({
      avoided: (personId) => this.riderDrivers.avoidedDriverIds(personId),
      favourites: (personId) => this.habits.favouriteDriverIds(personId),
      standing: async (ids) => {
        const [since, ratings] = await Promise.all([this.search.driverSince(ids), Promise.all(ids.map((id) => this.rides.driverRating(id)))]);
        return new Map(ids.map((id, i) => [id, { rating: ratings[i]?.rating ?? null, driverSince: since[id] ?? null }]));
      },
    });
  }
}

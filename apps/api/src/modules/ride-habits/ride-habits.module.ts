import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { publicCourierRating, type IntercityDirection, type LatLng, type Order, type Trip } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrdersModule, OrdersService, serverFees } from '../orders/index.js';
import { BLOB_STORE, PlacesModule, SavedPlacesService } from '../places/index.js';
import type { BlobStore } from '../places/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { CORRIDORS, DeparturesService, GARAGES, RoutesModule, RoutesRpc } from '../routes/index.js';
import { EtaService, RoutingModule } from '../routing/index.js';
import { TrackingModule, TrackingService, tripsOrdersRatings } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { FAVOURITE_READ_PURPOSE, HABITS_EVENTS, HABITS_PEOPLE, HABITS_RAJAA, HABITS_RIDES, type FinishedRide, type HabitsEventsPort, type HabitsPeoplePort, type HabitsRajaaPort, type HabitsRidesPort } from './ports.js';
import { registerFootprints } from './footprints.subscriber.js';
import { RegularTripJob } from './regular-trip.job.js';
import { InMemoryRideHabitsRepository, PrismaRideHabitsRepository, RIDE_HABITS_REPOSITORY, type RideHabitsRepository } from './ride-habits.repository.js';
import { RideHabitsService } from './ride-habits.service.js';
import { SameRideJob } from './same-ride.job.js';

const FINISHED = new Set<Order['state']>(['completed', 'closed']);
const MIN = 60_000;
/** A ride booked for within this many minutes of a habit's time is that day's ride already (o4). */
const RIDE_ON_BOOKED_MIN = 60;

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
  imports: [OrdersModule, TripsModule, TrackingModule, RoutesModule, IdentityModule, PlacesModule, PricingModule, RoutingModule, EventsModule],
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
        finishedOrderIds: async (ids) => {
          const found = await Promise.all(ids.map((id) => orders.get(id).catch(() => null)));
          return new Set(found.filter((o): o is Order => o !== null && o.type === 'ride' && FINISHED.has(o.state)).map((o) => o.id));
        },
        rideOn: async (personId, around) =>
          (await orders.listForPerson(personId)).some(
            (o) =>
              o.ordererId === personId &&
              o.type === 'ride' &&
              (o.state === 'matched' || (o.state === 'placed' && (!o.scheduledFor || Math.abs(o.scheduledFor.getTime() - around.getTime()) <= RIDE_ON_BOOKED_MIN * MIN))),
          ),
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
    { provide: HABITS_EVENTS, useFactory: (events: EventsService): HabitsEventsPort => ({ emit: (event, aggregate) => events.emit(undefined, event, aggregate) }), inject: [EventsService] },
    RideHabitsService,
    RegularTripJob,
    SameRideJob,
  ],
  exports: [RideHabitsService, RegularTripJob, SameRideJob],
})
export class RideHabitsModule implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly orders: OrdersService,
    private readonly habits: RideHabitsService,
    private readonly events: EventsService,
  ) {}

  /**
   * Orders asks this module who a booked ride's favourite is (joy l9); every placed ride leaves its
   * footprint for «نفس مشوار البارحة؟» (step 4, o4).
   */
  onModuleInit(): void {
    this.orders.bindFavourites({ driverFor: (personId, favouriteId) => this.habits.driverFor(personId, favouriteId) });
    this.unsubscribe = registerFootprints(this.events, this.habits);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}

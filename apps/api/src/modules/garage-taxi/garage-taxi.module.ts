import { Module } from '@nestjs/common';
import type { Order } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule, EventsService } from '../events/index.js';
import { OrdersModule, OrdersService, payable, serverFees } from '../orders/index.js';
import { PlacesModule, SavedPlacesService } from '../places/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { CORRIDORS, DeparturesService, GARAGES, RoutesModule } from '../routes/index.js';
import { EtaService, RoutingModule } from '../routing/index.js';
import { TrackingModule, TrackingService } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { GARAGE_TAXIS_REPOSITORY, InMemoryGarageTaxisRepository, PrismaGarageTaxisRepository, type GarageTaxisRepository } from './garage-taxi.repository.js';
import { GarageTaxiJob } from './garage-taxi.job.js';
import { GARAGE_TAXI_CITY, GARAGE_TAXI_EMITTER, GARAGE_TAXI_SOURCES, GarageTaxiService, type GarageTaxiEmitter, type GarageTaxiSources } from './garage-taxi.service.js';

const MIN = 60_000;

async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Taxis linked to a الرجعة seat (taxi ideas x2, x3, x4 + n10). Owns `garage_taxis` (Prisma with
 * DATABASE_URL, in memory otherwise). Reads seats and cars through the routes module's public
 * `DeparturesService` (never writes them), places rides through `OrdersService`, prices with
 * `serverFees` (the quote `orders.place` locks), times with the one ETA (`EtaService`,
 * `TrackingService.liveEta`), and tells people through the event log (notify subscribes).
 */
@Module({
  imports: [EventsModule, OrdersModule, PlacesModule, PricingModule, RoutesModule, RoutingModule, TrackingModule, TripsModule],
  providers: [
    {
      provide: GARAGE_TAXIS_REPOSITORY,
      useFactory: (prisma: PrismaService): GarageTaxisRepository => (prisma.configured ? new PrismaGarageTaxisRepository(prisma) : new InMemoryGarageTaxisRepository()),
      inject: [PrismaService],
    },
    {
      provide: GARAGE_TAXI_SOURCES,
      useFactory: (
        departures: DeparturesService,
        orders: OrdersService,
        places: SavedPlacesService,
        pricing: PricingService,
        eta: EtaService,
        trips: TripsService,
        tracking: TrackingService,
        clock: Clock,
      ): GarageTaxiSources => ({
        seat: (id) =>
          orNull(async () => {
            const b = await departures.booking(id);
            return { id: b.id, riderId: b.riderId, departureId: b.departureId, state: b.state, seatIds: b.seatIds, pickupKind: b.pickup.kind, movedToBookingId: b.movedToBookingId };
          }),
        car: (id) =>
          orNull(async () => {
            const d = await departures.departure(id);
            return { id: d.id, driverId: d.driverId, corridorId: d.corridorId, direction: d.direction, garageId: d.garageId, departAt: d.departAt, state: d.state, departedAt: d.departedAt, arrivedAt: d.arrivedAt, lastFix: d.lastPosition };
          }),
        garages: () => GARAGES.map((g) => ({ id: g.id, cityId: g.cityId, nameAr: g.nameAr, nameEn: g.nameEn, lat: g.lat, lng: g.lng, draft: g.draft })),
        travelMin: (corridorId) => CORRIDORS.find((c) => c.id === corridorId)?.travelMin ?? null,
        places: async (personId) =>
          (await places.mine(personId)).map((p) => ({ id: p.id, label: p.label, name: p.name, zoneName_ar: p.zoneName_ar, zoneId: p.zoneId, pin: p.pin })),
        zoneOf: (pin) => places.zoneFor(GARAGE_TAXI_CITY, pin).zoneId,
        minutes: async (from, to, at) => (await eta.minutes(from, to, 'car', at)).minutes,
        fare: (pickup, dropoff, at) => {
          const { fareIqd } = serverFees(pricing, { cityId: GARAGE_TAXI_CITY, type: 'ride', rideVertical: 'taxi', pickup, dropoff, options: { doorPickup: false }, at });
          return { fareIqd, totalIqd: payable('ride', 'cash', fareIqd).totalIqd };
        },
        place: (personId, i) =>
          orders.place(personId, {
            cityId: GARAGE_TAXI_CITY,
            type: 'ride',
            rideVertical: 'taxi',
            fareIqd: i.fareIqd,
            options: { doorPickup: false },
            paymentMethod: i.paymentMethod,
            pickup: i.pickup,
            dropoff: i.dropoff,
            ...(i.scheduledFor ? { scheduledFor: i.scheduledFor } : {}),
            clientRequestId: i.clientRequestId,
          }),
        order: (orderId) => orNull(() => orders.get(orderId)),
        usualPayment: async (personId) => {
          const rides = (await orders.listForPerson(personId))
            .filter((o: Order) => o.ordererId === personId && o.type === 'ride' && (o.paymentMethod === 'cash' || o.paymentMethod === 'wallet'))
            .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
          return rides[0] ? (rides[0].paymentMethod === 'wallet' ? 'wallet' : 'cash') : null;
        },
        // The same arrival the ride screens show: before pickup, the driver's ETA to the pickup + the ride.
        taxiLate: (riderId, bookingId, until) => departures.taxiLate(riderId, bookingId, until),
        seatHeldUntil: (bookingId) =>
          orNull(async () => {
            const b = await departures.booking(bookingId);
            const held = b.state === 'booked' ? departures.seatHeldUntil(await departures.departure(b.departureId), b) : null;
            return held && held.getTime() > clock.now().getTime() ? held : null;
          }),
        rideArrival: (orderId) =>
          orNull(async () => {
            const [order, trip] = await Promise.all([orders.get(orderId), trips.activeForOrder(orderId)]);
            if (!trip) return null;
            const now = clock.now();
            const fix = await trips.lastPosition(trip.id);
            const live = fix ? await tracking.liveEta(order, trip, fix.pin, now) : null;
            if (trip.state === 'in_transit' || trip.state === 'arrived_dropoff') return live?.at ?? null;
            const pickup = trip.stops.find((s) => s.orderId === orderId && s.type === 'pickup')?.target ?? null;
            const dropoff = trip.stops.find((s) => s.orderId === orderId && s.type === 'dropoff')?.target ?? null;
            if (!pickup || !dropoff) return null;
            return new Date((live?.at ?? now).getTime() + (await eta.minutes(pickup, dropoff, 'car')).minutes * MIN);
          }),
      }),
      inject: [DeparturesService, OrdersService, SavedPlacesService, PricingService, EtaService, TripsService, TrackingService, CLOCK],
    },
    { provide: GARAGE_TAXI_EMITTER, useFactory: (events: EventsService): GarageTaxiEmitter => ({ emit: async (event, aggregate) => void (await events.emit(undefined, event, aggregate)) }), inject: [EventsService] },
    GarageTaxiService,
    GarageTaxiJob,
  ],
  exports: [GarageTaxiService, GarageTaxiJob],
})
export class GarageTaxiModule {}

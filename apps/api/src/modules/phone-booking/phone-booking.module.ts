import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { DispatchModule, DispatchService } from '../dispatch/index.js';
import { EventsModule } from '../events/index.js';
import { ErasureRegistry, IdentityModule } from '../identity/index.js';
import { NotifyModule } from '../notify/index.js';
import { OrdersModule, serverFees } from '../orders/index.js';
import { PlacesModule, SavedPlacesService } from '../places/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { EtaService, RoutingModule } from '../routing/index.js';
import { COURIER_VEHICLES, ShareLinksService, TrackingModule, type CourierVehicleDirectory } from '../tracking/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { InMemoryPhoneBookingsRepository, PHONE_BOOKINGS_REPOSITORY, PrismaPhoneBookingsRepository, type PhoneBookingsRepository } from './phone-booking.repository.js';
import { PHONE_BOOKING_SOURCES, PhoneBookingService, type PhoneBookingSources } from './phone-booking.service.js';

async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * «حجز بالتلفون» (taxi/tuktuk step 4). Owns `phone_bookings` (Prisma with DATABASE_URL, in memory
 * otherwise). Places the ride through `OrdersService`; reads landmarks and zones from places, the
 * fare from pricing (`serverFees`, as `orders.place` does), minutes from routing, the trip, its driver
 * and his vehicle from trips/tracking/dispatch; names and numbers through identity (logged vault
 * reads); texts the caller through notify; audits through controls.
 *
 * Env: SHARE_LINK_BASE_URL (the trip link in the SMS, default https://driver.iq).
 */
@Module({
  imports: [ControlsModule, DispatchModule, EventsModule, IdentityModule, NotifyModule, OrdersModule, PlacesModule, PricingModule, RoutingModule, TrackingModule, TripsModule],
  providers: [
    {
      provide: PHONE_BOOKINGS_REPOSITORY,
      useFactory: (prisma: PrismaService): PhoneBookingsRepository => (prisma.configured ? new PrismaPhoneBookingsRepository(prisma) : new InMemoryPhoneBookingsRepository()),
      inject: [PrismaService],
    },
    {
      provide: PHONE_BOOKING_SOURCES,
      useFactory: (
        places: SavedPlacesService,
        pricing: PricingService,
        eta: EtaService,
        trips: TripsService,
        vehicles: CourierVehicleDirectory,
        dispatch: DispatchService,
        shares: ShareLinksService,
      ): PhoneBookingSources => ({
        landmarks: async (cityId) => (await places.landmarks(cityId)).map((l) => ({ id: l.id, name_ar: l.name_ar, pin: l.pin, zoneId: l.zoneId })),
        zoneName: (cityId, pin) => places.zoneFor(cityId, pin).zoneName_ar,
        fare: (q) => serverFees(pricing, { cityId: q.cityId, type: 'ride', rideVertical: q.vertical, pickup: q.pickup, dropoff: q.dropoff, options: { doorPickup: false }, at: q.at }).fareIqd,
        minutes: (from, to, vehicle, at) => orNull(async () => (await eta.minutes(from, to, vehicle, at)).minutes),
        ride: (orderId) =>
          orNull(async () => {
            const c = await trips.courierOf(orderId);
            return c ? { trip: await trips.get(c.tripId), driverId: c.courierId } : null;
          }),
        vehicle: (driverId, vehicleId) => orNull(() => vehicles.forCourier(driverId, vehicleId)),
        driverPin: async (tripId, driverId) => {
          const last = await orNull(() => trips.lastPosition(tripId));
          if (last) return last.pin;
          const online = await orNull(() => dispatch.presence.get(driverId));
          return online ? { lat: online.lat, lng: online.lng } : null;
        },
        // The caller's own «شارك» link (made for him, as the night auto-share does).
        shareLink: (personId, orderId) =>
          orNull(async () => {
            const link = await shares.createShareLink({ personId, sessionId: 'system:phone_booking' }, { orderId });
            return `${(process.env['SHARE_LINK_BASE_URL'] ?? 'https://driver.iq').replace(/\/$/, '')}${link.path}`;
          }),
      }),
      inject: [SavedPlacesService, PricingService, EtaService, TripsService, COURIER_VEHICLES, DispatchService, ShareLinksService],
    },
    PhoneBookingService,
  ],
  exports: [PhoneBookingService],
})
export class PhoneBookingModule implements OnModuleInit {
  constructor(
    @Inject(PHONE_BOOKINGS_REPOSITORY) private readonly repo: PhoneBookingsRepository,
    private readonly erasure: ErasureRegistry,
  ) {}

  onModuleInit(): void {
    // W7 account deletion: the place names said on his phone bookings are blanked.
    this.erasure.register({ owner: 'phone-booking', tables: ['public.phone_bookings'], erase: (personId) => this.repo.blankPlacesOf(personId) });
  }
}

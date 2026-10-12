import { Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { baseUrlFromEnv } from '../../shared/public-url.js';
import { SMS_DAY_KEY, SMS_DAY_MS, smsBudgetThrottlesFromEnv, smsDailyBudgetFromEnv } from '../../shared/sms-budget.js';
import { WINDOW_COUNTER, type WindowCounter } from '../../shared/window-counter.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { NotifyModule, NotifyService } from '../notify/index.js';
import { identityRiders, OrdersModule, OrdersService, orgsHouseholds } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { BLOB_STORE, ownsStoredUpload, PlacesModule, SavedPlacesService, type BlobStore } from '../places/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { ParcelsJob } from './parcels.job.js';
import { InMemoryParcelsRepository, PARCELS_REPOSITORY, PrismaParcelsRepository, type ParcelsRepository } from './parcels.repository.js';
import { ParcelsService, orderInput } from './parcels.service.js';
import {
  PARCELS_LINK_BASE,
  PARCELS_NOTIFY,
  PARCELS_ORDERS,
  PARCELS_PEOPLE,
  PARCELS_PLACES,
  PARCELS_RIDERS,
  PARCELS_SMS_BUDGET,
  type ParcelsNotifyPort,
  type ParcelsOrdersPort,
  type ParcelsPeoplePort,
  type ParcelsPlacesPort,
  type ParcelsSmsBudgetPort,
} from './ports.js';

const photoOf = (proof: Record<string, unknown> | undefined): string | null => (typeof proof?.['photoUploadId'] === 'string' ? proof['photoUploadId'] : null);

/**
 * طرود: owns `parcel_sends`. Places courier orders through orders only; the receiver's name lives in the
 * identity vault (participant names, `parcel:<id>`). Env: SHARE_LINK_BASE_URL (the receiver's link; unset: no link
 * and no door-link text). The receiver's texts go through notify (`parcel_door_link`, `parcel_pin`) and count in
 * the day's SMS budget (OTP_SMS_DAILY_BUDGET; past it, with OTP_BUDGET_MODE=throttle, parcels send none).
 */
@Module({
  imports: [OrdersModule, TripsModule, IdentityModule, OrgsModule, PlacesModule, NotifyModule],
  providers: [
    {
      provide: PARCELS_REPOSITORY,
      useFactory: (prisma: PrismaService): ParcelsRepository => (prisma.configured ? new PrismaParcelsRepository(prisma) : new InMemoryParcelsRepository()),
      inject: [PrismaService],
    },
    {
      provide: PARCELS_ORDERS,
      useFactory: (orders: OrdersService, trips: TripsService): ParcelsOrdersPort => ({
        fare: async (senderId, i) => (await orders.quote(senderId, orderInput({ id: 'quote', cityId: i.cityId, pickup: i.pickup, courierNote: null }, i.dropoff))).totalIqd,
        place: (senderId, input) => orders.place(senderId, input),
        order: (orderId) => orders.get(orderId).catch(() => null),
        cancel: (senderId, orderId) => orders.cancel(senderId, { orderId, reason: 'parcel_cancelled' }),
        courierOf: async (orderId) => {
          const c = await trips.courierOf(orderId);
          return c ? { tripId: c.tripId, courierId: c.courierId } : null;
        },
        lastFix: async (tripId) => (await trips.lastPosition(tripId))?.pin ?? null,
        proofs: async (orderId) => {
          const carried = await trips.courierOf(orderId);
          if (!carried) return { pickup: null, dropoff: null };
          const trip = await trips.get(carried.tripId);
          const stop = (type: 'pickup' | 'dropoff') => trip.stops.find((s) => s.orderId === orderId && s.type === type);
          return { pickup: photoOf(stop('pickup')?.handoverProof), dropoff: photoOf(stop('dropoff')?.handoverProof) };
        },
      }),
      inject: [OrdersService, TripsService],
    },
    {
      provide: PARCELS_PEOPLE,
      useFactory: (identity: IdentityService): ParcelsPeoplePort => ({
        firstName: async (personId, accessorId, purpose) => (await identity.firstNamesFor([personId], accessorId, purpose))[personId] ?? null,
        phoneMasked: async (personId, accessorId, purpose) => (await identity.memberCards([personId], accessorId, purpose))[personId]?.phoneMasked ?? null,
      }),
      inject: [IdentityService],
    },
    {
      provide: PARCELS_PLACES,
      useFactory: (saved: SavedPlacesService, blobs: BlobStore): ParcelsPlacesPort => ({
        zoneOf: (cityId, pin) => saved.zones.resolve(cityId, pin),
        zone: (cityId, zoneKey) => {
          const centre = saved.zones.centre(cityId, zoneKey);
          return centre ? { name: saved.zones.names(cityId, zoneKey).ar, centre } : null;
        },
        photoOwned: (uploadId, personId) => ownsStoredUpload(blobs, uploadId, personId),
        photoUrl: (uploadId) => blobs.readUrl(uploadId),
      }),
      inject: [SavedPlacesService, BLOB_STORE],
    },
    { provide: PARCELS_RIDERS, useFactory: (identity: IdentityService, orgs: OrgsService) => identityRiders(identity, orgsHouseholds(orgs)), inject: [IdentityService, OrgsService] },
    { provide: PARCELS_LINK_BASE, useFactory: () => baseUrlFromEnv('SHARE_LINK_BASE_URL') },
    { provide: PARCELS_NOTIFY, useFactory: (notify: NotifyService): ParcelsNotifyPort => ({ dispatch: (req) => notify.dispatch(req) }), inject: [NotifyService] },
    {
      provide: PARCELS_SMS_BUDGET,
      useFactory: (counter: WindowCounter): ParcelsSmsBudgetPort => {
        const budget = smsDailyBudgetFromEnv();
        const throttle = smsBudgetThrottlesFromEnv();
        // The same rolling count notify and the OTP guard keep; a counter that can't be read never stops a text.
        return { spent: async () => throttle && (await counter.count(SMS_DAY_KEY, SMS_DAY_MS).catch(() => 0)) >= budget };
      },
      inject: [WINDOW_COUNTER],
    },
    ParcelsService,
    ParcelsJob,
  ],
  exports: [ParcelsService],
})
export class ParcelsModule implements OnModuleInit {
  constructor(
    private readonly trips: TripsService,
    private readonly parcels: ParcelsService,
  ) {}

  /** Trips asks parcels before a parcel drop-off completes (the receiver's code); trips never imports parcels. */
  onModuleInit(): void {
    this.trips.bindDropoffGuard({ check: (orderId) => this.parcels.dropoffProblem(orderId) });
  }
}

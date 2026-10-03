import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CatalogModule, CatalogService } from '../catalog/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { Accounts, LedgerModule, LedgerService } from '../ledger/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import {
  TRACKING_IDENTITY,
  TRACKING_MERCHANTS,
  TRACKING_ORDERS,
  TRACKING_POINTS,
  TRACKING_TRIPS,
  TrackingService,
  type TrackingMerchantsPort,
  type TrackingPointsPort,
} from './tracking.service.js';
import { COURIER_VEHICLES, InMemoryCourierVehicles, PrismaCourierVehicles, type CourierVehicleDirectory } from './vehicles.js';

const POINTS_EARNED_TYPES = new Set(['points_earned', 'organizer_bonus']);

/**
 * The customer's live order/ride screen (`orders.track`, `orders.courierPosition`): a read side that
 * composes orders, trips, identity (first name, logged), orgs/catalog (names) and the ledger (points
 * earned). Owns no tables; the vehicle registry read is narrow and read-only.
 */
@Module({
  imports: [OrdersModule, TripsModule, IdentityModule, OrgsModule, CatalogModule, LedgerModule],
  providers: [
    { provide: TRACKING_ORDERS, useExisting: OrdersService },
    { provide: TRACKING_TRIPS, useExisting: TripsService },
    { provide: TRACKING_IDENTITY, useExisting: IdentityService },
    {
      provide: TRACKING_MERCHANTS,
      useFactory: (orgs: OrgsService, catalog: CatalogService): TrackingMerchantsPort => ({
        merchant: (orgId) => {
          try {
            const org = orgs.get(orgId);
            return { name: org.name, pin: orgs.merchantSettings(orgId).location?.pin ?? null };
          } catch {
            return null;
          }
        },
        itemNames: async (orgId, ids) => new Map((await catalog.itemsOf(orgId, ids)).map((i) => [i.id, i.nameAr])),
      }),
      inject: [OrgsService, CatalogService],
    },
    {
      provide: TRACKING_POINTS,
      useFactory: (ledger: LedgerService): TrackingPointsPort => ({
        earnedOn: async (personId, orderId) => {
          const account = Accounts.points(personId);
          let sum = 0;
          for (const e of await ledger.eventsFor(account)) {
            if (e.orderId !== orderId || !POINTS_EARNED_TYPES.has(e.type)) continue;
            sum += e.toAccount === account ? e.amount : -e.amount;
          }
          return Math.max(0, sum);
        },
      }),
      inject: [LedgerService],
    },
    {
      provide: COURIER_VEHICLES,
      useFactory: (prisma: PrismaService): CourierVehicleDirectory => (prisma.configured ? new PrismaCourierVehicles(prisma) : new InMemoryCourierVehicles()),
      inject: [PrismaService],
    },
    TrackingService,
  ],
  exports: [TrackingService, COURIER_VEHICLES],
})
export class TrackingModule {}

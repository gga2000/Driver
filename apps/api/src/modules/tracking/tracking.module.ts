import { RoutingModule } from '../routing/index.js';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CatalogModule, CatalogService } from '../catalog/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { Accounts, LedgerModule, LedgerService } from '../ledger/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { CORRIDORS, DeparturesService, RoutesModule } from '../routes/index.js';
import {
  InMemoryShareLinksRepository,
  PrismaShareLinksRepository,
  SHARE_DELIVERY_ETA,
  SHARE_INTERCITY,
  SHARE_LINKS_REPOSITORY,
  SHARE_NAMES,
  SHARE_SECRET,
  ShareLinksService,
  shareSecret,
  type ShareIntercityPort,
} from './share-links.js';
import { eventsLateApology, LateApologySweeper, LatePromiseSubscriber, ledgerLateCredit } from './late-promise.js';
import {
  TRACKING_IDENTITY,
  TRACKING_LATE_APOLOGY,
  TRACKING_LATE_CREDIT,
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
  imports: [OrdersModule, TripsModule, IdentityModule, OrgsModule, CatalogModule, LedgerModule, RoutesModule, RoutingModule, EventsModule],
  providers: [
    { provide: TRACKING_ORDERS, useExisting: OrdersService },
    { provide: TRACKING_TRIPS, useExisting: TripsService },
    { provide: TRACKING_IDENTITY, useExisting: IdentityService },
    {
      provide: TRACKING_MERCHANTS,
      useFactory: (orgs: OrgsService, catalog: CatalogService): TrackingMerchantsPort => ({
        merchant: async (orgId) => {
          const org = await orgs.find(orgId);
          return org ? { name: org.name, pin: org.merchant?.location?.pin ?? null } : null;
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
    // Audit d-5: the honest-delay credit (delivery fee back as wallet credit past the promise).
    { provide: TRACKING_LATE_CREDIT, useFactory: (ledger: LedgerService) => ledgerLateCredit(ledger), inject: [LedgerService] },
    // Its first step (Ali, 2026-10-06): one apology with the new time, sent by the sweep or a track read.
    { provide: TRACKING_LATE_APOLOGY, useFactory: (events: EventsService) => eventsLateApology(events), inject: [EventsService] },
    TrackingService,
    LatePromiseSubscriber,
    LateApologySweeper,
    // Share-trip links (`tracking.createShareLink` / `revokeShareLink` / `shared`).
    {
      provide: SHARE_LINKS_REPOSITORY,
      useFactory: (prisma: PrismaService) => (prisma.configured ? new PrismaShareLinksRepository(prisma) : new InMemoryShareLinksRepository()),
      inject: [PrismaService],
    },
    { provide: SHARE_NAMES, useExisting: IdentityService },
    { provide: SHARE_DELIVERY_ETA, useExisting: TrackingService },
    { provide: SHARE_SECRET, useFactory: () => shareSecret() },
    {
      provide: SHARE_INTERCITY,
      useFactory: (departures: DeparturesService): ShareIntercityPort => ({
        booking: (id) => departures.booking(id),
        departure: (id) => departures.departure(id),
        boardingWindowMin: () => departures.rules.boardingWindowMin,
        travelMin: (corridorId) => CORRIDORS.find((c) => c.id === corridorId)?.travelMin ?? null,
      }),
      inject: [DeparturesService],
    },
    ShareLinksService,
  ],
  exports: [TrackingService, COURIER_VEHICLES, ShareLinksService],
})
export class TrackingModule {}

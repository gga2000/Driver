import { Module, type OnModuleInit } from '@nestjs/common';
import { baghdadMonthRange } from '@driver/contracts';
import { CatalogModule, CatalogService } from '../catalog/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { Accounts, LedgerModule, LedgerService, savedBetween } from '../ledger/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { HouseholdsRpc, OrgsModule, OrgsService } from '../orgs/index.js';
import { RoutesModule, RoutesRpc } from '../routes/index.js';
import { INSIGHTS_SOURCES, InsightsService, type InsightsSources } from './insights.service.js';
import { MONTH_CARD_SOURCES, MonthCardJob, type MonthCardSources } from './month-card.job.js';

/**
 * Joy w4 / w6 read side: «شهرك» (`wallet.month`), the month-start card's event, and the household
 * hub's month (spend per member, «سفرة البيت»), composed from orders, orgs/catalog names, الرجعة
 * bookings and the ledger. Owns no tables.
 */
@Module({
  imports: [OrdersModule, OrgsModule, CatalogModule, LedgerModule, RoutesModule, EventsModule],
  providers: [
    {
      provide: INSIGHTS_SOURCES,
      useFactory: (orders: OrdersService, orgs: OrgsService, catalog: CatalogService, routes: RoutesRpc, ledger: LedgerService): InsightsSources => ({
        ordersPlacedBy: async (personId, from, to) =>
          (await orders.placedByBetween(personId, from, to)).map(({ order, lines }) => ({
            id: order.id,
            type: order.type,
            state: order.state,
            merchantOrgId: order.merchantOrgId,
            placedAt: order.placedAt,
            deliveredAt: order.deliveredAt,
            lines: lines.map((l) => ({ catalogItemId: l.catalogItemId, qty: l.qty, removed: l.substitution?.state === 'removed' })),
          })),
        merchantName: async (orgId) => (await orgs.find(orgId))?.name ?? null,
        itemNames: async (orgId, ids) => new Map((await catalog.itemsOf(orgId, ids)).map((i) => [i.id, i.nameAr])),
        seatsTravelled: async (personId, from, to) =>
          (await routes.myBookings({ personId, sessionId: 'insights' })).filter((b) => b.state === 'completed' && b.completedAt !== null && b.completedAt >= from && b.completedAt < to).length,
        eventsFor: (account) => ledger.eventsFor(account),
        saved: (personId, events, from, to) => savedBetween(Accounts.customer(personId), events, from, to),
        customerAccount: (personId) => Accounts.customer(personId),
        pointsAccount: (personId) => Accounts.points(personId),
      }),
      inject: [OrdersService, OrgsService, CatalogService, RoutesRpc, LedgerService],
    },
    InsightsService,
    {
      provide: MONTH_CARD_SOURCES,
      useFactory: (orders: OrdersService, events: EventsService): MonthCardSources => ({
        activePeople: (from, to) => orders.orderersServedBetween(from, to),
        emit: (event, aggregate) => events.emit(undefined, event, aggregate),
      }),
      inject: [OrdersService, EventsService],
    },
    MonthCardJob,
  ],
  exports: [InsightsService, MonthCardJob],
})
export class InsightsModule implements OnModuleInit {
  constructor(
    private readonly households: HouseholdsRpc,
    private readonly orders: OrdersService,
    private readonly orgs: OrgsService,
  ) {}

  /** Joy w4: the hub's month — the household's orders this month with each kitchen's name. */
  onModuleInit(): void {
    this.households.bindMonthOrders(async ({ householdId, memberIds, month }) => {
      const { from, to } = baghdadMonthRange(month);
      const rows = await this.orders.householdOrdersBetween(householdId, memberIds, from, to);
      const names = new Map<string, string | null>();
      for (const id of new Set(rows.map((o) => o.merchantOrgId).filter((x): x is string => x !== null))) names.set(id, (await this.orgs.find(id))?.name ?? null);
      return rows.map((o) => ({
        orderId: o.id,
        ordererId: o.ordererId,
        householdOrgId: o.householdOrgId,
        familyTable: o.familyTable ?? false,
        heldForPayer: o.heldForPayer ?? false,
        merchantName: o.merchantOrgId ? (names.get(o.merchantOrgId) ?? null) : null,
        totalIqd: o.totalIqd,
        state: o.state,
        placedAt: o.placedAt,
      }));
    });
  }
}

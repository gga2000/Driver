import { RoutingModule } from '../routing/index.js';
import { AZIZIYAH_MONEY_RULES } from '@driver/contracts';
import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { CatalogModule, CatalogRpc, CatalogService, STOREFRONT_MERCHANTS, STOREFRONT_PHOTOS, STOREFRONT_TODAY, type StorefrontToday } from '../catalog/index.js';
import { RoutesModule, RoutesRpc } from '../routes/index.js';
import { Accounts, CapsService, LedgerModule, LedgerService } from '../ledger/index.js';
import { ControlsModule, ControlsService } from '../controls/index.js';
import { HouseholdsRpc, OrgsModule, OrgsService } from '../orgs/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { PromotionsModule, PromotionsService } from '../promotions/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { ORDERS_CATALOG } from './catalog.port.js';
import { ORDERS_CONTROLS } from './controls.port.js';
import { EventsServiceAdapter, ORDER_EVENTS } from './events.adapter.js';
import { ORDERS_HOUSEHOLDS, orgsHouseholds } from './households.port.js';
import { MERCHANT_DIRECTORY, OrgsMerchantDirectory, type MerchantDirectory } from './merchants.port.js';
import { InMemoryOrdersRepository, ORDERS_REPOSITORY, PrismaOrdersRepository, type OrdersRepository } from './orders.repository.js';
import { ORDERS_ROLE_CHECKER, OrdersRpc } from './orders.rpc.js';
import { ORDERS_CASH_RISK, ORDERS_PLACES, ORDERS_PRICING, ORDERS_QUEUE, ORDERS_TRIPS, ORDERS_WALLET, OrdersService, type OrderTimerJob, type OrdersWalletPort } from './orders.service.js';
import { BLOB_STORE, PlacesModule, SavedPlacesService } from '../places/index.js';
import { PARTICIPANT_RESOLVER, type ParticipantResolver } from './participants.js';
import { MerchantDealsPromotions } from './promotions.adapter.js';
import { ORDERS_PROMOTIONS, type PromotionsPort } from './promotions.port.js';
import { OrdersStorefrontMerchants } from './storefront.port.js';
import { OrderTipsService } from './tips.js';

function timersQueue<T>(name: string, factory: BullMqQueueFactory, clock: Clock): Queue<T> {
  return factory.configured ? factory.queue<T>(name) : new InMemoryQueue<T>(name, () => clock.now());
}

/**
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory twin otherwise; timers on the
 * `orders.timers` queue; merchants read through `OrgsService`; participant phones resolved by
 * identity (hash only); the new-customer cash cap read from the ledger's caps; trip events consumed
 * from the outbox as the `orders:trip-events` subscriber.
 */
@Module({
  imports: [EventsModule, TripsModule, PricingModule, OrgsModule, IdentityModule, LedgerModule, CatalogModule, PromotionsModule, ControlsModule, RoutingModule, RoutesModule, PlacesModule],
  providers: [
    {
      provide: ORDERS_REPOSITORY,
      useFactory: (prisma: PrismaService): OrdersRepository => (prisma.configured ? new PrismaOrdersRepository(prisma) : new InMemoryOrdersRepository()),
      inject: [PrismaService],
    },
    { provide: ORDER_EVENTS, useFactory: (events: EventsService) => new EventsServiceAdapter(events), inject: [EventsService] },
    { provide: ORDERS_QUEUE, useFactory: (f: BullMqQueueFactory, clock: Clock) => timersQueue<OrderTimerJob>('orders.timers', f, clock), inject: [BullMqQueueFactory, CLOCK] },
    { provide: ORDERS_TRIPS, useExisting: TripsService },
    // M2 review follow-up: fees come from this quote engine at placement, never from the client.
    { provide: ORDERS_PRICING, useExisting: PricingService },
    // Discounts only from the server: merchant deals from the promotions module (best one, spend reserved
    // atomically in the order's transaction); platform codes resolve nothing yet.
    { provide: ORDERS_PROMOTIONS, useFactory: (promotions: PromotionsService) => new MerchantDealsPromotions(promotions), inject: [PromotionsService] },
    // Decisions §4 new-customer cash cap, enforced at place(): the ledger counts completed cash orders.
    { provide: ORDERS_CASH_RISK, useExisting: CapsService },
    // Maps program SP3d: an order links to the saved place it goes to only when the orderer may use it.
    { provide: ORDERS_PLACES, useExisting: SavedPlacesService },
    // C-04: wallet payments at checkout are checked against the ledger balance of the paying wallet.
    {
      provide: ORDERS_WALLET,
      useFactory: (ledger: LedgerService): OrdersWalletPort => ({
        balanceIqd: async ({ customerId, householdId }) => (await ledger.balance(householdId ? Accounts.household(householdId) : Accounts.customer(customerId))).amount,
        // W-02: points at checkout read the customer's own points account.
        pointsBalance: async (customerId) => (await ledger.balance(Accounts.points(customerId))).amount,
      }),
      inject: [LedgerService],
    },
    // Review C2: line prices come from the merchant's menu (catalog module), never from the client.
    { provide: ORDERS_CATALOG, useExisting: CatalogService },
    // Joy w4: who may spend the household wallet, their limits and budgets, the payer's approval.
    { provide: ORDERS_HOUSEHOLDS, useFactory: (orgs: OrgsService) => orgsHouseholds(orgs), inject: [OrgsService] },
    { provide: MERCHANT_DIRECTORY, useFactory: (orgs: OrgsService, clock: Clock) => new OrgsMerchantDirectory(orgs, () => clock.now()), inject: [OrgsService, CLOCK] },
    {
      provide: PARTICIPANT_RESOLVER,
      useFactory: (identity: IdentityService): ParticipantResolver => ({ resolvePhone: (phone) => identity.phoneRef(phone) }),
      inject: [IdentityService],
    },
    { provide: ORDERS_ROLE_CHECKER, useExisting: IdentityService },
    // Launch controls: kill switches and the zone throttle gate `place()` (playbook §3).
    { provide: ORDERS_CONTROLS, useExisting: ControlsService },
    // M3 customer catalog read: cards are open exactly when place() takes orders, fees as place() charges.
    {
      provide: STOREFRONT_MERCHANTS,
      useFactory: (dir: MerchantDirectory, deals: PromotionsPort, repo: OrdersRepository) => new OrdersStorefrontMerchants(dir, deals, repo),
      inject: [MERCHANT_DIRECTORY, ORDERS_PROMOTIONS, ORDERS_REPOSITORY],
    },
    // Audit d-6: the welcome screen's الرجعة line and the late-delivery promise (`catalog.today`).
    {
      provide: STOREFRONT_TODAY,
      useFactory: (routes: RoutesRpc): StorefrontToday => ({ rajaa: () => routes.today(), latePromiseMin: () => AZIZIYAH_MONEY_RULES.latePromise.afterMin }),
      inject: [RoutesRpc],
    },
    // Merchant-uploaded dish photos (`upload:<id>`) reach customers as signed links from the blob store.
    { provide: STOREFRONT_PHOTOS, useExisting: BLOB_STORE },
    CatalogRpc,
    OrdersService,
    // «تحب تكرم عباس؟»: the tip after a 4–5 rating, wallet → driver (docs/api/tips.md).
    OrderTipsService,
    OrdersRpc,
  ],
  exports: [OrdersService, OrdersRpc, CatalogRpc, OrderTipsService],
})
export class OrdersModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersModule.name);

  private poller: NodeJS.Timeout | undefined;

  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(ORDERS_QUEUE) private readonly queue: Queue<OrderTimerJob>,
    @Inject(ORDER_EVENTS) private readonly events: EventsServiceAdapter,
    private readonly orders: OrdersService,
    private readonly controls: ControlsService,
    private readonly trips: TripsService,
    private readonly households: HouseholdsRpc,
  ) {}

  onModuleInit(): void {
    // The throttle and the console's zone gauges count active orders here (orders owns them).
    this.controls.bindActiveOrders((cityId) => this.orders.activeByZone(cityId));
    // "الخردة علينا": a drop-off's cash is checked against its order before trips records it.
    this.trips.bindHandoverCheck({ check: (orderId, handover) => (orderId ? this.orders.handoverProblem(orderId, handover) : Promise.resolve(handover.changeToWalletIqd !== undefined ? 'change_to_wallet_not_cash' : null)) });
    // Joy w4: a payer's yes or no moves the held household order (its timer settles it otherwise).
    this.households.bindDecision((req) => (req.state === 'approved' || req.state === 'declined' ? this.orders.onPayerDecision(req.orderId, req.state) : Promise.resolve()));
    // Named outbox subscriber: a failure is retried with backoff by the publisher (and logged there).
    this.unsubscribe = this.events.subscribeToTrips((e) => this.orders.onTripEvent(e));
    const q = this.queue;
    if (q instanceof InMemoryQueue) {
      this.poller = setInterval(() => {
        q.drain().catch((err: unknown) => this.logger.error(`orders timer failed: ${(err as Error).message}`));
      }, 1000);
      this.poller.unref();
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.poller) clearInterval(this.poller);
  }
}

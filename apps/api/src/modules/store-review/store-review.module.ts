import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { CatalogModule, CatalogService } from '../catalog/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { StoreReviewRunner, type StoreReviewJob } from './runner.js';
import { ensureTestKitchenMenu, ensureTestKitchenOrg } from './test-kitchen.js';

export const STORE_REVIEW_QUEUE = Symbol('STORE_REVIEW_QUEUE');

/** Subscriber name (the dedupe key in `subscriber_deliveries`): the test kitchen accepted a test order. */
export const STORE_REVIEW_SUBSCRIBER = 'store-review:accepted';

/**
 * The store reviewers' test kitchen (BENCH-04). Only while the store-reviewer sign-in is configured
 * (`STORE_REVIEW_PHONE` / `STORE_REVIEW_CODE` in the host's secrets): makes sure the test crew and the
 * test kitchen exist (once, under a lock across machines), and walks each accepted test order to the
 * door on the `store-review.steps` queue. Off, it does nothing at all.
 */
@Module({
  imports: [EventsModule, IdentityModule, OrgsModule, CatalogModule, OrdersModule, TripsModule],
  providers: [
    {
      provide: STORE_REVIEW_QUEUE,
      useFactory: (f: BullMqQueueFactory, clock: Clock): Queue<StoreReviewJob> =>
        f.configured
          ? f.queue<StoreReviewJob>('store-review.steps')
          : new InMemoryQueue<StoreReviewJob>('store-review.steps', () => clock.now()),
      inject: [BullMqQueueFactory, CLOCK],
    },
  ],
})
export class StoreReviewModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreReviewModule.name);
  private readonly offs: Array<() => void> = [];
  private poller: NodeJS.Timeout | undefined;

  constructor(
    @Inject(STORE_REVIEW_QUEUE) private readonly queue: Queue<StoreReviewJob>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly events: EventsService,
    private readonly identity: IdentityService,
    private readonly orgs: OrgsService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
    private readonly trips: TripsService,
  ) {}

  onModuleInit(): void {
    if (!this.identity.storeReviewEnabled) return;
    const runner = new StoreReviewRunner(this.orders, this.trips, this.queue, this.clock);
    this.queue.process((job) => runner.run(job.data));
    // Test events reach only subscribers that opt in; this one acts on test orders and nothing else.
    this.offs.push(
      this.events.subscribe(
        STORE_REVIEW_SUBSCRIBER,
        ['order.accepted', 'order.auto_accepted'],
        (e) => runner.accepted(e.orderId ?? e.aggregateId),
        { test: true },
      ),
    );
    void this.ensureKitchen();
    const q = this.queue;
    if (q instanceof InMemoryQueue) {
      this.poller = setInterval(() => {
        q.drain().catch((err: unknown) =>
          this.logger.error(`store-review step failed: ${(err as Error).message}`),
        );
      }, 1000);
      this.poller.unref();
    }
  }

  onModuleDestroy(): void {
    for (const off of this.offs.splice(0)) off();
    if (this.poller) clearInterval(this.poller);
  }

  /**
   * Reviewer account, crew and kitchen, made once across machines: the org under the kitchen lock in its own
   * transaction (so it is committed before anything points at it), then the menu under the same lock.
   */
  async ensureKitchen(): Promise<string | null> {
    try {
      const lock = new DistributedKeyedLock(this.uow, 'store_review');
      await lock.run('reviewer', () => this.identity.ensureStoreReviewer());
      const crewId = await this.identity.ensureTestCrew();
      const orgId = await lock.run('kitchen', () => ensureTestKitchenOrg(this.orgs, crewId));
      await lock.run('kitchen', () => ensureTestKitchenMenu(this.catalog, orgId));
      return orgId;
    } catch (err) {
      this.logger.error(`store-review test kitchen not ready: ${(err as Error).message}`);
      return null;
    }
  }
}

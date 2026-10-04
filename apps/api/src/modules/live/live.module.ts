import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { afterCommit } from '../../shared/db/unit-of-work.js';
import { EventsModule, EventsService, type PublishedEvent } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { InMemoryLiveBus, LIVE_BUS, RedisLiveBus, type LiveBus } from './live.bus.js';
import { fanout, type FanoutLookups } from './live.fanout.js';
import { PositionFanout } from './live.positions.js';
import { LIVE_SESSIONS, LIVE_TOKENS, LiveService } from './live.service.js';
import { StreamTokens, liveTokenKey } from './live.tokens.js';

export const LIVE_FANOUT_SUBSCRIBER = 'live:fanout';

/**
 * The outbox subscriber that turns every domain event into live events (`fanout`) and the observer
 * that turns committed courier positions into throttled position/pin events. Publishing happens
 * after the delivery commits; a failure is logged and never fails the delivery (live events are
 * best-effort: clients resync on reconnect and keep a slow safety refetch).
 */
@Injectable()
export class LiveFanoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveFanoutService.name);
  private readonly positions: PositionFanout;
  private readonly offs: Array<() => void> = [];
  readonly lookups: FanoutLookups;

  constructor(
    @Inject(LIVE_BUS) private readonly bus: LiveBus,
    private readonly events: EventsService,
    private readonly orders: OrdersService,
    private readonly trips: TripsService,
  ) {
    this.positions = new PositionFanout(bus, trips);
    this.lookups = {
      order: async (orderId) => {
        try {
          const o = await this.orders.get(orderId);
          return { cityId: o.cityId, merchantOrgId: o.merchantOrgId };
        } catch {
          return null;
        }
      },
      courierOf: async (orderId) =>
        (await this.trips.courierOf(orderId).catch(() => null))?.courierId ?? null,
      trip: async (tripId) => {
        try {
          const t = await this.trips.get(tripId);
          return {
            cityId: t.cityId,
            courierId: t.courierId,
            orderIds: [
              ...new Set(t.stops.map((s) => s.orderId).filter((id): id is string => Boolean(id))),
            ],
          };
        } catch {
          return null;
        }
      },
    };
  }

  onModuleInit(): void {
    this.offs.push(
      this.events.subscribe(LIVE_FANOUT_SUBSCRIBER, '*', async (event, ctx) => {
        if (this.bus.idle()) return;
        const publish = () => this.publish(event);
        if (!afterCommit(ctx.tx, publish)) await publish();
      }),
    );
    this.offs.push(
      this.trips.onPositionReported((report) => {
        if (!this.bus.idle()) this.positions.report(report);
      }),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.offs.splice(0)) off();
    this.positions.close();
  }

  private async publish(event: PublishedEvent): Promise<void> {
    try {
      const pubs = await fanout(event, this.lookups);
      for (const p of pubs) await this.bus.publish(p.channel, p.event);
    } catch (err) {
      this.logger.warn(`live fan-out of ${event.type} failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Real-time channel (`live.*`, tRPC subscriptions over SSE). Bus: Redis pub/sub when REDIS_URL is
 * set (every API instance's streams get every instance's events), in process otherwise. Stream
 * tokens: LIVE_TOKEN_SECRET, else a key derived from JWT_SECRET.
 */
@Module({
  imports: [EventsModule, IdentityModule, OrdersModule, TripsModule],
  providers: [
    {
      provide: LIVE_BUS,
      useFactory: (): LiveBus => {
        const url = process.env['REDIS_URL'];
        if (!url) return new InMemoryLiveBus();
        // Subscriber mode takes a connection of its own; commands never queue behind it.
        return new RedisLiveBus(
          new Redis(url, { maxRetriesPerRequest: 3 }),
          new Redis(url, { maxRetriesPerRequest: null }),
        );
      },
    },
    {
      provide: LIVE_TOKENS,
      useFactory: (clock: Clock) => new StreamTokens(liveTokenKey(), () => clock.now()),
      inject: [CLOCK],
    },
    { provide: LIVE_SESSIONS, useExisting: IdentityService },
    LiveService,
    LiveFanoutService,
  ],
  exports: [LiveService, LIVE_BUS],
})
export class LiveModule implements OnModuleDestroy {
  constructor(@Inject(LIVE_BUS) private readonly bus: LiveBus) {}

  async onModuleDestroy(): Promise<void> {
    await this.bus.close();
  }
}

import { Inject, Logger, Module, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { KHAT_RULES } from '@driver/contracts';
import { callBridgeFor } from '../../shared/call-bridge.js';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { DispatchModule } from '../dispatch/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { BLOB_STORE, PlacesModule, type BlobStore } from '../places/index.js';
import { TripsModule } from '../trips/index.js';
import { InMemoryKhatRepository, KHAT_REPOSITORY, PrismaKhatRepository, type KhatRepository } from './khat.repository.js';
import { KHAT_CALLS, KHAT_CONFIG, KHAT_PHOTOS, KHAT_QUEUE, KhatService, type KhatConfig, type KhatPhotosPort, type SweepCheckJob } from './khat.service.js';

/** A whole number of minutes from the environment, else the rule's default. */
function envMinutes(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

/**
 * خطوط driver side: today's run, per-child taps, absences, substitute offers, and the late-sweep
 * alert. Runs are khat Trips (trips module), names come from identity's vault port, offers from
 * dispatch. Owns `khat_absences` and `khat_sweep_alerts`. The sweep check runs on the `khat.timers`
 * queue (BullMQ when REDIS_URL is set; otherwise in process, polled once a second).
 *
 * Env: KHAT_SWEEP_ALERT_AFTER_MIN (default `KHAT_RULES.sweepAlertAfterMin`, 5).
 */
@Module({
  imports: [TripsModule, DispatchModule, IdentityModule, EventsModule, PlacesModule],
  providers: [
    {
      provide: KHAT_REPOSITORY,
      useFactory: (prisma: PrismaService): KhatRepository => (prisma.configured ? new PrismaKhatRepository(prisma) : new InMemoryKhatRepository()),
      inject: [PrismaService],
    },
    // Guardian calls: the same masked-call bridge as in-order chat (dev: the guardian's own number, logged).
    { provide: KHAT_CALLS, useFactory: (identity: IdentityService) => callBridgeFor(identity), inject: [IdentityService] },
    {
      provide: KHAT_QUEUE,
      useFactory: (f: BullMqQueueFactory, clock: Clock): Queue<SweepCheckJob> => (f.configured ? f.queue<SweepCheckJob>('khat.timers') : new InMemoryQueue<SweepCheckJob>('khat.timers', () => clock.now())),
      inject: [BullMqQueueFactory, CLOCK],
    },
    { provide: KHAT_CONFIG, useFactory: (): KhatConfig => ({ sweepAlertAfterMin: envMinutes('KHAT_SWEEP_ALERT_AFTER_MIN', KHAT_RULES.sweepAlertAfterMin) }) },
    // Child photos (Ali, 2026-10-06): uploads in the places blob store, signed short-lived for the run's driver.
    {
      provide: KHAT_PHOTOS,
      useFactory: (blobs: BlobStore): KhatPhotosPort => ({
        owns: async (id, personId) => {
          const rec = await blobs.get(id);
          return rec !== null && rec.ownerId === personId && rec.state === 'stored';
        },
        readUrl: (ref) => blobs.readUrl(ref),
        remove: (ref) => blobs.remove(ref),
      }),
      inject: [BLOB_STORE],
    },
    KhatService,
  ],
  exports: [KhatService],
})
export class KhatModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KhatModule.name);

  private poller: NodeJS.Timeout | undefined;

  constructor(@Optional() @Inject(KHAT_QUEUE) private readonly queue: Queue<SweepCheckJob> | null) {}

  onModuleInit(): void {
    const q = this.queue;
    if (q instanceof InMemoryQueue) {
      this.poller = setInterval(() => {
        q.drain().catch((err: unknown) => this.logger.error(`khat timer failed: ${(err as Error).message}`));
      }, 1000);
      this.poller.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.poller) clearInterval(this.poller);
  }
}

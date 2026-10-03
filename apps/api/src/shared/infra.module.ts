import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CLOCK, SystemClock, type Clock } from './clock.js';
import { InMemoryWindowCounter, RedisWindowCounter, WINDOW_COUNTER, type WindowCounter } from './window-counter.js';
import { PrismaService } from './db/prisma.service.js';
import { UnitOfWork } from './db/unit-of-work.js';
import { BullMqQueueFactory, QUEUE_FACTORY } from './queue.js';

/**
 * Cross-cutting infrastructure: database client, unit of work, clock and queue factory.
 * Global so every module can inject them without importing each other. Nothing here knows
 * about any module (enforced by the `shared` boundary rule).
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => new PrismaService(process.env['DATABASE_URL']) },
    { provide: UnitOfWork, useFactory: (p: PrismaService) => new UnitOfWork(p), inject: [PrismaService] },
    { provide: CLOCK, useClass: SystemClock },
    { provide: BullMqQueueFactory, useFactory: () => new BullMqQueueFactory(process.env['REDIS_URL']) },
    { provide: QUEUE_FACTORY, useExisting: BullMqQueueFactory },
    // Rate limits and attempt counters every API instance shares (review 2026-10-04 #22): Redis when
    // REDIS_URL is set, in process otherwise.
    {
      provide: WINDOW_COUNTER,
      useFactory: (clock: Clock): WindowCounter => {
        const url = process.env['REDIS_URL'];
        return url ? new RedisWindowCounter(new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 }), clock) : new InMemoryWindowCounter(clock);
      },
      inject: [CLOCK],
    },
  ],
  exports: [PrismaService, UnitOfWork, CLOCK, BullMqQueueFactory, QUEUE_FACTORY, WINDOW_COUNTER],
})
export class InfraModule {}

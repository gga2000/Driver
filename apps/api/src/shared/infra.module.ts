import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CLOCK, SystemClock, type Clock } from './clock.js';
import { InMemoryWindowCounter, RedisWindowCounter, WINDOW_COUNTER, type WindowCounter } from './window-counter.js';
import { PrismaService } from './db/prisma.service.js';
import { UnitOfWork } from './db/unit-of-work.js';
import { PROCESS_ROLE, processRoleFromEnv, type ProcessRole } from './process-role.js';
import { BullMqQueueFactory, QUEUE_FACTORY } from './queue.js';
import { InMemoryTimerStore, PrismaTimerStore, TIMER_STORE, timerSweeperOptionsFromEnv, TimerSweeper, type TimerStore } from './timers/index.js';

/**
 * Cross-cutting infrastructure: database client, unit of work, clock, process role and queue factory.
 * Global so every module can inject them without importing each other. Nothing here knows
 * about any module (enforced by the `shared` boundary rule).
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => new PrismaService(process.env['DATABASE_URL']) },
    { provide: UnitOfWork, useFactory: (p: PrismaService) => new UnitOfWork(p), inject: [PrismaService] },
    { provide: CLOCK, useClass: SystemClock },
    // DRIVER_ROLE=web|worker|all (default all): which machines run the background jobs.
    { provide: PROCESS_ROLE, useFactory: (): ProcessRole => processRoleFromEnv(process.env) },
    { provide: BullMqQueueFactory, useFactory: (role: ProcessRole) => new BullMqQueueFactory(process.env['REDIS_URL'], 'driver', role), inject: [PROCESS_ROLE] },
    { provide: QUEUE_FACTORY, useExisting: BullMqQueueFactory },
    // Durable timers (plan W4): Postgres when DATABASE_URL is set; the sweeper runs with TIMERS_SWEEPER=on.
    { provide: TIMER_STORE, useFactory: (p: PrismaService): TimerStore => (p.configured ? new PrismaTimerStore(p) : new InMemoryTimerStore()), inject: [PrismaService] },
    {
      provide: TimerSweeper,
      useFactory: (store: TimerStore, clock: Clock, role: ProcessRole) => new TimerSweeper(store, clock, role, timerSweeperOptionsFromEnv(process.env)),
      inject: [TIMER_STORE, CLOCK, PROCESS_ROLE],
    },
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
  exports: [PrismaService, UnitOfWork, CLOCK, PROCESS_ROLE, BullMqQueueFactory, QUEUE_FACTORY, TIMER_STORE, TimerSweeper, WINDOW_COUNTER],
})
export class InfraModule {}

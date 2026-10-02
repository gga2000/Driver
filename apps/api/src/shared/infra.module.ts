import { Global, Module } from '@nestjs/common';
import { CLOCK, SystemClock } from './clock.js';
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
  ],
  exports: [PrismaService, UnitOfWork, CLOCK, BullMqQueueFactory, QUEUE_FACTORY],
})
export class InfraModule {}

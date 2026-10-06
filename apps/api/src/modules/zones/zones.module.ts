import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { InMemoryZoneChecksRepository, PrismaZoneChecksRepository, ZONE_CHECKS_REPOSITORY, type ZoneChecksRepository } from './zone-checks.repository.js';
import { ZoneChecksService } from './zone-checks.service.js';
import { FileZonesRepository, InMemoryZonesRepository, PrismaZonesRepository, ZONES_REPOSITORY, type ZonesRepository } from './zones.repository.js';
import { ZonesService } from './zones.service.js';

/**
 * Zone outlines: Postgres with DATABASE_URL; otherwise a JSON file when ZONES_STORE_FILE is set (the
 * studio's demo API, so outlines drawn there survive restarts), else memory only. Drivers' zone
 * checks (SP3 §5.3) live in Postgres with a database and in memory otherwise.
 */
@Module({
  imports: [EventsModule, ControlsModule],
  providers: [
    {
      provide: ZONES_REPOSITORY,
      useFactory: (prisma: PrismaService): ZonesRepository => {
        if (prisma.configured) return new PrismaZonesRepository(prisma);
        const file = process.env['ZONES_STORE_FILE'];
        return file ? new FileZonesRepository(file) : new InMemoryZonesRepository();
      },
      inject: [PrismaService],
    },
    {
      provide: ZONE_CHECKS_REPOSITORY,
      useFactory: (prisma: PrismaService): ZoneChecksRepository => (prisma.configured ? new PrismaZoneChecksRepository(prisma) : new InMemoryZoneChecksRepository()),
      inject: [PrismaService],
    },
    ZonesService,
    ZoneChecksService,
  ],
  exports: [ZonesService, ZoneChecksService],
})
export class ZonesModule {}

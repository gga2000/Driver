import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { FileZonesRepository, InMemoryZonesRepository, PrismaZonesRepository, ZONES_REPOSITORY, type ZonesRepository } from './zones.repository.js';
import { ZonesService } from './zones.service.js';

/**
 * Zone outlines: Postgres with DATABASE_URL; otherwise a JSON file when ZONES_STORE_FILE is set (the
 * studio's demo API, so outlines drawn there survive restarts), else memory only.
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
    ZonesService,
  ],
  exports: [ZonesService],
})
export class ZonesModule {}

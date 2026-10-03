import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ConfigModule } from '../config/index.js';
import { DispatchModule } from '../dispatch/index.js';
import { DriverAccountModule } from '../driver-account/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { FLEET_REPOSITORY, InMemoryFleetRepository, PrismaFleetRepository, type FleetRepository } from './fleet.repository.js';
import { FleetService } from './fleet.service.js';

/** Fleet owner dashboard: owns the `vehicles` registry writes and `fleet_drivers`. */
@Module({
  imports: [ConfigModule, DispatchModule, DriverAccountModule, EventsModule, IdentityModule],
  providers: [
    {
      provide: FLEET_REPOSITORY,
      useFactory: (prisma: PrismaService): FleetRepository => (prisma.configured ? new PrismaFleetRepository(prisma) : new InMemoryFleetRepository()),
      inject: [PrismaService],
    },
    FleetService,
  ],
  exports: [FleetService],
})
export class FleetModule {}

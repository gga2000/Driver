import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ConfigModule } from '../config/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { OrgsModule } from '../orgs/index.js';
import { AuditLogService, StaffNames } from './audit.js';
import { CONTROLS_REPOSITORY, InMemoryControlsRepository, PrismaControlsRepository, type ControlsRepository } from './controls.repository.js';
import { ControlsService } from './controls.service.js';

/**
 * Launch controls: owns `ops_kill_switches`, `ops_zone_capacities`, `system_banners` and
 * `console_audit_log` (Prisma with DATABASE_URL, in memory otherwise). A leaf for the modules that
 * enforce it: orders and routes import it to refuse new work, dispatch to hold offers. The orders
 * module binds the live count per zone; the routes module registers its corridors.
 */
@Module({
  imports: [ConfigModule, EventsModule, IdentityModule, OrgsModule],
  providers: [
    {
      provide: CONTROLS_REPOSITORY,
      useFactory: (prisma: PrismaService): ControlsRepository => (prisma.configured ? new PrismaControlsRepository(prisma) : new InMemoryControlsRepository()),
      inject: [PrismaService],
    },
    StaffNames,
    AuditLogService,
    ControlsService,
  ],
  exports: [ControlsService, AuditLogService, StaffNames],
})
export class ControlsModule {}

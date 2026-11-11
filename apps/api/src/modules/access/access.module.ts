import { Module, type OnModuleInit } from '@nestjs/common';
import { westernDigits } from '@driver/contracts';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ConfigModule, ConfigService } from '../config/index.js';
import { AuditLogService, ControlsModule } from '../controls/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { PlacesModule, SavedPlacesService } from '../places/index.js';
import { AccessSweepJob } from './access.job.js';
import {
  ACCESS_REPOSITORY,
  InMemoryAccessRepository,
  PrismaAccessRepository,
  type AccessRepository,
} from './access.repository.js';
import { ACCESS_SOURCES, AccessService, type AccessSources } from './access.service.js';

/**
 * Customer waves and the waitlist (W5, D-24): owns `customer_access` and `ops_zone_waves`. Reads the
 * person's own saved place for their zone, their roles and whether they ordered before; binds the
 * food-order gate into orders. No zone has a wave until ops sets one, so everyone is let in.
 */
@Module({
  imports: [ConfigModule, ControlsModule, EventsModule, IdentityModule, OrdersModule, PlacesModule],
  providers: [
    {
      provide: ACCESS_REPOSITORY,
      useFactory: (prisma: PrismaService): AccessRepository =>
        prisma.configured ? new PrismaAccessRepository(prisma) : new InMemoryAccessRepository(),
      inject: [PrismaService],
    },
    {
      provide: ACCESS_SOURCES,
      useFactory: (
        places: SavedPlacesService,
        identity: IdentityService,
        orders: OrdersService,
        config: ConfigService,
        events: EventsService,
        audits: AuditLogService,
      ): AccessSources => ({
        ownZone: async (personId) => {
          const own = (await places.mine(personId)).find((p) => p.access === 'owner');
          return own ? { cityId: own.cityId, zoneKey: own.zoneId } : null;
        },
        isStaff: async (personId) =>
          (await identity.activeRoles(personId)).some((r) => r !== 'customer'),
        hasOrdered: async (personId) => (await orders.placedCount(personId)) > 0,
        // Western digits on every screen (voice spec): «شارع ٣٠» in the city config reads «شارع 30».
        zoneNames: (cityId) =>
          new Map((config.city(cityId)?.zones ?? []).map((z) => [z.id, westernDigits(z.name_ar)])),
        emit: (tx, event, aggregate) => events.emit(tx, event, aggregate),
        audit: (input, tx) => audits.record(input, tx),
      }),
      inject: [
        SavedPlacesService,
        IdentityService,
        OrdersService,
        ConfigService,
        EventsService,
        AuditLogService,
      ],
    },
    AccessService,
    AccessSweepJob,
  ],
  exports: [AccessService],
})
export class AccessModule implements OnModuleInit {
  constructor(
    private readonly access: AccessService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    this.orders.bindAccess({ assertMayOrder: (personId) => this.access.assertMayOrder(personId) });
  }
}

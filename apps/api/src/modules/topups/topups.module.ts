import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { InMemoryTopUpsRepository, PrismaTopUpsRepository, TOPUPS_REPOSITORY, type TopUpsRepository } from './topups.repository.js';
import { TOPUP_COURIER_CHECK, TOPUP_PEOPLE, TopUpService, courierCarriesOrderOf, type TopUpCourierCheck, type TopUpPeople } from './topups.service.js';

/**
 * Wallet top-up with cash (`wallet.requestTopUp/topUpStatus`, `ops.topUpLookup/confirmTopUp`,
 * `partner.topUpLookup/confirmTopUp`). Prisma repository when DATABASE_URL is set, in-memory twin
 * otherwise; the courier path checks the courier carries one of the customer's live orders.
 */
@Module({
  imports: [EventsModule, IdentityModule, LedgerModule, OrdersModule, TripsModule],
  providers: [
    {
      provide: TOPUPS_REPOSITORY,
      useFactory: (prisma: PrismaService): TopUpsRepository => (prisma.configured ? new PrismaTopUpsRepository(prisma) : new InMemoryTopUpsRepository()),
      inject: [PrismaService],
    },
    {
      provide: TOPUP_COURIER_CHECK,
      useFactory: (orders: OrdersService, trips: TripsService): TopUpCourierCheck => ({ carriesOrderOf: courierCarriesOrderOf(orders, trips) }),
      inject: [OrdersService, TripsService],
    },
    {
      provide: TOPUP_PEOPLE,
      useFactory: (identity: IdentityService): TopUpPeople => ({ cards: (ids, accessor, purpose) => identity.memberCards(ids, accessor, purpose) }),
      inject: [IdentityService],
    },
    TopUpService,
  ],
  exports: [TopUpService],
})
export class TopUpsModule {}

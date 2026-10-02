import { Module } from '@nestjs/common';
import { CatalogModule } from './modules/catalog/index.js';
import { ConfigModule } from './modules/config/index.js';
import { DispatchModule } from './modules/dispatch/index.js';
import { EventsModule } from './modules/events/index.js';
import { IdentityModule } from './modules/identity/index.js';
import { LedgerModule } from './modules/ledger/index.js';
import { NotifyModule } from './modules/notify/index.js';
import { OrgsModule } from './modules/orgs/index.js';
import { PlacesModule } from './modules/places/index.js';
import { PricingModule } from './modules/pricing/index.js';
import { RoutesModule } from './modules/routes/index.js';
import { ScoringModule } from './modules/scoring/index.js';
import { SimulatorModule } from './modules/simulator/index.js';
import { SupportModule } from './modules/support/index.js';
import { TripsModule } from './modules/trips/index.js';
import { InfraModule } from './shared/infra.module.js';
import { TrpcModule } from './trpc/trpc.module.js';

@Module({
  imports: [
    InfraModule,
    IdentityModule,
    OrgsModule,
    ConfigModule,
    PlacesModule,
    CatalogModule,
    TripsModule,
    DispatchModule,
    PricingModule,
    LedgerModule,
    RoutesModule,
    ScoringModule,
    NotifyModule,
    SupportModule,
    EventsModule,
    SimulatorModule,
    TrpcModule,
  ],
})
export class AppModule {}

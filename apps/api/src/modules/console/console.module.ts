import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/index.js';
import { CatalogModule } from '../catalog/index.js';
import { DispatchModule } from '../dispatch/index.js';
import { DriverAccountModule } from '../driver-account/index.js';
import { EventsModule } from '../events/index.js';
import { FleetModule } from '../fleet/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrdersModule } from '../orders/index.js';
import { OrgsModule } from '../orgs/index.js';
import { ScoringModule } from '../scoring/index.js';
import { SimulatorModule } from '../simulator/index.js';
import { ConsoleReadService } from './console.reads.js';

/** The Console's read side: composes other modules' public services into `ctx.console`. Owns no tables. */
@Module({
  imports: [DispatchModule, IdentityModule, OrdersModule, LedgerModule, EventsModule, OrgsModule, ScoringModule, SimulatorModule, FleetModule, CatalogModule, DriverAccountModule, TripsModule],
  providers: [ConsoleReadService],
  exports: [ConsoleReadService],
})
export class ConsoleModule {}

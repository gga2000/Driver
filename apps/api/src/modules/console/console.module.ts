import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/index.js';
import { CatalogModule } from '../catalog/index.js';
import { ControlsModule } from '../controls/index.js';
import { DispatchModule } from '../dispatch/index.js';
import { DriverAccountModule } from '../driver-account/index.js';
import { EventsModule } from '../events/index.js';
import { FleetModule } from '../fleet/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { NotifyModule } from '../notify/index.js';
import { OrdersModule } from '../orders/index.js';
import { OrgsModule } from '../orgs/index.js';
import { ScoringModule } from '../scoring/index.js';
import { SimulatorModule } from '../simulator/index.js';
import { SupportModule } from '../support/index.js';
import { ConsoleReadService } from './console.reads.js';
import { PeopleReadService } from './people.reads.js';

/** The Console's read side: composes other modules' public services into `ctx.console`. Owns no tables. */
@Module({
  imports: [DispatchModule, IdentityModule, OrdersModule, LedgerModule, EventsModule, OrgsModule, ScoringModule, SimulatorModule, FleetModule, CatalogModule, DriverAccountModule, TripsModule, ControlsModule, NotifyModule, SupportModule],
  providers: [ConsoleReadService, PeopleReadService],
  exports: [ConsoleReadService, PeopleReadService],
})
export class ConsoleModule {}

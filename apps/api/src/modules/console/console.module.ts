import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrdersModule } from '../orders/index.js';
import { OrgsModule } from '../orgs/index.js';
import { ScoringModule } from '../scoring/index.js';
import { SimulatorModule } from '../simulator/index.js';
import { ConsoleReadService } from './console.reads.js';

/** The Console's read side: composes other modules' public services into `ctx.console`. Owns no tables. */
@Module({
  imports: [DispatchModule, IdentityModule, OrdersModule, LedgerModule, EventsModule, OrgsModule, ScoringModule, SimulatorModule],
  providers: [ConsoleReadService],
  exports: [ConsoleReadService],
})
export class ConsoleModule {}

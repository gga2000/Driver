import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/index.js';
import { DispatchModule } from '../dispatch/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrdersModule } from '../orders/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PricingModule } from '../pricing/index.js';
import { TripsModule } from '../trips/index.js';
import { SimulatorService } from './simulator.service.js';

/** The Aziziyah simulator: drives the other modules' public services only. */
@Module({
  imports: [IdentityModule, OrgsModule, CatalogModule, OrdersModule, TripsModule, DispatchModule, PricingModule, LedgerModule, EventsModule],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}

import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/index.js';
import { LedgerModule } from '../ledger/index.js';
import { PricingModule } from '../pricing/index.js';
import { TripsModule } from '../trips/index.js';
import { SimulatorService } from './simulator.service.js';

@Module({
  imports: [PricingModule, DispatchModule, TripsModule, LedgerModule],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/index.js';
import { DISPATCH_POLICIES, DispatchService, defaultPolicies } from './dispatch.service.js';
import { DriverRanker } from './ranker.js';

@Module({
  imports: [ConfigModule],
  providers: [DriverRanker, { provide: DISPATCH_POLICIES, useFactory: defaultPolicies }, DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}

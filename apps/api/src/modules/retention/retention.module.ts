import { Module } from '@nestjs/common';
import { SupportModule } from '../support/index.js';
import { TripsModule } from '../trips/index.js';
import { TrailRetention } from './trail-retention.js';

/** Data retention jobs (decision D6). Separate from trips and support so neither depends on the other. */
@Module({
  imports: [TripsModule, SupportModule],
  providers: [TrailRetention],
  exports: [TrailRetention],
})
export class RetentionModule {}

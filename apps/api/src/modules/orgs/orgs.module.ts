import { Module } from '@nestjs/common';
import { EventsModule } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { HOUSEHOLD_PEOPLE, HouseholdsRpc } from './households.rpc.js';
import { OrgsService } from './orgs.service.js';

/** Orgs (restaurants, grocers, fleets, households) and the households transport port. */
@Module({
  imports: [EventsModule, IdentityModule],
  providers: [OrgsService, { provide: HOUSEHOLD_PEOPLE, useExisting: IdentityService }, HouseholdsRpc],
  exports: [OrgsService, HouseholdsRpc],
})
export class OrgsModule {}

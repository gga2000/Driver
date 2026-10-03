import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { EventsModule } from '../events/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { PlacesRpc } from './places.rpc.js';
import { PlacesService } from './places.service.js';
import { HOUSEHOLD_PEERS, InMemorySavedPlacesRepository, SAVED_PLACES_REPOSITORY, SavedPlacesService, type HouseholdPeers } from './saved-places.service.js';
import { UploadsController } from './uploads.controller.js';
import { BLOB_STORE, DevBlobStore } from './uploads.js';

/**
 * Places: learned places and landmarks (`PlacesService`), customers' saved places
 * (`SavedPlacesService`, in-memory until the places table grows label/zone columns) and gate-photo
 * storage (`DevBlobStore`: memory, plus disk under UPLOADS_DIR; served by `UploadsController`).
 * UPLOADS_PUBLIC_ORIGIN makes ticket/read URLs absolute; UPLOADS_SECRET (else JWT_SECRET) signs them.
 */
@Module({
  imports: [EventsModule, OrgsModule],
  controllers: [UploadsController],
  providers: [
    PlacesService,
    { provide: SAVED_PLACES_REPOSITORY, useFactory: () => new InMemorySavedPlacesRepository() },
    {
      provide: BLOB_STORE,
      useFactory: (clock: Clock) =>
        new DevBlobStore(clock, {
          secret: process.env['UPLOADS_SECRET'] ?? process.env['JWT_SECRET'],
          publicOrigin: process.env['UPLOADS_PUBLIC_ORIGIN'],
          dir: process.env['UPLOADS_DIR'],
        }),
      inject: [CLOCK],
    },
    {
      provide: HOUSEHOLD_PEERS,
      useFactory: (orgs: OrgsService): HouseholdPeers => ({
        peersOf: (personId) => [...new Set(orgs.householdsOf(personId).flatMap((h) => h.members.map((m) => m.personId)))].filter((id) => id !== personId),
      }),
      inject: [OrgsService],
    },
    SavedPlacesService,
    PlacesRpc,
  ],
  exports: [PlacesService, SavedPlacesService, PlacesRpc, BLOB_STORE],
})
export class PlacesModule {}

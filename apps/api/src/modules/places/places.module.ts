import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule } from '../events/index.js';
import { ErasureRegistry, IdentityModule } from '../identity/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { LandmarkFeedService } from './landmark-feed.js';
import { objectStorageFromEnv, OBJECT_STORAGE, type ObjectStoragePort } from './object-storage.js';
import { InMemoryPlacesRepository, PLACES_REPOSITORY, PrismaPlacesRepository, PrismaSavedPlacesRepository, type PlacesRepository } from './places.repository.js';
import { PlacesRpc } from './places.rpc.js';
import { PlacesErasure } from './places.erasure.js';
import { PlacesService } from './places.service.js';
import {
  HOUSEHOLD_PEERS,
  InMemorySavedPlacesRepository,
  LEARNED_LANDMARKS,
  SAVED_PLACES_REPOSITORY,
  SavedPlacesService,
  type HouseholdPeers,
  type SavedPlacesRepository,
} from './saved-places.service.js';
import { UploadsController } from './uploads.controller.js';
import { BLOB_STORE, InMemoryUploadRecords, ObjectBlobStore, PrismaUploadRecords, type BlobStore } from './uploads.js';

/**
 * Places: learned places and landmarks (`PlacesService`), customers' saved places
 * (`SavedPlacesService`) — both on the `places` table with DATABASE_URL, in memory otherwise — and photo
 * storage (`ObjectBlobStore`: records in `uploads`, bytes behind `ObjectStoragePort`, S3-compatible when
 * S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are set, else the dev store in memory
 * plus disk under UPLOADS_DIR; served by `UploadsController`). UPLOADS_PUBLIC_ORIGIN makes ticket/read URLs
 * absolute; UPLOADS_SECRET (else JWT_SECRET) signs them. See docs/persistence.md.
 */
@Module({
  imports: [EventsModule, OrgsModule, IdentityModule],
  controllers: [UploadsController],
  providers: [
    {
      provide: PLACES_REPOSITORY,
      useFactory: (prisma: PrismaService): PlacesRepository => (prisma.configured ? new PrismaPlacesRepository(prisma) : new InMemoryPlacesRepository()),
      inject: [PrismaService],
    },
    PlacesService,
    {
      provide: SAVED_PLACES_REPOSITORY,
      useFactory: (prisma: PrismaService): SavedPlacesRepository => (prisma.configured ? new PrismaSavedPlacesRepository(prisma) : new InMemorySavedPlacesRepository()),
      inject: [PrismaService],
    },
    { provide: OBJECT_STORAGE, useFactory: (): ObjectStoragePort => objectStorageFromEnv() },
    {
      provide: BLOB_STORE,
      useFactory: (clock: Clock, prisma: PrismaService, storage: ObjectStoragePort) => {
        if (prisma.configured && !storage.direct && !process.env['UPLOADS_DIR']) {
          new Logger('PlacesModule').warn('photo bytes are kept in memory (no S3_* storage, no UPLOADS_DIR): upload records survive a restart, the bytes do not');
        }
        return new ObjectBlobStore(clock, prisma.configured ? new PrismaUploadRecords(prisma) : new InMemoryUploadRecords(), storage, {
          secret: process.env['UPLOADS_SECRET'] ?? process.env['JWT_SECRET'],
          publicOrigin: process.env['UPLOADS_PUBLIC_ORIGIN'],
        });
      },
      inject: [CLOCK, PrismaService, OBJECT_STORAGE],
    },
    {
      provide: HOUSEHOLD_PEERS,
      useFactory: (orgs: OrgsService): HouseholdPeers => ({
        peersOf: async (personId) => [...new Set((await orgs.householdsOf(personId)).flatMap((h) => h.members.map((m) => m.personId)))].filter((id) => id !== personId),
      }),
      inject: [OrgsService],
    },
    // Saved places name their landmark from the same list "وين رايح؟" searches (maps program a2).
    { provide: LEARNED_LANDMARKS, useExisting: PlacesService },
    SavedPlacesService,
    LandmarkFeedService,
    PlacesRpc,
    {
      provide: PlacesErasure,
      useFactory: (places: PlacesRepository, saved: SavedPlacesRepository, blobs: BlobStore) => new PlacesErasure(places, saved, blobs),
      inject: [PLACES_REPOSITORY, SAVED_PLACES_REPOSITORY, BLOB_STORE],
    },
  ],
  exports: [PlacesService, SavedPlacesService, LandmarkFeedService, PlacesRpc, BLOB_STORE, PlacesErasure],
})
export class PlacesModule implements OnModuleInit {
  constructor(
    private readonly placesErasure: PlacesErasure,
    @Inject(ErasureRegistry) private readonly erasure: ErasureRegistry,
  ) {}

  onModuleInit(): void {
    // W7 account deletion: saved places, his landmark proposals, and every photo and voice note he uploaded.
    this.erasure.register({ owner: 'places', tables: ['public.places', 'public.place_photos', 'public.uploads'], erase: (personId) => this.placesErasure.erase(personId) });
  }
}

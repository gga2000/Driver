import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { IdentityModule } from '../identity/index.js';
import { OpsModule } from '../ops/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PlacesModule } from '../places/index.js';
import { InMemoryMapEditorRepository, MAP_EDITOR_REPOSITORY, PrismaMapEditorRepository, type MapEditorRepository } from './map-editor.repository.js';
import { MapEditorService } from './map-editor.service.js';

/**
 * Console › محرر الخريطة: owns `map_edits` (the undo history) and `map_reports` (fixes from the apps),
 * Prisma with DATABASE_URL, in memory otherwise. The places it changes stay the places module's.
 */
@Module({
  imports: [ControlsModule, IdentityModule, OpsModule, OrgsModule, PlacesModule],
  providers: [
    {
      provide: MAP_EDITOR_REPOSITORY,
      useFactory: (prisma: PrismaService): MapEditorRepository => (prisma.configured ? new PrismaMapEditorRepository(prisma) : new InMemoryMapEditorRepository()),
      inject: [PrismaService],
    },
    MapEditorService,
  ],
  exports: [MapEditorService],
})
export class MapEditorModule {}

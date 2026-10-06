import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CatalogModule } from '../catalog/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PlacesModule } from '../places/index.js';
import { InMemoryMenuPhotosRepository, MENU_PHOTOS_REPOSITORY, PrismaMenuPhotosRepository, type MenuPhotosRepository } from './menu-photos.repository.js';
import { MenuPhotosService } from './menu-photos.service.js';

/** Menu photo service (maps k3): requests from the Merchant app, shoots from the Partner app, the Console queue. */
@Module({
  imports: [CatalogModule, EventsModule, IdentityModule, OrgsModule, PlacesModule],
  providers: [
    {
      provide: MENU_PHOTOS_REPOSITORY,
      useFactory: (prisma: PrismaService): MenuPhotosRepository => (prisma.configured ? new PrismaMenuPhotosRepository(prisma) : new InMemoryMenuPhotosRepository()),
      inject: [PrismaService],
    },
    MenuPhotosService,
  ],
  exports: [MenuPhotosService, MENU_PHOTOS_REPOSITORY],
})
export class MenuPhotosModule {}

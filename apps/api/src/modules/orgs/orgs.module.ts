import { Module } from '@nestjs/common';
import { EventsModule } from '../events/index.js';
import { OrgsService } from './orgs.service.js';

@Module({ imports: [EventsModule], providers: [OrgsService], exports: [OrgsService] })
export class OrgsModule {}

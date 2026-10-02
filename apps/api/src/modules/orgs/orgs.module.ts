import { Module } from '@nestjs/common';
import { OrgsService } from './orgs.service.js';

@Module({ providers: [OrgsService], exports: [OrgsService] })
export class OrgsModule {}

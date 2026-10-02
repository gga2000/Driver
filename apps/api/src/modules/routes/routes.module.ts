import { Module } from '@nestjs/common';
import { RoutesService } from './routes.service.js';

@Module({ providers: [RoutesService], exports: [RoutesService] })
export class RoutesModule {}

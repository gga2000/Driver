import { Module } from '@nestjs/common';
import { PlacesService } from './places.service.js';

@Module({ providers: [PlacesService], exports: [PlacesService] })
export class PlacesModule {}

import { Module } from '@nestjs/common';
import { EventsModule } from '../events/index.js';
import { TripsService } from './trips.service.js';

@Module({ imports: [EventsModule], providers: [TripsService], exports: [TripsService] })
export class TripsModule {}

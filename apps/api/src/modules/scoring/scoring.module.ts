import { Module } from '@nestjs/common';
import { EventsModule } from '../events/index.js';
import { ScoringService } from './scoring.service.js';

@Module({ imports: [EventsModule], providers: [ScoringService], exports: [ScoringService] })
export class ScoringModule {}

import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { SupportModule } from '../support/index.js';
import { TripsModule } from '../trips/index.js';
import { HandoverPhotoRetention } from './handover-photo-retention.js';
import { TrailRetention } from './trail-retention.js';
import { VoiceNoteRetention } from './voice-note-retention.js';

/** Data retention jobs (decision D6; chat voice notes, ride ideas n7/n8). Separate from trips, support and chat so none depends on another. */
@Module({
  imports: [TripsModule, SupportModule, ChatModule],
  providers: [TrailRetention, HandoverPhotoRetention, VoiceNoteRetention],
  exports: [TrailRetention, HandoverPhotoRetention, VoiceNoteRetention],
})
export class RetentionModule {}

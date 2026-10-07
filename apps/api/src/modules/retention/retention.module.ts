import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { PlacesModule } from '../places/index.js';
import { PricingModule } from '../pricing/index.js';
import { SupportModule } from '../support/index.js';
import { TripsModule } from '../trips/index.js';
import { HandoverPhotoRetention } from './handover-photo-retention.js';
import { QuoteRetention } from './quote-retention.js';
import { TrailRetention } from './trail-retention.js';
import { UploadRetention } from './upload-retention.js';
import { VoiceNoteRetention } from './voice-note-retention.js';

/** Data retention jobs (decision D6; chat voice notes, ride ideas n7/n8; expired quotes, LOAD-01; unfinished uploads, SEC-24). Separate from trips, support and chat so none depends on another. */
@Module({
  imports: [TripsModule, SupportModule, ChatModule, PricingModule, PlacesModule],
  providers: [TrailRetention, HandoverPhotoRetention, VoiceNoteRetention, QuoteRetention, UploadRetention],
  exports: [TrailRetention, HandoverPhotoRetention, VoiceNoteRetention, QuoteRetention, UploadRetention],
})
export class RetentionModule {}

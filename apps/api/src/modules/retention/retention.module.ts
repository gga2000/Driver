import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/index.js';
import { EventsModule } from '../events/index.js';
import { NotifyModule } from '../notify/index.js';
import { PricingModule } from '../pricing/index.js';
import { SupportModule } from '../support/index.js';
import { TripsModule } from '../trips/index.js';
import { DeliveryRetention } from './delivery-retention.js';
import { HandoverPhotoRetention } from './handover-photo-retention.js';
import { QuoteRetention } from './quote-retention.js';
import { TrailRetention } from './trail-retention.js';
import { VoiceNoteRetention } from './voice-note-retention.js';

/** Data retention jobs (decision D6; chat voice notes, ride ideas n7/n8; expired quotes, LOAD-01; delivery records, speed audit z1). Separate from trips, support and chat so none depends on another. */
@Module({
  imports: [TripsModule, SupportModule, ChatModule, PricingModule, EventsModule, NotifyModule],
  providers: [TrailRetention, HandoverPhotoRetention, VoiceNoteRetention, QuoteRetention, DeliveryRetention],
  exports: [TrailRetention, HandoverPhotoRetention, VoiceNoteRetention, QuoteRetention, DeliveryRetention],
})
export class RetentionModule {}

import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ConfigModule } from '../config/index.js';
import { PricingService } from './pricing.service.js';
import { InMemoryQuoteStore, PrismaQuoteStore, QUOTE_STORE, type QuoteStore } from './quote-store.js';

/** Kept quotes (LOAD-01) in Postgres when DATABASE_URL is set, in memory otherwise. */
@Module({
  imports: [ConfigModule],
  providers: [
    { provide: QUOTE_STORE, useFactory: (prisma: PrismaService): QuoteStore => (prisma.configured ? new PrismaQuoteStore(prisma) : new InMemoryQuoteStore()), inject: [PrismaService] },
    PricingService,
  ],
  exports: [PricingService],
})
export class PricingModule {}

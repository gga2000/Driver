import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/index.js';
import { PricingService } from './pricing.service.js';

@Module({ imports: [ConfigModule], providers: [PricingService], exports: [PricingService] })
export class PricingModule {}

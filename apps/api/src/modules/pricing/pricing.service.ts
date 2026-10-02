import { Injectable } from '@nestjs/common';
import type { PriceRequest, Quote } from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import { PricingEngine, PricingError } from './engine.js';

@Injectable()
export class PricingService {
  private readonly engine = new PricingEngine();

  constructor(private readonly config: ConfigService) {}

  quote(req: PriceRequest): Quote {
    const city = this.config.city(req.cityId);
    if (!city) throw new PricingError('city_mismatch', `unknown city ${req.cityId}`);
    return this.engine.quote(req, city);
  }
}

import { Injectable } from '@nestjs/common';
import type { CancellationFee, PriceRequest, Quote, Vertical } from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import { DEFAULT_CANCELLATION_RULES, cancellationFee, type CancellationSubject } from './cancellation.js';
import { PricingEngine, PricingError } from './engine.js';

/** `DispatchConfig.customerFreeCancelAfterSec`'s schema default. */
const DEFAULT_FREE_CANCEL_AFTER_SEC = 180;

@Injectable()
export class PricingService {
  private readonly engine = new PricingEngine();

  constructor(private readonly config: ConfigService) {}

  quote(req: PriceRequest): Quote {
    const city = this.config.city(req.cityId);
    if (!city) throw new PricingError('city_mismatch', `unknown city ${req.cityId}`);
    return this.engine.quote(req, city);
  }

  /**
   * Seconds a ride searches before the customer may cancel free or switch vehicle (J-D7): the city's
   * dispatch config, as the dispatch orchestrator reads it (default 180).
   */
  freeCancelAfterSec(cityId: string, vertical: Vertical): number {
    return this.config.dispatchFor(cityId, vertical)?.customerFreeCancelAfterSec ?? DEFAULT_FREE_CANCEL_AFTER_SEC;
  }

  /** Cancellation fee for an order or a ride trip at `at` (dispatch & pricing spec §4), rounded per city. */
  cancellationFee(subject: CancellationSubject, at: Date, cityId?: string): CancellationFee {
    const step = (cityId ? this.config.city(cityId)?.roundingStep : undefined) ?? DEFAULT_CANCELLATION_RULES.roundingStep;
    return cancellationFee(subject, at, { ...DEFAULT_CANCELLATION_RULES, roundingStep: step });
  }
}

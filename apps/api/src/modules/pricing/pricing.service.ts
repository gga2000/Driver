import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CancellationFee, PriceRequest, Quote, Vertical } from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { ConfigService } from '../config/index.js';
import { DEFAULT_CANCELLATION_RULES, cancellationFee, type CancellationSubject } from './cancellation.js';
import { PricingEngine, PricingError } from './engine.js';
import { InMemoryQuoteStore, QUOTE_PURGE_GRACE_MIN, QUOTE_STORE, QUOTE_TTL_MIN, type QuoteStore } from './quote-store.js';

/** `DispatchConfig.customerFreeCancelAfterSec`'s schema default. */
const DEFAULT_FREE_CANCEL_AFTER_SEC = 180;

/** Quote ids unique across API instances (a kept quote is a `quotes` primary key). */
function quoteId(): string {
  return `q_${randomBytes(12).toString('base64url')}`;
}

@Injectable()
export class PricingService {
  private readonly engine = new PricingEngine(quoteId);
  private readonly store: QuoteStore;
  private readonly clock: Clock;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(QUOTE_STORE) store?: QuoteStore,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.store = store ?? new InMemoryQuoteStore();
    this.clock = clock ?? new SystemClock();
  }

  /** A price, computed and not kept: the server's own re-quotes (fees at placement, previews). */
  quote(req: PriceRequest): Quote {
    const city = this.config.city(req.cityId);
    if (!city) throw new PricingError('city_mismatch', `unknown city ${req.cityId}`);
    return this.engine.quote(req, city);
  }

  /**
   * `pricing.quote` (LOAD-01): the quote a client is shown and may book with, kept for `QUOTE_TTL_MIN`
   * minutes so the order (and its trip) can reference it.
   */
  async keepQuote(req: PriceRequest): Promise<Quote> {
    const q = this.quote(req);
    await this.store.save(q, req, new Date(this.clock.now().getTime() + QUOTE_TTL_MIN * 60_000));
    return q;
  }

  /** Takes a kept quote for one order (see `QuoteStore.claim`): false when unknown, expired or already taken. */
  claimQuote(quoteId: string, at: Date, tx?: Tx): Promise<boolean> {
    return this.store.claim(quoteId, at, tx);
  }

  /** Deletes up to `limit` kept quotes nobody booked, `QUOTE_PURGE_GRACE_MIN` after they expired. */
  purgeExpiredQuotes(limit: number): Promise<number> {
    return this.store.purgeExpired(new Date(this.clock.now().getTime() - QUOTE_PURGE_GRACE_MIN * 60_000), limit);
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

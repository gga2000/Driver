import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CancellationFee, PriceRequest, Quote, Vertical } from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { ConfigService } from '../config/index.js';
import { DEFAULT_CANCELLATION_RULES, cancellationFee, type CancellationSubject } from './cancellation.js';
import { PricingEngine, PricingError } from './engine.js';
import { InMemoryQuoteStore, QUOTE_PURGE_GRACE_MIN, QUOTE_REUSE_MIN_LEFT_MIN, QUOTE_STORE, QUOTE_TTL_MIN, type QuoteStore } from './quote-store.js';

/** `DispatchConfig.customerFreeCancelAfterSec`'s schema default. */
const DEFAULT_FREE_CANCEL_AFTER_SEC = 180;

/** Quote ids unique across API instances (a kept quote is a `quotes` primary key). */
function quoteId(): string {
  return `q_${randomBytes(12).toString('base64url')}`;
}

/** Kept quotes this instance remembers for reuse (perf z3); the oldest is forgotten first past this. */
const KEPT_MEMORY_MAX = 10_000;

/** What a quote is asked for, without its time: the same trip asked a minute later has the same key. */
function requestKey(req: PriceRequest): string {
  return JSON.stringify([req.cityId, req.vertical, req.stops, req.options, req.distanceKm ?? null, req.durationMin ?? null]);
}

/** Everything a quote charges (its id and dates aside): two quotes with the same key price the same. */
function pricedKey(q: Quote): string {
  return JSON.stringify([q.cityId, q.vertical, q.currency, q.components, q.shadowComponents, q.subtotal, q.total, q.shadowTotal, q.rounding, q.bounds]);
}

@Injectable()
export class PricingService {
  private readonly engine = new PricingEngine(quoteId);
  private readonly store: QuoteStore;
  private readonly clock: Clock;
  /** Perf z3: per caller and trip, the quote last kept for it (in insertion order, oldest first). */
  private readonly kept = new Map<string, { quote: Quote; priced: string; expiresAt: number }>();

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
   *
   * Perf z3: checkout re-asks every minute. With `who` (the signed-in person, else the client's address),
   * the same caller asking for the same trip gets the quote already kept for it back — no new rows —
   * while that quote prices exactly what the engine prices now, is untaken, and has at least
   * `QUOTE_REUSE_MIN_LEFT_MIN` minutes left to be booked. Anything else keeps a new quote, as before.
   * The price is always computed now: reuse never hands out an amount the engine would not charge.
   */
  async keepQuote(req: PriceRequest, who?: string | null): Promise<Quote> {
    const q = this.quote(req);
    const now = this.clock.now().getTime();
    const key = who ? `${who}\u0000${requestKey(req)}` : null;
    const priced = pricedKey(q);
    if (key) {
      const hit = this.kept.get(key);
      const mustLastUntil = now + QUOTE_REUSE_MIN_LEFT_MIN * 60_000;
      if (hit && hit.priced === priced && hit.expiresAt > mustLastUntil && (await this.store.isOpen(hit.quote.id, new Date(mustLastUntil)))) return hit.quote;
    }
    const expiresAt = now + QUOTE_TTL_MIN * 60_000;
    await this.store.save(q, req, new Date(expiresAt));
    if (key) this.remember(key, { quote: q, priced, expiresAt });
    return q;
  }

  private remember(key: string, entry: { quote: Quote; priced: string; expiresAt: number }): void {
    this.kept.delete(key);
    this.kept.set(key, entry);
    while (this.kept.size > KEPT_MEMORY_MAX) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) break;
      this.kept.delete(oldest);
    }
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

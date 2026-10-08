import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { LATE_PROMISE_MEMO, encodeDomainEvent } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { EventsService } from '../events/index.js';
import { Accounts, type LedgerService } from '../ledger/index.js';
import { TrackingService, type TrackingLateApologyPort, type TrackingLateCreditPort } from './tracking.service.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';

/** Memo on the honest-delay credit line (shared with the wallet's reading of it, `@driver/contracts`). */
export { LATE_PROMISE_MEMO };

/** Posting group of an order's honest-delay credit: one per order, so a replay posts nothing. */
export const latePromiseGroupId = (orderId: string): string => `${LATE_PROMISE_MEMO}:${orderId}`;

/**
 * The honest-delay credit through the ledger's public API (audit d-5): a balanced group per order —
 * `credit_issued` from the platform to the customer's wallet, the amount the tracking read decided
 * (the delivery fee). Idempotent by order.
 */
export function ledgerLateCredit(ledger: Pick<LedgerService, 'recordAll' | 'eventsForOrder'>): TrackingLateCreditPort {
  return {
    issued: async (orderId) => {
      const line = (await ledger.eventsForOrder(orderId)).find((e) => e.postingGroupId === latePromiseGroupId(orderId) && e.type === 'credit_issued');
      return line ? { amountIqd: line.amount, at: line.occurredAt } : null;
    },
    issue: async (c, tx?: Tx) => {
      await ledger.recordAll(
        {
          id: latePromiseGroupId(c.orderId),
          kind: 'money',
          occurredAt: c.at,
          refs: { orderId: c.orderId },
          lines: [{ type: 'credit_issued', amount: c.amountIqd, fromAccount: Accounts.platform, toAccount: Accounts.customer(c.customerId), memo: LATE_PROMISE_MEMO }],
          controls: [{ account: Accounts.customer(c.customerId), net: c.amountIqd }],
        },
        tx,
      );
    },
  };
}

/** The honest-delay apology's event (step one): the notify module turns it into the push and its SMS twin. */
export const LATE_APOLOGY_EVENT = 'order.late_apology' as const;

/** Its idempotency key: one apology per order, whoever (track read, sweep, another instance) gets there first. */
export const lateApologyKey = (orderId: string): string => `late_apology:${orderId}`;

/**
 * The apology through the event log (Ali, 2026-10-06): one `order.late_apology` per order (idempotency
 * key), carrying the new time. It goes on its own aggregate, not `order`, because it changes no order
 * state — an offline courier's replay older than it must not read as a contradiction.
 */
export function eventsLateApology(events: Pick<EventsService, 'emit' | 'forOrder'>): TrackingLateApologyPort {
  return {
    sent: async (orderId) => {
      const e = (await events.forOrder(orderId)).find((x) => x.type === LATE_APOLOGY_EVENT);
      if (!e) return null;
      const eta = typeof e.payload['etaAt'] === 'string' ? new Date(e.payload['etaAt']) : null;
      return { at: e.occurredAt, etaAt: eta && !Number.isNaN(eta.getTime()) ? eta : e.occurredAt };
    },
    send: async (c, tx?: Tx) => {
      await events.emit(
        tx,
        {
          type: LATE_APOLOGY_EVENT,
          actorId: 'system',
          occurredAt: c.at,
          orderId: c.orderId,
          idempotencyKey: lateApologyKey(c.orderId),
          payload: encodeDomainEvent(LATE_APOLOGY_EVENT, { customerId: c.customerId, promisedAt: c.promisedAt.toISOString(), etaAt: c.etaAt.toISOString(), ...(c.cityId ? { cityId: c.cityId } : {}) }),
        },
        { name: 'late_promise', id: c.orderId },
      );
    },
  };
}

/** How often the apology sweep runs: `LATE_APOLOGY_SWEEP_MS` (default 30 s; 0 turns it off). */
export function lateApologySweepMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env['LATE_APOLOGY_SWEEP_MS'];
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

/**
 * Sends the honest-delay apology to deliveries nobody is watching (`TrackingService.sweepLateApologies`)
 * on a timer. A run that overlaps the previous one is skipped; a failed run is logged and the next
 * one tries again (the apology is idempotent by order).
 */
@Injectable()
export class LateApologySweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LateApologySweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly tracking: TrackingService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Background work: on DRIVER_ROLE=web machines the worker runs it, so it ticks once, not per machine.
    if (!runsJobs(this.role)) return;
    const every = lateApologySweepMs();
    if (every <= 0) return;
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tracking.sweepLateApologies();
    } catch (err) {
      this.logger.error(`late apology sweep: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

/** A delivery that reached the door past the promise gets its credit at `order.delivered`, watched or not. */
@Injectable()
export class LatePromiseSubscriber implements OnModuleInit, OnModuleDestroy {
  private off: (() => void) | null = null;

  constructor(
    private readonly events: EventsService,
    private readonly tracking: TrackingService,
  ) {}

  onModuleInit(): void {
    this.off = this.events.subscribe('tracking:late_promise', ['order.delivered'], async (e, ctx) => {
      if (e.orderId) await this.tracking.settleLatePromise(e.orderId, ctx.tx);
    });
  }

  onModuleDestroy(): void {
    this.off?.();
  }
}

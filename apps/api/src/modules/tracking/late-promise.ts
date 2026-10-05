import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { EventsService } from '../events/index.js';
import { Accounts, type LedgerService } from '../ledger/index.js';
import { TrackingService, type TrackingLateCreditPort } from './tracking.service.js';

/** Memo on the honest-delay credit line, so wallets, receipts and finance can tell it apart. */
export const LATE_PROMISE_MEMO = 'late_promise';

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

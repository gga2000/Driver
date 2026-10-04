import { Inject, Injectable } from '@nestjs/common';
import type { LedgerEvent, MoneyRules } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { Accounts } from './accounts.js';
import { LedgerService } from './ledger.service.js';
import type { PostingGroup } from './postings.js';
import { MONEY_RULES } from './tokens.js';

/** Memo prefix on every support credit line (`support:<ticketId>`), so wallets and reports can tell them apart. */
export const SUPPORT_CREDIT_MEMO = 'support';

/** Who pays for a goodwill credit: the platform, or the party support found at fault. */
export type SupportCreditFunder = { kind: 'platform' } | { kind: 'courier'; driverId: string } | { kind: 'merchant'; merchantId: string };

export interface SupportCredit {
  /** Stable per refund action (ticket + client idempotency key): a replay posts nothing. */
  groupId: string;
  ticketId: string;
  customerId: string;
  orderId: string | null;
  amountIqd: number;
  method: 'wallet' | 'points';
  funder: SupportCreditFunder;
  occurredAt: Date;
}

/**
 * Support refunds through the ledger's public API (support spec §2–3, decisions "refunds default to
 * wallet"): a balanced posting group per refund.
 *  - wallet: `credit_issued` from the funder (platform / the courier's earnings `driver:` / the
 *    merchant's cash account `merchant_cash:`) to the customer's wallet.
 *  - points: `points_earned` from the points pool (always platform-funded: points never create money),
 *    at the city's point value (100 points = 1,000 IQD).
 * Limits (per agent, per customer, escalation) are the support module's; this only posts.
 */
@Injectable()
export class SupportCreditService {
  constructor(
    private readonly ledger: LedgerService,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
  ) {}

  pointsFor(amountIqd: number): number {
    return Math.floor(amountIqd / this.rules.points.pointValueIqd);
  }

  async credit(c: SupportCredit, tx?: Tx): Promise<{ recorded: boolean; points: number | null }> {
    const memo = `${SUPPORT_CREDIT_MEMO}:${c.ticketId}`;
    const refs = c.orderId ? { orderId: c.orderId } : {};
    let group: PostingGroup;
    let points: number | null = null;
    if (c.method === 'points') {
      points = this.pointsFor(c.amountIqd);
      group = {
        id: c.groupId,
        kind: 'points',
        occurredAt: c.occurredAt,
        refs,
        lines: [{ type: 'points_earned', amount: points, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(c.customerId), memo }],
        controls: [{ account: Accounts.points(c.customerId), net: points }],
      };
    } else {
      const from = c.funder.kind === 'courier' ? Accounts.driver(c.funder.driverId) : c.funder.kind === 'merchant' ? Accounts.merchantCash(c.funder.merchantId) : Accounts.platform;
      group = {
        id: c.groupId,
        kind: 'money',
        occurredAt: c.occurredAt,
        refs,
        lines: [{ type: 'credit_issued', amount: c.amountIqd, fromAccount: from, toAccount: Accounts.customer(c.customerId), memo: `${memo}:${c.funder.kind}` }],
        controls: [{ account: Accounts.customer(c.customerId), net: c.amountIqd }],
      };
    }
    const res = await this.ledger.recordAll(group, tx);
    return { recorded: res.recorded.includes(c.groupId), points };
  }

  /** Support credit lines for an order (wallet and points), oldest first. */
  async linesForOrder(orderId: string): Promise<LedgerEvent[]> {
    return (await this.ledger.eventsForOrder(orderId)).filter((e) => e.memo?.startsWith(`${SUPPORT_CREDIT_MEMO}:`));
  }
}

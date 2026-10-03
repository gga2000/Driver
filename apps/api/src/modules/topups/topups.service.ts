import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  TOPUP_RULES,
  type Actor,
  ConfirmTopUpInput,
  TopUpLookupInput,
  type RequestTopUpInput,
  type TopUpConfirmation,
  type TopUpLookupView,
  type TopUpPort,
  type TopUpStatusInput,
  type TopUpView,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { startOfLocalDay } from '../../shared/local-time.js';
import { EventsService } from '../events/index.js';
import { Accounts, LedgerService, type PostingGroup } from '../ledger/index.js';
import { TOPUPS_REPOSITORY, type TopUpRecord, type TopUpsRepository } from './topups.repository.js';

/** Does this courier carry an order of this customer right now (his "next order")? Bound over orders + trips. */
export interface TopUpCourierCheck {
  carriesOrderOf(courierId: string, customerId: string): Promise<boolean>;
}

/** Names on the agent's screen: the customer's first name and masked phone (vault read, logged). */
export interface TopUpPeople {
  cards(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, { name: string | null; phoneMasked: string }>>;
}

/**
 * Digital top-up rails (ZainCash first) plug in here when they ship: a payment that settles credits
 * the wallet through the same ledger posting (`topup:<id>`, channel `zaincash`, from `bank`).
 * Nothing is bound yet; cash to an agent or a courier is the only channel.
 */
export interface TopUpRailsPort {
  readonly channel: 'zaincash';
  /** Starts a payment for a pending top-up and returns where the customer pays. */
  start(topUpId: string, amountIqd: number): Promise<{ paymentUrl: string }>;
}

export const TOPUP_COURIER_CHECK = Symbol('TOPUP_COURIER_CHECK');
export const TOPUP_PEOPLE = Symbol('TOPUP_PEOPLE');

const HOUR_MS = 3_600_000;
const QR_PREFIX = 'DRVTU:';

/** `T-XXXX-XXXX` for the receipt; stable per top-up (Crockford base32, read aloud easily). */
export function topUpReference(topUpId: string): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const digest = createHash('sha256').update(`topup|${topUpId}`).digest();
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[(digest[i] ?? 0) % 32];
  return `T-${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What a stored row looks like to the customer right now (pending past its expiry reads `expired`). */
export function topUpState(r: Pick<TopUpRecord, 'state' | 'expiresAt'>, now: Date): TopUpView['state'] {
  if (r.state === 'pending' && r.expiresAt.getTime() <= now.getTime()) return 'expired';
  return r.state;
}

/**
 * Wallet top-up with cash (money §4 channel 3; domain §12 "cash top-ups via drivers or agent shops").
 * The customer asks for an amount and gets a 6-digit code; an ops agent or the courier carrying his
 * next order counts the cash and confirms. The confirmation, the single-use state change and the
 * ledger credit (`topup:<id>`: `credit_issued` into `customer:<id>`, from `bank` for an agent or
 * `cash:<courier>` for a courier, whose cash cap then counts it) are one unit of work. Limits: 5,000–
 * 100,000 per code in steps of 1,000, 200,000 and 5 codes per customer per local day, 24 h expiry.
 */
@Injectable()
export class TopUpService implements TopUpPort {
  constructor(
    @Inject(TOPUPS_REPOSITORY) private readonly repo: TopUpsRepository,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TOPUP_COURIER_CHECK) private readonly couriers: TopUpCourierCheck,
    @Inject(TOPUP_PEOPLE) private readonly people: TopUpPeople,
  ) {}

  async request(actor: Actor, input: RequestTopUpInput): Promise<TopUpView> {
    const amount = input.amountIqd;
    if (amount < TOPUP_RULES.minIqd || amount > TOPUP_RULES.maxIqd || amount % TOPUP_RULES.stepIqd !== 0) throw new DriverError('topup_amount_invalid');
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const today = await this.repo.ofCustomer(actor.personId, startOfLocalDay(now), tx);
      const open = today.find((r) => topUpState(r, now) === 'pending');
      // Asking again for the same amount returns the code he already has.
      if (open && open.amountIqd === amount) return this.view(open, now, today);
      const counted = today.filter((r) => r.id !== open?.id && (r.state === 'confirmed' || topUpState(r, now) === 'pending'));
      const usedIqd = counted.reduce((s, r) => s + r.amountIqd, 0);
      if (today.length >= TOPUP_RULES.dailyMaxRequests || usedIqd + amount > TOPUP_RULES.dailyMaxIqd) throw new DriverError('topup_daily_limit');
      // One live code at a time: a new amount replaces the open one.
      if (open) await this.repo.cancel(open.id, tx);
      const code = await this.freshCode(now);
      const row = await this.repo.create({ customerId: actor.personId, amountIqd: amount, code, expiresAt: new Date(now.getTime() + TOPUP_RULES.codeTtlHours * HOUR_MS), createdAt: now }, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'wallet.topup_requested', occurredAt: now, payload: { topUpId: row.id, customerId: actor.personId, amountIqd: amount, expiresAt: row.expiresAt.toISOString(), replaced: open?.id ?? null } },
        { name: 'wallet_topup', id: row.id },
      );
      return this.view(row, now, [row, ...today.map((r) => (r.id === open?.id ? { ...r, state: 'cancelled' as const } : r))]);
    });
  }

  async status(actor: Actor, input: TopUpStatusInput): Promise<TopUpView | null> {
    const now = this.clock.now();
    const row = input.topUpId ? await this.repo.get(input.topUpId) : await this.repo.latestOf(actor.personId);
    if (!row) return null;
    if (row.customerId !== actor.personId) throw new DriverError('forbidden');
    return this.view(row, now, await this.repo.ofCustomer(actor.personId, startOfLocalDay(now)));
  }

  async lookup(actor: Actor, input: z.infer<typeof TopUpLookupInput>, channel: 'ops_agent' | 'courier'): Promise<TopUpLookupView> {
    const now = this.clock.now();
    const row = await this.byCode(input.code);
    if (channel === 'courier' && !(await this.couriers.carriesOrderOf(actor.personId, row.customerId))) throw new DriverError('topup_courier_not_assigned');
    const card = (await this.people.cards([row.customerId], actor.personId, 'wallet_topup'))[row.customerId];
    return {
      topUpId: row.id,
      amountIqd: row.amountIqd,
      state: topUpState(row, now),
      expiresAt: row.expiresAt,
      customerName: firstName(card?.name ?? null),
      customerPhoneMasked: card?.phoneMasked ?? null,
    };
  }

  async confirm(actor: Actor, input: z.infer<typeof ConfirmTopUpInput>, channel: 'ops_agent' | 'courier'): Promise<TopUpConfirmation> {
    const now = this.clock.now();
    const done = await this.uow.run(async (tx) => {
      const row = await this.byCode(input.code, tx);
      if (row.state === 'confirmed') {
        // A retried confirmation (same key, same person) answers with the receipt; anything else is a reused code.
        if (input.idempotencyKey && row.idempotencyKey === input.idempotencyKey && row.confirmedById === actor.personId) return row;
        throw new DriverError('topup_code_used');
      }
      if (row.state === 'cancelled') throw new DriverError('topup_code_invalid');
      if (topUpState(row, now) === 'expired') throw new DriverError('topup_expired');
      if (input.amountIqd !== row.amountIqd) throw new DriverError('topup_amount_mismatch');
      if (channel === 'courier' && !(await this.couriers.carriesOrderOf(actor.personId, row.customerId))) throw new DriverError('topup_courier_not_assigned');
      const reference = topUpReference(row.id);
      const ok = await this.repo.confirm(row.id, { confirmedAt: now, confirmedById: actor.personId, channel, reference, idempotencyKey: input.idempotencyKey ?? null }, tx);
      if (!ok) throw new DriverError('topup_code_used');
      // The cash is now with the company (agent → bank) or in the courier's hand (counts on his cap).
      const from = channel === 'courier' ? Accounts.cash(actor.personId) : Accounts.bank;
      const group: PostingGroup = {
        id: `topup:${row.id}`,
        kind: 'money',
        occurredAt: now,
        refs: {},
        lines: [{ type: 'credit_issued', amount: row.amountIqd, fromAccount: from, toAccount: Accounts.customer(row.customerId), memo: `topup:${channel}:${reference}` }],
        controls: [{ account: Accounts.customer(row.customerId), net: row.amountIqd }],
      };
      await this.ledger.recordAll(group, tx);
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: 'wallet.topped_up',
          occurredAt: now,
          payload: { topUpId: row.id, customerId: row.customerId, amountIqd: row.amountIqd, channel, reference, confirmedBy: actor.personId, whatsappReceipt: true },
          ...(input.idempotencyKey ? { idempotencyKey: `topup:${input.idempotencyKey}` } : {}),
        },
        { name: 'wallet_topup', id: row.id },
      );
      return { ...row, state: 'confirmed' as const, confirmedAt: now, confirmedById: actor.personId, channel, reference, idempotencyKey: input.idempotencyKey ?? null };
    });
    const card = (await this.people.cards([done.customerId], actor.personId, 'wallet_topup'))[done.customerId];
    return {
      topUpId: done.id,
      amountIqd: done.amountIqd,
      reference: done.reference ?? topUpReference(done.id),
      channel: done.channel ?? channel,
      confirmedAt: done.confirmedAt ?? now,
      walletBalanceIqd: (await this.ledger.balance(Accounts.customer(done.customerId))).amount,
      customerName: firstName(card?.name ?? null),
      customerPhoneMasked: card?.phoneMasked ?? null,
    };
  }

  /** The row a code points at: the live one if any, else the newest (so "used" / "expired" can be told). */
  private async byCode(code: string, tx?: Parameters<TopUpsRepository['byCode']>[1]): Promise<TopUpRecord> {
    const rows = await this.repo.byCode(code.trim().replace(/^DRVTU:/i, '').replace(/\s+/g, ''), tx);
    const now = this.clock.now();
    const row = rows.find((r) => topUpState(r, now) === 'pending') ?? rows[0];
    if (!row) throw new DriverError('topup_code_invalid');
    return row;
  }

  /** Six digits not held by any live code (1 in a million clash; a few tries). */
  private async freshCode(now: Date): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const clash = (await this.repo.byCode(code)).some((r) => topUpState(r, now) === 'pending');
      if (!clash) return code;
    }
    throw new DriverError('internal');
  }

  private view(r: TopUpRecord, now: Date, today: readonly TopUpRecord[]): TopUpView {
    const used = today.filter((x) => x.state === 'confirmed' || topUpState(x, now) === 'pending').reduce((s, x) => s + x.amountIqd, 0);
    return {
      topUpId: r.id,
      amountIqd: r.amountIqd,
      code: r.code,
      qrPayload: `${QR_PREFIX}${r.code}`,
      state: topUpState(r, now),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      confirmedAt: r.confirmedAt,
      channel: r.channel,
      reference: r.reference,
      dailyRemainingIqd: Math.max(0, TOPUP_RULES.dailyMaxIqd - used),
    };
  }
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}


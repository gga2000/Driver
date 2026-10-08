import { describe, expect, it } from 'vitest';
import { DriverError, type Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { Accounts } from '../ledger/accounts.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { moneyLines } from '../ledger/customer-wallet.js';
import { InMemoryLedgerRepository } from '../ledger/repository.js';
import { InMemoryTopUpsRepository } from './topups.repository.js';
import { TopUpService, topUpReference } from './topups.service.js';

const HOUR = 3_600_000;
const customer: Actor = { personId: 'c1', sessionId: 's1' };
const agent: Actor = { personId: 'ops_1', sessionId: 's2' };
const courier: Actor = { personId: 'k1', sessionId: 's3' };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

function harness(outcomes?: { agentCashAccounts: boolean }) {
  const clock = new FakeClock('2026-10-04T09:00:00Z'); // Sunday 12:00 Baghdad
  const ev = createInMemoryEvents({ clock });
  const ledgerRepo = new InMemoryLedgerRepository();
  const ledger = new LedgerService(ledgerRepo, ev.uow);
  const repo = new InMemoryTopUpsRepository();
  const carrying = new Set<string>(); // `${courierId}|${customerId}`
  const svc = new TopUpService(
    repo,
    ledger,
    ev.events,
    ev.uow,
    clock,
    { carriesOrderOf: async (k, c) => carrying.has(`${k}|${c}`) },
    { cards: async (ids) => Object.fromEntries(ids.map((id) => [id, { name: 'علي أحمد', phoneMasked: '0770 ••• 4567' }])) },
    outcomes,
  );
  const balance = async (id = 'c1') => (await ledger.balance(Accounts.customer(id))).amount;
  return { clock, ev, ledger, repo, svc, carrying, balance };
}

describe('wallet top-up with cash — request', () => {
  it('a 6-digit code + QR payload, 24 h, one live code at a time; the same amount returns the same code', async () => {
    const h = harness();
    const a = await h.svc.request(customer, { amountIqd: 25_000 });
    expect(a).toMatchObject({ amountIqd: 25_000, state: 'pending', qrPayload: `DRVTU:${a.code}`, confirmedAt: null, dailyRemainingIqd: 175_000 });
    expect(a.code).toMatch(/^\d{6}$/);
    expect(a.expiresAt.getTime() - a.createdAt.getTime()).toBe(24 * HOUR);
    expect((await h.svc.request(customer, { amountIqd: 25_000 })).topUpId).toBe(a.topUpId);
    // A new amount replaces the open code.
    const b = await h.svc.request(customer, { amountIqd: 50_000 });
    expect(b.topUpId).not.toBe(a.topUpId);
    expect((await h.repo.get(a.topUpId))?.state).toBe('cancelled');
    expect(await h.svc.status(customer, {})).toMatchObject({ topUpId: b.topUpId, state: 'pending', dailyRemainingIqd: 150_000 });
    expect(await code(h.svc.status({ personId: 'someone', sessionId: 'x' }, { topUpId: b.topUpId }))).toBe('forbidden');
    expect((await h.ev.repo.find({ actorId: 'c1' })).map((e) => e.type)).toEqual(['wallet.topup_requested', 'wallet.topup_requested']);
  });

  it('limits: 5,000–100,000 in thousands per code, 200,000 and 5 codes per local day', async () => {
    const h = harness();
    for (const amountIqd of [4000, 100_500, 7500]) expect(await code(h.svc.request(customer, { amountIqd }))).toBe('topup_amount_invalid');
    // Two confirmed 100,000 top-ups use the whole day.
    for (let i = 0; i < 2; i++) {
      const r = await h.svc.request(customer, { amountIqd: 100_000 });
      await h.svc.confirm(agent, { code: r.code, amountIqd: 100_000 }, 'ops_agent');
    }
    expect(await code(h.svc.request(customer, { amountIqd: 5000 }))).toBe('topup_daily_limit');
    // The next local day starts fresh (Baghdad midnight is 21:00 UTC).
    h.clock.set(new Date('2026-10-04T21:00:00Z'));
    expect(await code(h.svc.request(customer, { amountIqd: 5000 }))).toBe('ok');
  });
});

describe('wallet top-up with cash — confirmation', () => {
  it('an ops agent confirms once: the wallet is credited from bank (company holds the cash) and reads as a top-up line', async () => {
    const h = harness();
    const r = await h.svc.request(customer, { amountIqd: 30_000 });
    expect(await h.svc.lookup(agent, { code: r.code }, 'ops_agent')).toMatchObject({ topUpId: r.topUpId, amountIqd: 30_000, state: 'pending', customerName: 'علي', customerPhoneMasked: '0770 ••• 4567' });
    const done = await h.svc.confirm(agent, { code: `DRVTU:${r.code}`, amountIqd: 30_000 }, 'ops_agent');
    expect(done).toMatchObject({ topUpId: r.topUpId, amountIqd: 30_000, channel: 'ops_agent', reference: topUpReference(r.topUpId), walletBalanceIqd: 30_000 });
    expect(done.reference).toMatch(/^T-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await h.balance()).toBe(30_000);
    expect((await h.ledger.balance(Accounts.bank)).amount).toBe(-30_000);
    const lines = moneyLines(Accounts.customer('c1'), await h.ledger.eventsFor(Accounts.customer('c1')));
    expect(lines).toEqual([expect.objectContaining({ kind: 'topup', amount: 30_000, title_ar: 'شحن رصيد' })]);
    expect(await h.svc.status(customer, { topUpId: r.topUpId })).toMatchObject({ state: 'confirmed', channel: 'ops_agent', reference: done.reference });
    expect((await h.ev.repo.find({ actorId: 'ops_1' })).find((e) => e.type === 'wallet.topped_up')?.payload).toMatchObject({ amountIqd: 30_000, channel: 'ops_agent', whatsappReceipt: true });
    expect((await h.ledger.checkInvariant()).ok).toBe(true);
  });

  it('single use, idempotent retries, wrong amount, expiry and unknown codes', async () => {
    const h = harness();
    const r = await h.svc.request(customer, { amountIqd: 20_000 });
    expect(await code(h.svc.confirm(agent, { code: r.code, amountIqd: 15_000 }, 'ops_agent'))).toBe('topup_amount_mismatch');
    const first = await h.svc.confirm(agent, { code: r.code, amountIqd: 20_000, idempotencyKey: 'tap-0001' }, 'ops_agent');
    // The agent's app retries the same tap: same receipt, no second credit.
    expect(await h.svc.confirm(agent, { code: r.code, amountIqd: 20_000, idempotencyKey: 'tap-0001' }, 'ops_agent')).toMatchObject({ reference: first.reference, walletBalanceIqd: 20_000 });
    expect(await code(h.svc.confirm(agent, { code: r.code, amountIqd: 20_000 }, 'ops_agent'))).toBe('topup_code_used');
    expect(await code(h.svc.confirm(courier, { code: r.code, amountIqd: 20_000, idempotencyKey: 'tap-0001' }, 'ops_agent'))).toBe('topup_code_used');
    expect(await h.balance()).toBe(20_000);

    const late = await h.svc.request(customer, { amountIqd: 10_000 });
    h.clock.advance(24 * HOUR);
    expect(await code(h.svc.confirm(agent, { code: late.code, amountIqd: 10_000 }, 'ops_agent'))).toBe('topup_expired');
    expect((await h.svc.status(customer, { topUpId: late.topUpId }))?.state).toBe('expired');
    expect(await code(h.svc.confirm(agent, { code: '000000', amountIqd: 10_000 }, 'ops_agent'))).toBe(late.code === '000000' ? 'topup_expired' : 'topup_code_invalid');
    expect(await h.balance()).toBe(20_000);
  });

  it('two agents confirming the same code at once: one credit only', async () => {
    const h = harness();
    const r = await h.svc.request(customer, { amountIqd: 40_000 });
    const both = await Promise.all([h.svc.confirm(agent, { code: r.code, amountIqd: 40_000 }, 'ops_agent'), h.svc.confirm({ personId: 'ops_2', sessionId: 's9' }, { code: r.code, amountIqd: 40_000 }, 'ops_agent')].map(code));
    expect(both.sort()).toEqual(['ok', 'topup_code_used']);
    expect(await h.balance()).toBe(40_000);
  });

  it('courier path: only the courier carrying the customer’s order; the cash then counts as held by him', async () => {
    const h = harness();
    const r = await h.svc.request(customer, { amountIqd: 15_000 });
    expect(await code(h.svc.lookup(courier, { code: r.code }, 'courier'))).toBe('topup_courier_not_assigned');
    expect(await code(h.svc.confirm(courier, { code: r.code, amountIqd: 15_000 }, 'courier'))).toBe('topup_courier_not_assigned');
    h.carrying.add('k1|c1');
    expect(await h.svc.confirm(courier, { code: r.code, amountIqd: 15_000 }, 'courier')).toMatchObject({ channel: 'courier', walletBalanceIqd: 15_000 });
    expect((await h.ledger.balance(Accounts.cash('k1'))).amount).toBe(-15_000);
  });
});

describe('THIN-12 / M-13: agent cash accounts (switch off by default)', () => {
  it('off: an agent top-up is booked to the bank; on: it sits on the agent own cash account', async () => {
    for (const on of [false, true]) {
      const h = harness({ agentCashAccounts: on });
      const r = await h.svc.request(customer, { amountIqd: 30_000 });
      await h.svc.confirm(agent, { code: r.code, amountIqd: 30_000 }, 'ops_agent');
      expect(await h.balance()).toBe(30_000);
      expect((await h.ledger.balance(Accounts.bank)).amount).toBe(on ? 0 : -30_000);
      expect((await h.ledger.balance(Accounts.cash(agent.personId))).amount).toBe(on ? -30_000 : 0);
      expect((await h.ledger.checkInvariant()).ok).toBe(true);
    }
  });
});

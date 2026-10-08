import { describe, expect, it } from 'vitest';
import { DisputeKind } from '@driver/contracts';
import { CANNED_RESPONSES, DISPUTE_SUBJECT_AR, SUGGESTED_BY_DISPUTE } from './canned.js';
import { InMemorySupportRepository, type TicketRecord } from './support.repository.js';
import { customerOrderStats, slaDueAt, slaStateOf, urgencyOf } from './support.service.js';

function ticket(over: Partial<TicketRecord> = {}): TicketRecord {
  const openedAt = over.openedAt ?? new Date('2026-10-04T09:00:00Z');
  return {
    id: 'tk_1',
    cityId: 'aziziyah',
    kind: 'complaint',
    status: 'open',
    channel: 'in_app',
    subject: 'تأخير',
    orderId: null,
    tripId: null,
    customerId: 'c1',
    openedById: 'c1',
    openedAt,
    firstResponseAt: null,
    resolvedAt: null,
    slaDueAt: slaDueAt(openedAt),
    assigneeId: null,
    faultParty: 'none',
    refundedIqd: 0,
    escalatedTo: null,
    escalatedAt: null,
    resolution: null,
    sourceKey: null,
    reopenCount: 0,
    lastActivityAt: openedAt,
    ...over,
  };
}

describe('support desk rules', () => {
  it('same-day SLA: due at local midnight, never less than 2 h after opening, never more than 24 h', () => {
    // 12:00 Baghdad → due 00:00 Baghdad (21:00Z).
    expect(slaDueAt(new Date('2026-10-04T09:00:00Z')).toISOString()).toBe('2026-10-04T21:00:00.000Z');
    // 23:30 Baghdad → 2 h later, not 30 min.
    expect(slaDueAt(new Date('2026-10-04T20:30:00Z')).toISOString()).toBe('2026-10-04T22:30:00.000Z');
    // 00:05 Baghdad (just after midnight) → that night's midnight is ~24 h away: capped at 24 h.
    expect(slaDueAt(new Date('2026-10-04T21:05:00Z')).toISOString()).toBe('2026-10-05T21:00:00.000Z');
  });

  it('SLA state: ok → due soon in the last hour → breached; resolved tickets are met or breached', () => {
    const t = ticket();
    expect(slaStateOf(t, new Date('2026-10-04T12:00:00Z'))).toBe('ok');
    expect(slaStateOf(t, new Date('2026-10-04T20:30:00Z'))).toBe('due_soon');
    expect(slaStateOf(t, new Date('2026-10-04T21:00:01Z'))).toBe('breached');
    expect(slaStateOf({ ...t, status: 'resolved', resolvedAt: new Date('2026-10-04T20:00:00Z') }, new Date('2026-10-06T00:00:00Z'))).toBe('met');
    expect(slaStateOf({ ...t, status: 'resolved', resolvedAt: new Date('2026-10-04T22:00:00Z') }, new Date('2026-10-06T00:00:00Z'))).toBe('breached');
  });

  it('urgency: safety and live orders first, then escalated, overdue, money and tone; waiting drops', () => {
    const now = new Date('2026-10-04T09:30:00Z');
    const base = urgencyOf(ticket(), { activeOrder: false, orderTotalIqd: 6_000, text: 'تأخير' }, now);
    const live = urgencyOf(ticket(), { activeOrder: true, orderTotalIqd: 6_000, text: 'تأخير' }, now);
    const safety = urgencyOf(ticket({ kind: 'incident' }), { activeOrder: false, orderTotalIqd: null, text: '' }, now);
    const hostile = urgencyOf(ticket(), { activeOrder: false, orderTotalIqd: 30_000, text: 'هذا نصب وغش' }, now);
    const waiting = urgencyOf(ticket({ status: 'waiting' }), { activeOrder: false, orderTotalIqd: 6_000, text: 'تأخير' }, now);
    expect(safety.score).toBeGreaterThan(live.score);
    expect(live.score).toBeGreaterThan(base.score);
    expect(hostile.reasons).toEqual(['مبلغ كبير', 'زعلان']);
    expect(waiting.score).toBeLessThan(base.score);
    const old = urgencyOf(ticket({ openedAt: new Date('2026-10-03T08:00:00Z'), slaDueAt: new Date('2026-10-03T21:00:00Z') }), { activeOrder: false, orderTotalIqd: null, text: '' }, now);
    expect(old.reasons).toEqual(['أكثر من 24 ساعة', 'فات موعدها']);
  });

  it('has the launch replies Ali approved (G0-11), none of which gives money, and none promises a cash agent', () => {
    const byKey = new Map(CANNED_RESPONSES.map((c) => [c.key, c]));
    for (const k of ['no_courier', 'kitchen_refused', 'calls_soon', 'wallet_balance', 'change_to_wallet', 'sos_followup', 'refund_refused', 'ask_order_number']) {
      const c = byKey.get(k);
      expect(c?.text_ar).toBeTruthy();
      expect(c?.amountIqd).toBeNull();
      expect(c?.action === 'none' || c?.action === 'resolve').toBe(true);
    }
    expect(byKey.get('sos_followup')?.text_ar).toContain('911');
    for (const c of CANNED_RESPONSES) expect(c.text_ar).not.toContain('وكيل');
  });

  it('every dispute kind has an Arabic subject; suggestions point at real canned answers', () => {
    for (const k of DisputeKind.options) expect(DISPUTE_SUBJECT_AR[k]).toBeTruthy();
    const keys = new Set(CANNED_RESPONSES.map((c) => c.key));
    expect(keys.size).toBe(CANNED_RESPONSES.length);
    for (const s of Object.values(SUGGESTED_BY_DISPUTE)) expect(keys.has(s!.cannedKey)).toBe(true);
    // Iraqi Arabic with Western digits (voice guide §5): no Eastern-Arabic numerals.
    for (const c of CANNED_RESPONSES) expect(c.text_ar).not.toMatch(/[٠-٩]/);
  });

  it('repository: one ticket per source key, idempotent entries, refunds per agent and per customer', async () => {
    const repo = new InMemorySupportRepository();
    const input: Omit<ReturnType<typeof ticket>, 'id'> & { id?: string } = ticket({ sourceKey: 'dispute:o1' });
    delete input.id;
    const t = await repo.create(input);
    await expect(repo.create(input)).rejects.toThrow(/source_key/);
    expect((await repo.bySourceKey('dispute:o1'))?.id).toBe(t.id);
    const at = new Date('2026-10-04T10:00:00Z');
    await repo.addEntry({ ticketId: t.id, actorId: 'a1', kind: 'refund', text: '1,000', amountIqd: 1000, meta: {}, idempotencyKey: 'refund:k1', at });
    await expect(repo.addEntry({ ticketId: t.id, actorId: 'a1', kind: 'refund', text: '1,000', amountIqd: 1000, meta: {}, idempotencyKey: 'refund:k1', at })).rejects.toThrow(/idempotency/);
    expect((await repo.refundsBy('a1', new Date('2026-10-04T00:00:00Z'))).map((e) => e.amountIqd)).toEqual([1000]);
    expect(await repo.refundsBy('a1', new Date('2026-10-04T11:00:00Z'))).toEqual([]);
    expect((await repo.refundsOn([t.id], new Date('2026-10-01T00:00:00Z'))).length).toBe(1);
    await repo.update(t.id, { status: 'resolved', resolvedAt: at });
    expect(await repo.list({ cityId: 'aziziyah', statuses: ['open'], limit: 10 })).toEqual([]);
    expect((await repo.list({ cityId: 'aziziyah', statuses: [], resolvedSince: new Date('2026-10-04T00:00:00Z'), limit: 10 })).map((x) => x.id)).toEqual([t.id]);
  });

  it('customer card: counts only orders the customer placed; lifetime value from delivered ones', () => {
    const at = (d: string) => new Date(`2026-${d}T12:00:00Z`);
    const stats = customerOrderStats(
      [
        { ordererId: 'c1', state: 'closed', totalIqd: 8_000, placedAt: at('09-01') },
        { ordererId: 'c1', state: 'delivered', totalIqd: 6_500, placedAt: at('10-03') },
        { ordererId: 'c1', state: 'customer_cancelled', totalIqd: 4_000, placedAt: at('09-20') },
        { ordererId: 'c1', state: 'preparing', totalIqd: 3_000, placedAt: at('10-04') },
        // Carried by c1 as a household member, ordered by someone else: not theirs.
        { ordererId: 'c2', state: 'closed', totalIqd: 50_000, placedAt: at('08-01') },
      ],
      'c1',
    );
    expect(stats).toEqual({ orders: 4, delivered: 2, cancelled: 1, lifetimeIqd: 14_500, firstOrderAt: at('09-01'), lastOrderAt: at('10-04') });
    expect(customerOrderStats([], 'c1')).toMatchObject({ orders: 0, lifetimeIqd: 0, firstOrderAt: null, lastOrderAt: null });
  });
});

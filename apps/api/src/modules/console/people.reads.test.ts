import { describe, expect, it } from 'vitest';
import { PeopleCustomersInput, PersonInput, StoryInput } from '@driver/contracts/people';
import { FleetService, InMemoryFleetRepository } from '../fleet/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { dispatchHarness } from '../dispatch/test-harness.js';
import { PHONE_REVEAL_LIMIT_EVENT, STAFF_PHONE_REVEAL_PURPOSE, STAFF_REVEAL_PER_HOUR } from '../identity/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { ordersHarness } from '../orders/test-harness.js';
import { ScoringService } from '../scoring/index.js';
import type { SupportService, TicketRecord } from '../support/index.js';
import {
  CONSOLE_PEOPLE_PURPOSE,
  customerSignals,
  medianGapDays,
  PeopleReadService,
  segmentOf,
} from './people.reads.js';

const START = '2026-10-03T09:00:00Z';
const SYSTEM = { personId: 'system' };
const DAY = 86_400_000;

function ticket(p: Partial<TicketRecord> & Pick<TicketRecord, 'id'>): TicketRecord {
  const at = new Date(START);
  return {
    cityId: 'aziziyah',
    kind: 'complaint',
    status: 'open',
    channel: 'phone',
    subject: 'الأكل وصل بارد',
    orderId: null,
    tripId: null,
    customerId: null,
    openedById: 'staff',
    openedAt: at,
    firstResponseAt: null,
    resolvedAt: null,
    slaDueAt: at,
    assigneeId: null,
    faultParty: 'none',
    refundedIqd: 0,
    escalatedTo: null,
    escalatedAt: null,
    resolution: null,
    sourceKey: null,
    reopenCount: 0,
    lastActivityAt: at,
    ...p,
  };
}

/** The modules «الناس» reads, on in-memory twins; support is a stub holding a few tickets. */
async function world() {
  const d = dispatchHarness(START);
  const id = identityHarness(START);
  const l = ledgerHarness({ start: START });
  const o = ordersHarness(START);
  const ev = createInMemoryEvents({ clock: d.clock, contradictions: false });
  const scoring = new ScoringService(ev.events);
  const fleet = new FleetService(
    new InMemoryFleetRepository(),
    id.service,
    undefined as never,
    d.service,
    undefined as never,
    ev.events,
    undefined as never,
    d.clock,
  );
  const tickets: TicketRecord[] = [];
  const support = {
    openTicketsByCustomer: async () => {
      const m = new Map<string, number>();
      for (const t of tickets)
        if (t.customerId && t.status !== 'resolved')
          m.set(t.customerId, (m.get(t.customerId) ?? 0) + 1);
      return m;
    },
    ticketsOfCustomer: async (c: string) => tickets.filter((t) => t.customerId === c),
    ticketsOnOrders: async (ids: readonly string[]) =>
      tickets.filter((t) => t.orderId !== null && ids.includes(t.orderId)),
  } as unknown as SupportService;
  const people = new PeopleReadService(
    id.service,
    o.orders,
    l.ledger,
    l.caps,
    d.service,
    scoring,
    fleet,
    support,
    o.clock,
  );

  const ids: Record<string, string> = {};
  for (const [name, phone, kind] of [
    ['regular', '07712340011', null],
    ['quiet', '07712340012', null],
    ['upset', '07712340013', null],
    ['courier', '07712340014', 'courier'],
    ['agent', '07712340015', 'support'],
    ['finance', '07712340016', 'finance'],
    ['admin', '07712340017', 'admin'],
  ] as const) {
    const { personId } = await id.login(phone);
    if (kind) await id.service.grantRole(SYSTEM, { personId, kind });
    ids[name] = personId;
  }
  return { d, id, l, o, people, ids, tickets };
}

type W = Awaited<ReturnType<typeof world>>;

/** Places `n` food orders for `who`, a day apart, ending now; `delivered` of them delivered. */
async function orderHistory(w: W, who: string, n: number, delivered: number) {
  const placed: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const order = await w.o.orders.place(who, w.o.foodInput());
    placed.push(order.id);
    if (i < delivered)
      await w.o.repo.update(order.id, { state: 'delivered', deliveredAt: w.o.clock.now() });
    w.o.clock.advanceMinutes(24 * 60);
  }
  return placed;
}

describe('segmentOf / medianGapDays / customerSignals', () => {
  const now = new Date(START);
  const old = new Date(now.getTime() - 60 * DAY);
  const stats = (p: { orders?: number; orders30d?: number; delivered30d?: number }) => ({
    orders: 0,
    delivered: 0,
    spentIqd: 0,
    delivered30d: 0,
    orders30d: 0,
    lastOrderAt: null,
    weekly: [],
    zones: new Map(),
    ...p,
  });

  it('labels each customer with the first segment that fits', () => {
    expect(segmentOf({ frozen: true, openTickets: 2, joinedAt: now, stats: undefined, now })).toBe(
      'frozen',
    );
    expect(segmentOf({ frozen: false, openTickets: 1, joinedAt: now, stats: undefined, now })).toBe(
      'issue',
    );
    expect(segmentOf({ frozen: false, openTickets: 0, joinedAt: now, stats: undefined, now })).toBe(
      'new',
    );
    expect(
      segmentOf({
        frozen: false,
        openTickets: 0,
        joinedAt: old,
        stats: stats({ orders: 6, orders30d: 5, delivered30d: 4 }),
        now,
      }),
    ).toBe('regular');
    expect(
      segmentOf({
        frozen: false,
        openTickets: 0,
        joinedAt: old,
        stats: stats({ orders: 2, orders30d: 1 }),
        now,
      }),
    ).toBe('active');
    expect(
      segmentOf({ frozen: false, openTickets: 0, joinedAt: old, stats: stats({ orders: 2 }), now }),
    ).toBe('lapsed');
    expect(segmentOf({ frozen: false, openTickets: 0, joinedAt: old, stats: undefined, now })).toBe(
      'quiet',
    );
  });

  it('the median gap needs three orders', () => {
    expect(medianGapDays([0, DAY])).toBeNull();
    expect(medianGapDays([0, DAY, 3 * DAY, 4 * DAY])).toBe(1);
    expect(medianGapDays([0, 2 * DAY, 4 * DAY])).toBe(2);
  });

  it('says the trouble first and at most five facts', () => {
    const totals = {
      orders: 10,
      delivered: 6,
      cancelled: 3,
      rides: 0,
      spentIqd: 0,
      avgOrderIqd: null,
      cityAvgOrderIqd: null,
      firstOrderAt: null,
      lastOrderAt: null,
      everyDays: null,
    };
    const hours = Array<number>(24).fill(0);
    hours[21] = 5;
    const s = customerSignals({
      segment: 'issue',
      totals,
      hours,
      credits30dIqd: 1_000,
      creditCount: 1,
      lateRecent: 2,
      openTickets: 1,
      ratingAvg: 4.8,
      ratingCount: 5,
      frozen: false,
      now,
    });
    expect(s.map((x) => x.key)).toEqual([
      'open_ticket',
      'late_orders',
      'credits',
      'cancels_high',
      'rates_well',
    ]);
    expect(s[3]!.n).toBe(30);
  });
});

describe('PeopleReadService', () => {
  it('customers: every customer with the window numbers, the filter counts and a last-4 search (a logged read)', async () => {
    const w = await world();
    // Mornings (09:00 Baghdad): clear of the Friday prayer pause.
    w.o.clock.set(new Date(new Date(START).getTime() - 10 * DAY - 3 * 3_600_000));
    await orderHistory(w, w.ids['regular']!, 6, 5);
    await orderHistory(w, w.ids['upset']!, 1, 0);
    w.tickets.push(ticket({ id: 't1', customerId: w.ids['upset']! }));
    w.o.clock.set(new Date(new Date(START).getTime() + 15 * DAY));

    const page = await w.people.customers(
      PeopleCustomersInput.parse({ cityId: 'aziziyah' }),
      'staff_1',
    );
    const byId = new Map(page.rows.map((r) => [r.personId, r]));
    expect(byId.get(w.ids['regular']!)).toMatchObject({
      orders: 6,
      delivered: 5,
      segment: 'regular',
      openTickets: 0,
    });
    expect(byId.get(w.ids['upset']!)).toMatchObject({
      orders: 1,
      segment: 'issue',
      openTickets: 1,
    });
    expect(byId.get(w.ids['regular']!)!.weekly).toHaveLength(8);
    expect(page.counts.issue).toBe(1);
    // The latest order first.
    expect(page.rows.slice(0, 2).map((r) => r.personId)).toEqual([
      w.ids['upset'],
      w.ids['regular'],
    ]);

    const issues = await w.people.customers(
      PeopleCustomersInput.parse({ cityId: 'aziziyah', filter: 'issue' }),
      'staff_1',
    );
    expect(issues.rows.map((r) => r.personId)).toEqual([w.ids['upset']]);

    const found = await w.people.customers(
      PeopleCustomersInput.parse({ cityId: 'aziziyah', q: '0012' }),
      'staff_1',
    );
    expect(found.rows.map((r) => r.personId)).toEqual([w.ids['quiet']]);
    expect(w.id.repo.accessLogs.every((l) => l.purpose === CONSOLE_PEOPLE_PURPOSE)).toBe(true);
  });

  it('customer: totals, charts, recent orders, tickets, the masked number (one logged read) and signals', async () => {
    const w = await world();
    await orderHistory(w, w.ids['regular']!, 4, 3);
    w.tickets.push(
      ticket({ id: 't2', customerId: w.ids['regular']!, status: 'resolved', refundedIqd: 2_000 }),
    );

    const p = await w.people.customer(
      PersonInput.parse({ cityId: 'aziziyah', personId: w.ids['regular']! }),
      'staff_1',
    );
    expect(p.totals).toMatchObject({ orders: 4, delivered: 3, rides: 0 });
    expect(p.totals.avgOrderIqd).toBeGreaterThan(0);
    expect(p.totals.everyDays).toBe(1);
    expect(p.weekly).toHaveLength(12);
    expect(p.hours.reduce((a, b) => a + b, 0)).toBe(4);
    expect(p.services).toEqual([{ type: 'food', count: 4 }]);
    expect(p.recent).toHaveLength(4);
    expect(p.tickets).toMatchObject({ open: 0, total: 1 });
    expect(p.phoneMasked).toMatch(/11$/);
    expect(p.phoneMasked).not.toContain('2340011');
    expect(w.id.repo.accessLogs.map((l) => [l.personId, l.purpose])).toEqual([
      [w.ids['regular'], CONSOLE_PEOPLE_PURPOSE],
    ]);

    await expect(
      w.people.customer(PersonInput.parse({ cityId: 'aziziyah', personId: 'nobody' }), 'staff_1'),
    ).rejects.toThrow();
  });

  it('story: orders and tickets newest first, paged by time', async () => {
    const w = await world();
    const placed = await orderHistory(w, w.ids['regular']!, 3, 3);
    w.tickets.push(ticket({ id: 't3', customerId: w.ids['regular']!, openedAt: w.o.clock.now() }));
    const first = await w.people.story(
      StoryInput.parse({
        cityId: 'aziziyah',
        personId: w.ids['regular']!,
        who: 'customer',
        limit: 2,
      }),
    );
    expect(first.items.map((i) => i.kind)).toEqual(['ticket', 'order']);
    expect(first.items[1]!.orderId).toBe(placed[2]);
    const rest = await w.people.story(
      StoryInput.parse({
        cityId: 'aziziyah',
        personId: w.ids['regular']!,
        who: 'customer',
        limit: 10,
        cursor: first.nextBefore!,
      }),
    );
    expect(rest.items.map((i) => i.orderId)).toEqual([placed[1], placed[0]]);
    const onlyTickets = await w.people.story(
      StoryInput.parse({
        cityId: 'aziziyah',
        personId: w.ids['regular']!,
        who: 'customer',
        kinds: ['ticket'],
      }),
    );
    expect(onlyTickets.items.map((i) => i.ticketId)).toEqual(['t3']);
  });

  it('driver: roles, cash against the cap, an empty week and no documents without the account module', async () => {
    const w = await world();
    const p = await w.people.driver(
      PersonInput.parse({ cityId: 'aziziyah', personId: w.ids['courier']! }),
      'staff_1',
    );
    expect(p.roles).toEqual(['courier']);
    expect(p.live).toBeNull();
    expect(p.daily).toHaveLength(14);
    expect(p.heat).toHaveLength(7);
    expect(p.heat[0]).toHaveLength(24);
    expect(p.cash.capIqd).toBeGreaterThan(0);
    await expect(
      w.people.driver(
        PersonInput.parse({ cityId: 'aziziyah', personId: w.ids['quiet']! }),
        'staff_1',
      ),
    ).rejects.toThrow();
  });

  it('revealPhone: support sees the whole number, one vault row under its own purpose', async () => {
    const w = await world();
    const agent = { personId: w.ids['agent']!, sessionId: 's' };
    const r = await w.people.revealPhone(agent, { personId: w.ids['quiet']!, reason: 'call_back' });
    expect(r.phone).toContain('7712340012');
    const rows = w.id.repo.accessLogs.filter((l) => l.purpose === STAFF_PHONE_REVEAL_PURPOSE);
    expect(rows.map((l) => [l.personId, l.accessorId, l.fieldsRead])).toEqual([
      [w.ids['quiet'], w.ids['agent'], ['phone_e164']],
    ]);
  });

  it('revealPhone: refused without a calling desk role, for oneself, and for staff unless admin', async () => {
    const w = await world();
    const as = (who: string) => ({ personId: w.ids[who]!, sessionId: 's' });
    const reveal = (who: string, target: string) =>
      w.id.service.staffRevealPhone(as(who), w.ids[target]!, 'call_back');
    await expect(reveal('finance', 'quiet')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(reveal('courier', 'quiet')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(reveal('agent', 'agent')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(reveal('agent', 'finance')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(reveal('admin', 'finance')).resolves.toContain('7712340016');
    await expect(
      w.id.service.staffRevealPhone(as('agent'), w.ids['quiet']!, 'curious' as never),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(w.id.repo.accessLogs.filter((l) => l.purpose === STAFF_PHONE_REVEAL_PURPOSE)).toHaveLength(1);
  });

  it('revealPhone: 30 an hour per staff member, then refused with a security alert', async () => {
    const w = await world();
    const agent = { personId: w.ids['agent']!, sessionId: 's' };
    for (let i = 0; i < STAFF_REVEAL_PER_HOUR; i += 1)
      await w.id.service.staffRevealPhone(agent, w.ids['quiet']!, 'call_back');
    await expect(w.id.service.staffRevealPhone(agent, w.ids['quiet']!, 'call_back')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(w.id.events.events.some((e) => e.type === PHONE_REVEAL_LIMIT_EVENT)).toBe(true);
    expect(w.id.repo.accessLogs.filter((l) => l.purpose === STAFF_PHONE_REVEAL_PURPOSE)).toHaveLength(STAFF_REVEAL_PER_HOUR);
  });
});

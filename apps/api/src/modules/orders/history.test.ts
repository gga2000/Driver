import { describe, expect, it } from 'vitest';
import { orderTicketNumber } from '@driver/contracts';
import { decodeCursor, encodeCursor, isLate } from './history.js';
import { ordersHarness } from './test-harness.js';

const T0 = new Date('2026-10-03T09:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

describe('lateness rule', () => {
  const base = { state: 'preparing' as const, placedAt: T0, scheduledFor: null, promisedReadyAt: null, pickedUpAt: null };

  it('late when the kitchen promise is 5+ min past and nobody picked it up', () => {
    const o = { ...base, promisedReadyAt: min(15) };
    expect(isLate(o, min(20))).toBe(false);
    expect(isLate(o, min(20.5))).toBe(true);
    expect(isLate({ ...o, state: 'picked_up', pickedUpAt: min(19) }, min(25))).toBe(false);
  });

  it('late when not delivered within 60 min of placement, or of its scheduled time', () => {
    expect(isLate({ ...base, state: 'picked_up' }, min(60))).toBe(false);
    expect(isLate({ ...base, state: 'picked_up' }, min(61))).toBe(true);
    expect(isLate({ ...base, state: 'placed', scheduledFor: min(120) }, min(150))).toBe(false);
    expect(isLate({ ...base, state: 'placed', scheduledFor: min(120) }, min(181))).toBe(true);
  });

  it('never late once delivered, closed, cancelled or disputed', () => {
    for (const state of ['delivered', 'closed', 'customer_cancelled', 'disputed', 'failed'] as const) expect(isLate({ ...base, state }, min(500))).toBe(false);
  });
});

describe('cursor', () => {
  it('round-trips and rejects junk', () => {
    const c = encodeCursor({ placedAt: T0, id: 'ord.with.dots' });
    expect(decodeCursor(c)).toEqual({ placedAt: T0, id: 'ord.with.dots' });
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('nonsense')).toBeNull();
    expect(decodeCursor('.x')).toBeNull();
  });
});

describe('OrdersService.search / liveStats (in-memory repository)', () => {
  async function seeded() {
    const h = ordersHarness('2026-10-03T09:00:00Z');
    h.merchants.add('rest_2', { location: { zoneKey: 'centre' } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const o = await h.orders.place(`c${i}`, h.foodInput({ ...(i === 3 ? { merchantOrgId: 'rest_2', note: 'بدون بصل' } : {}) }));
      ids.push(o.id);
      h.clock.advance(10 * 60_000);
    }
    await h.orders.cancel('c1', { orderId: ids[1]! });
    return { h, ids };
  }

  it('newest first, keyset pages that neither skip nor repeat', async () => {
    const { h, ids } = await seeded();
    const p1 = await h.orders.search({ cityId: 'aziziyah', limit: 2 });
    expect(p1.rows.map((r) => r.id)).toEqual([ids[4], ids[3]]);
    const p2 = await h.orders.search({ cityId: 'aziziyah', limit: 2, cursor: p1.nextCursor! });
    expect(p2.rows.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const p3 = await h.orders.search({ cityId: 'aziziyah', limit: 2, cursor: p2.nextCursor! });
    expect(p3.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect(p3.nextCursor).toBeNull();
  });

  it('filters by state (history included), merchant, type, text and placement window', async () => {
    const { h, ids } = await seeded();
    const q = (extra: object) => h.orders.search({ cityId: 'aziziyah', limit: 50, ...extra }).then((p) => p.rows.map((r) => r.id));
    expect(await q({ states: ['customer_cancelled'] })).toEqual([ids[1]]);
    expect(await q({ merchantOrgId: 'rest_2' })).toEqual([ids[3]]);
    expect(await q({ type: 'ride' })).toEqual([]);
    expect(await q({ text: 'بصل' })).toEqual([ids[3]]);
    expect(await q({ text: ids[2]!.toUpperCase() })).toEqual([ids[2]]);
    expect(await q({ from: new Date('2026-10-03T09:10:00Z'), to: new Date('2026-10-03T09:30:00Z') })).toEqual([ids[2], ids[1]]);
    expect(await q({ cityId: 'kut' })).toEqual([]);
  });

  it('summaries carry the late flag; liveStats counts the last hour, active and late orders', async () => {
    const { h, ids } = await seeded();
    // Now 09:50: the first order (09:00, still placed) is 50 min old; nothing is late yet.
    expect(await h.orders.liveStats('aziziyah')).toEqual({ ordersLastHour: 5, activeOrders: 4, lateOrders: 0 });
    h.clock.advance(15 * 60_000); // 10:05
    const stats = await h.orders.liveStats('aziziyah');
    expect(stats).toEqual({ ordersLastHour: 4, activeOrders: 4, lateOrders: 1 });
    const page = await h.orders.search({ cityId: 'aziziyah', limit: 50 });
    expect(page.rows.filter((r) => r.late).map((r) => r.id)).toEqual([ids[0]]);
    expect(page.rows.find((r) => r.id === ids[1])).toMatchObject({ state: 'customer_cancelled', late: false });
  });
});

describe('OrdersService.search by order number "#1284" (K-02)', () => {
  /** Three ids that share a ticket number (FNV collisions are rare but real), found deterministically. */
  function collidingIds(): [string, string, string] {
    const seen = new Map<string, string[]>();
    for (let i = 1; ; i += 1) {
      const id = `ord_t${i}`;
      const same = [...(seen.get(orderTicketNumber(id)) ?? []), id];
      if (same.length === 3) return [same[0]!, same[1]!, same[2]!];
      seen.set(orderTicketNumber(id), same);
    }
  }

  async function seeded() {
    const h = ordersHarness('2026-10-03T09:00:00Z');
    const template = await h.orders.place('c1', h.foodInput());
    const record = h.repo.orders.get(template.id)!;
    const [a, b, oldId] = collidingIds();
    const at = (iso: string) => new Date(iso);
    // a: this morning; b: yesterday evening (Baghdad); old: same ticket as a, three days ago.
    h.repo.orders.set(a, { ...record, id: a, placedAt: at('2026-10-03T08:30:00Z') });
    h.repo.orders.set(b, { ...record, id: b, placedAt: at('2026-10-02T18:00:00Z'), state: 'closed' });
    h.repo.orders.set(oldId, { ...record, id: oldId, placedAt: at('2026-09-30T12:00:00Z') });
    return { h, a, b, ticket: orderTicketNumber(a), templateId: template.id, oldId };
  }

  const ids = (p: { rows: Array<{ id: string }> }) => p.rows.map((r) => r.id);

  it('finds every order with that number since yesterday, newest first, however it is typed', async () => {
    const { h, a, b, ticket } = await seeded();
    const eastern = ticket.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    for (const text of [ticket, `#${ticket}`, ` # ${ticket} `, eastern]) {
      expect(ids(await h.orders.search({ cityId: 'aziziyah', limit: 50, text }))).toEqual([a, b]);
    }
  });

  it('other filters still apply; an explicit window reaches older days', async () => {
    const { h, a, b, ticket, oldId } = await seeded();
    expect(ids(await h.orders.search({ cityId: 'aziziyah', limit: 50, text: ticket, states: ['closed'] }))).toEqual([b]);
    expect(ids(await h.orders.search({ cityId: 'kut', limit: 50, text: ticket }))).toEqual([]);
    const wide = await h.orders.search({ cityId: 'aziziyah', limit: 50, text: ticket, from: new Date('2026-09-25T00:00:00Z') });
    expect(ids(wide)).toEqual([a, b, oldId]);
  });

  it('pages through collisions with the keyset cursor', async () => {
    const { h, a, b, ticket } = await seeded();
    const p1 = await h.orders.search({ cityId: 'aziziyah', limit: 1, text: `#${ticket}` });
    expect(ids(p1)).toEqual([a]);
    const p2 = await h.orders.search({ cityId: 'aziziyah', limit: 1, text: `#${ticket}`, cursor: p1.nextCursor! });
    expect(ids(p2)).toEqual([b]);
    expect(p2.nextCursor).toBeNull();
  });

  it('ids and text still search as before', async () => {
    const { h, a, templateId } = await seeded();
    const byId = ids(await h.orders.search({ cityId: 'aziziyah', limit: 50, text: a }));
    expect(byId).toContain(a);
    expect(byId.every((id) => id.includes(a))).toBe(true);
    expect(ids(await h.orders.search({ cityId: 'aziziyah', limit: 50, text: templateId }))).toEqual([templateId]);
    // A number of the template itself finds it (placed today).
    const own = await h.orders.search({ cityId: 'aziziyah', limit: 50, text: `#${orderTicketNumber(templateId)}` });
    expect(ids(own)).toContain(templateId);
  });
});

import { describe, expect, it } from 'vitest';
import { at, line, order, participant } from './fixtures';
import { countByFilter, filterOrders, groupLinesByParticipant, orderTimeline, priceCheck, priceRows } from './orders';

describe('orders list filters', () => {
  const list = [
    order({ id: 'ord-a', state: 'placed', placedAt: at(0) }),
    order({ id: 'ord-b', state: 'preparing', placedAt: at(5), type: 'grocery_catalog' }),
    order({ id: 'ord-c', state: 'picked_up', placedAt: at(10), merchantOrgId: 'kebab-house' }),
    order({ id: 'ord-d', state: 'disputed', placedAt: at(15) }),
  ];
  it('filters by state chip, type and text, newest first', () => {
    expect(filterOrders(list, { state: 'all', type: 'all', q: '' }).map((o) => o.id)).toEqual(['ord-d', 'ord-c', 'ord-b', 'ord-a']);
    expect(filterOrders(list, { state: 'kitchen', type: 'all', q: '' }).map((o) => o.id)).toEqual(['ord-b']);
    expect(filterOrders(list, { state: 'all', type: 'grocery_catalog', q: '' }).map((o) => o.id)).toEqual(['ord-b']);
    expect(filterOrders(list, { state: 'all', type: 'all', q: 'KEBAB' }).map((o) => o.id)).toEqual(['ord-c']);
    expect(filterOrders(list, { state: 'problem', type: 'food', q: '' }).map((o) => o.id)).toEqual(['ord-d']);
  });
  it('counts per chip', () => {
    const c = countByFilter(list);
    expect(c.all).toBe(4);
    expect(c.waiting_merchant).toBe(1);
    expect(c.on_the_way).toBe(1);
    expect(c.delivered).toBe(0);
  });
});

describe('order timeline', () => {
  it('lists only the timestamps that exist, oldest first, with minutes from placement', () => {
    const o = order({ id: 'x', acceptedAt: at(1), preparingAt: at(2), readyAt: at(14), pickedUpAt: at(16), deliveredAt: at(27) });
    expect(orderTimeline(o).map((e) => [e.step, e.offsetMin])).toEqual([
      ['placed', 0],
      ['accepted', 1],
      ['preparing', 2],
      ['ready', 14],
      ['picked_up', 16],
      ['delivered', 27],
    ]);
  });
  it('orders a schedule and a cancellation by time', () => {
    const o = order({ id: 'y', scheduledFor: at(60), cancelledAt: at(3) });
    expect(orderTimeline(o).map((e) => e.step)).toEqual(['placed', 'cancelled', 'scheduled']);
  });
});

describe('lines by person', () => {
  it('groups lines under participants; the orderer’s own lines first', () => {
    const o = order({
      id: 'z',
      participants: [participant({ id: 'p1', label: 'الكبير' }), participant({ id: 'p2', role: 'recipient' })],
      lines: [
        line({ id: 'l1', participantId: 'p1', qty: 2, unitPriceIqd: 3000 }),
        line({ id: 'l2', qty: 1, unitPriceIqd: 1500 }),
        line({ id: 'l3', participantId: 'p1', unitPriceIqd: 1000, availability: 'removed' }),
        line({ id: 'l4', participantId: 'ghost', unitPriceIqd: 500 }),
      ],
    });
    const g = groupLinesByParticipant(o);
    expect(g.map((x) => x.participant?.id ?? null)).toEqual([null, 'p1', 'p2']);
    expect(g[0]!.lines.map((l) => l.id)).toEqual(['l2', 'l4']);
    expect(g[0]!.subtotalIqd).toBe(2000);
    expect(g[1]!.subtotalIqd).toBe(6000);
    expect(g[2]!.lines).toEqual([]);
  });
});

describe('price components', () => {
  it('signs the discount, drops zero rows and checks the total', () => {
    const o = order({ id: 'p', itemsTotalIqd: 9000, deliveryFeeIqd: 1500, serviceFeeIqd: 500, discountIqd: 1000, tipIqd: 0, totalIqd: 10000 });
    expect(priceRows(o)).toEqual([
      { key: 'items', amountIqd: 9000 },
      { key: 'delivery', amountIqd: 1500 },
      { key: 'service', amountIqd: 500 },
      { key: 'discount', amountIqd: -1000 },
    ]);
    expect(priceCheck(o)).toEqual({ sumIqd: 10000, matches: true });
    expect(priceCheck({ ...o, totalIqd: 10250 }).matches).toBe(false);
  });
});

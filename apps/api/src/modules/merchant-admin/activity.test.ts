import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../events/index.js';
import { ticketNumber } from '../merchant/index.js';
import { activityActorIds, activityEntry, activityKindOf, composeActivity, type ActivityNames } from './activity.js';

const at = (min: number) => new Date(Date.UTC(2026, 9, 5, 6, 0) + min * 60_000); // 09:00 Baghdad + min

function ev(over: Partial<StoredEvent> & { type: string; actorId: string }, min = 0): StoredEvent {
  return {
    id: `ev_${over.type}_${min}`,
    occurredAt: at(min),
    recordedAt: at(min),
    aggregate: 'order',
    aggregateId: over.orderId ?? 'ord_1',
    payload: {},
    skewMs: 0,
    flagged: false,
    quarantined: false,
    ...over,
  } as StoredEvent;
}

const names: ActivityNames = { people: new Map([['p_mun', 'منتظر'], ['p_ali', 'علي'], ['p_gone', null]]), itemNames: new Map([['it_kas', 'كص']]), viewerId: 'p_owner' };

describe('«مين سوّى شنو» — event → kind', () => {
  it('maps every kitchen action, the automatic ones apart', () => {
    expect(activityKindOf(ev({ type: 'order.accepted', actorId: 'p_mun', payload: { auto: false, partial: false } }))).toBe('accept');
    expect(activityKindOf(ev({ type: 'order.accepted', actorId: 'system', payload: { auto: false } }))).toBe('auto_accept');
    expect(activityKindOf(ev({ type: 'order.auto_accepted', actorId: 'system', payload: { auto: true } }))).toBe('auto_accept');
    expect(activityKindOf(ev({ type: 'order.partial_proposed', actorId: 'p_mun' }))).toBe('partial');
    expect(activityKindOf(ev({ type: 'order.rejected', actorId: 'p_mun', payload: { reason: 'busy', auto: false } }))).toBe('reject');
    expect(activityKindOf(ev({ type: 'order.rejected', actorId: 'system', payload: { reason: 'merchant_timeout', auto: true } }))).toBe('auto_reject');
    expect(activityKindOf(ev({ type: 'order.ready', actorId: 'p_ali' }))).toBe('ready');
    expect(activityKindOf(ev({ type: 'order.prep_extended', actorId: 'p_ali' }))).toBe('extend');
    expect(activityKindOf(ev({ type: 'order.handed_over', actorId: 'p_ali' }))).toBe('hand_over');
    expect(activityKindOf(ev({ type: 'item.sold_out', actorId: 'p_ali' }))).toBe('sold_out');
    expect(activityKindOf(ev({ type: 'item.restocked', actorId: 'p_ali' }))).toBe('back_on');
    expect(activityKindOf(ev({ type: 'order.placed', actorId: 'c1' }))).toBeNull();
  });

  it('leaves out what the kitchen did not press: the customer approving a partial order, a ready implied by the pickup', () => {
    const approved = ev({ type: 'order.accepted', actorId: 'cust_1', payload: { auto: false, partial: true } });
    const implied = ev({ type: 'order.ready', actorId: 'courier_1', payload: { implied: true } });
    expect(activityKindOf(approved)).toBeNull();
    expect(activityKindOf(implied)).toBeNull();
    // …so neither the customer's nor the courier's id ever goes to the vault read.
    expect(activityActorIds([approved, implied, ev({ type: 'order.ready', actorId: 'p_ali' }), ev({ type: 'order.ready', actorId: 'p_ali' }, 1), ev({ type: 'order.auto_accepted', actorId: 'system' })])).toEqual(['p_ali']);
  });
});

describe('«مين سوّى شنو» — rows', () => {
  it('an order row carries its ticket, who, and the reason of a rejection', () => {
    const row = activityEntry(ev({ type: 'order.rejected', actorId: 'p_mun', orderId: 'ord_6347', payload: { reason: 'busy' } }, 41), names)!;
    expect(row).toEqual({ at: at(41), kind: 'reject', orderId: 'ord_6347', orderNumber: ticketNumber('ord_6347'), dishName: null, until: null, who: { personId: 'p_mun', name: 'منتظر', you: false }, reason: 'busy' });
    const timeout = activityEntry(ev({ type: 'order.rejected', actorId: 'system', orderId: 'ord_2', payload: { auto: true } }), names)!;
    expect(timeout).toMatchObject({ kind: 'auto_reject', who: null, reason: 'merchant_timeout' });
  });

  it('a dish row carries its name and until; the viewer is `you`; an unknown or deleted person has a null name', () => {
    const until = at(15 * 60).toISOString();
    const soldOut = activityEntry(ev({ type: 'item.sold_out', actorId: 'p_owner', aggregate: 'org', aggregateId: 'org_1', payload: { itemId: 'it_kas', until } }), names)!;
    expect(soldOut).toMatchObject({ kind: 'sold_out', orderId: null, orderNumber: null, dishName: 'كص', until: new Date(until), who: { personId: 'p_owner', name: null, you: true } });
    expect(activityEntry(ev({ type: 'item.restocked', actorId: 'p_gone', aggregate: 'org', aggregateId: 'org_1', payload: { itemId: 'it_x' } }), names)).toMatchObject({ kind: 'back_on', dishName: null, until: null, who: { personId: 'p_gone', name: null, you: false } });
  });

  it('the day: newest first, only inside the window, capped at 200', () => {
    const events = [ev({ type: 'order.accepted', actorId: 'p_mun' }, -30), ev({ type: 'order.accepted', actorId: 'p_mun' }, 1), ev({ type: 'order.ready', actorId: 'p_ali' }, 20), ev({ type: 'order.placed', actorId: 'c1' }, 5)];
    const day = composeActivity({ merchantOrgId: 'org_1', localDate: '2026-10-05', events, names, window: { from: at(0), to: at(24 * 60) } });
    expect(day.entries.map((e) => [e.kind, e.who?.name])).toEqual([
      ['ready', 'علي'],
      ['accept', 'منتظر'],
    ]);
    const many = Array.from({ length: 230 }, (_, i) => ev({ type: 'order.ready', actorId: 'p_ali', id: `ev_${i}` } as never, i));
    const capped = composeActivity({ merchantOrgId: 'org_1', localDate: '2026-10-05', events: many, names, window: { from: at(0), to: at(24 * 60) } });
    expect(capped.entries).toHaveLength(200);
    expect(capped.entries[0]!.at).toEqual(at(229));
  });
});

import { describe, expect, it } from 'vitest';
import type { Order } from '@driver/contracts';
import { canReorder, dayKey, lastReorderable, sectionByDay, shortStatus } from './history';

// 2026-10-05 14:00 in Baghdad (UTC+3).
const NOW = new Date('2026-10-05T11:00:00Z');
const at = (iso: string) => new Date(iso);

function row(id: string, state: Order['state'], placedAt: Date, over: Partial<Order> = {}) {
  return { order: { id, state, placedAt, type: 'food', merchantOrgId: 'org_1', ordererId: 'me', ...over } as Order };
}

describe('dayKey (Baghdad days)', () => {
  it('says today and yesterday by the Baghdad calendar, not UTC', () => {
    expect(dayKey(at('2026-10-04T21:30:00Z'), NOW)).toEqual({ kind: 'today' }); // 00:30 on the 5th in Baghdad
    expect(dayKey(at('2026-10-04T20:30:00Z'), NOW)).toEqual({ kind: 'yesterday' }); // 23:30 on the 4th
    expect(dayKey(at('2026-10-02T09:00:00Z'), NOW)).toEqual({ kind: 'date', weekday: 5, day: 2, month: 10, year: 2026, thisYear: true });
    expect(dayKey(at('2025-12-30T09:00:00Z'), NOW)).toMatchObject({ kind: 'date', year: 2025, thisYear: false });
  });
});

describe('sectionByDay', () => {
  it('pins running orders on top, then groups the rest by day, newest first', () => {
    const rows = [
      row('old', 'closed', at('2026-09-26T10:00:00Z')),
      row('y1', 'delivered', at('2026-10-04T15:00:00Z')),
      row('live', 'preparing', at('2026-10-05T10:50:00Z')),
      row('t1', 'customer_cancelled', at('2026-10-05T08:00:00Z')),
      row('y2', 'closed', at('2026-10-04T09:00:00Z')),
    ];
    const s = sectionByDay(rows, NOW);
    expect(s.map((x) => [x.running, x.day?.kind ?? null, x.rows.map((r) => r.order.id)])).toEqual([
      [true, null, ['live']],
      [false, 'today', ['t1']],
      [false, 'yesterday', ['y1', 'y2']],
      [false, 'date', ['old']],
    ]);
  });
});

describe('shortStatus and reorder eligibility', () => {
  it('gives the list one short word per state, rides reading as rides', () => {
    expect(shortStatus({ state: 'delivered', type: 'food' })).toBe('delivered');
    expect(shortStatus({ state: 'closed', type: 'food' })).toBe('done');
    expect(shortStatus({ state: 'placed', type: 'food' })).toBe('waiting');
    expect(shortStatus({ state: 'placed', type: 'ride' })).toBe('searching');
    expect(shortStatus({ state: 'platform_cancelled', type: 'food' })).toBe('cancelled');
    expect(shortStatus({ state: 'ready', type: 'food' })).toBe('preparing');
  });

  it('offers "اطلبه مرة ثانية" only on food that reached the door', () => {
    expect(canReorder({ type: 'food', state: 'closed', merchantOrgId: 'o' })).toBe(true);
    expect(canReorder({ type: 'food', state: 'delivered', merchantOrgId: 'o' })).toBe(true);
    expect(canReorder({ type: 'food', state: 'merchant_rejected', merchantOrgId: 'o' })).toBe(false);
    expect(canReorder({ type: 'food', state: 'preparing', merchantOrgId: 'o' })).toBe(false);
    expect(canReorder({ type: 'ride', state: 'completed', merchantOrgId: null })).toBe(false);
  });

  it('picks the newest delivered food order of the last 30 days for the home card, my own only', () => {
    const rows = [
      row('cancelled', 'customer_cancelled', at('2026-10-05T08:00:00Z')),
      row('mine', 'closed', at('2026-10-03T08:00:00Z')),
      row('theirs', 'closed', at('2026-10-04T08:00:00Z'), { ordererId: 'friend' }),
      row('older', 'closed', at('2026-10-01T08:00:00Z')),
      row('ancient', 'closed', at('2026-08-01T08:00:00Z')),
    ];
    expect(lastReorderable(rows, NOW, 'me')?.order.id).toBe('mine');
    expect(lastReorderable([rows[4]!], NOW, 'me')).toBeNull();
  });
});

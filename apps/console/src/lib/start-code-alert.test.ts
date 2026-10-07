import { describe, expect, it } from 'vitest';
import type { StartCodeAlert } from '@driver/contracts';
import { startCodeDetail, startCodeOrder, startCodeTitle } from './start-code-alert';

const at = (min: number) => new Date(Date.UTC(2026, 9, 7, 19, 0) + min * 60_000); // 10:00 م Baghdad

const alert = (id: string, over: Partial<StartCodeAlert> = {}): StartCodeAlert => ({
  alertId: id,
  cityId: 'aziziyah',
  orderId: 'ord_7f3a91',
  tripId: 'trp_1',
  vertical: 'taxi',
  driver: { personId: 'd1', displayName: 'حيدر ك.', phoneMasked: '0770 ••• ••01' },
  wrongCount: 5,
  raisedAt: at(0),
  startedAt: null,
  ...over,
});

describe('night trip-code alerts on the strip (ride s1)', () => {
  it('names the driver and the count, never the code', () => {
    expect(startCodeTitle(alert('s1'))).toBe('حيدر ك. كتب رمز المشوار غلط 5 مرات');
    expect(startCodeTitle(alert('s1', { driver: { personId: 'd1', displayName: null, phoneMasked: null } }))).toContain('غلط 5 مرات');
  });
  it('says the ride, whether the rider got in since, and how long ago', () => {
    const waiting = startCodeDetail(alert('s1', { vertical: 'tuktuk' }), at(3).getTime());
    expect(waiting).toContain('بالليل');
    expect(waiting).toContain('المشوار بعده ما بدأ');
    expect(startCodeDetail(alert('s1', { startedAt: at(2) }), at(3).getTime())).toContain('الراكب صعد بعدها بالرمز الصحيح');
  });
  it('rides still waiting first, newest first', () => {
    const rows = [alert('a', { raisedAt: at(1), startedAt: at(2) }), alert('b', { raisedAt: at(0) }), alert('c', { raisedAt: at(5) })];
    expect(startCodeOrder(rows).map((r) => r.alertId)).toEqual(['c', 'b', 'a']);
  });
});

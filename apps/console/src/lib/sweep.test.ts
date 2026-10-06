import { describe, expect, it } from 'vitest';
import type { KhatSweepAlert } from '@driver/contracts';
import { sweepDetail, sweepOrder, sweepTitle } from './sweep';

const at = (min: number) => new Date(Date.UTC(2026, 9, 6, 4, 40) + min * 60_000); // 7:40 ص Baghdad

const alert = (id: string, endedMin: number, over: Partial<KhatSweepAlert> = {}): KhatSweepAlert => ({
  alertId: id,
  tripId: `trip_${id}`,
  cityId: 'aziziyah',
  driver: { personId: 'd1', displayName: 'حيدر ك.', phoneMasked: '+96477*****01' },
  childrenTotal: 4,
  lastDropAt: at(endedMin),
  lastDropZone: 'centre',
  runEndedAt: at(endedMin),
  raisedAt: at(endedMin + 5),
  confirmedAt: null,
  confirmedLateMin: null,
  closedAt: null,
  closedById: null,
  closeReason: null,
  closeNote: null,
  ...over,
});

describe('sweep alert strip', () => {
  it('shows open alerts first (oldest run first), then late confirms (latest first)', () => {
    const rows = [alert('a', 0, { confirmedAt: at(7), confirmedLateMin: 7 }), alert('b', 3), alert('c', 1), alert('d', 0, { confirmedAt: at(9), confirmedLateMin: 9 })];
    expect(sweepOrder(rows).map((r) => r.alertId)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('drops an alert a dispatcher closed (the server leaves it out too)', () => {
    const rows = [alert('a', 0), alert('b', 1, { closedAt: at(9), closedById: 'p_disp', closeReason: 'guardian_called' })];
    expect(sweepOrder(rows).map((r) => r.alertId)).toEqual(['a']);
  });

  it('names the driver, the run, the last drop and how long ago; a late confirm says how late', () => {
    const open = alert('a', 0);
    expect(sweepTitle(open)).toBe('حيدر ك. ما تأكد إن السيارة فاضية');
    const line = sweepDetail(open, at(6).getTime());
    expect(line).toMatch(/^خط اليوم #\d{4} · /);
    expect(line).toContain('آخر نزول 7:40');
    expect(line).toContain('قبل 6 د');
    expect(sweepTitle(alert('a', 0, { confirmedAt: at(7), confirmedLateMin: 7 }))).toBe('حيدر ك. تأكد متأخر 7 دقايق');
    expect(sweepDetail(alert('a', 0, { confirmedAt: at(7), confirmedLateMin: 7 }), at(8).getTime())).toContain('السيارة فاضية، ماكو شي مطلوب');
  });

  it('a run that ended on an absence (no drop) shows when it ended; a driver with no name reads "سايق"', () => {
    const a = alert('a', 0, { lastDropAt: null, lastDropZone: null, driver: { personId: 'd1', displayName: null, phoneMasked: null } });
    expect(sweepDetail(a, at(5).getTime())).toContain('خلص الخط 7:40');
    expect(sweepTitle(a)).toBe('سايق ما تأكد إن السيارة فاضية');
  });
});

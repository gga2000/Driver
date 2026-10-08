import { describe, expect, it } from 'vitest';
import type { ShiftSummary } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { dayLine, shareCardModel, shareFileName, shiftRange, shiftStats, tomorrowLine } from './shift-logic';

const t = createT('ar-IQ');

function summary(over: Partial<ShiftSummary> = {}): ShiftSummary {
  return {
    driverId: 'd1',
    from: new Date('2026-10-05T12:00:00Z'), // 3:00 م Baghdad
    to: new Date('2026-10-05T16:00:00Z'), // 7:00 م
    onlineMinutes: 240,
    jobs: 7,
    netIqd: 15_000,
    tipsIqd: 2_000,
    perHourIqd: 3_750,
    bestHour: { from: new Date('2026-10-05T10:00:00Z'), to: new Date('2026-10-05T11:00:00Z'), netIqd: 4_500, jobs: 2 },
    day: { netIqd: 15_000, jobs: 7 },
    cash: { heldIqd: 68_500, owedIqd: 54_500, capIqd: 75_000, overCap: false },
    tomorrow: { from: new Date('2026-10-06T10:00:00Z'), to: new Date('2026-10-06T12:00:00Z'), orders: 12 },
    nudge: null,
    guarantee: [],
    compliments: [],
    minKm: null,
    ...over,
  };
}

describe('end of shift words (S-4)', () => {
  it('the range on the Baghdad clock with ص/م and the length as a duration', () => {
    expect(shiftRange(summary(), t)).toBe('من 3:00 م لـ 7:00 م · 4 ساعات');
  });

  it('stats: jobs, time online, tips only when there were some, best hour as its start time with its money', () => {
    const s = shiftStats(summary(), t);
    expect(s.map((x) => x.key)).toEqual(['jobs', 'online', 'tips', 'best']);
    expect(s.find((x) => x.key === 'best')).toMatchObject({ value: '1:00 م', sub: '4,500 دينار بهالساعة' });
    expect(s.find((x) => x.key === 'tips')?.value).toBe('2,000 دينار');
    expect(shiftStats(summary({ tipsIqd: 0, bestHour: null, jobs: 0 }), t).map((x) => x.key)).toEqual(['jobs', 'online']);
  });

  it('the whole day only when it holds more than this shift; tomorrow in words', () => {
    expect(dayLine(summary(), t)).toBeNull();
    expect(dayLine(summary({ day: { netIqd: 21_000, jobs: 9 } }), t)).toBe('اليوم كله: 21,000 دينار · 9 طلبات');
    expect(tomorrowLine(summary(), t)).toBe('أكثر طلبات بين 1:00 و3:00 م');
    expect(tomorrowLine(summary({ tomorrow: { from: new Date('2026-10-06T08:00:00Z'), to: new Date('2026-10-06T10:00:00Z'), orders: 9 } }), t)).toBe('أكثر طلبات بين 11:00 ص و1:00 م');
    expect(tomorrowLine(summary({ tomorrow: null }), t)).toBeNull();
  });

  it('the shared picture says the same numbers, and is named by the Baghdad date', () => {
    const m = shareCardModel(summary(), t, new Date('2026-10-05T17:00:00Z'));
    expect(m).toMatchObject({ title: 'يومي ويا درايفر', net: '15,000', currency: 'دينار', perHour: 'تقريباً 3,750 دينار لكل ساعة شغل' });
    expect(m.date).toBe('اليوم · من 3:00 م لـ 7:00 م · 4 ساعات');
    expect(m.stats.map((x) => x.label)).toEqual(['الطلبات', 'وقت الشغل', 'أحسن ساعة']);
    expect(shareCardModel(summary({ perHourIqd: null }), t).perHour).toBeNull();
    expect(shareFileName({ to: new Date('2026-10-05T22:30:00Z') })).toBe('driver-day-2026-10-06.png');
    expect(m.quote).toBeNull();
  });

  it('«يومك» (e7): the km as «أكثر من», in place of time online on the picture, and the most-said word', () => {
    const s = summary({ minKm: 23, compliments: [{ key: 'fast', count: 3 }, { key: 'polite', count: 1 }] });
    expect(shiftStats(s, t).find((x) => x.key === 'km')).toMatchObject({ label: 'قطعت', value: 'أكثر من 23 كم' });
    const m = shareCardModel(s, t);
    expect(m.stats.map((x) => x.label)).toEqual(['الطلبات', 'قطعت', 'أحسن ساعة']);
    expect(m.quote).toBe('الزبائن قالوا عني: «سريع»');
  });
});

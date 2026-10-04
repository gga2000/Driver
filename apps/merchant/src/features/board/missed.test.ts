import { describe, expect, it } from 'vitest';
import type { MissedOrder } from '@driver/contracts';
import { addSeen, missNudge, parseSeen, SEEN_MAX, unseenMissed } from './missed';
import { baghdadDay, shiftGateNeeded } from './shift';

const NOW = Date.parse('2026-10-04T18:00:00Z');
const miss = (id: string, minutesAgo: number, reason: MissedOrder['reason'] = 'merchant_timeout'): MissedOrder => ({
  orderId: id,
  number: id.slice(-4),
  reason,
  placedAt: new Date(NOW - (minutesAgo + 2) * 60_000),
  missedAt: new Date(NOW - minutesAgo * 60_000),
  itemCount: 3,
  totalIqd: 15_250,
  scored: true,
});

describe('missed orders never vanish (M-01)', () => {
  it('stay in the strip until the kitchen taps "تمام"', () => {
    const missed = [miss('ord_7603', 1), miss('ord_1151', 5)];
    expect(unseenMissed(missed, new Set()).map((m) => m.orderId)).toEqual(['ord_7603', 'ord_1151']);
    expect(unseenMissed(missed, new Set(['ord_7603'])).map((m) => m.orderId)).toEqual(['ord_1151']);
    expect(unseenMissed(missed, new Set(['ord_7603', 'ord_1151']))).toEqual([]);
  });

  it('two of the kitchen\'s own misses in 30 min suggest busy mode or a short close', () => {
    expect(missNudge([miss('a', 1)], new Set(), NOW)).toBe(false);
    expect(missNudge([miss('a', 1), miss('b', 20)], new Set(), NOW)).toBe(true);
    // Older than 30 minutes doesn't count; neither does a partial accept the customer let lapse.
    expect(missNudge([miss('a', 1), miss('b', 45)], new Set(), NOW)).toBe(false);
    expect(missNudge([miss('a', 1), miss('b', 3, 'partial_timeout')], new Set(), NOW)).toBe(false);
    // Once both are acknowledged the nudge goes away.
    expect(missNudge([miss('a', 1), miss('b', 20)], new Set(['a', 'b']), NOW)).toBe(false);
  });

  it('keeps the acknowledged ids across reloads, newest last, bounded', () => {
    expect(parseSeen(null)).toEqual(new Set());
    expect(parseSeen('not json')).toEqual(new Set());
    expect(parseSeen('["a", 3, "b"]')).toEqual(new Set(['a', 'b']));
    expect(addSeen(new Set(['a', 'b']), ['b', 'c'])).toEqual(['a', 'b', 'c']);
    const many = Array.from({ length: SEEN_MAX + 5 }, (_, i) => `o${i}`);
    expect(addSeen(new Set(), many)).toHaveLength(SEEN_MAX);
  });
});

describe('"ابدأ الشغل" gate (M-04)', () => {
  it('shows until the shift was started today (Baghdad day), and again the next day', () => {
    expect(baghdadDay(Date.parse('2026-10-04T20:59:00Z'))).toBe('2026-10-04');
    expect(baghdadDay(Date.parse('2026-10-04T21:00:00Z'))).toBe('2026-10-05');
    expect(shiftGateNeeded(null, NOW)).toBe(true);
    expect(shiftGateNeeded('2026-10-04', NOW)).toBe(false);
    expect(shiftGateNeeded('2026-10-03', NOW)).toBe(true);
  });
});

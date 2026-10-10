import { contrastRatio } from '@driver/design-tokens';
import { describe, expect, it } from 'vitest';
import { COUNTER } from './counter';

/** Every word the counter draws in its own colours passes WCAG AA (4.5:1). */
const TEXT_PAIRS: [fg: keyof typeof COUNTER, bg: keyof typeof COUNTER, use: string][] = [
  ['onDate', 'date', 'store name and chips on the status bar'],
  ['onDateMuted', 'date', 'second line on the status bar'],
  ['onDate', 'dateRaised', 'neutral chips on the status bar'],
  ['onDateReady', 'date', '«مفتوح» on the status bar'],
  ['onDateLate', 'date', 'closed / missed text on the status bar'],
  ['busy', 'date', 'busy mode text on the status bar'],
  ['onBusy', 'busy', 'the busy chip'],
  ['onDate', 'newBadge', 'count on the new lane'],
  ['onDate', 'ready', 'count on the ready lane'],
  ['date', 'paper', 'ticket text'],
  ['qty', 'paper', 'quantities on a ticket'],
  ['late', 'lateWash', '«متأخر» on a late ticket'],
  ['qty', 'lateWash', 'quantities on a late ticket'],
  ['date', 'laneNew', 'lane title'],
  ['date', 'laneCooking', 'lane title'],
  ['date', 'laneReady', 'lane title'],
  ['kindDrink', 'kindDrinkWash', 'a drink\'s mark on a ticket'],
  ['kindSweet', 'kindSweetWash', 'a sweet\'s mark on a ticket'],
  ['kindDrink', 'paper', 'a drink\'s mark on the paper'],
  ['kindSweet', 'paper', 'a sweet\'s mark on the paper'],
];

describe('counter colours', () => {
  it.each(TEXT_PAIRS)('%s on %s (%s) passes AA', (fg, bg) => {
    expect(contrastRatio(COUNTER[fg], COUNTER[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('has no blue or teal', () => {
    for (const hex of Object.values(COUNTER)) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // Blue/teal: blue is the strongest channel by a clear margin.
      expect(b > r + 20 && b >= g, `${hex} reads as blue`).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { formatClock, formatClockInline } from './format';

describe('formatClockInline (VIS-19)', () => {
  it('keeps ص / م on the same line as the time', () => {
    const at = Date.UTC(2026, 9, 8, 6, 5); // 9:05 ص in Baghdad
    expect(formatClock(at)).toContain(' ');
    expect(formatClockInline(at)).toBe(formatClock(at).replace(' ', ' '));
    expect(formatClockInline(at)).not.toContain(' ');
  });
});
